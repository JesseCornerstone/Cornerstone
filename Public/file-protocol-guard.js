(function () {
  if (window.location.protocol !== 'file:') return;

  try {
    window.stop();
  } catch {}

  var STATUS_LOAD_TIMEOUT_MS = 150;
  var PORT_PROBE_TIMEOUT_MS = 260;
  var STATUS_PORT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  var FALLBACK_PORTS = [
    4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181, 4182, 4183, 4184,
    4185, 4186, 4187, 4188, 4189, 4190, 4191, 4192, 4193, 5173, 5174, 3000,
    3001, 3002, 8080, 8081, 8888, 5500, 5501, 7000, 7001, 9000, 9001
  ];
  var UNSAFE_PORTS = {
    1: true, 7: true, 9: true, 11: true, 13: true, 15: true, 17: true,
    19: true, 20: true, 21: true, 22: true, 23: true, 25: true, 37: true,
    42: true, 43: true, 53: true, 69: true, 77: true, 79: true, 87: true,
    95: true, 101: true, 102: true, 103: true, 104: true, 109: true,
    110: true, 111: true, 113: true, 115: true, 117: true, 119: true,
    123: true, 135: true, 137: true, 139: true, 143: true, 161: true,
    179: true, 389: true, 427: true, 465: true, 512: true, 513: true,
    514: true, 515: true, 526: true, 530: true, 531: true, 532: true,
    540: true, 548: true, 554: true, 556: true, 563: true, 587: true,
    601: true, 636: true, 989: true, 990: true, 993: true, 995: true,
    1719: true, 1720: true, 1723: true, 2049: true, 3659: true,
    4045: true, 5060: true, 5061: true, 6000: true, 6566: true,
    6665: true, 6666: true, 6667: true, 6668: true, 6669: true,
    6697: true, 10080: true
  };
  var pageName = decodeURIComponent(
    (window.location.pathname.split('/').pop() || 'Index.html')
  );
  var pageLauncher = launcherForPage(pageName);
  var fileFallback = fileFallbackForPage(pageName);
  var pageSuffix =
    pageName +
    window.location.search +
    window.location.hash;

  if (fileFallback) {
    window.location.replace(
      fileFallback + window.location.search + window.location.hash
    );
    return;
  }

  var diagnostics = {
    statusFile: 'not checked',
    statusUpdatedAt: '',
    statusAgeText: '',
    statusStale: false,
    statusWarning: '',
    statusPorts: [],
    candidatePorts: [],
    probes: [],
    finalError: ''
  };

  function localUrl(port) {
    return 'http://127.0.0.1:' + port + '/' + pageSuffix;
  }

  function healthUrl(port) {
    return 'http://127.0.0.1:' + port + '/__cornerstone-local-health';
  }

  function addPort(ports, seen, port) {
    port = Number(port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
    if (UNSAFE_PORTS[port] || seen[port]) return;
    seen[port] = true;
    ports.push(port);
  }

  function loadStatusPorts() {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      var done = false;
      diagnostics.statusFile = 'checking';
      var timer = window.setTimeout(function () {
        finish('timed out');
      }, STATUS_LOAD_TIMEOUT_MS);

      function finish(state) {
        if (done) return;
        done = true;
        diagnostics.statusFile = state || diagnostics.statusFile;
        captureStatusDiagnostics();
        window.clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve();
      }

      script.onload = function () {
        finish('loaded');
      };
      script.onerror = function () {
        finish('not found');
      };
      script.src = './local-server-status.js?_=' + Date.now();
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function captureStatusDiagnostics() {
    var status = window.__CORNERSTONE_LOCAL_SERVER__ || {};
    diagnostics.statusUpdatedAt = status.updatedAt || '';
    diagnostics.statusPorts = []
      .concat(status.port ? [status.port] : [])
      .concat(status.ports || [])
      .filter(function (port, index, ports) {
        return ports.indexOf(port) === index;
      });

    if (diagnostics.statusUpdatedAt) {
      var updatedTime = Date.parse(diagnostics.statusUpdatedAt);
      if (Number.isFinite(updatedTime)) {
        var ageMs = Math.max(0, Date.now() - updatedTime);
        diagnostics.statusAgeText = formatAge(ageMs);
        diagnostics.statusStale = ageMs > STATUS_PORT_MAX_AGE_MS;
        if (diagnostics.statusStale) {
          diagnostics.statusFile = 'stale ignored';
          diagnostics.statusWarning =
            'using the standard Chrome-safe port list instead';
        }
      } else {
        diagnostics.statusStale = diagnostics.statusPorts.length > 0;
        if (diagnostics.statusStale) diagnostics.statusFile = 'stale ignored';
        diagnostics.statusWarning =
          'saved server status has an invalid timestamp; using the standard Chrome-safe port list instead';
      }
    }
  }

  function candidatePorts() {
    var ports = [];
    var seen = {};
    var status = window.__CORNERSTONE_LOCAL_SERVER__ || {};
    if (!diagnostics.statusStale) {
      addPort(ports, seen, status.port);
      (status.ports || []).forEach(function (port) {
        addPort(ports, seen, port);
      });
      (window.__CORNERSTONE_LOCAL_PORTS__ || []).forEach(function (port) {
        addPort(ports, seen, port);
      });
    }
    FALLBACK_PORTS.forEach(function (port) {
      addPort(ports, seen, port);
    });
    diagnostics.candidatePorts = ports.slice();
    return ports;
  }

  function probePort(port) {
    var probe = {
      port: port,
      result: 'checking',
      elapsedMs: 0,
      httpStatus: ''
    };
    var startedAt = Date.now();
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, PORT_PROBE_TIMEOUT_MS)
      : null;

    diagnostics.probes.push(probe);

    return fetch(healthUrl(port), {
      cache: 'no-store',
      mode: 'cors',
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        probe.httpStatus = res.status;
        if (!res.ok) throw new Error('Not local mapping server');
        return res.json().catch(function () {
          throw new Error('Invalid health response');
        });
      })
      .then(function (json) {
        if (!json || json.app !== 'cornerstone-local-mapping') {
          throw new Error('Not local mapping server');
        }
        probe.result = 'found mapping server';
        return localUrl(port);
      })
      .catch(function (err) {
        if (probe.result !== 'found mapping server') {
          probe.result = describeProbeError(err);
        }
        throw err;
      })
      .finally(function () {
        probe.elapsedMs = Date.now() - startedAt;
        if (timer) window.clearTimeout(timer);
      });
  }

  function describeProbeError(err) {
    var name = err && err.name;
    var message = String((err && err.message) || err || 'Unknown error');

    if (name === 'AbortError') return 'timed out or no response';
    if (/Failed to fetch|NetworkError/i.test(message)) {
      return 'connection refused, blocked, or no server';
    }
    if (/Invalid health response/i.test(message)) {
      return 'answered, but not valid mapping health';
    }
    if (/Not local mapping server/i.test(message)) {
      return 'answered, but not this mapping server';
    }
    return message;
  }

  function findLocalServer(ports) {
    return new Promise(function (resolve, reject) {
      var pending = ports.length;
      var settled = false;

      if (!pending) {
        reject(new Error('No local server'));
        return;
      }

      ports.forEach(function (port) {
        probePort(port)
          .then(function (url) {
            if (settled) return;
            settled = true;
            resolve(url);
          })
          .catch(function () {
            pending -= 1;
            if (!settled && pending <= 0) {
              reject(new Error('No local server'));
            }
          });
      });
    });
  }

  function showMessage() {
    var filePath = htmlEsc(window.location.href);
    var fileFallbackUrl = fileFallback
      ? fileFallback + window.location.search + window.location.hash
      : '';
    var launcherBlock = pageLauncher
      ? '<pre style="margin:0 0 8px;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#fff;overflow:auto">' + htmlEsc(pageLauncher) + '</pre>'
      : '';
    var localCopyLauncher = localCopyLauncherForPage(pageName);
    var localCopyBlock = localCopyLauncher
      ? '<pre style="margin:0 0 8px;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#fff;overflow:auto">' + htmlEsc(localCopyLauncher) + '</pre>'
      : '';
    var fileFallbackBlock = fileFallback
      ? '<div style="margin:14px 0;padding:12px;border:1px solid #3f4654;border-radius:10px;background:#20232b">' +
        '<p style="margin:0 0 10px;color:#f2f4f8;font-weight:700">Browser-only backup</p>' +
        '<p style="margin:0 0 10px;color:#cfd3dd;line-height:1.45">If the launcher cannot be used, this page will open the no-port backup <span id="cornerstoneFallbackCountdown">in 8 seconds</span>.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<a href="' + htmlEsc(fileFallbackUrl) + '" style="display:inline-flex;color:#fff;background:#d54250;border-radius:999px;padding:10px 14px;text-decoration:none;font-weight:700">Open backup now</a>' +
        '<button id="cornerstoneFallbackCancel" type="button" style="border:1px solid #59606d;background:#17191f;color:#fff;border-radius:999px;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer">Stay here</button>' +
        '</div>' +
        '</div>'
      : '';
    var diagnosticBlock = diagnosticBlockHtml();
    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:grid',
      'justify-items:center',
      'align-items:start',
      'background:rgba(10,10,12,.92)',
      'color:#fff',
      'font:14px system-ui,-apple-system,Segoe UI,Roboto,Arial',
      'padding:24px',
      'overflow:auto'
    ].join(';');
    panel.innerHTML =
      '<div style="width:100%;max-width:560px;max-height:calc(100vh - 48px);overflow:auto;box-sizing:border-box;background:#17191f;border:1px solid #343844;border-radius:14px;padding:22px;box-shadow:0 24px 64px rgba(0,0,0,.45)">' +
      '<h1 style="margin:0 0 10px;font-size:20px">Open the port version</h1>' +
      '<p style="margin:0 0 12px;color:#cfd3dd;line-height:1.45">You opened the HTML file directly. This tab cannot start the local HTTP server, so it cannot continue to the normal port version by itself.</p>' +
      '<p style="margin:0 0 10px;color:#cfd3dd">If this folder is in OneDrive, use this launcher first. It copies the site to a normal local folder, then opens the port version:</p>' +
      localCopyBlock +
      '<p style="margin:0 0 10px;color:#cfd3dd">Otherwise, close this tab and double-click the START HERE launcher in the launchers folder. It finds a Chrome-safe open port and opens the normal HTTP version:</p>' +
      launcherBlock +
      '<pre style="margin:0 0 8px;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#fff;overflow:auto">launchers\\Open Local Mapping Site.cmd</pre>' +
      '<pre style="margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#fff;overflow:auto">launchers\\Open Local Mapping Site - Backup Port.cmd</pre>' +
      '<p style="margin:0 0 10px;color:#cfd3dd;line-height:1.45">Use the backup launcher if Chrome says the port is unsafe, unavailable, or blocked. It keeps asking Windows for a Chrome-safe HTTP port and opens that address automatically.</p>' +
      fileFallbackBlock +
      diagnosticBlock +
      '<p style="margin:0;color:#8f96a3;font-size:12px;line-height:1.45;word-break:break-all">Blocked file URL: ' + filePath + '</p>' +
      '</div>';
    document.body.appendChild(panel);

    if (fileFallback) {
      startFileFallbackTimer(panel, fileFallbackUrl);
    }
  }

  function diagnosticBlockHtml() {
    var diagnosticLauncher = diagnosticLauncherForPage(pageName);
    var launcherBlock = diagnosticLauncher
      ? '<p style="margin:10px 0 8px;color:#cfd3dd;line-height:1.45">For a full Windows/Chrome check, close this tab and run:</p>' +
        '<pre style="margin:0;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#fff;overflow:auto">' + htmlEsc(diagnosticLauncher) + '</pre>'
      : '';

    return (
      '<details open style="margin:14px 0;padding:12px;border:1px solid #3f4654;border-radius:10px;background:#20232b">' +
      '<summary style="cursor:pointer;font-weight:700;color:#f2f4f8">Port check</summary>' +
      '<pre style="white-space:pre-wrap;margin:10px 0 0;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#dce2ee;overflow:auto;max-height:220px">' +
      htmlEsc(diagnosticText()) +
      '</pre>' +
      launcherBlock +
      '</details>'
    );
  }

  function diagnosticText() {
    var probes = diagnostics.probes || [];
    var lines = [
      'Result: no local mapping server answered from this browser tab.',
      'Status file: ' + diagnostics.statusFile + statusExtraText(),
      'Ports checked: ' + (diagnostics.candidatePorts || []).join(', ')
    ];

    if (diagnostics.statusWarning && diagnostics.statusFile !== 'stale ignored') {
      lines.push('Status warning: ' + diagnostics.statusWarning + '.');
    }
    if (diagnostics.statusStale) {
      lines.push('Status note: old saved ports were ignored; checking standard Chrome-safe ports only.');
    }

    if (probes.length) {
      lines.push('Probe summary: ' + probeSummaryText(probes));
      lines.push('Probe details:');
      probes.slice(0, 14).forEach(function (probe) {
        lines.push(
          '  ' +
            probe.port +
            ': ' +
            probe.result +
            (probe.httpStatus ? ' HTTP ' + probe.httpStatus : '') +
            ' (' +
            probe.elapsedMs +
            'ms)'
        );
      });
      if (probes.length > 14) {
        lines.push('  ... ' + (probes.length - 14) + ' more ports checked');
      }
    } else {
      lines.push('Probe details: no candidate ports were available.');
    }

    lines.push('');
    lines.push('Likely causes:');
    lines.push('- The .cmd launcher has not been run, so no local server is active.');
    if (diagnostics.statusStale) {
      lines.push('- The saved status file came from an old session or another OneDrive-synced PC.');
    }
    lines.push('- Node.js is missing or the launcher crashed before the server started.');
    lines.push('- OneDrive has files cloud-only, locked, or still syncing.');
    lines.push('- Chrome/security policy is blocking localhost from this file tab.');

    if (diagnostics.finalError) {
      lines.push('');
      lines.push('Last error: ' + diagnostics.finalError);
    }

    return lines.join('\n');
  }

  function statusExtraText() {
    var extras = [];
    if (diagnostics.statusUpdatedAt) {
      extras.push('updated ' + diagnostics.statusUpdatedAt);
    }
    if (diagnostics.statusAgeText) {
      extras.push(diagnostics.statusAgeText);
    }
    if (!diagnostics.statusStale && diagnostics.statusPorts && diagnostics.statusPorts.length) {
      extras.push('status ports ' + diagnostics.statusPorts.join(', '));
    }
    return extras.length ? ' (' + extras.join('; ') + ')' : '';
  }

  function formatAge(ms) {
    var seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + ' seconds old';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' minutes old';
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + ' hours old';
    var days = Math.round(hours / 24);
    return days + ' days old';
  }

  function probeSummaryText(probes) {
    var counts = {};
    probes.forEach(function (probe) {
      counts[probe.result] = (counts[probe.result] || 0) + 1;
    });
    return Object.keys(counts)
      .sort()
      .map(function (key) {
        return key + ' x' + counts[key];
      })
      .join('; ');
  }

  function startFileFallbackTimer(panel, target) {
    var seconds = 8;
    var countdown = panel.querySelector('#cornerstoneFallbackCountdown');
    var cancel = panel.querySelector('#cornerstoneFallbackCancel');
    var timeout = window.setTimeout(function () {
      window.location.replace(target);
    }, seconds * 1000);
    var interval = window.setInterval(function () {
      seconds -= 1;
      if (countdown) countdown.textContent = 'in ' + Math.max(seconds, 0) + ' seconds';
      if (seconds <= 0) window.clearInterval(interval);
    }, 1000);

    if (cancel) {
      cancel.addEventListener('click', function () {
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        if (countdown) countdown.textContent = 'only when you choose it';
      });
    }
  }

  function launcherForPage(page) {
    var launchers = {
      'BCC.html': 'launchers\\START HERE - BCC Map.cmd',
      'GCCC2.html': 'launchers\\START HERE - GCCC2 Map.cmd',
      'ICC2.html': 'launchers\\START HERE - ICC2 Map.cmd',
      'RCC.html': 'launchers\\START HERE - RCC Map.cmd'
    };
    return launchers[page] || null;
  }

  function localCopyLauncherForPage(page) {
    var match = /^([A-Za-z0-9]+)\.html$/.exec(page);
    return match
      ? 'launchers\\Run Local Copy - ' + match[1] + ' Map.cmd'
      : 'launchers\\Run Local Copy Mapping Site.cmd';
  }

  function diagnosticLauncherForPage(page) {
    var match = /^([A-Za-z0-9]+)\.html$/.exec(page);
    return match ? 'launchers\\Diagnose Local Port - ' + match[1] + '.cmd' : null;
  }

  function fileFallbackForPage(page) {
    if (!/^[A-Za-z0-9._ -]+\.html$/.test(page)) return null;
    if (/-file\.html$/i.test(page)) return null;
    return page.replace(/\.html$/i, '-file.html');
  }

  function htmlEsc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  loadStatusPorts()
    .then(function () {
      return findLocalServer(candidatePorts());
    })
    .then(function (url) {
      window.location.replace(url);
    })
    .catch(function () {
      diagnostics.finalError = 'No local mapping server found on checked ports';
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showMessage);
      } else {
        showMessage();
      }
    });
})();
