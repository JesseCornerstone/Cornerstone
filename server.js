require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const sql = require('mssql');

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

// ----- Middleware -----
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests from our frontend origin or localhost
    const allowed = (process.env.FRONTEND_ORIGIN || '').split(',').filter(Boolean);
    if (!origin || allowed.length === 0 || allowed.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
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
    sameSite: 'lax',
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

// ----- Routes -----
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

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Serve static frontend
app.use(express.static('public'));

// Azure gives us PORT via env
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

