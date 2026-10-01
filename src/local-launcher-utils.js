const net = require('net');

function sanitisePage(value, fallback = 'Index.html') {
  const page = String(value || '')
    .trim()
    .replace(/^\/+/, '');
  return /^[A-Za-z0-9 ._-]+\.html(?:[?#].*)?$/.test(page) ? page : fallback;
}

function extractOpenUrl(text) {
  const match = String(text).match(/Open mapping site:\s*(http:\/\/[^\s]+)/);
  return match ? match[1] : null;
}

function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return String(url).replace(/\/[^/]*$/, '');
  }
}

function findAvailablePort(start, attempts, options = {}) {
  let current = Number.isInteger(start) && start > 0 ? start : options.fallbackPort;
  const host = options.host || '127.0.0.1';

  return new Promise((resolve, reject) => {
    const tryPort = remaining => {
      if (remaining <= 0) {
        reject(new Error(options.errorMessage || 'No available local port found.'));
        return;
      }

      const probe = net.createServer();
      probe.once('error', () => {
        current += 1;
        tryPort(remaining - 1);
      });
      probe.once('listening', () => {
        probe.close(() => resolve(current));
      });
      probe.listen(current, host);
    };

    tryPort(attempts);
  });
}

module.exports = {
  extractOpenUrl,
  findAvailablePort,
  originFromUrl,
  sanitisePage
};
