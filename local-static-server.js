const http = require('http');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { sanitisePage } = require('./src/local-launcher-utils');

const publicDir = path.resolve(__dirname, 'public');
const preferredPort = parsePort(process.env.PORT || 4173) ?? 4173;
const portRetries = Number(process.env.PORT_RETRIES || 20);
const randomPortRetries = Number(process.env.RANDOM_PORT_RETRIES || 50);
const existingServerProbeTimeoutMs = Number(
  process.env.EXISTING_SERVER_PROBE_TIMEOUT_MS || 250
);
const fallbackPorts = parsePortList(
  Object.prototype.hasOwnProperty.call(process.env, 'FALLBACK_PORTS')
    ? process.env.FALLBACK_PORTS
    : '5173,5174,3000,3001,3002,8080,8081,8888,5500,5501,7000,7001,9000,9001'
);
const host = process.env.HOST || '127.0.0.1';
const args = process.argv.slice(2);
const shouldOpenBrowser =
  args.includes('--open') || process.env.OPEN_BROWSER === 'true';
const requestedPage = sanitisePage(
  args.find(arg => !arg.startsWith('--')) || process.env.PAGE || 'Index.html'
);
const unsafeChromePorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6697, 10080
]);
const warnedUnsafePorts = new Set();
const portCandidates = buildPortCandidates();
let activeStatusPort = null;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  return port;
}

function parsePortList(value) {
  return String(value || '')
    .split(',')
    .map(item => parsePort(item.trim()))
    .filter(port => port !== null && port > 0);
}

function isChromeUnsafePort(port) {
  return unsafeChromePorts.has(port);
}

function addSafePort(ports, port) {
  if (port === null || port <= 0 || port > 65535) return;
  if (isChromeUnsafePort(port)) {
    if (!warnedUnsafePorts.has(port)) {
      console.warn(`Skipping port ${port} because Chrome blocks it.`);
      warnedUnsafePorts.add(port);
    }
    return;
  }
  if (!ports.includes(port)) ports.push(port);
}

function buildPortCandidates() {
  const ports = [];
  if (preferredPort !== 0) {
    for (let offset = 0; offset <= Math.max(0, portRetries); offset += 1) {
      addSafePort(ports, preferredPort + offset);
    }
  }
  fallbackPorts.forEach(port => addSafePort(ports, port));
  return ports;
}

function localUrl(port) {
  return `http://${host}:${port}/${encodeURI(requestedPage)}`;
}

function writeLocalStatusFile(port) {
  activeStatusPort = port;
  const ports = [];
  addSafePort(ports, port);
  portCandidates.forEach(candidate => addSafePort(ports, candidate));
  const body = [
    ';window.__LOT_WISE_LOCAL_SERVER__ = {',
    `  port: ${port},`,
    `  ports: [${ports.join(',')}],`,
    `  updatedAt: ${JSON.stringify(new Date().toISOString())}`,
    '};',
    'window.__LOT_WISE_LOCAL_PORTS__ = window.__LOT_WISE_LOCAL_SERVER__.ports;'
  ].join('\n') + '\n';

  try {
    fs.writeFileSync(path.join(publicDir, 'local-server-status.js'), body);
  } catch (err) {
    console.warn(`Could not write local server status file: ${err.message}`);
  }
}

function clearLocalStatusFile() {
  if (!activeStatusPort) return;

  const statusPath = path.join(publicDir, 'local-server-status.js');
  try {
    const current = fs.existsSync(statusPath)
      ? fs.readFileSync(statusPath, 'utf8')
      : '';
    const match = current.match(/port:\s*(\d+)/);
    if (match && Number(match[1]) === activeStatusPort) {
      fs.unlinkSync(statusPath);
    }
  } catch {
    // Best effort only. A stale status file is still ignored by the browser guard.
  }
}

function exitCleanly() {
  clearLocalStatusFile();
  process.exit();
}

process.once('SIGINT', exitCleanly);
process.once('SIGTERM', exitCleanly);

