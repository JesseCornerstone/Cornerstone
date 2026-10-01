require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');
const compression = require('compression');
const Stripe = require('stripe');
const { createVaApiAuth } = require('./src/va/auth');
const { VaJobStore } = require('./src/va/job-store');
const { createVaRouter } = require('./src/va/routes');

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim();
const TOKEN_ISSUER_API_KEY = (process.env.TOKEN_ISSUER_API_KEY || '').trim();

if (IS_PRODUCTION && SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
}

// ---------- DB CONFIG (Azure SQL) ----------
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// Lazy connection pool – avoids crashing the app if SQL is down
let pool = null;
async function getPool() {
  if (pool && pool.connected) return pool;
  try {
    pool = await sql.connect(dbConfig);
    console.log('✅ Connected to SQL');
    return pool;
  } catch (err) {
    console.error('❌ DB connection error:', err);
    return null; // routes will handle null and return 500
  }
}

// Where BCC.html lives (we append ?key=... to this)
const REPORT_BASE_URL =
  (process.env.REPORT_BASE_URL || '').trim();
const PAYMENT_URL = (process.env.PAYMENT_URL || '').trim();
const APP_BASE_URL = (process.env.APP_BASE_URL || '').trim();
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || '').trim();
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const ARCGIS_FEATURE_URL = (process.env.ARCGIS_FEATURE_URL || '').trim();
const ARCGIS_TOKEN = process.env.ARCGIS_TOKEN || '';
const ENABLE_POD_ARCGIS = process.env.ENABLE_POD_ARCGIS === 'true';
const DEV_I_BASE =
  process.env.DEV_I_BASE ||
  'https://developmenti.brisbane.qld.gov.au';
const VA_STORAGE_DIR =
  process.env.VA_STORAGE_DIR || path.join(__dirname, 'storage');
const vaJobStore = new VaJobStore({
  storageDir: VA_STORAGE_DIR,
  reportsDir: path.join(VA_STORAGE_DIR, 'reports')
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15 MB cap keeps uploads reasonable
  }
});

// ---------- MIDDLEWARE ----------
app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
// Compress responses to speed up asset delivery (especially map JS/CSS)
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(
  session({
    name: 'lot_wise_sess',
    secret: SESSION_SECRET || 'local-development-only-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: process.env.COOKIE_SAME_SITE || 'lax',
      secure:
        process.env.COOKIE_SECURE === undefined
          ? IS_PRODUCTION
          : process.env.COOKIE_SECURE === 'true'
    }
  })
);

// ---------- HELPERS ----------
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    company: row.company,
    role: row.role,
    created_at: row.created_at
  };
}

function generateToken(byteLength = 32) {
  const buf = crypto.randomBytes(byteLength);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const tokenStore = new Map();
const paymentTokenIndex = new Map();

function createInMemoryToken(email, paymentId) {
  const paymentKey = String(paymentId || '').trim();
  if (paymentKey && paymentTokenIndex.has(paymentKey)) {
    const existingToken = paymentTokenIndex.get(paymentKey);
    return {
      token: existingToken,
      record: tokenStore.get(existingToken) || null,
      duplicate: true
    };
  }

  const token = generateToken(32);
  const now = Date.now();
  const expiresAt = now + TOKEN_TTL_MS;
  tokenStore.set(token, {
    token,
    email: email || null,
    paymentId: paymentId || null,
    createdAt: now,
    expiresAt,
    used: false,
    usedAt: null
  });
  if (paymentKey) paymentTokenIndex.set(paymentKey, token);
  return { token, expiresAt, record: tokenStore.get(token), duplicate: false };
}

function getTokenRecord(token) {
  if (!token) return null;
  const rec = tokenStore.get(token);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    tokenStore.delete(token);
    return { expired: true };
  }
  return rec;
}

