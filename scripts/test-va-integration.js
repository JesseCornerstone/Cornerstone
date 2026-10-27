const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { findAvailablePort } = require('../src/local-launcher-utils');

const appRoot = path.resolve(__dirname, '..');
const defaultStorageDir = path.join(appRoot, 'storage-demo', 'test-storage');
const defaultDownloadDir = path.join(appRoot, 'storage-demo', 'test-downloads');

let fetch;
let serverProcess = null;
let stoppingServer = false;
const serverLog = [];

main()
  .then(async () => {
    await stopManagedServer();
  })
  .catch(async err => {
    console.error(`VA integration smoke test failed: ${err.message}`);
    if (serverLog.length) {
      console.error('\nRecent server output:');
      console.error(serverLog.slice(-30).join('').trim());
    }
    await stopManagedServer();
    process.exitCode = 1;
  });

async function main() {
  ensureDependencies();
  fetch = require('node-fetch');

  const apiKey = getApiKey();
  const baseUrl = getExternalBaseUrl() || (await startManagedServer(apiKey));
  const requestId = await runSmokeTest(baseUrl, apiKey);

  console.log('');
  console.log('VA integration smoke test passed.');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Request ID: ${requestId}`);
}

async function runSmokeTest(baseUrl, apiKey) {
  console.log(`Testing VA integration at ${baseUrl}`);

  console.log('1. Checking server health...');
  const health = await fetchJson(baseUrl, '/api/health', { auth: false });
  assert(health && health.ok === true, 'Health endpoint did not return ok=true.');

  const payload = samplePayload();

  console.log('2. Generating a report directly (no UI or polling)...');
  const direct = await generateReportDirectly(baseUrl, apiKey, payload);
  assert(direct.requestId, 'Direct generation did not return a request ID header.');
  assert(
    ['complete', 'manual_review'].includes(direct.status),
    `Direct generation returned unexpected status ${direct.status || 'none'}.`
  );
  console.log(`   Generated ${direct.bytes} bytes for request ${direct.requestId}.`);

  console.log('3. Creating asynchronous VA report request...');
  const created = await fetchJson(baseUrl, '/api/va/report-request', {
    apiKey,
    method: 'POST',
    expectedStatus: 202,
    body: payload
  });
  assert(created.ok === true, 'Create response did not return ok=true.');
  assert(created.requestId, 'Create response did not include requestId.');
  assert(created.links && created.links.status, 'Create response did not include status link.');
  console.log(`   Accepted request ${created.requestId}.`);

  console.log('4. Polling report status...');
  const finalStatus = await pollReportStatus(baseUrl, apiKey, created.requestId);
  assert(
    ['complete', 'manual_review'].includes(finalStatus.status),
    `Expected complete or manual_review, got ${finalStatus.status}.`
  );
  assert(finalStatus.report, 'Final status did not include report metadata.');
  if (finalStatus.status === 'manual_review') {
    const reasons = finalStatus.manualReviewReasons || [];
    console.log(`   Final status is manual_review with ${reasons.length} reason(s).`);
  } else {
    console.log('   Final status is complete.');
  }

  console.log('5. Checking JSON summary...');
  const summary = await fetchJson(
    baseUrl,
    `/api/va/report-summary/${encodeURIComponent(created.requestId)}`,
    { apiKey }
  );
  assert(summary.ok === true, 'Summary response did not return ok=true.');
  assert(summary.summary, 'Summary response did not include summary.');

  console.log('6. Checking admin report list...');
  const admin = await fetchJson(baseUrl, '/api/va/admin/reports?limit=10', { apiKey });
  assert(admin.ok === true, 'Admin list did not return ok=true.');
  assert(Array.isArray(admin.jobs), 'Admin list did not include jobs array.');
  assert(
    admin.jobs.some(job => job.requestId === created.requestId),
    'Admin list did not include the created request.'
  );
  assert(
    admin.jobs.some(job => job.requestId === direct.requestId),
    'Admin list did not include the directly generated request.'
  );

  console.log('7. Downloading the asynchronous report...');
  const download = await downloadReport(baseUrl, apiKey, created.requestId);
  console.log(`   Saved ${download.bytes} bytes to ${download.filePath}`);

  return created.requestId;
}

async function generateReportDirectly(baseUrl, apiKey, payload) {
  const url = new URL('/api/va/report-generate', `${baseUrl}/`).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/pdf'
    },
    body: JSON.stringify(payload),
    timeout: parsePositiveInt(process.env.VA_TEST_TIMEOUT_MS, 10 * 60 * 1000)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Direct generation returned ${res.status}: ${text}`);
  }

  const contentType = res.headers.get('content-type') || '';
  assert(
    contentType.toLowerCase().includes('application/pdf'),
    `Direct generation was not a PDF: ${contentType}`
  );

  const buffer = await res.buffer();
  assert(buffer.length > 100, `Directly generated PDF was too small (${buffer.length} bytes).`);
  assert(buffer.slice(0, 5).toString('ascii') === '%PDF-', 'Direct response did not start with %PDF-.');

  return {
    bytes: buffer.length,
    requestId: res.headers.get('x-lot-wise-request-id') || '',
    status: res.headers.get('x-lot-wise-report-status') || '',
    manualReview: res.headers.get('x-lot-wise-manual-review') === 'true'
  };
}

