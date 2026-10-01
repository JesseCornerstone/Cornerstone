import ArcGISMap from "https://js.arcgis.com/4.30/@arcgis/core/Map.js";
import SceneView from "https://js.arcgis.com/4.30/@arcgis/core/views/SceneView.js";
import Basemap from "https://js.arcgis.com/4.30/@arcgis/core/Basemap.js";
import TileLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/TileLayer.js";
import FeatureLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/FeatureLayer.js";
import GraphicsLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "https://js.arcgis.com/4.30/@arcgis/core/Graphic.js";
import Polygon from "https://js.arcgis.com/4.30/@arcgis/core/geometry/Polygon.js";
import Point from "https://js.arcgis.com/4.30/@arcgis/core/geometry/Point.js";
import Camera from "https://js.arcgis.com/4.30/@arcgis/core/Camera.js";

const rules = window.QHCRules;
if (!rules) throw new Error("QHC rules failed to load.");

const QSCF_LOT_PARCELS_URL = "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/QSCF_LandParcelPropertyFramework/MapServer/120";
const DRAFT_KEY = "lotwise-qhc-assessment-v1";
const SAMPLE_LOCATION = { latitude: -27.4698, longitude: 153.0251 };
const inputIds = [
  "projectName", "council", "address", "lotPlan", "councilAdoption", "dwellingPermitted",
  "priorityDevelopmentArea", "overlayChecked", "planOfDevelopmentChecked", "lotWidth", "lotDepth",
  "slope", "lotBearing", "frontageType", "proposalType", "class10Subtype", "buildingWidth",
  "buildingDepth", "height", "storeys", "meanHeight", "frontSetback", "leftSetback", "otherSiteCover",
  "hasSecondaryDwelling", "parkingSpaces", "coveredParkingSpaces", "parkingDimensions",
  "garageAccessWidth", "garageOverhang", "posWidth", "posDepth", "posOpenSkyArea", "posSlope",
  "privacyTrigger", "privacySolution", "maintenanceFree", "visibleEntry"
];

const $ = id => document.getElementById(id);
const numericIds = new Set([
  "lotWidth", "lotDepth", "slope", "lotBearing", "buildingWidth", "buildingDepth", "height", "storeys",
  "meanHeight", "frontSetback", "leftSetback", "otherSiteCover", "parkingSpaces", "coveredParkingSpaces",
  "garageAccessWidth", "posWidth", "posDepth", "posOpenSkyArea", "posSlope"
]);

let locationState = { ...SAMPLE_LOCATION };
let latestAssessment = null;
let activeFilter = "all";
let selectingParcel = false;
let showEnvelope = true;
let aerialOn = false;
let toastTimer = 0;
let viewReady = false;

