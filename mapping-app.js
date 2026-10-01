const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const childProcess = require('child_process');
const {
  extractOpenUrl,
  originFromUrl,
  sanitisePage
} = require('./src/local-launcher-utils');

const appRoot = __dirname;
const configPath = path.join(appRoot, 'mapping-app.config.json');
const localStatusPath = path.join(appRoot, 'public', 'local-server-status.js');
const LOCAL_HOST = '127.0.0.1';
const LOCAL_SERVER_PROBE_TIMEOUT_MS = 220;
const COMMON_LOCAL_PORTS = [
  4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181, 4182, 4183, 4184,
  4185, 4186, 4187, 4188, 4189, 4190, 4191, 4192, 4193, 5173, 5174, 3000,
  3001, 3002, 8080, 8081, 8888, 5500, 5501, 7000, 7001, 9000, 9001
];
const args = process.argv.slice(2);
const backupPort = args.includes('--backup-port');
const requestedPage =
  args.find(arg => !arg.startsWith('--')) ||
  process.env.PAGE ||
  readConfig().defaultPage ||
  'Index.html';

main().catch(err => {
  console.error(`Launcher failed: ${err.message}`);
  process.exitCode = 1;
});

async function main() {
  const config = readConfig();
  await updateFromSource(config);
  await startMappingServer(config, sanitisePage(requestedPage), backupPort);
}

function readConfig() {
  const defaults = {
    autoUpdate: false,
    updateSource: '',
    browser: 'chrome',
    browserMode: 'window',
    portMode: 'auto',
    reuseExistingServer: true,
    defaultPage: 'Index.html'
  };

  try {
    if (!fs.existsSync(configPath)) return defaults;
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch (err) {
    console.warn(`Could not read mapping-app.config.json: ${err.message}`);
    return defaults;
  }
}

async function updateFromSource(config) {
  const source = expandPath(process.env.MAPPING_APP_UPDATE_SOURCE || config.updateSource);
  const enabled =
    process.env.MAPPING_APP_AUTO_UPDATE === 'true' || config.autoUpdate === true;

  if (!enabled || !source) {
    console.log('Update check: skipped.');
    return;
  }

  const sourceDir = path.resolve(source);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.warn(`Update check: source folder not found: ${sourceDir}`);
    return;
  }

  if (samePath(sourceDir, appRoot)) {
    console.log('Update check: source is this folder, no sync needed.');
    return;
  }

  console.log(`Update check: syncing changed files from ${sourceDir}`);
  const copied = syncDirectory(sourceDir, appRoot, sourceDir);
  console.log(`Update check: ${copied} file${copied === 1 ? '' : 's'} updated.`);
}

function syncDirectory(sourceDir, targetDir, sourceRoot) {
  let copied = 0;
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const relativePath = path.relative(sourceRoot, sourcePath);
    if (shouldSkip(relativePath, entry)) continue;

    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copied += syncDirectory(sourcePath, targetPath, sourceRoot);
      continue;
    }

    if (!entry.isFile()) continue;
    if (filesMatch(sourcePath, targetPath)) continue;

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  return copied;
}

function shouldSkip(relativePath, entry) {
  const normalised = relativePath.replace(/\\/g, '/');
  const name = entry.name.toLowerCase();

  if (normalised === 'mapping-app.config.json') return true;
  if (normalised === 'public/local-server-status.js') return true;
  if (normalised.startsWith('node_modules/')) return true;
  if (normalised.startsWith('.git/')) return true;
  if (normalised.startsWith('.openai/')) return true;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (name.endsWith('.log')) return true;
  if (name === 'local-static-server.out.log') return true;
  if (name === 'local-static-server.err.log') return true;
  return false;
}

