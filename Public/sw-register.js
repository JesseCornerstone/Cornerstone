(() => {
  if (!('serviceWorker' in navigator)) return;

  const clearOldStaticCaches = async () => {
    if (!window.caches) return;
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => /^cornerstone-static-/.test(key) && key !== 'cornerstone-static-v2')
          .map(key => caches.delete(key))
      );
    } catch (err) {
      console.warn('Service worker cache cleanup failed', err);
    }
  };

  const register = async () => {
    try {
      await clearOldStaticCaches();
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none'
      });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') worker.postMessage('force-skip-waiting');
        });
      });
      registration.update?.();
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  };

  // Helps keep the service worker alive even when the tab is backgrounded
  const pingSw = () => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('ping');
    }
  };

  window.addEventListener('load', () => {
    register();
    // Light keep-alive so background tasks are not throttled as aggressively
    setInterval(pingSw, 4 * 60 * 1000);
  });
})();
