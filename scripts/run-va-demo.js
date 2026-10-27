const fs = require('fs');
const http = require('http');
const path = require('path');
const childProcess = require('child_process');
const { findAvailablePort } = require('../src/local-launcher-utils');

const appRoot = path.resolve(__dirname, '..');
const preferredPort = Number(process.env.VA_DEMO_PORT || process.env.PORT || 3112);
const demoKey = process.env.VA_DEMO_KEY || 'demo-va-key';

main().catch(err => {
  console.error(`Integration demonstration failed: ${err.message}`);
  process.exitCode = 1;
});

async function main() {
  ensureDependencies();
  const port = await findAvailablePort(preferredPort, 20, {
    fallbackPort: 3112,
    errorMessage: 'No available local demo port found.'
  });
  const url = `http://127.0.0.1:${port}/VADemo.html?apiKey=${encodeURIComponent(demoKey)}`;
  const env = {
    ...process.env,
    PORT: String(port),
    VA_API_KEYS: demoKey,
    VA_REQUIRE_HTTPS: 'false',
    VA_STORAGE_DIR: path.join(appRoot, 'storage-demo'),
    APP_BASE_URL: `http://127.0.0.1:${port}`
  };

  console.log('Lot Companion Visual Approvals integration demonstration');
  console.log(`Demonstration URL: ${url}`);
  console.log(`Demonstration API key: ${demoKey}`);
  console.log('Press Ctrl+C in this window to stop the demonstration service.');

  const server = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });

  server.stdout.on('data', chunk => process.stdout.write(chunk));
  server.stderr.on('data', chunk => process.stderr.write(chunk));
  server.once('exit', code => {
    if (code && code !== 0) {
      console.error(`Demonstration service exited with code ${code}.`);
      process.exitCode = code;
    }
  });

  process.on('SIGINT', () => {
    if (!server.killed) server.kill('SIGINT');
    process.exit();
  });

  await waitForHealth(port);
  openBrowser(url);
}

function ensureDependencies() {
  const dotenvPath = path.join(appRoot, 'node_modules', 'dotenv');
  if (fs.existsSync(dotenvPath)) return;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('Installing Node dependencies...');
  const result = childProcess.spawnSync(npm, ['install'], {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: false
  });
  if (result.status !== 0) {
    throw new Error('npm install failed.');
  }
}

function waitForHealth(port) {
  const started = Date.now();
  const timeoutMs = 12000;

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/api/health',
          timeout: 700
        },
        res => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        }
      );
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
      req.on('error', retry);
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('The demonstration service did not become healthy.'));
        return;
      }
      setTimeout(check, 350);
    };

    check();
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    const child = childProcess.spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return;
  }

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = childProcess.spawn(opener, [url], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}
