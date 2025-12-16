(() => {
  if (!('serviceWorker' in navigator)) return;

  const register = async () => {
    try {
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
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