function filesMatch(a, b) {
  if (!fs.existsSync(b)) return false;
  const aStat = fs.statSync(a);
  const bStat = fs.statSync(b);
  if (aStat.size !== bStat.size) return false;
  return fileHash(a) === fileHash(b);
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function startMappingServer(config, page, forceBackupPort) {
  if (!forceBackupPort && config.reuseExistingServer !== false) {
    const existingUrl = await findExistingLocalServer(page);
    if (existingUrl) {
      console.log(`Local mapping server already running: ${originFromUrl(existingUrl)}/`);
      console.log(`Open mapping site: ${existingUrl}`);
      openBrowser(existingUrl, config);
      return;
    }
  }

  return new Promise((resolve, reject) => {
    let opened = false;
    const env = {
      ...process.env,
      OPEN_BROWSER: 'false'
    };
    const portMode = forceBackupPort
      ? 'auto'
      : String(config.portMode || 'auto').toLowerCase();

    if (portMode === 'auto') {
      console.log('Choosing a Chrome-safe available local port...');
      env.PORT = '0';
      env.PORT_RETRIES = '0';
      env.FALLBACK_PORTS = 'none';
    }

    const server = childProcess.spawn(process.execPath, ['local-static-server.js', page], {
      cwd: appRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    server.stdout.on('data', chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      const url = extractOpenUrl(text);
      if (url && !opened) {
        opened = true;
        openBrowser(url, config);
      }
    });

    server.stderr.on('data', chunk => {
      process.stderr.write(chunk);
    });

    server.once('error', reject);
    server.once('exit', code => {
      if (code && code !== 0) {
        reject(new Error(`local server exited with code ${code}`));
        return;
      }
      resolve();
    });

    process.on('SIGINT', () => {
      if (!server.killed) server.kill('SIGINT');
      process.exit();
    });
  });
}

async function findExistingLocalServer(page) {
  const ports = getExistingServerCandidatePorts();
  if (!ports.length) return null;

  return new Promise(resolve => {
    let pending = ports.length;
    let settled = false;

    ports.forEach(port => {
      probeLocalServer(port)
        .then(ok => {
          if (!ok || settled) return;
          settled = true;
          resolve(`http://${LOCAL_HOST}:${port}/${encodeURI(page)}`);
        })
        .finally(() => {
          pending -= 1;
          if (!settled && pending <= 0) resolve(null);
        });
    });
  });
}

function getExistingServerCandidatePorts() {
  const ports = [];
  const seen = new Set();
  const add = port => {
    port = Number(port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || seen.has(port)) {
      return;
    }
    seen.add(port);
    ports.push(port);
  };

  try {
    if (fs.existsSync(localStatusPath)) {
      const status = fs.readFileSync(localStatusPath, 'utf8');
      const portMatch = status.match(/\bport:\s*(\d+)/);
      if (portMatch) add(portMatch[1]);
      const portsMatch = status.match(/\bports:\s*\[([^\]]*)\]/);
      if (portsMatch) {
        portsMatch[1].split(',').forEach(add);
      }
    }
  } catch {}

  COMMON_LOCAL_PORTS.forEach(add);
  return ports;
}

function probeLocalServer(port) {
  return new Promise(resolve => {
    let settled = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const req = http.get(
      {
        host: LOCAL_HOST,
        port,
        path: '/__lot-wise-local-health',
        timeout: LOCAL_SERVER_PROBE_TIMEOUT_MS
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            done(res.statusCode === 200 && json.app === 'lot-wise-local-mapping');
          } catch {
            done(false);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      done(false);
    });
    req.on('error', () => done(false));
  });
}

function openBrowser(url, config) {
  const preferred = String(config.browser || 'chrome').toLowerCase();
  const mode = String(config.browserMode || 'window').toLowerCase();
  const exe =
    preferred === 'chrome'
      ? findChrome()
      : preferred === 'edge'
        ? findEdge() || findChrome()
        : preferred === 'default'
        ? null
        : findChrome() || findEdge();

  if (exe) {
    const browserArgs = parseChromeExtraArgs(config);
    const userDataDir = process.env.CHROME_USER_DATA_DIR || config.chromeUserDataDir;
    if (userDataDir) {
      browserArgs.push(`--user-data-dir=${expandPath(userDataDir)}`);
    }
    browserArgs.push(mode === 'app' ? `--app=${url}` : '--new-window');
    if (mode !== 'app') browserArgs.push(url);
    console.log(`Opening Chrome browser URL: ${url}`);
    const child = childProcess.spawn(exe, browserArgs, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return;
  }

  console.log(`Opening default browser URL: ${url}`);
  const child = childProcess.spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function parseChromeExtraArgs(config) {
  const raw = process.env.CHROME_EXTRA_ARGS || config.chromeExtraArgs || '';
  return String(raw)
    .split(/\s+/)
    .map(arg => arg.trim())
    .filter(Boolean);
}

function findEdge() {
  return findFirstExisting([
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    'msedge.exe'
  ]);
}

function findChrome() {
  return findFirstExisting([
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LocalAppData || '', 'Google/Chrome/Application/chrome.exe'),
    'chrome.exe'
  ]);
}

function findFirstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.endsWith('.exe') && candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    const found = findOnPath(candidate);
    if (found) return found;
  }
  return null;
}

function findOnPath(command) {
  if (process.platform !== 'win32') return null;
  const result = childProcess.spawnSync('where', [command], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) || null;
}

function expandPath(value) {
  return String(value || '').replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