function openBrowser(url) {
  const platform = process.platform;
  const opener =
    platform === 'win32'
      ? { command: 'cmd', args: ['/c', 'start', '', url] }
      : platform === 'darwin'
        ? { command: 'open', args: [url] }
        : { command: 'xdg-open', args: [url] };

  try {
    const child = childProcess.spawn(opener.command, opener.args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (err) {
    console.warn(`Could not open browser automatically: ${err.message}`);
  }
}

function checkExistingServer(port, callback) {
  let settled = false;
  const done = isLocalMappingServer => {
    if (settled) return;
    settled = true;
    callback(isLocalMappingServer);
  };

  const req = http.get(
    {
      host,
      port,
      path: '/__lot-wise-local-health',
      timeout: existingServerProbeTimeoutMs
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
}

function resolvePublicPath(urlPath) {
  let decodedPath;
  try {
    const parsed = new URL(urlPath, `http://${host}`);
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  const relativePath =
    decodedPath === '/' ? 'Index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relativePath);
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return filePath;
}

function handleRequest(req, res) {
  if ((req.url || '').startsWith('/__lot-wise-local-health')) {
    send(
      res,
      200,
      JSON.stringify({ ok: true, app: 'lot-wise-local-mapping' }),
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    );
    return;
  }

  const filePath = resolvePublicPath(req.url || '/');
  if (!filePath) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream'
    };
    if (
      ext === '.html' ||
      filePath.endsWith(`${path.sep}theme.js`) ||
      filePath.endsWith(`${path.sep}file-protocol-guard.js`) ||
      filePath.endsWith(`${path.sep}local-server-status.js`) ||
      filePath.includes(`${path.sep}Js${path.sep}`)
    ) {
      headers['Cache-Control'] = 'no-cache';
    }
    send(res, 200, data, headers);
  });
}

function listenOnPort(port, tryNext, randomAttemptsLeft = randomPortRetries) {
  const server = http.createServer(handleRequest);

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && tryNext) {
      checkExistingServer(port, isLocalMappingServer => {
        if (isLocalMappingServer) {
          const pageUrl = localUrl(port);
          writeLocalStatusFile(port);
          console.log(`Local mapping server already running: http://${host}:${port}/`);
          console.log(`Open mapping site: ${pageUrl}`);
          if (shouldOpenBrowser) openBrowser(pageUrl);
          return;
        }

        console.warn(`Port ${port} is busy. Trying backup port...`);
        tryNext();
      });
      return;
    }

    if (err.code === 'EACCES' && tryNext) {
      console.warn(`Port ${port} is blocked by the operating system. Trying backup port...`);
      tryNext();
      return;
    }

    console.error(`Could not start local mapping server on ${host}:${port}.`);
    console.error(err.message);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const actualPort = server.address().port;
    if (isChromeUnsafePort(actualPort)) {
      console.warn(`Windows selected port ${actualPort}, but Chrome blocks it.`);
      if (port === 0 && randomAttemptsLeft > 0) {
        server.close(() => listenOnPort(0, null, randomAttemptsLeft - 1));
        return;
      }
      server.close(() => {
        if (tryNext) {
          tryNext();
        } else {
          console.error('Could not find a Chrome-safe local port.');
          process.exitCode = 1;
        }
      });
      return;
    }

    writeLocalStatusFile(actualPort);
    const baseUrl = `http://${host}:${actualPort}/`;
    const pageUrl = localUrl(actualPort);
    console.log(`Local mapping server: ${baseUrl}`);
    console.log(`Open mapping site: ${pageUrl}`);
    console.log('Press Ctrl+C to stop the server.');
    if (shouldOpenBrowser) openBrowser(pageUrl);
  });
}

function listenCandidate(index) {
  if (index >= portCandidates.length) {
    console.warn('Preferred ports are unavailable. Asking Windows for a free backup port...');
    listenOnPort(0, null);
    return;
  }
  listenOnPort(portCandidates[index], () => listenCandidate(index + 1));
}

listenCandidate(0);
