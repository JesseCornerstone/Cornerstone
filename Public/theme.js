(function () {
  "use strict";

  var storageKey = "lot_wise_theme";
  var root = document.documentElement;
  var media = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  function readStoredTheme() {
    try {
      var stored = window.localStorage.getItem(storageKey);
      return stored === "light" || stored === "dark" ? stored : null;
    } catch (error) {
      return null;
    }
  }

  function writeStoredTheme(theme) {
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch (error) {
      // The selected theme still applies for this page when storage is unavailable.
    }
  }

  function preferredTheme() {
    return media && media.matches ? "dark" : "light";
  }

  function requestedTheme() {
    try {
      var requested = new URLSearchParams(window.location.search).get("theme");
      return requested === "light" || requested === "dark" ? requested : null;
    } catch (error) {
      return null;
    }
  }

  function updateButtons(theme) {
    var isDark = theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.setAttribute("aria-pressed", isDark ? "true" : "false");
      button.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
      );
      button.title = isDark ? "Switch to light mode" : "Switch to dark mode";

      var icon = button.querySelector("[data-theme-icon]");
      var label = button.querySelector("[data-theme-label]");
      if (icon) icon.textContent = isDark ? "☀" : "☾";
      if (label) label.textContent = isDark ? "Light" : "Dark";
    });
  }

  function applyTheme(theme, persist) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (persist) writeStoredTheme(theme);
    updateButtons(theme);
  }

  function createToggle() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "lot-wise-theme-toggle";
    button.setAttribute("data-theme-toggle", "");

    var icon = document.createElement("span");
    icon.className = "lot-wise-theme-toggle__icon";
    icon.setAttribute("data-theme-icon", "");
    icon.setAttribute("aria-hidden", "true");

    var label = document.createElement("span");
    label.className = "lot-wise-theme-toggle__label";
    label.setAttribute("data-theme-label", "");

    button.appendChild(icon);
    button.appendChild(label);
    if (document.body.classList.contains("terms-page")) {
      document.body.insertBefore(button, document.body.firstChild);
    } else if (document.body.classList.contains("only-landing-body")) {
      var landingActions = document.querySelector(".landing-header .top-actions");
      if (landingActions) {
        landingActions.appendChild(button);
      } else {
        document.body.appendChild(button);
      }
    } else {
      document.body.appendChild(button);
    }
    return button;
  }

  function initialiseToggle() {
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    if (!buttons.length) {
      createToggle();
      buttons = document.querySelectorAll("[data-theme-toggle]");
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
      });
    });
    updateButtons(root.dataset.theme);
  }

  applyTheme(requestedTheme() || readStoredTheme() || preferredTheme(), false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseToggle, { once: true });
  } else {
    initialiseToggle();
  }

  if (media && media.addEventListener) {
    media.addEventListener("change", function (event) {
      if (!readStoredTheme()) applyTheme(event.matches ? "dark" : "light", false);
    });
  }
})();
