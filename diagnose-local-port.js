const http = require('http');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const {
  extractOpenUrl,
  originFromUrl,
  sanitisePage
} = require('./src/local-launcher-utils');

const page = sanitisePage(process.argv[2] || 'BCC.html', 'BCC.html');
const appRoot = __dirname;
const publicDir = path.join(appRoot, 'public');

main();

function main() {
  console.log('Lot Companion local port diagnostic');
  console.log(`Page: ${page}`);
  console.log(`Node: ${process.version}`);
  console.log(`Folder: ${appRoot}`);
  console.log(`OneDrive folder: ${isOneDrivePath(appRoot) ? 'yes' : 'no'}`);
  printPageCheck();
  printLocalStatusCheck();
  printChromePolicyHint();
  console.log('');
  console.log('Starting a test server on a Windows-selected Chrome-safe port...');

  const env = {
    ...process.env,
    PORT: '0',
    PORT_RETRIES: '0',
    FALLBACK_PORTS: 'none',
    OPEN_BROWSER: 'false'
  };

  const server = childProcess.spawn(process.execPath, ['local-static-server.js', page], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let opened = false;
  const startupTimer = setTimeout(() => {
    if (!opened) {
      console.error('');
      console.error('FAIL: The diagnostic server did not report a page URL within 15 seconds.');
      console.error('Likely causes: Node.js cannot read this folder, OneDrive is still syncing, or local-static-server.js crashed before startup.');
    }
  }, 15000);

  server.stdout.on('data', async chunk => {
    const text = chunk.toString();
    process.stdout.write(text);
    const url = extractOpenUrl(text);
    if (!url || opened) return;
    opened = true;
    clearTimeout(startupTimer);

    try {
      await assertUrl(`${originFromUrl(url)}/__lot-wise-local-health`, 'health check');
      await assertUrl(url, 'page request');
      console.log('');
      console.log('PASS: Windows/Node can reach the local HTTP page.');
      console.log('Opening Chrome with local-network compatibility flags...');
      try {
        openChrome(url);
      } catch (err) {
        console.error(`Chrome launch failed: ${err.message}`);
      }
      console.log('');
      console.log('If Chrome still blocks this URL, check chrome://policy and security software.');
      console.log('Leave this window open while testing. Press Ctrl+C to stop the diagnostic server.');
    } catch (err) {
      console.error('');
      console.error(`FAIL: ${err.message}`);
      console.error('This means the local server is not reachable before Chrome is involved.');
    }
  });

  server.stderr.on('data', chunk => process.stderr.write(chunk));
  server.on('exit', code => {
    clearTimeout(startupTimer);
    if (code && code !== 0) console.error(`Diagnostic server exited with code ${code}`);
  });

  process.on('SIGINT', () => {
    if (!server.killed) server.kill('SIGINT');
    process.exit();
  });
}

function printPageCheck() {
  const pageOnly = page.split(/[?#]/)[0];
  const pagePath = path.join(publicDir, pageOnly);
  const serverPath = path.join(appRoot, 'local-static-server.js');

  console.log(`Public folder: ${fs.existsSync(publicDir) ? 'found' : 'missing'}`);
  console.log(`Server script: ${fs.existsSync(serverPath) ? 'found' : 'missing'}`);
  console.log(`Requested page: ${fs.existsSync(pagePath) ? 'found' : 'missing'} (${pageOnly})`);
}

function printLocalStatusCheck() {
  const statusPath = path.join(publicDir, 'local-server-status.js');
  if (!fs.existsSync(statusPath)) {
    console.log('Saved server status: missing');
    return;
  }

  try {
    const status = fs.readFileSync(statusPath, 'utf8');
    const portMatch = status.match(/port:\s*(\d+)/);
    const updatedMatch = status.match(/updatedAt:\s*"([^"]+)"/);
    console.log(
      `Saved server status: found` +
        (portMatch ? `, port ${portMatch[1]}` : '') +
        (updatedMatch ? `, updated ${updatedMatch[1]}` : '')
    );
  } catch (err) {
    console.log(`Saved server status: unreadable (${err.message})`);
  }
}

function isOneDrivePath(value) {
  return /(^|[\\/])OneDrive(?:\s|-|[\\/]|$)/i.test(String(value || ''));
}

function assertUrl(url, label) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          console.log(`PASS: ${label} returned HTTP ${res.statusCode}`);
          resolve();
        } else {
          reject(new Error(`${label} returned HTTP ${res.statusCode}`));
        }
      });
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${label} timed out`));
    });
    req.on('error', reject);
  });
}

function openChrome(url) {
  const chrome = findChrome();
  const userDataDir = path.join(process.env.TEMP || appRoot, 'LotWiseMappingChrome');
  const args = [
    '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
    '--allow-insecure-localhost',
    '--explicitly-allowed-ports=4173,4174,4175,4176,4177,4178,4179,4180,4181,4182,4183,4184,4185,4186,4187,4188,4189,4190,4191,4192,4193,5173,5174,3000,3001,3002,8080,8081,8888,5500,5501,7000,7001,9000,9001',
    `--user-data-dir=${userDataDir}`,
    '--new-window',
    url
  ];

  if (chrome) {
    childProcess.spawn(chrome, args, { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  childProcess.spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

function printChromePolicyHint() {
  const policyKeys = [
    'HKLM\\SOFTWARE\\Policies\\Google\\Chrome',
    'HKCU\\SOFTWARE\\Policies\\Google\\Chrome',
    'HKLM\\SOFTWARE\\WOW6432Node\\Policies\\Google\\Chrome'
  ];

  policyKeys.forEach(key => {
    const result = childProcess.spawnSync('reg', ['query', key, '/s'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status === 0 && result.stdout.trim()) {
      console.log('');
      console.log(`Chrome policy key found: ${key}`);
      console.log(result.stdout.trim());
    }
  });
}

function findChrome() {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LocalAppData || '', 'Google/Chrome/Application/chrome.exe')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}
