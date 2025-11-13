require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sql = require('mssql');

const app = express();

// ---------- Health check ----------
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ---------- DB config ----------
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

const poolPromise = sql.connect(dbConfig);

poolPromise
  .then(() => console.log('✅ Connected to SQL database'))
  .catch(err => {
    console.error('❌ Failed to connect to SQL database', err);
    // don’t throw – we want the app to stay up so we can see JSON errors
  });

// ---------- Middleware ----------
app.use(express.json());

app.use(session({
  name: 'cs_sess',
  secret: process.env.SESSION_SECRET || 'change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false // true if HTTPS + custom domain only
  }
}));

// Map DB row to JSON
function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.Id,
    first_name: row.FirstName,
    last_name: row.LastName,
    email: row.Email,
    company: row.Company,
    role: row.Role,
    created_at: row.CreatedAt
  };
}

// ---------- API: current user ----------
app.get('/api/me', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ user: null });
    }

    const pool = await poolPromise;
    if (!pool) {
      return res.status(500).json({ user: null, error: 'No DB connection' });
    }

    const result = await pool.request()
      .input('Id', sql.Int, req.session.userId)
      .query(`
        SELECT TOP 1
          Id,
          FirstName,
          LastName,
          Email,
          Company,
          Role,
          CreatedAt
        FROM [dbo].[Users]
        WHERE Id = @Id
      `);

    const user = userFromRow(result.recordset[0]);
    return res.json({ user });
  } catch (err) {
    console.error('GET /api/me error', err);
    return res.status(500).json({
      user: null,
      error: 'Server error',
      detail: err.message       // DEBUG
    });
  }
});

// ---------- API: register ----------
app.post('/api/auth/register', async (req, res) => {
  const { first_name, last_name, email, company, role, password } = req.body || {};

  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  try {
    const pool = await poolPromise;
    if (!pool) {
      return res.status(500).json({ ok: false, error: 'No DB connection' });
    }

    // Check if email already exists
    const existing = await pool.request()
      .input('Email', sql.NVarChar, email)
      .query('SELECT 1 FROM [dbo].[Users] WHERE Email = @Email');

    if (existing.recordset.length) {
      return res.status(400).json({ ok: false, error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);

    const insert = await pool.request()
      .input('FirstName', sql.NVarChar, first_name)
      .input('LastName', sql.NVarChar, last_name)
      .input('Email', sql.NVarChar, email)
      .input('Company', sql.NVarChar, company || null)
      .input('Role', sql.NVarChar, role || null)
      .input('PasswordHash', sql.NVarChar, hash)
      .query(`
        INSERT INTO [dbo].[Users] (
          FirstName,
          LastName,
          Email,
          Company,
          Role,
          PasswordHash
        )
        OUTPUT
          INSERTED.Id,
          INSERTED.FirstName,
          INSERTED.LastName,
          INSERTED.Email,
          INSERTED.Company,
          INSERTED.Role,
          INSERTED.CreatedAt
        VALUES (
          @FirstName,
          @LastName,
          @Email,
          @Company,
          @Role,
          @PasswordHash
        )
      `);

    const user = userFromRow(insert.recordset[0]);
    req.session.userId = user.id;
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /api/auth/register error', err);
    return res.status(500).json({
      ok: false,
      error: 'Server error',
      detail: err.message      // DEBUG – this is the bit we want to see
    });
  }
});

// ---------- API: login ----------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }

  try {
    const pool = await poolPromise;
    if (!pool) {
      return res.status(500).json({ ok: false, error: 'No DB connection' });
    }

    const result = await pool.request()
      .input('Email', sql.NVarChar, email)
      .query(`
        SELECT TOP 1
          Id,
          FirstName,
          LastName,
          Email,
          Company,
          Role,
          PasswordHash,
          CreatedAt
        FROM [dbo].[Users]
        WHERE Email = @Email
      `);

    if (!result.recordset.length) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }

    const row = result.recordset[0];
    const match = await bcrypt.compare(password, row.PasswordHash);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }

    const user = userFromRow(row);
    req.session.userId = user.id;
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /api/auth/login error', err);
    return res.status(500).json({
      ok: false,
      error: 'Server error',
      detail: err.message      // DEBUG
    });
  }
});

// ---------- API: logout ----------
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error', err);
      return res.status(500).json({ ok: false, error: 'Server error', detail: err.message });
    }
    res.clearCookie('cs_sess');
    return res.json({ ok: true });
  });
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cornerstone auth server listening on port ${PORT}`);
});
