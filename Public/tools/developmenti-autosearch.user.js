// ==UserScript==
// @name         Development.i Auto Search
// @namespace    cornerstonebc
// @version      1.0.0
// @description  Auto-runs Development.i searches when opened from Cornerstone Mapping by reusing Land Numbers or search text in the URL.
// @author       Cornerstone BC
// @match        https://developmenti.brisbane.qld.gov.au/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const DEV_I_BASE = "https://developmenti.brisbane.qld.gov.au";
  const SEARCH_API = `${DEV_I_BASE}/Geo/AddressCompoundSearch?searchTerm=`;

  function parseFiltersParam(raw) {
    if (!raw) return {};
    try {
      return Object.fromEntries(new URLSearchParams(raw));
    } catch {
      return {};
    }
  }

  function getLandFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const filterBag = parseFiltersParam(params.get("filters"));
    const directLand = params.get("landNumber") || params.get("LandNumber");
    const fromFilters =
      filterBag.LandNumber ||
      filterBag.landNumber ||
      filterBag.landnumber ||
      null;
    const searchText = params.get("searchText");
    const sourceHint = params.get("from") || "";
    return {
      landNumber: directLand || fromFilters || null,
      searchText,
      fromCornerstone: /cornerstone/i.test(sourceHint)
    };
  }

  async function lookupLandNumber(searchText) {
    if (!searchText) return null;
    try {
      const res = await fetch(SEARCH_API + encodeURIComponent(searchText));
      if (!res.ok) return null;
      const data = await res.json();
      const orderedBuckets = [
        ...(Array.isArray(data.Address) ? data.Address : []),
        ...(Array.isArray(data.LotPlan) ? data.LotPlan : []),
        ...(Array.isArray(data.LotStreet) ? data.LotStreet : []),
        ...(Array.isArray(data.Locality) ? data.Locality : []),
        ...(Array.isArray(data.Division) ? data.Division : [])
      ];
      if (!orderedBuckets.length) return null;
      const preferred =
        orderedBuckets.find(
          (item) =>
            typeof item?.extra === "string" &&
            /current/i.test(item.extra || "")
        ) || orderedBuckets[0];
      return preferred?.id ?? null;
    } catch {
      return null;
    }
  }

  function applyFilters(landNumber, searchText) {
    if (!landNumber) return false;
    if (
      typeof window.eyeFilters === "undefined" ||
      typeof window.eyeFilters.getDefaultFilters !== "function" ||
      typeof window.eyeFilters.setFilters !== "function" ||
      typeof window.SyncAddressSearch !== "function"
    ) {
      return false;
    }
    try {
      const filters = {
        ...window.eyeFilters.getDefaultFilters(),
        LandNumber: Number(landNumber),
        IncludeDA: true,
        IncludeBA: true,
        IncludePlumb: true
      };
      window.eyeFilters.setFilters(filters);
      window.SyncAddressSearch();
      const input = document.getElementById("addressLookup");
      if (input && searchText) {
        input.value = searchText;
      }
      return true;
    } catch {
      return false;
    }
  }

  (async () => {
    const { landNumber, searchText, fromCornerstone } = getLandFromUrl();
    if (!landNumber && !searchText) return;
    let resolvedLand = landNumber;
    if (!resolvedLand && searchText) {
      resolvedLand = await lookupLandNumber(searchText);
    }
    if (!resolvedLand) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const success = applyFilters(resolvedLand, searchText);
      if (success || attempts > 40) {
        clearInterval(timer);
        if (success && fromCornerstone) {
          console.info(
            "Cornerstone helper applied Development.i filters automatically."
          );
        }
      }
    }, 400);
  })();
})();
