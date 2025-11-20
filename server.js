require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const crypto = require('crypto');
const path = require('path');

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

// ---------- MIDDLEWARE ----------
app.use(cors()); // allow all origins (easy for Squarespace + testing)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// ---------- STATIC FRONT-END ----------

// Serve everything from /public (e.g. BCC.html, index.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Cornerstone auth + token API listening on port ${PORT}`);
});