async function startManagedServer(apiKey) {
  const preferredPort = parsePositiveInt(process.env.VA_TEST_PORT || process.env.PORT, 3122);
  const port = await findAvailablePort(preferredPort, 30, {
    fallbackPort: 3122,
    errorMessage: 'No available local test port found.'
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const storageDir = process.env.VA_TEST_STORAGE_DIR || defaultStorageDir;

  console.log(`Starting local test server on ${baseUrl}...`);
  serverProcess = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(port),
      APP_BASE_URL: baseUrl,
      VA_API_KEYS: apiKey,
      VA_REQUIRE_HTTPS: 'false',
      VA_STORAGE_DIR: storageDir
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverProcess.stdout.on('data', chunk => rememberServerLog(chunk));
  serverProcess.stderr.on('data', chunk => rememberServerLog(chunk));
  serverProcess.once('exit', (code, signal) => {
    if (!stoppingServer) {
      rememberServerLog(`Test server exited early with code ${code} signal ${signal}.\n`);
    }
  });

  await waitForHealth(baseUrl);
  return baseUrl;
}

async function stopManagedServer() {
  if (!serverProcess || serverProcess.killed || serverProcess.exitCode !== null) return;

  stoppingServer = true;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 2500);
    serverProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    serverProcess.kill();
  });
}

async function waitForHealth(baseUrl) {
  const started = Date.now();
  const timeoutMs = parsePositiveInt(process.env.VA_TEST_START_TIMEOUT_MS, 15000);

  while (Date.now() - started < timeoutMs) {
    try {
      const health = await fetchJson(baseUrl, '/api/health', {
        auth: false,
        timeoutMs: 1000
      });
      if (health && health.ok === true) return;
    } catch (err) {
      await wait(350);
    }
  }

  throw new Error('Local test server did not become healthy.');
}

async function pollReportStatus(baseUrl, apiKey, requestId) {
  const timeoutMs = parsePositiveInt(
    process.env.VA_TEST_TIMEOUT_MS,
    10 * 60 * 1000
  );
  const pollMs = parsePositiveInt(process.env.VA_TEST_POLL_MS, 650);
  const started = Date.now();
  let lastStatus = null;

  while (Date.now() - started < timeoutMs) {
    const status = await fetchJson(
      baseUrl,
      `/api/va/report-status/${encodeURIComponent(requestId)}`,
      { apiKey }
    );
    lastStatus = status.status || 'unknown';
    if (status.status === 'failed') {
      throw new Error(status.error || 'VA report status returned failed.');
    }
    if (['complete', 'manual_review'].includes(status.status)) {
      return status;
    }
    await wait(pollMs);
  }

  throw new Error(`Timed out waiting for report status. Last status: ${lastStatus || 'none'}.`);
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const url = new URL(pathname, `${baseUrl}/`).toString();
  const headers = {
    ...(options.auth === false ? {} : { 'x-api-key': options.apiKey || getApiKey() }),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeout: options.timeoutMs || 10000
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`${options.method || 'GET'} ${pathname} returned non-JSON: ${text.slice(0, 300)}`);
  }

  const expectedStatus = options.expectedStatus;
  if (expectedStatus && res.status !== expectedStatus) {
    throw new Error(`${options.method || 'GET'} ${pathname} returned ${res.status}, expected ${expectedStatus}: ${text}`);
  }
  if (!expectedStatus && !res.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} returned ${res.status}: ${text}`);
  }
  if (json && json.ok === false) {
    throw new Error(json.error || `${options.method || 'GET'} ${pathname} returned ok=false.`);
  }

  return json;
}

async function downloadReport(baseUrl, apiKey, requestId) {
  const url = new URL(
    `/api/va/report-download/${encodeURIComponent(requestId)}`,
    `${baseUrl}/`
  ).toString();
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    timeout: 30000
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download returned ${res.status}: ${text}`);
  }

  const contentType = res.headers.get('content-type') || '';
  assert(contentType.toLowerCase().includes('application/pdf'), `Download was not a PDF: ${contentType}`);

  const buffer = await res.buffer();
  assert(buffer.length > 100, `Downloaded PDF was too small (${buffer.length} bytes).`);
  assert(buffer.slice(0, 5).toString('ascii') === '%PDF-', 'Downloaded file did not start with %PDF-.');

  const fileName =
    sanitiseFileName(fileNameFromDisposition(res.headers.get('content-disposition'))) ||
    `${requestId}.pdf`;
  const downloadDir = process.env.VA_TEST_DOWNLOAD_DIR || defaultDownloadDir;
  fs.mkdirSync(downloadDir, { recursive: true });
  const filePath = path.join(downloadDir, fileName);
  fs.writeFileSync(filePath, buffer);

  return {
    bytes: buffer.length,
    filePath
  };
}

function samplePayload() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return {
    vaJobId: `VA-DEMO-SMOKE-${stamp}`,
    jobNumber: `CBC-DEMO-SMOKE-${stamp}`,
    address: '1 Romach Street, Morayfield QLD 4506',
    lotPlan: '636/SP350483',
    council: 'City of Moreton Bay',
    applicationType: 'Building Approval',
    latitude: -27.1039,
    longitude: 152.9478
  };
}

function ensureDependencies() {
  if (fs.existsSync(path.join(appRoot, 'node_modules', 'node-fetch'))) return;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('Installing Node dependencies...');
  const result = childProcess.spawnSync(npm, ['install'], {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error('npm install failed.');
  }
}

function getApiKey() {
  const multiKey = String(process.env.VA_API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)[0];

  return (
    process.env.VA_TEST_API_KEY ||
    process.env.VA_DEMO_KEY ||
    process.env.VA_API_KEY ||
    multiKey ||
    'demo-va-key'
  );
}

function getExternalBaseUrl() {
  return trimTrailingSlash(process.env.VA_TEST_BASE_URL || '');
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fileNameFromDisposition(value) {
  const match = String(value || '').match(/filename="?([^"]+)"?/i);
  return match ? match[1] : '';
}

function sanitiseFileName(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

function rememberServerLog(chunk) {
  serverLog.push(String(chunk));
  while (serverLog.length > 80) serverLog.shift();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
