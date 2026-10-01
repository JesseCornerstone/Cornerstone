const express = require('express');
const path = require('path');

const { createVaApiAuth } = require('./src/va/auth');
const { VaJobStore } = require('./src/va/job-store');
const { createVaRouter } = require('./src/va/routes');

const app = express();
const port = positiveInteger(process.env.PORT, 3112);
const host = String(process.env.VA_REPORT_HOST || '127.0.0.1').trim();
const storageDir = path.resolve(
  process.env.VA_STORAGE_DIR || path.join(__dirname, 'storage')
);
const store = new VaJobStore({
  storageDir,
  reportsDir: path.join(storageDir, 'reports')
});

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(
  '/__va-report-ui',
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    index: false,
    maxAge: 0
  })
);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'lot-wise-report-service',
    documentApi: true
  });
});

app.use(
  '/api/va',
  createVaApiAuth(),
  createVaRouter({ store, getBaseUrl })
);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Lot Companion Report Service error:', err);
  return res.status(err.status || 500).json({
    ok: false,
    error: err.type === 'entity.parse.failed'
      ? 'The request body is not valid JSON.'
      : 'The report API could not process the request.'
  });
});

app.listen(port, host, () => {
  console.log(`Lot Companion Report Service listening on ${host}:${port}`);
});

function getBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || '').trim();
  return configured || `${req.protocol}://${req.get('host')}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}