const simpleBasemap = new Basemap({
  title: "Lot Companion Light Basemap",
  baseLayers: [new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer" })]
});
const aerialBasemap = new Basemap({
  title: "Aerial",
  baseLayers: [new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" })]
});
const map = new ArcGISMap({ basemap: simpleBasemap, ground: "world-elevation" });
const parcelLayer = new FeatureLayer({
  url: QSCF_LOT_PARCELS_URL,
  title: "Queensland property boundaries",
  outFields: ["*"],
  popupEnabled: false,
  renderer: {
    type: "simple",
    symbol: { type: "simple-fill", color: [255, 255, 255, 0.01], outline: { color: [74, 116, 163, 0.75], width: 0.8 } }
  }
});
const selectedParcelLayer = new GraphicsLayer({ title: "Selected parcel", listMode: "hide" });
const zonesLayer = new GraphicsLayer({ title: "QHC setbacks", listMode: "hide" });
const envelopeLayer = new GraphicsLayer({ title: "QHC buildable envelope", listMode: "hide" });
const lotLayer = new GraphicsLayer({ title: "Assessment lot", listMode: "hide" });
const amenityLayer = new GraphicsLayer({ title: "Parking and private open space", listMode: "hide" });
const buildingLayer = new GraphicsLayer({ title: "Proposal", listMode: "hide" });
map.addMany([parcelLayer, selectedParcelLayer, lotLayer, zonesLayer, envelopeLayer, amenityLayer, buildingLayer]);

const view = new SceneView({
  container: "viewDiv",
  map,
  center: [SAMPLE_LOCATION.longitude, SAMPLE_LOCATION.latitude],
  zoom: 18,
  qualityProfile: "high",
  environment: {
    atmosphere: { quality: "high" },
    lighting: { type: "virtual" },
    starsEnabled: false
  },
  constraints: { altitude: { min: 20, max: 5000000 } },
  highlightOptions: { color: [255, 190, 62], haloOpacity: 0.9, fillOpacity: 0.15 }
});
view.ui.components = [];

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInputs() {
  const data = {};
  inputIds.forEach(id => {
    const el = $(id);
    if (!el) return;
    data[id] = numericIds.has(id) ? finite(el.value) : el.value;
  });
  data.hasSecondaryDwelling = data.hasSecondaryDwelling === "yes";
  data.garageOverhang = data.garageOverhang === "yes";
  data.garageFacesSecondaryFrontage = false;
  return data;
}

function writeInputs(data) {
  if (!data) return;
  inputIds.forEach(id => {
    if ($(id) && data[id] !== undefined && data[id] !== null) $(id).value = String(data[id]);
  });
  if (data.hasSecondaryDwelling !== undefined && $("hasSecondaryDwelling")) $("hasSecondaryDwelling").value = data.hasSecondaryDwelling === true || data.hasSecondaryDwelling === "yes" ? "yes" : "no";
  if (data.garageOverhang !== undefined && $("garageOverhang")) $("garageOverhang").value = data.garageOverhang === true || data.garageOverhang === "yes" ? "yes" : "no";
}

function statusText(status) {
  if (status === "pass") return "Pass";
  if (status === "fail") return "Fail";
  if (status === "na") return "Not applicable";
  return "Review";
}

function measuredText(check) {
  const value = check.measured;
  if (typeof value === "number") {
    const percent = check.id === "site-cover" || check.id === "pos-slope";
    const count = check.id.includes("parking-count") || check.id.includes("parking-covered");
    const area = check.id === "secondary-ifa" || check.id === "pos-area" || check.id === "pos-sky";
    const unit = percent ? "%" : count ? "" : area ? "m²" : "m";
    const actual = `${value.toFixed(count ? 0 : 1)}${unit}`;
    const required = typeof check.required === "number" ? `${check.required.toFixed(count ? 0 : 1)}${unit}` : check.required;
    const direction = ["height", "site-cover", "secondary-ifa", "garage-access", "pos-slope", "btb-length"].includes(check.id) ? "max" : "min";
    return `${actual} · ${direction} ${required}`;
  }
  return `${statusText(check.status)} · ${check.required}`;
}

function renderResults(assessment) {
  const m = assessment.metrics;
  $("topProject").textContent = $("projectName").value.trim() || "Untitled preliminary assessment";
  $("chapterLabel").textContent = assessment.chapterLabel;
  $("lotAreaDisplay").textContent = `${m.lotArea.toFixed(1)} m²`;
  $("rightSetbackDisplay").textContent = `${m.setbacks.right.toFixed(1)} m`;
  $("rearSetbackDisplay").textContent = `${m.setbacks.rear.toFixed(1)} m`;
  $("metricLotArea").textContent = `${m.lotArea.toFixed(1)} m²`;
  $("metricSiteCover").textContent = Number.isFinite(m.siteCover) ? `${m.siteCover.toFixed(1)}%` : "—";
  $("metricHeight").textContent = `${m.maxHeight.toFixed(1)} m`;
  $("metricSetbacks").textContent = `${m.setbacks.right.toFixed(1)} / ${m.setbacks.rear.toFixed(1)} m`;
  $("passCount").textContent = assessment.counts.pass;
  $("failCount").textContent = assessment.counts.fail;
  $("reviewCount").textContent = assessment.counts.review;

  const summary = {
    pass: { title: "Modelled checks pass", copy: "All included acceptable-solution and context checks are confirmed. Professional certification is still required.", icon: "✓" },
    fail: { title: "Does not pass", copy: "One or more modelled acceptable solutions fail. Adjust the highlighted geometry or document a performance solution.", icon: "×" },
    review: { title: "Needs review", copy: "No final outcome yet. Confirm every amber site and design item before relying on the model.", icon: "!" }
  }[assessment.status];
  $("summaryCard").className = `summary-card ${assessment.status}`;
  $("summaryTitle").textContent = summary.title;
  $("summaryCopy").textContent = summary.copy;
  $("summaryIcon").textContent = summary.icon;

  const visible = assessment.checks.filter(check => activeFilter === "all" || check.status === activeFilter);
  const groups = new Map();
  visible.forEach(check => {
    if (!groups.has(check.group)) groups.set(check.group, []);
    groups.get(check.group).push(check);
  });
  const host = $("resultGroups");
  if (!visible.length) {
    host.innerHTML = `<div class="result-empty">No ${activeFilter} items in this assessment.</div>`;
    return;
  }
  const icon = { pass: "✓", fail: "×", review: "!", na: "–" };
  host.innerHTML = Array.from(groups.entries()).map(([group, checks]) => `
    <section class="result-group">
      <h3 class="result-group-title">${escapeHtml(group)}</h3>
      ${checks.map(check => `<article class="check-item ${check.status}" data-visual="${escapeHtml(check.visual || "")}">
        <span class="check-icon" aria-label="${statusText(check.status)}">${icon[check.status]}</span>
        <div>
          <div class="check-title-row"><span class="check-title">${escapeHtml(check.title)}</span><span class="check-clause">${escapeHtml(check.clause)}</span></div>
          <div class="check-measure">${escapeHtml(measuredText(check))}</div>
          <p class="check-detail">${escapeHtml(check.detail)}</p>
        </div>
      </article>`).join("")}
    </section>`).join("");
  host.querySelectorAll(".check-item").forEach(item => item.addEventListener("click", () => {
    const visual = item.dataset.visual;
    if (visual) showToast(`Map focus: ${item.querySelector(".check-title").textContent}`);
  }));
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function metresPerDegreeLatitude(latitude) {
  const phi = latitude * Math.PI / 180;
  return 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
}

function metresPerDegreeLongitude(latitude) {
  const phi = latitude * Math.PI / 180;
  return 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
}

function localToLonLat(x, y, bearing) {
  const theta = finite(bearing) * Math.PI / 180;
  const east = x * Math.cos(theta) - y * Math.sin(theta);
  const north = x * Math.sin(theta) + y * Math.cos(theta);
  return [
    locationState.longitude + east / metresPerDegreeLongitude(locationState.latitude),
    locationState.latitude + north / metresPerDegreeLatitude(locationState.latitude)
  ];
}

function rectanglePolygon(width, depth, x, y, bearing) {
  const halfW = Math.max(0.05, width / 2);
  const halfD = Math.max(0.05, depth / 2);
  const localRing = [
    [x - halfW, y - halfD], [x + halfW, y - halfD], [x + halfW, y + halfD],
    [x - halfW, y + halfD], [x - halfW, y - halfD]
  ];
  return new Polygon({ rings: [localRing.map(pair => localToLonLat(pair[0], pair[1], bearing))], spatialReference: { wkid: 4326 } });
}

function groundSymbol(fill, outline, width = 1) {
  return { type: "simple-fill", color: fill, outline: { color: outline, width } };
}

function extrudeSymbol(height, color, edge) {
  return { type: "polygon-3d", symbolLayers: [{ type: "extrude", size: Math.max(0.3, height), material: { color }, edges: { type: "solid", color: edge, size: 1 } }] };
}

function addSetbackBand(width, depth, x, y, bearing, color) {
  if (width <= 0 || depth <= 0) return;
  zonesLayer.add(new Graphic({ geometry: rectanglePolygon(width, depth, x, y, bearing), symbol: groundSymbol(color, [255, 255, 255, 0.12], 0.5) }));
}

function renderModel(input, assessment) {
  renderFallback(input, assessment);
  if (!viewReady) return;
  lotLayer.removeAll();
  zonesLayer.removeAll();
  envelopeLayer.removeAll();
  amenityLayer.removeAll();
  buildingLayer.removeAll();
  const w = Math.max(1, finite(input.lotWidth));
  const d = Math.max(1, finite(input.lotDepth));
  const bw = Math.max(0.2, finite(input.buildingWidth));
  const bd = Math.max(0.2, finite(input.buildingDepth));
  const bearing = finite(input.lotBearing);
  const req = assessment.metrics.requiredSetbacks;
  const set = assessment.metrics.setbacks;
  const lotGeometry = rectanglePolygon(w, d, 0, 0, bearing);
  lotLayer.add(new Graphic({
    geometry: lotGeometry,
    symbol: groundSymbol([25, 105, 224, 0.08], [22, 86, 167, 1], 2.2)
  }));

  addSetbackBand(w, Math.min(req.front, d), 0, -d / 2 + Math.min(req.front, d) / 2, bearing, [31, 119, 216, 0.16]);
  addSetbackBand(w, Math.min(req.rear, d), 0, d / 2 - Math.min(req.rear, d) / 2, bearing, [31, 119, 216, 0.12]);
  const innerDepth = Math.max(0, d - req.front - req.rear);
  addSetbackBand(Math.min(req.left, w), innerDepth, -w / 2 + Math.min(req.left, w) / 2, (req.front - req.rear) / 2, bearing, [31, 119, 216, 0.12]);
  addSetbackBand(Math.min(req.right, w), innerDepth, w / 2 - Math.min(req.right, w) / 2, (req.front - req.rear) / 2, bearing, [31, 119, 216, 0.12]);

  const envelopeWidth = Math.max(0.2, w - req.left - req.right);
  const envelopeDepth = Math.max(0.2, d - req.front - req.rear);
  const envelopeX = (req.left - req.right) / 2;
  const envelopeY = (req.front - req.rear) / 2;
  envelopeLayer.add(new Graphic({
    geometry: rectanglePolygon(envelopeWidth, envelopeDepth, envelopeX, envelopeY, bearing),
    symbol: extrudeSymbol(assessment.metrics.maxHeight, [33, 136, 223, 0.08], [33, 136, 223, 0.75])
  }));
  envelopeLayer.visible = showEnvelope;

  const buildingX = -w / 2 + set.left + bw / 2;
  const buildingY = -d / 2 + set.front + bd / 2;
  const modelColor = assessment.status === "fail" ? [207, 59, 70, 0.91] : assessment.status === "pass" ? [21, 137, 92, 0.91] : [213, 142, 31, 0.92];
  const modelEdge = assessment.status === "fail" ? [126, 24, 31, 1] : assessment.status === "pass" ? [8, 85, 56, 1] : [126, 76, 8, 1];
  buildingLayer.add(new Graphic({
    geometry: rectanglePolygon(bw, bd, buildingX, buildingY, bearing),
    symbol: extrudeSymbol(Math.max(0.4, finite(input.height)), modelColor, modelEdge),
    attributes: { outcome: assessment.status }
  }));

  if (input.proposalType !== "class10a" && assessment.metrics.lotArea < 2000) {
    const posW = Math.max(0.2, Math.min(finite(input.posWidth), w));
    const posD = Math.max(0.2, Math.min(finite(input.posDepth), d));
    let posX = w / 2 - posW / 2 - 0.35;
    let posY = buildingY + bd / 2 + posD / 2 + 0.25;
    if (posY + posD / 2 > d / 2) posY = d / 2 - posD / 2 - 0.25;
    amenityLayer.add(new Graphic({ geometry: rectanglePolygon(posW, posD, posX, posY, bearing), symbol: groundSymbol([126, 87, 194, 0.34], [91, 57, 154, 0.95], 1.4) }));
  }

  if (input.proposalType !== "class10a") {
    const spaces = Math.max(0, Math.min(3, Math.round(finite(input.parkingSpaces))));
    for (let n = 0; n < spaces; n++) {
      const parkingW = 2.5;
      const parkingD = Math.min(5.4, Math.max(2, d - 0.5));
      const px = w / 2 - parkingW / 2 - n * (parkingW + 0.15) - 0.25;
      const py = -d / 2 + parkingD / 2 + 0.25;
      amenityLayer.add(new Graphic({ geometry: rectanglePolygon(parkingW, parkingD, px, py, bearing), symbol: groundSymbol([58, 75, 97, 0.18], [58, 75, 97, 0.75], 0.8) }));
    }
  }
}

function renderFallback(input, assessment) {
  const fallback = $("fallbackScene");
  if (!fallback) return;
  const lotWidth = Math.max(1, finite(input.lotWidth));
  const lotDepth = Math.max(1, finite(input.lotDepth));
  const metrics = assessment.metrics;
  const req = metrics.requiredSetbacks;
  const pct = (value, total, min, max) => `${Math.max(min, Math.min(max, value / total * 100)).toFixed(2)}%`;
  fallback.style.setProperty("--building-left", pct(metrics.setbacks.left, lotWidth, -8, 96));
  fallback.style.setProperty("--building-top", pct(metrics.setbacks.front, lotDepth, -8, 96));
  fallback.style.setProperty("--building-width", pct(input.buildingWidth, lotWidth, 2, 112));
  fallback.style.setProperty("--building-depth", pct(input.buildingDepth, lotDepth, 2, 112));
  fallback.style.setProperty("--envelope-left", pct(req.left, lotWidth, 0, 96));
  fallback.style.setProperty("--envelope-top", pct(req.front, lotDepth, 0, 96));
  fallback.style.setProperty("--envelope-width", pct(Math.max(0, lotWidth - req.left - req.right), lotWidth, 1, 100));
  fallback.style.setProperty("--envelope-depth", pct(Math.max(0, lotDepth - req.front - req.rear), lotDepth, 1, 100));
  fallback.classList.remove("pass", "fail", "review");
  fallback.classList.add(assessment.status);
  const caption = fallback.querySelector(".fallback-caption strong");
  if (caption && !viewReady) caption.textContent = `${statusText(assessment.status)} · loading mapped context`;
}

function refresh() {
  const input = readInputs();
  latestAssessment = rules.assessment(input);
  syncConditionalFields(input);
  renderResults(latestAssessment);
  renderModel(input, latestAssessment);
}

function syncConditionalFields(input) {
  const class10 = input.proposalType === "class10a";
  $("class10SubtypeField").hidden = !class10;
  $("meanHeightField").hidden = !(class10 && input.class10Subtype === "carport");
  $("dwellingAmenityFields").hidden = class10;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $("mapToast");
  el.textContent = message;
  el.style.background = error ? "rgba(142, 41, 49, .96)" : "rgba(16, 34, 63, .94)";
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function setLocateStatus(message, error = false) {
  $("locateStatus").textContent = message;
  $("locateStatus").classList.toggle("error", error);
}

function cameraForModel() {
  const input = readInputs();
  const range = Math.max(85, Math.hypot(input.lotWidth, input.lotDepth) * 3.5);
  const latOffset = (range * 0.42) / metresPerDegreeLatitude(locationState.latitude);
  return new Camera({
    position: { latitude: locationState.latitude - latOffset, longitude: locationState.longitude, z: range * 0.72 },
    heading: finite(input.lotBearing), tilt: 62
  });
}

async function resetCamera() {
  if (!viewReady) return;
  try { await view.goTo(cameraForModel(), { speedFactor: 0.8 }); } catch (_) { /* interrupted navigation */ }
}

function parseCoordinates(value) {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value || "");
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return latitude >= -44 && latitude <= -10 && longitude >= 111 && longitude <= 156 ? { latitude, longitude } : null;
}

async function geocodeAddress() {
  const raw = $("address").value.trim();
  if (!raw) return;
  setLocateStatus("Searching Queensland…");
  try {
    let hit = parseCoordinates(raw);
    if (!hit) {
      const query = /australia|qld|queensland/i.test(raw) ? raw : `${raw}, Queensland, Australia`;
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=au&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Address service unavailable");
      const rows = await response.json();
      if (rows && rows[0]) hit = { latitude: Number(rows[0].lat), longitude: Number(rows[0].lon), label: rows[0].display_name };
    }
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) throw new Error("No Queensland result found");
    locationState = { latitude: hit.latitude, longitude: hit.longitude };
    setLocateStatus(hit.label || `Located ${hit.latitude.toFixed(5)}, ${hit.longitude.toFixed(5)}`);
    renderModel(readInputs(), latestAssessment || rules.assessment(readInputs()));
    await resetCamera();
    await queryParcelAtPoint(new Point({ longitude: hit.longitude, latitude: hit.latitude }));
  } catch (error) {
    setLocateStatus(error.message || "Address search failed", true);
    showToast(error.message || "Address search failed", true);
  }
}

function parcelLabel(attributes) {
  if (!attributes) return "parcel";
  const lot = attributes.LOT || attributes.LOT_NO || attributes.LOT_NUMBER || "";
  const plan = attributes.PLAN || attributes.PLAN_ || attributes.PLAN_NO || "";
  return [lot ? `Lot ${lot}` : "", plan].filter(Boolean).join(" ") || "parcel";
}

async function queryParcelAtPoint(point) {
  try {
    const query = parcelLayer.createQuery();
    query.geometry = point;
    query.spatialRelationship = "intersects";
    query.returnGeometry = true;
    query.outFields = ["*"];
    query.num = 1;
    const response = await parcelLayer.queryFeatures(query);
    const feature = response.features && response.features[0];
    if (!feature) return null;
    selectedParcelLayer.removeAll();
    selectedParcelLayer.add(new Graphic({ geometry: feature.geometry, symbol: groundSymbol([255, 188, 54, 0.10], [238, 151, 21, 1], 2.2) }));
    const label = parcelLabel(feature.attributes);
    $("lotPlan").value = label === "parcel" ? $("lotPlan").value : label;
    setLocateStatus(`Located ${label}. Enter the effective lot width and depth from the survey plan.`);
    return feature;
  } catch (error) {
    console.warn("Parcel query unavailable", error);
    return null;
  }
}

async function findLotPlan() {
  const raw = $("lotPlan").value.trim().toUpperCase();
  const match = /(?:LOT\s*)?([0-9A-Z.-]+)\s+([A-Z]{1,5}[0-9]+(?:SP)?)$/.exec(raw);
  if (!match) {
    setLocateStatus("Enter a lot and plan such as “Lot 19 RP90746”.", true);
    return;
  }
  setLocateStatus(`Searching for Lot ${match[1]} ${match[2]}…`);
  try {
    const safeLot = match[1].replace(/'/g, "''");
    const safePlan = match[2].replace(/'/g, "''");
    const query = parcelLayer.createQuery();
    query.where = `LOT = '${safeLot}' AND PLAN = '${safePlan}'`;
    query.outFields = ["*"];
    query.returnGeometry = true;
    query.num = 1;
    const response = await parcelLayer.queryFeatures(query);
    const feature = response.features && response.features[0];
    if (!feature) throw new Error("Lot / plan not found in the Queensland DCDB");
    selectedParcelLayer.removeAll();
    selectedParcelLayer.add(new Graphic({ geometry: feature.geometry, symbol: groundSymbol([255, 188, 54, 0.10], [238, 151, 21, 1], 2.2) }));
    const center = feature.geometry.extent.center;
    locationState = { latitude: center.latitude, longitude: center.longitude };
    setLocateStatus(`Located ${parcelLabel(feature.attributes)}. Confirm dimensions against the survey plan.`);
    renderModel(readInputs(), latestAssessment || rules.assessment(readInputs()));
    await resetCamera();
  } catch (error) {
    setLocateStatus(error.message || "Lot / plan search failed", true);
    showToast(error.message || "Lot / plan search failed", true);
  }
}

function saveDraft() {
  const payload = { inputs: readInputs(), location: locationState, savedAt: new Date().toISOString() };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  showToast("Draft saved in this browser");
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!saved || !saved.inputs) return false;
    writeInputs(saved.inputs);
    if (saved.location && Number.isFinite(saved.location.latitude) && Number.isFinite(saved.location.longitude)) locationState = saved.location;
    setLocateStatus(`Restored draft saved ${new Date(saved.savedAt).toLocaleString("en-AU")}.`);
    return true;
  } catch (_) { return false; }
}

function loadSample(fullyConfirmed = false) {
  const sample = {
    projectName: fullyConfirmed ? "Compliant example — preliminary" : "New dwelling — concept review",
    council: fullyConfirmed ? "Brisbane City Council" : "",
    address: "Brisbane QLD", lotPlan: "", councilAdoption: fullyConfirmed ? "yes" : "unknown",
    dwellingPermitted: fullyConfirmed ? "yes" : "unknown", priorityDevelopmentArea: "no",
    overlayChecked: fullyConfirmed ? "yes" : "unknown", planOfDevelopmentChecked: fullyConfirmed ? "yes" : "unknown",
    lotWidth: 12.5, lotDepth: 32, slope: 2, lotBearing: 0, frontageType: "road", proposalType: "primary",
    class10Subtype: "garage", buildingWidth: 9, buildingDepth: 18, height: 7.5, storeys: 2, meanHeight: 3.5,
    frontSetback: 3, leftSetback: 1.5, otherSiteCover: 0, hasSecondaryDwelling: false,
    parkingSpaces: 2, coveredParkingSpaces: 1, parkingDimensions: "yes", garageAccessWidth: 4.8,
    garageOverhang: false, posWidth: 3, posDepth: 5, posOpenSkyArea: 7.5, posSlope: 2,
    privacyTrigger: fullyConfirmed ? "no" : "unknown", privacySolution: "unknown",
    maintenanceFree: fullyConfirmed ? "yes" : "unknown", visibleEntry: fullyConfirmed ? "yes" : "unknown"
  };
  writeInputs(sample);
  locationState = { ...SAMPLE_LOCATION };
  selectedParcelLayer.removeAll();
  setLocateStatus(fullyConfirmed ? "Loaded a fully confirmed passing example. Replace every sample value with project evidence." : "The model is placed on the Brisbane sample site.");
  refresh();
  resetCamera();
}

document.querySelectorAll(".step-toggle").forEach(button => button.addEventListener("click", () => {
  const card = button.closest(".step-card");
  const open = card.classList.toggle("open");
  button.setAttribute("aria-expanded", String(open));
}));

inputIds.forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener(el.tagName === "SELECT" ? "change" : "input", refresh);
});

