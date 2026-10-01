(function () {
  "use strict";

  // Payment gates are a production invariant. The non-writable marker also
  // prevents older cached council bundles from re-enabling the former bypass.
  Object.defineProperty(window, "__LOT_WISE_PAYWALL_ENABLED__", {
    value: true,
    writable: false,
    configurable: false
  });

  var root = document.documentElement;
  root.dataset.theme = "dark";
  root.style.colorScheme = "dark";

  try {
    window.localStorage.removeItem("lot_wise_theme");
  } catch {
    // Dark mode still applies when storage is unavailable.
  }
})();
