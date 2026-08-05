(function () {
  "use strict";

  var root = document.documentElement;
  root.dataset.theme = "dark";
  root.style.colorScheme = "dark";

  try {
    window.localStorage.removeItem("lot_wise_theme");
  } catch (error) {
    // Dark mode still applies when storage is unavailable.
  }
})();
