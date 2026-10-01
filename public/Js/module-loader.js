(function () {
  var currentScript = document.currentScript;
  var modulePath = currentScript && currentScript.getAttribute('data-module');

  if (!modulePath) return;
  if (window.location.protocol === 'file:') return;

  var version = '20260916-bal-calculator';
  var moduleUrl = new URL(modulePath, document.baseURI);
  if (!moduleUrl.searchParams.has('v')) moduleUrl.searchParams.set('v', version);

  var balModuleUrl = new URL('./bal-calculator.js', currentScript.src || document.baseURI);
  balModuleUrl.searchParams.set('v', version);

  import(balModuleUrl.href).then(function () {
    return import(moduleUrl.href);
  }).catch(function (err) {
    console.error('Council module failed to load', err);

    if (document.getElementById('lot-wise-module-load-error')) return;

    var panel = document.createElement('div');
    panel.id = 'lot-wise-module-load-error';
    panel.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:grid',
      'place-items:center',
      'background:rgba(10,10,12,.92)',
      'color:#fff',
      "font:14px 'Hanken Grotesk',sans-serif",
      'padding:24px'
    ].join(';');
    panel.innerHTML =
      '<div style="max-width:620px;background:#17191f;border:1px solid #343844;border-radius:14px;padding:22px;box-shadow:0 24px 64px rgba(0,0,0,.45)">' +
      '<h1 style="margin:0 0 10px;font-size:20px">Map module failed to load</h1>' +
      '<p style="margin:0 0 12px;color:#cfd3dd;line-height:1.45">Refresh the page. If this keeps happening, close Chrome and open the map with the local-copy launcher.</p>' +
      '<pre style="white-space:pre-wrap;margin:0;padding:10px 12px;border-radius:8px;background:#0c0d11;color:#fff;overflow:auto;max-height:240px">' +
      escapeHtml(err && (err.stack || err.message) || String(err)) +
      '</pre>' +
      '</div>';
    document.body.appendChild(panel);
  });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