function markTokenUsed(token) {
  const rec = getTokenRecord(token);
  if (!rec || rec.expired) return null;
  if (rec.used) return null;
  rec.used = true;
  rec.usedAt = Date.now();
  return rec;
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenIssuerKeyFromRequest(req) {
  const headerKey = req.get('x-api-key');
  if (headerKey) return headerKey.trim();
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireTokenIssuerKey(req, res, next) {
  if (!TOKEN_ISSUER_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'Token issuing is not configured.'
    });
  }

  if (!safeStringEqual(tokenIssuerKeyFromRequest(req), TOKEN_ISSUER_API_KEY)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }

  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of tokenStore.entries()) {
    if (rec.expiresAt <= now) tokenStore.delete(key);
  }
}, 15 * 60 * 1000);

function getBaseUrl(req) {
  if (APP_BASE_URL) return APP_BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}

function sanitizeReturnPath(value, fallback = 'BCC.html') {
  if (!value || typeof value !== 'string') return fallback;
  if (value.includes('://')) return fallback;
  const cleaned = value.replace(/^\/+/, '');
  if (!/^[A-Za-z0-9._-]+\.html$/.test(cleaned)) return fallback;
  return cleaned;
}

function parseSubdivisionsFromText(text) {
  if (!text) return [];

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const subdivisions = [];
  const pushCurrent = current => {
    if (!current) return;
    if (!current.lot && !current.plan) return;
    current.areaSqm =
      typeof current.areaSqm === 'number' && Number.isFinite(current.areaSqm)
        ? current.areaSqm
        : null;
    const key = `${current.lot || ''}_${current.plan || ''}`;
    const duplicate = subdivisions.find(
      sub => `${sub.lot}_${sub.plan}` === key
    );
    if (!duplicate) {
      subdivisions.push({
        lot: current.lot || null,
        plan: current.plan || null,
        areaSqm: current.areaSqm,
        raw: current.raw
      });
    }
  };

  let current = null;
  const planRegex = /\b((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/i;
  const lotRegex = /\b(?:lot|lot\s*no\.?)\s*[:#-]?\s*([0-9A-Za-z-]+)\b/i;
  const areaRegex =
    /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:m(?:2|²)|sqm|square metres?)/i;

  lines.forEach(line => {
    const normalised = line.replace(/\s+/g, ' ');
    const lotMatch = normalised.match(lotRegex);
    const planMatch = normalised.match(planRegex);
    const areaMatch = normalised.match(areaRegex);

    const shouldStartNew =
      !current ||
      (lotMatch && current.lot && lotMatch[1].toUpperCase() !== current.lot) ||
      (planMatch &&
        current.plan &&
        planMatch[1].replace(/\s+/g, '').toUpperCase() !== current.plan);

    if (shouldStartNew) {
      pushCurrent(current);
      current = { lot: null, plan: null, areaSqm: null, raw: normalised };
    }

    if (!current) {
      current = { lot: null, plan: null, areaSqm: null, raw: normalised };
    } else {
      current.raw = normalised;
    }

    if (lotMatch) {
      current.lot = lotMatch[1].toUpperCase();
    }
    if (planMatch) {
      current.plan = planMatch[1].replace(/\s+/g, '').toUpperCase();
    }
    if (areaMatch) {
      const parsedArea = Number(areaMatch[1].replace(/,/g, ''));
      if (!Number.isNaN(parsedArea)) {
        current.areaSqm = parsedArea;
      }
    }
  });

  pushCurrent(current);
  return subdivisions;
}

async function pushSubdivisionsToArcGis(subdivisions, meta = {}) {
  if (!subdivisions || subdivisions.length === 0) {
    return { skipped: true, reason: 'No subdivisions parsed' };
  }
  if (!ARCGIS_FEATURE_URL || !ARCGIS_TOKEN) {
    return {
      skipped: true,
      reason: 'ArcGIS feature URL or token missing from environment'
    };
  }

  const now = Date.now();
  const trimmedUrl = ARCGIS_FEATURE_URL.replace(/\/+$/, '');
  const features = subdivisions.map(sub => ({
    attributes: {
      LotNumber: sub.lot || null,
      PlanNumber: sub.plan || null,
      AreaSqm: sub.areaSqm ?? null,
      SourceFile: meta.sourceFile || null,
      UploadedAtUTC: now,
      UploadedBy: meta.userId || null,
      RawText: sub.raw || null
    }
  }));

  const body = new URLSearchParams({
    f: 'json',
    features: JSON.stringify(features),
    rollbackOnFailure: 'false',
    token: ARCGIS_TOKEN
  });

  const arcgisResp = await fetch(`${trimmedUrl}/addFeatures`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  let arcgisJson = {};
  try {
    arcgisJson = await arcgisResp.json();
  } catch {
    throw new Error('ArcGIS response was not JSON');
  }

  if (!arcgisResp.ok || arcgisJson.error) {
    const message =
      arcgisJson?.error?.message ||
      arcgisJson?.error?.details?.join('; ') ||
      'ArcGIS addFeatures call failed';
    throw new Error(message);
  }

  return arcgisJson;
}

// Optional: log unhandled errors instead of silently killing the app
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

// ---------- BASIC / AUTH ROUTES ----------

// Lightweight liveness endpoint.
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Health check does not require a database connection.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'lot-wise-application' });
});