$("searchAddress").addEventListener("click", geocodeAddress);
$("address").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); geocodeAddress(); } });
$("searchLotPlan").addEventListener("click", findLotPlan);
$("lotPlan").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); findLotPlan(); } });
$("sampleSite").addEventListener("click", () => loadSample(false));
$("compliantExample").addEventListener("click", () => loadSample(true));
$("saveDraft").addEventListener("click", saveDraft);
$("printReport").addEventListener("click", () => window.print());
$("resetCamera").addEventListener("click", resetCamera);
$("toggleEnvelope").addEventListener("click", event => {
  showEnvelope = !showEnvelope;
  envelopeLayer.visible = showEnvelope;
  event.currentTarget.classList.toggle("active", showEnvelope);
});
$("toggleAerial").addEventListener("click", event => {
  aerialOn = !aerialOn;
  map.basemap = aerialOn ? aerialBasemap : simpleBasemap;
  event.currentTarget.classList.toggle("active", aerialOn);
});
$("selectParcel").addEventListener("click", event => {
  selectingParcel = !selectingParcel;
  event.currentTarget.classList.toggle("active", selectingParcel);
  $("mapHelp").innerHTML = selectingParcel ? "<strong>Select parcel mode.</strong> Click a Queensland property boundary to relocate the assessment model." : "<strong>Live compliance model.</strong> Green means the modelled geometry passes; red marks at least one failed check; amber means required context is still unconfirmed.";
});
view.on("click", async event => {
  if (!selectingParcel) return;
  const point = event.mapPoint;
  if (!point) return;
  locationState = { latitude: point.latitude, longitude: point.longitude };
  await queryParcelAtPoint(point);
  renderModel(readInputs(), latestAssessment || rules.assessment(readInputs()));
  await resetCamera();
  selectingParcel = false;
  $("selectParcel").classList.remove("active");
});

document.querySelectorAll(".filter-btn").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(item => item.classList.toggle("active", item === button));
  if (latestAssessment) renderResults(latestAssessment);
}));
$("expandResults").addEventListener("click", event => {
  const expanded = $("resultGroups").classList.toggle("show-details");
  event.currentTarget.textContent = expanded ? "Hide detail" : "Show detail";
});

view.when(async () => {
  viewReady = true;
  $("fallbackScene").classList.add("hidden");
  refresh();
  await resetCamera();
}).catch(error => {
  console.warn("3D map initialization failed", error);
  $("fallbackScene").classList.remove("hidden");
  const caption = $("fallbackScene").querySelector(".fallback-caption strong");
  if (caption) caption.textContent = "3D preview · mapped context unavailable";
  setLocateStatus("The compliance engine is available, but the 3D map could not be loaded.", true);
});

loadDraft();
refresh();
