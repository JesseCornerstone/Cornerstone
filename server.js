require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const crypto = require('crypto'); // NEW: for generating secure tokens

const app = express();

// ----- DB config (Azure SQL / SQL Server) -----
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,               // required for Azure SQL
    trustServerCertificate: false
  }
};

// Create a single connection pool for the whole app
const poolPromise = sql.connect(dbConfig);

// Base URL for the BCC report page (where ?key=... links will land)
const REPORT_BASE_URL =
  process.env.REPORT_BASE_URL ||
  'https://cornerstoneplus-hqhferewfdhsh4b0.australiaeast-01.azurewebsites.net/BCC.html';

// ----- Middleware -----
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests from our frontend origin(s), or no-origin (curl, same-origin fetch)
    const allowed = (process.env.FRONTEND_ORIGIN || '').split(',').filter(Boolean);

    if (!origin) {
      // No origin (e.g. curl, server-side, or same-origin) – allow
      return cb(null, true);
    }

    if (allowed.length === 0 || allowed.includes(origin)) {
      return cb(null, true);
    }

    // If you need Squarespace here, add its origin into FRONTEND_ORIGIN in .env
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));

app.use(express.json());

app.use(session({
  name: 'cs_sess',
  secret: process.env.SESSION_SECRET || 'change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true'
  }
}));

// ----- Helper: map DB row to safe user object -----
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

// ----- Auth / user routes -----
// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Current user (used by API.me in your HTML)
app.get('/api/me', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.session.userId)
      .query('SELECT TOP 1 id, first_name, last_name, email, company, role, created_at FROM users WHERE id = @id');

    const user = mapUser(result.recordset[0]);
    return res.json({ user });
  } catch (err) {
    console.error('GET /api/me error', err);
    return res.status(500).json({ user: null });
  }
});

// Register (used by /api/auth/register)
app.post('/api/auth/register', async (req, res) => {
  const { first_name, last_name, email, company, role, password } = req.body || {};
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  try {
    const pool = await poolPromise;

    // Check if email already exists
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT TOP 1 id FROM users WHERE email = @email');

    if (existing.recordset.length) {
      return res.status(400).json({ ok: false, error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);

    const insert = await pool.request()
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
    req.session.userId = user.id; // auto sign-in after register
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /api/auth/register error', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Login (used by /api/auth/login)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT TOP 1 id, first_name, last_name, email, company, role, created_at, password_hash FROM users WHERE email = @email');

    if (!result.recordset.length) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }

    const row = result.recordset[0];
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }

    const user = mapUser(row);
    req.session.userId = user.id;
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /api/auth/login error', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Logout (used by /api/auth/logout)
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

// ----- ONE-TIME REPORT TOKEN ENDPOINTS -----
// Helper: generate a URL-safe random token
function generateToken(byteLength = 32) {
  const buf = crypto.randomBytes(byteLength);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// POST /api/create-token
// Body: { "email": "user@example.com", "orderId": "SQUARESPACE-ORDER-ID" }
app.post('/api/create-token', async (req, res) => {
  try {
    const { email, orderId } = req.body || {};

    if (!email || !orderId) {
      return res.status(400).send('Missing email or orderId.');
    }

    const token = generateToken(32);
    const pool = await poolPromise;

    const insertSql = `
      INSERT INTO dbo.ReportAccessTokens (Token, UserEmail, PaymentId, ExpiresAt)
      VALUES (@Token, @UserEmail, @PaymentId, DATEADD(HOUR, 24, SYSUTCDATETIME()));
    `;

    await pool.request()
      .input('Token', sql.NVarChar(128), token)
      .input('UserEmail', sql.NVarChar(320), email)
      .input('PaymentId', sql.NVarChar(100), orderId)
      .query(insertSql);

    const sep = REPORT_BASE_URL.includes('?') ? '&' : '?';
    const reportUrl = `${REPORT_BASE_URL}${sep}key=${token}`;

    return res.json({ reportUrl });
  } catch (err) {
    console.error('Error in /api/create-token:', err);
    return res.status(500).send('Failed to create token.');
  }
});

// POST /api/finalise-token?key=...
app.post('/api/finalise-token', async (req, res) => {
  try {
    const key = req.query.key;

    if (!key) {
      return res.status(400).send('Missing key.');
    }

    const pool = await poolPromise;

    const updateSql = `
      UPDATE dbo.ReportAccessTokens
      SET Used = 1,
          UsedAt = SYSUTCDATETIME()
      WHERE Token = @Token
        AND Used = 0
        AND ExpiresAt > SYSUTCDATETIME();
    `;

    const result = await pool.request()
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

// ----- Static front-end -----
// Serve static front-end if you put files in ./public (BCC.html etc.)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cornerstone auth + token API listening on port ${PORT}`);
});