// Current user
app.get('/api/me', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ user: null });
    }

    const pool = await getPool();
    if (!pool) {
      return res
        .status(500)
        .json({ user: null, error: 'DB connection failed' });
    }

    const result = await pool
      .request()
      .input('id', sql.Int, req.session.userId)
      .query(`
        SELECT TOP 1 id, first_name, last_name, email, company, role, created_at
        FROM users
        WHERE id = @id
      `);

    const user = mapUser(result.recordset[0]);
    return res.json({ user });
  } catch (err) {
    console.error('GET /api/me error', err);
    return res.status(500).json({ user: null });
  }
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const { first_name, last_name, email, company, role, password } =
    req.body || {};
  if (!first_name || !last_name || !email || !password) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing required fields' });
  }

  try {
    const pool = await getPool();
    if (!pool) {
      return res
        .status(500)
        .json({ ok: false, error: 'DB connection failed' });
    }

    const existing = await pool
      .request()
      .input('email', sql.NVarChar, email)
      .query('SELECT TOP 1 id FROM users WHERE email = @email');

    if (existing.recordset.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);

    const insert = await pool
      .request()
      .input('first_name', sql.NVarChar, first_name)
      .input('last_name', sql.NVarChar, last_name)
      .input('email', sql.NVarChar, email)
      .input('company', sql.NVarChar, company || null)
      .input('role', sql.NVarChar, role || null)
      .input('password_hash', sql.NVarChar, hash)
      .query(`
        INSERT INTO users (first_name, last_name, email, company, role, password_hash)
        OUTPUT INSERTED.id, INSERTED.first_name, INSERTED.last_name, INSERTED.email,
               INSERTED.company, INSERTED.role, INSERTED.created_at
        VALUES (@first_name, @last_name, @email, @company, @role, @password_hash)
      `);

    const user = mapUser(insert.recordset[0]);
    req.session.userId = user.id;
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /api/auth/register error', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res
      .status(400)
      .json({ ok: false, error: 'Email and password required' });
  }

  try {
    const pool = await getPool();
    if (!pool) {
      return res
        .status(500)
        .json({ ok: false, error: 'DB connection failed' });
    }

    const result = await pool
      .request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT TOP 1 id, first_name, last_name, email, company, role, created_at, password_hash
        FROM users
        WHERE email = @email
      `);

    if (!result.recordset.length) {
      return res
        .status(401)
        .json({ ok: false, error: 'Invalid email or password' });
    }

    const row = result.recordset[0];
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res
        .status(401)
        .json({ ok: false, error: 'Invalid email or password' });
    }

    const user = mapUser(row);
    req.session.userId = user.id;
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /api/auth/login error', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
    res.clearCookie('lot_wise_sess');
    return res.json({ ok: true });
  });
});

// ---------- ONE-TIME TOKEN ROUTES ----------

// Create token from Squarespace order
// Body: { "email": "user@example.com", "orderId": "SQUARESPACE-ORDER-ID" }
// Header: x-api-key: <TOKEN_ISSUER_API_KEY>
app.post('/api/create-token', requireTokenIssuerKey, async (req, res) => {
  try {
    const { email, orderId } = req.body || {};
    const normalisedEmail = String(email || '').trim().toLowerCase();
    const normalisedOrderId = String(orderId || '').trim();

    if (
      !normalisedEmail ||
      normalisedEmail.length > 254 ||
      !normalisedOrderId ||
      normalisedOrderId.length > 200
    ) {
      return res.status(400).json({
        ok: false,
        error: 'A valid email and orderId are required.'
      });
    }

    const issued = createInMemoryToken(normalisedEmail, normalisedOrderId);
    if (issued.duplicate) {
      return res.status(409).json({
        ok: false,
        error: 'Access has already been issued for this order.'
      });
    }

    const reportBaseUrl =
      REPORT_BASE_URL || `${getBaseUrl(req)}/BCC.html`;
    const sep = reportBaseUrl.includes('?') ? '&' : '?';
    const reportUrl = `${reportBaseUrl}${sep}key=${issued.token}`;

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, reportUrl });
  } catch (err) {
    console.error('Error in /api/create-token:', err);
    return res.status(500).send('Failed to create token.');
  }
});

// Check token validity without consuming it
// GET /api/check-token?key=...
app.get('/api/check-token', async (req, res) => {
  try {
    const key = String(req.query.key || '').trim();
    res.setHeader('Cache-Control', 'no-store');
    if (!key || key.length > 256) {
      return res.status(400).json({ ok: false, error: 'Missing key.' });
    }

    const rec = getTokenRecord(key);
    if (!rec) {
      return res.status(404).json({ ok: false, error: 'Invalid token.' });
    }
    if (rec.expired) {
      return res.status(410).json({ ok: false, error: 'Token expired.' });
    }
    if (rec.used) {
      return res.status(409).json({ ok: false, error: 'Token already used.' });
    }

    return res.json({
      ok: true,
      expiresAt: new Date(rec.expiresAt).toISOString()
    });
  } catch (err) {
    console.error('Error in /api/check-token:', err);
    return res.status(500).json({ ok: false, error: 'Failed to check token.' });
  }
});

// Finalise (use) a token after printing
// POST /api/finalise-token?key=...
app.post('/api/finalise-token', async (req, res) => {
  try {
    const key = String(req.query.key || '').trim();
    res.setHeader('Cache-Control', 'no-store');

    if (!key || key.length > 256) {
      return res.status(400).send('Missing key.');
    }

    const rec = markTokenUsed(key);
    if (!rec || rec.expired) {
      return res
        .status(400)
        .send('This report link is invalid, expired, or already used.');
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('Error in /api/finalise-token:', err);
    return res.status(500).send('Failed to finalise token.');
  }
});

// Payment link config (optional)
app.get('/api/payment-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ paymentUrl: PAYMENT_URL || null });
});

// ---------- STRIPE CHECKOUT ----------

// Start Stripe Checkout and redirect the user to Stripe
// GET /api/stripe/checkout?return=BCC.html
app.get('/api/stripe/checkout', async (req, res) => {
  try {
    if (!stripe || !STRIPE_PRICE_ID) {
      if (PAYMENT_URL) {
        return res.redirect(303, PAYMENT_URL);
      }
      return res
        .status(500)
        .send('Stripe is not configured. Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID.');
    }

    const returnPath = sanitizeReturnPath(req.query.return);
    const baseUrl = getBaseUrl(req);
    const successUrl = `${baseUrl}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}&return=${encodeURIComponent(
      returnPath
    )}`;
    const cancelUrl = `${baseUrl}/${returnPath}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true
    });

    return res.redirect(303, session.url);
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).send('Failed to start Stripe checkout.');
  }
});

