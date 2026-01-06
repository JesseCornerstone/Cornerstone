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

const app = express();

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
  process.env.REPORT_BASE_URL ||
  'https://cornerstoneplus-hqhferewfdhsh4b0.australiaeast-01.azurewebsites.net/BCC.html';
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15 MB cap keeps uploads reasonable
  }
});

// ---------- MIDDLEWARE ----------
app.use(cors()); // allow all origins (easy for Squarespace + testing)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Compress responses to speed up asset delivery (especially map JS/CSS)
app.use(compression());

app.use(
  session({
    name: 'cs_sess',
    secret: process.env.SESSION_SECRET || 'change-me-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: process.env.COOKIE_SAME_SITE || 'lax',
      secure: process.env.COOKIE_SECURE === 'true'
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

function getBaseUrl(req) {
  if (APP_BASE_URL) return APP_BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}

function sanitizeReturnPath(value, fallback = 'BCC.html') {
  if (!value || typeof value !== 'string') return fallback;
  if (value.includes('://')) return fallback;
  let cleaned = value.replace(/^\/+/, '');
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
    /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:m2|sqm|square metres?|mA�)/i;

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
  } catch (err) {
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

// Simple ping to confirm app is running
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Health check - just returns ok (no DB)
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
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
    res.clearCookie('cs_sess');
    return res.json({ ok: true });
  });
});

// ---------- ONE-TIME TOKEN ROUTES ----------

// Create token from Squarespace order
// Body: { "email": "user@example.com", "orderId": "SQUARESPACE-ORDER-ID" }
app.post('/api/create-token', async (req, res) => {
  try {
    const { email, orderId } = req.body || {};
    console.log('🔑 /api/create-token hit with:', email, orderId);

    if (!email || !orderId) {
      return res.status(400).send('Missing email or orderId.');
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).send('DB connection failed.');
    }

    const token = generateToken(32);

    const insertSql = `
      INSERT INTO dbo.ReportAccessTokens (Token, UserEmail, PaymentId, ExpiresAt)
      VALUES (@Token, @UserEmail, @PaymentId, DATEADD(HOUR, 24, SYSUTCDATETIME()));
    `;

    await pool
      .request()
      .input('Token', sql.NVarChar(128), token)
      .input('UserEmail', sql.NVarChar(320), email)
      .input('PaymentId', sql.NVarChar(100), orderId)
      .query(insertSql);

    const sep = REPORT_BASE_URL.includes('?') ? '&' : '?';
    const reportUrl = `${REPORT_BASE_URL}${sep}key=${token}`;

    console.log('🔗 Report URL:', reportUrl);
    return res.json({ reportUrl });
  } catch (err) {
    console.error('Error in /api/create-token:', err);
    return res.status(500).send('Failed to create token.');
  }
});

// Check token validity without consuming it
// GET /api/check-token?key=...
app.get('/api/check-token', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) {
      return res.status(400).json({ ok: false, error: 'Missing key.' });
    }

    const pool = await getPool();
    if (!pool) {
      return res
        .status(500)
        .json({ ok: false, error: 'DB connection failed' });
    }

    const result = await pool
      .request()
      .input('Token', sql.NVarChar(128), key)
      .query(
        `
        SELECT TOP 1 Token, ExpiresAt, Used
        FROM dbo.ReportAccessTokens
        WHERE Token = @Token
      `
      );

    if (!result.recordset.length) {
      return res.status(404).json({ ok: false, error: 'Invalid token.' });
    }

    const row = result.recordset[0];
    if (row.Used) {
      return res.status(409).json({ ok: false, error: 'Token already used.' });
    }

    const expiresAt = new Date(row.ExpiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return res.status(500).json({ ok: false, error: 'Invalid expiry.' });
    }

    if (expiresAt <= new Date()) {
      return res.status(410).json({ ok: false, error: 'Token expired.' });
    }

    return res.json({
      ok: true,
      expiresAt: expiresAt.toISOString()
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
    const key = req.query.key;
    console.log('🧹 /api/finalise-token hit with:', key);

    if (!key) {
      return res.status(400).send('Missing key.');
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).send('DB connection failed.');
    }

    const updateSql = `
      UPDATE dbo.ReportAccessTokens
      SET Used = 1,
          UsedAt = SYSUTCDATETIME()
      WHERE Token = @Token
        AND Used = 0
        AND ExpiresAt > SYSUTCDATETIME();
    `;

    const result = await pool
      .request()
      .input('Token', sql.NVarChar(128), key)
      .query(updateSql);

    if (!result.rowsAffected || result.rowsAffected[0] === 0) {
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
  return res.json({ paymentUrl: PAYMENT_URL || null });
});

// ---------- STRIPE CHECKOUT ----------

// Start Stripe Checkout and redirect the user to Stripe
// GET /api/stripe/checkout?return=BCC.html
app.get('/api/stripe/checkout', async (req, res) => {
  try {
    if (!stripe || !STRIPE_PRICE_ID) {
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

    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).send('Missing session_id.');
    }

    const returnPath = sanitizeReturnPath(req.query.return);
    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== 'paid') {
      return res.redirect(303, `${baseUrl}/${returnPath}`);
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).send('DB connection failed.');
    }

    const token = generateToken(32);
    const email =
      session.customer_details?.email || session.customer_email || null;

    const insertSql = `
      INSERT INTO dbo.ReportAccessTokens (Token, UserEmail, PaymentId, ExpiresAt)
      VALUES (@Token, @UserEmail, @PaymentId, DATEADD(HOUR, 24, SYSUTCDATETIME()));
    `;

    await pool
      .request()
      .input('Token', sql.NVarChar(128), token)
      .input('UserEmail', sql.NVarChar(320), email)
      .input('PaymentId', sql.NVarChar(100), session.id)
      .query(insertSql);

    const sep = returnPath.includes('?') ? '&' : '?';
    return res.redirect(303, `${baseUrl}/${returnPath}${sep}key=${token}`);
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
        'User-Agent': 'CornerstoneMapping/1.0 (+https://cornerstonebc.com.au)'
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

// ---------- STATIC FRONT-END ----------

// Serve everything from /public (e.g. BCC.html, index.html, etc.)
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '30d', // cache static assets aggressively
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        // keep HTML uncached so updates ship immediately
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Cornerstone auth + token API listening on port ${PORT}`);
});