// Stripe success redirect: validate session, create token, redirect to map
// GET /api/stripe/success?session_id=...&return=BCC.html
app.get('/api/stripe/success', async (req, res) => {
  try {
    if (!stripe) {
      return res
        .status(500)
        .send('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
    }

    const rawSessionId = req.query.session_id;
    const sessionId = Array.isArray(rawSessionId)
      ? rawSessionId[rawSessionId.length - 1]
      : rawSessionId;
    if (!sessionId) {
      return res.status(400).send('Missing session_id.');
    }

    const returnPath = sanitizeReturnPath(req.query.return);
    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== 'paid') {
      return res.redirect(303, `${baseUrl}/${returnPath}`);
    }

    const email =
      session.customer_details?.email || session.customer_email || null;
    const issued = createInMemoryToken(email, session.id);
    if (!issued.token || !issued.record) {
      return res.redirect(303, `${baseUrl}/${returnPath}`);
    }

    return res.redirect(
      303,
      `${baseUrl}/${returnPath}?key=${encodeURIComponent(issued.token)}`
    );
  } catch (err) {
    console.error('Stripe success error:', err);
    return res.status(500).send('Failed to finalise payment.');
  }
});

// ---------- POD / SUBDIVISION IMPORT ----------

app.post(
  '/api/subdivisions/import',
  upload.single('pod'),
  async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res
          .status(400)
          .json({ ok: false, error: 'Please attach a POD PDF.' });
      }

      if (
        req.file.mimetype &&
        req.file.mimetype !== 'application/pdf' &&
        !req.file.originalname.toLowerCase().endsWith('.pdf')
      ) {
        return res
          .status(400)
          .json({ ok: false, error: 'Only PDF POD documents are supported.' });
      }

      const parsed = await pdfParse(req.file.buffer);
      const text = parsed && typeof parsed.text === 'string' ? parsed.text : '';
      if (!text) {
        return res.status(422).json({
          ok: false,
          error: 'PDF did not contain readable text. Please try another file.'
        });
      }

      const subdivisions = parseSubdivisionsFromText(text);
      let arcgis = null;
      let arcgisError = null;
      if (ENABLE_POD_ARCGIS) {
        try {
          arcgis = await pushSubdivisionsToArcGis(subdivisions, {
            sourceFile: req.file.originalname,
            userId: req.session?.userId || null
          });
        } catch (err) {
          arcgisError = err.message || 'ArcGIS upload failed';
          console.error('ArcGIS import error', err);
        }
      } else {
        arcgis = {
          skipped: true,
          reason: 'ArcGIS upload disabled. Property detection only for now.'
        };
      }

      return res.json({
        ok: true,
        subdivisions,
        count: subdivisions.length,
        arcgis,
        arcgisError,
        textSample: text.slice(0, 4000)
      });
    } catch (err) {
      console.error('POST /api/subdivisions/import error', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to process POD document.' });
    }
  }
);

// ---------- DEVELOPMENT.I PROXY ----------

app.get('/api/dev-i/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ ok: false, error: 'Missing q parameter' });
  }
  const upstreamUrl = `${DEV_I_BASE}/Geo/AddressCompoundSearch?searchTerm=${encodeURIComponent(
    query
  )}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'LotCompanionMapping/1.0'
      }
    });
    const text = await upstream.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error('DEV-I JSON parse error', err, text.slice(0, 200));
      return res
        .status(502)
        .json({ ok: false, error: 'Development.i returned invalid JSON' });
    }
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('GET /api/dev-i/search error', err);
    return res.status(502).json({ ok: false, error: 'Lookup failed' });
  }
});

// ---------- VISUAL APPROVALS / VA INTEGRATION ----------

app.use(
  '/__va-report-ui',
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    index: false,
    maxAge: 0
  })
);
app.use('/api/va', createVaApiAuth(), createVaRouter({ store: vaJobStore, getBaseUrl }));

// ---------- STATIC FRONT-END ----------

// Serve everything from /public (e.g. BCC.html, index.html, etc.)
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '30d', // cache static assets aggressively
    etag: true,
    setHeaders: (res, filePath) => {
      const normalisedPath = filePath.replace(/\\/g, '/');
      if (
        filePath.endsWith('.html') ||
        normalisedPath.endsWith('/public/theme.js') ||
        normalisedPath.endsWith('/public/file-protocol-guard.js') ||
        normalisedPath.includes('/public/Js/')
      ) {
        // keep HTML and page-brain modules uncached so updates ship immediately
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lot Companion application service listening on port ${PORT}`);
});
