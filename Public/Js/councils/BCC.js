// Extracted from BCC.html. Keep this file as the independent page brain for BCC.
import {
  $,
  addCorsHosts,
  attrEsc,
  backgroundFactor,
  checkToken,
  formatRemaining,
  getQueryParam,
  htmlEsc,
  loadPaymentUrl,
  raf,
  setPaymentLink,
  setReportFrameHTML,
  setReportViewerVisible,
  setText,
  setTimerVisible,
  showLoading,
  sleep,
  slug
} from "../council-hub.js?v=20260707-pod";
    const FILE_MODE = !!window.__CORNERSTONE_FILE_MODE__;
    /* ---------------- ArcGIS imports ---------------- */
    import Portal from "https://js.arcgis.com/4.30/@arcgis/core/portal/Portal.js";
    import WebMap from "https://js.arcgis.com/4.30/@arcgis/core/WebMap.js";
    import MapView from "https://js.arcgis.com/4.30/@arcgis/core/views/MapView.js";
    import Graphic from "https://js.arcgis.com/4.30/@arcgis/core/Graphic.js";
    import GraphicsLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/GraphicsLayer.js";
    import FeatureLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/FeatureLayer.js";
    import Search from "https://js.arcgis.com/4.30/@arcgis/core/widgets/Search.js";
    import Expand from "https://js.arcgis.com/4.30/@arcgis/core/widgets/Expand.js";
    import ScaleBar from "https://js.arcgis.com/4.30/@arcgis/core/widgets/ScaleBar.js";
    import Home from "https://js.arcgis.com/4.30/@arcgis/core/widgets/Home.js";
    import LayerList from "https://js.arcgis.com/4.30/@arcgis/core/widgets/LayerList.js";
    import Legend from "https://js.arcgis.com/4.30/@arcgis/core/widgets/Legend.js";
    import BasemapGallery from "https://js.arcgis.com/4.30/@arcgis/core/widgets/BasemapGallery.js";
    import Fullscreen from "https://js.arcgis.com/4.30/@arcgis/core/widgets/Fullscreen.js";
    import * as reactiveUtils from "https://js.arcgis.com/4.30/@arcgis/core/core/reactiveUtils.js";
    import * as geometryEngine from "https://js.arcgis.com/4.30/@arcgis/core/geometry/geometryEngine.js";
    import * as webMercatorUtils from "https://js.arcgis.com/4.30/@arcgis/core/geometry/support/webMercatorUtils.js";
    import * as symbolUtils from "https://js.arcgis.com/4.30/@arcgis/core/symbols/support/symbolUtils.js";
    import * as locator from "https://js.arcgis.com/4.30/@arcgis/core/rest/locator.js";
    import esriConfig from "https://js.arcgis.com/4.30/@arcgis/core/config.js";
    /* ---------------- Tunables ---------------- */
    const TOUCH_BUFFER_M = 6;
    const SWATCH_PX = 16;
    const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
    const BRISBANE=[153.0251,-27.4698];
    const M2="m2";
    const QUERY_TIMEOUT_MS = 3000;       // cap slow overlay queries
    const SUMMARY_QUERY_TIMEOUT_MS = 8000; // more time for sidebar overlay summary
    const RENDER_TIMEOUT_MS = 14000;     // cap render waits (longer for background)
    const FAST_RENDER_TIMEOUT_MS = 9000;
    const SCREENSHOT_FORMAT = "png";     // higher-fidelity output for reports
    const SCREENSHOT_QUALITY = 92;       // used if format supports quality
    const FAST_SCREENSHOT_QUALITY = 82;  // still higher quality when fast mode is on
    const SCREENSHOT_TIMEOUT_MS = 14000; // cap screenshot time (longer for background)
    const BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";
    const MAX_ZONING_LAYERS = 5;
    const MAX_UTILITY_LAYERS = 6;
    const MAX_TRANSPORT_LAYERS = 5;
    const MAX_OTHER_LAYERS = 6;
    const MAX_LEGEND_FEATURES = 50;
    const FAST_MAX_OTHER = 3;
    const FAST_MAX_LEGEND_FEATURES = 6;
    const HEAVY_OVERLAY_THRESHOLD = 14;    // if we hit this many overlays, auto-trim counts
    const HEAVY_MAX_OTHER = 3;
    const HEAVY_MAX_LEGEND_FEATURES = 12;
    const HEAVY_MAX_ZONING_LAYERS = 4;
    const HEAVY_MAX_UTILITY_LAYERS = 5;
    const HEAVY_MAX_TRANSPORT_LAYERS = 4;
    const SHOT_SIZE = { width: 1400, height: 900 };
    const FAST_SHOT_SIZE = { width: 1100, height: 720 };
    let currentReportOptions = { fast:false, maxLegend:MAX_LEGEND_FEATURES, maxOther:MAX_OTHER_LAYERS };
    function getShotOptions(){
      const fast = !!currentReportOptions?.fast;
      const size = fast ? FAST_SHOT_SIZE : SHOT_SIZE;
      const quality = fast ? FAST_SCREENSHOT_QUALITY : SCREENSHOT_QUALITY;
      const viewW = Math.round(view?.width || size.width);
      const viewH = Math.round(view?.height || size.height);
      const width = Math.min(size.width, viewW);
      const height = Math.min(size.height, viewH);
      return { format: SCREENSHOT_FORMAT, quality, width, height };
    }
    const renderTimeoutMs = ()=> currentReportOptions?.fast ? FAST_RENDER_TIMEOUT_MS : RENDER_TIMEOUT_MS;
    // 3 houses out
    const HOUSES_OUT = 3;
    const HOUSE_LOT_METERS = 25;
    const SCREEN_BUFFER_METERS = HOUSES_OUT * HOUSE_LOT_METERS;
    /* ---- CORS allow-list for address queries ---- */
    const CORS_HOSTS = [
      "cornerstonebc.maps.arcgis.com",
      "services.arcgis.com",
      "services2.arcgis.com",
      "gisservices.information.qld.gov.au",
      "spatial-gis.information.qld.gov.au",
      "gis.brisbane.qld.gov.au",
      "maps.moretonbay.qld.gov.au",
      // Added for FloodWise / Open Data
      "data.brisbane.qld.gov.au",
      "fwpr.brisbane.qld.gov.au"
    ];
    addCorsHosts(esriConfig, CORS_HOSTS);
    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async(extra=80)=>{
      const pad = extra * backgroundFactor();
      if(document?.visibilityState==="hidden"){
        // In hidden tabs rendering pauses; just pause briefly instead of waiting forever
        await sleep(pad);
      }else{
        try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{}
        await raf();
        await sleep(pad);
      }
    };
    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null,
      countdownTimer: null
    };
    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/28E28r0rQg3ffu3eUN7ss0o";
    const setGateVisible = on=>{
      const gate = $("accessGate");
      if(!gate) return;
      gate.classList.toggle("active", !!on);
      gate.setAttribute("aria-hidden", on ? "false" : "true");
    };
    const setGateMessage = (title, msg)=>{
      setText("accessGateTitle", title);
      setText("accessGateMsg", msg);
    };
    const startCountdown = expiresAt=>{
      const expiry = new Date(expiresAt);
      const tick = ()=>{
        const ms = expiry - new Date();
        if(ms <= 0){
          stopCountdown();
          handleExpiry();
          return;
        }
        const el = $("accessCountdown");
        if(el) el.textContent = formatRemaining(ms);
      };
      tick();
      accessState.countdownTimer = setInterval(tick, 1000);
      setTimerVisible(true);
    };
    const stopCountdown = ()=>{
      if(accessState.countdownTimer){
        clearInterval(accessState.countdownTimer);
        accessState.countdownTimer = null;
      }
    };
    const handleExpiry = ()=>{
      accessState.active = false;
      setGateMessage("Session expired", "Your 24-hour access window has ended. Please purchase again to continue.");
      setGateVisible(true);
      setTimerVisible(false);
    };
    const initAccessGate = async()=>{
      if(window.__CORNERSTONE_FILE_MODE__){
        accessState.active = false;
        accessState.expiresAt = null;
        setPaymentLink(PAYMENT_FALLBACK_URL);
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        return;
      }
      accessState.key = getQueryParam("key");
      accessState.paymentUrl = await loadPaymentUrl();
      setPaymentLink(accessState.paymentUrl || PAYMENT_FALLBACK_URL);
      const homeBtn = $("accessGateHome");
      if(homeBtn){
        homeBtn.addEventListener("click", ()=>{ window.location.href = "Index.html"; });
      }
      if(!accessState.key){
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        setTimerVisible(false);
        return;
      }
      const result = await checkToken(accessState.key);
      if(!result.ok){
        setGateMessage("Access denied", result.error || "This access link is invalid or expired.");
        setGateVisible(true);
        setTimerVisible(false);
        return;
      }
      accessState.active = true;
      accessState.expiresAt = result.expiresAt;
      setGateVisible(false);
      startCountdown(result.expiresAt);
    };
    const isAccessActive = ()=>{
      if(window.__CORNERSTONE_FILE_MODE__) return false;
      if(!accessState.active || !accessState.expiresAt) return false;
      return new Date(accessState.expiresAt) > new Date();
    };
    const finalizeTokenAndLock = async()=>{
      if(window.__CORNERSTONE_FILE_MODE__) return;
      if(!accessState.key){
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        setTimerVisible(false);
        return;
      }
      try{
        await fetch(`/api/finalise-token?key=${encodeURIComponent(accessState.key)}`, { method: "POST" });
      }catch{}
      stopCountdown();
      accessState.active = false;
      setGateMessage("Payment required", "Access used. Please purchase again to continue.");
      setGateVisible(true);
      setTimerVisible(false);
    };
    initAccessGate();
    const CITY_PLAN_BASE="https://cityplan.brisbane.qld.gov.au/eplan/#/";
    const QDC_MP12_URL="https://www.chde.qld.gov.au/__data/assets/pdf_file/0012/4305/mp1-2.pdf";
    const STANDARD_LOT_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/162/0/0/0/264";
    const SMALL_LOT_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/163/0/0/0/264";
    const BIODIVERSITY_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/131/0/0/0/264";
    const BUSHFIRE_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/132/0/0/0/264";
    const COASTAL_HAZARD_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/133/0/0/0/264";
    const HERITAGE_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/140/0/0/0/264";
    const FLOOD_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/139/0/0/0/264";
    const TBC_DESIGN_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/150/0/0/0/264";
    const TBC_DEMOLITION_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/149/0/0/0/264";
    const TRANSPORT_NOISE_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/152/0/0/0/264";
    const LANDSLIDE_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/142/0/0/0/264";
    const PRE_1911_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/144/0/0/0/264";
    const INDUSTRIAL_AMENITY_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/141/0/0/0/264";
    const KEY_CIVIC_VISTA_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/517/0/0/0/264";
    const ROAD_HIERARCHY_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/146/0/0/0/264";
    const SIGNIFICANT_LANDSCAPE_TREE_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/147/0/0/0/264";
    const WATERWAY_CORRIDORS_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/154/0/0/0/264";
    const WETLAND_RULE_URL="https://cityplan.brisbane.qld.gov.au/eplan/rules/0/155/0/0/0/264";
    const compact=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
    const ZONING_CODE_URL={
      LDR:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/21/0/0/0/264",
      CR:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/25/0/14552/0/264",
      CR1:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/25/0/14552/0/264",
      CR2:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/25/0/14552/0/264",
      LMR:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/22/0/0/0/264",
      LMR1:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/22/0/0/0/264",
      LMR2:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/22/0/0/0/264",
      LMR3:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/22/0/0/0/264",
      MDR:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/23/0/0/0/264",
      HDR1:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/24/0/0/0/264",
      HDR2:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/24/0/0/0/264",
      TA:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/26/0/0/0/264",
      PC1:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/27/0/723/0/264",
      PC2:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/27/0/723/0/264",
      PC:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/27/0/723/0/264",
      RR:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/44/0/0/0/264",
      EM:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/33/0/0/0/264",
    };
    const ZONING_CODE_RX=new RegExp(`\\b(${Object.keys(ZONING_CODE_URL).join("|")})\\b`,"i");
    const ZONING_RULE_MAP=globalThis.ZONING_RULE_MAP || [];
    const NEIGHBOURHOOD_PLAN_MAP=[
      {key:compact("Acacia Ridge Archerfield"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/48/0/0/0/264"},
      {key:compact("Albion"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/49/0/0/0/264"},
      {key:compact("Algester Parkinson Stretton"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/50/0/0/0/264"},
      {key:compact("Ashgrove Grange"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/51/0/0/0/264"},
      {key:compact("Aspley"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/52/0/0/0/264"},
      {key:compact("Australia TradeCoast"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/53/0/0/0/264"},
      {key:compact("Banyo Northgate"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/54/0/0/0/264"},
      {key:compact("Bowen Hills"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/55/0/0/0/264"},
      {key:compact("Bracken Ridge and district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/56/0/0/0/264"},
      {key:compact("Bridgeman Downs"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/523/0/0/0/264"},
      {key:compact("Bulimba"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/57/0/0/0/264"},
      {key:compact("Calamvale"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/58/0/0/0/264"},
      {key:compact("Capalaba West"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/59/0/0/0/264"},
      {key:compact("Carina Carindale"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/60/0/0/0/264"},
      {key:compact("Carindale centre"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/61/0/0/0/264"},
      {key:compact("Centenary suburbs"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/62/0/0/0/264"},
      {key:compact("Chermside centre"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/63/0/0/0/264"},
      {key:compact("City Centre"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/64/0/0/0/264"},
      {key:compact("City west"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/66/0/0/0/264"},
      {key:compact("Clayfield Wooloowin"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/65/0/0/0/264"},
      {key:compact("Coorparoo and districts"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/510/0/0/0/264"},
      {key:compact("Darra Oxley district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/67/0/0/0/264"},
      {key:compact("Doolandella"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/68/0/0/0/264"},
      {key:compact("Dutton Park Fairfield"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/69/0/0/0/264"},
      {key:compact("East Brisbane Coorparoo"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/70/0/0/0/264"},
      {key:compact("Eastern corridor"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/71/0/0/0/264"},
      {key:compact("Eight Mile Plains gateway"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/526/0/0/0/264"},
      {key:compact("Enoggera district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/72/0/0/0/264"},
      {key:compact("Everton Park"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/73/0/0/0/264"},
      {key:compact("Ferny Grove Upper Kedron"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/74/0/0/0/264"},
      {key:compact("Fig Tree Pocket"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/75/0/0/0/264"},
      {key:compact("Forest Lake"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/76/0/0/0/264"},
      {key:compact("Fortitude Valley"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/77/0/0/0/264"},
      {key:compact("Hemmant Lytton"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/79/0/0/0/264"},
      {key:compact("Holland Park Tarragindi district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/78/0/0/0/264"},
      {key:compact("Indooroopilly centre"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/80/0/0/0/264"},
      {key:compact("Ithaca district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/81/0/0/0/264"},
      {key:compact("Kangaroo Point peninsula"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/82/0/0/0/264"},
      {key:compact("Kangaroo Point south"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/83/0/0/0/264"},
      {key:compact("Kelvin Grove urban village"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/84/0/0/0/264"},
      {key:compact("Kuraby"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/85/0/0/0/264"},
      {key:compact("Lake Manchester"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/86/0/0/0/264"},
      {key:compact("Latrobe and Given Terraces"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/87/0/0/0/264"},
      {key:compact("Lower Oxley Creek north"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/90/0/0/0/264"},
      {key:compact("Lower Oxley Creek south"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/88/0/0/0/264"},
      {key:compact("Lutwyche Road corridor"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/89/0/0/0/264"},
      {key:compact("McDowall"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/91/0/0/0/264"},
      {key:compact("Milton"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/92/0/0/0/264"},
      {key:compact("Milton Station"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/93/0/0/0/264"},
      {key:compact("Mitchelton centre"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/94/0/0/0/264"},
      {key:compact("Mitchelton"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/95/0/0/0/264"},
      {key:compact("Moggill Bellbowrie district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/96/0/0/0/264"},
      {key:compact("Moreton Island settlements"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/98/0/0/0/264"},
      {key:compact("Mt Coot tha"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/99/0/0/0/264"},
      {key:compact("Mt Gravatt corridor"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/100/0/0/0/264"},
      {key:compact("Nathan Salisbury Moorooka"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/534/0/0/0/264"},
      {key:compact("New Farm and Teneriffe Hill"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/101/0/0/0/264"},
      {key:compact("Newstead and Teneriffe waterfront"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/102/0/0/0/264"},
      {key:compact("Newstead north"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/105/0/0/0/264"},
      {key:compact("Nudgee Beach"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/103/0/0/0/264"},
      {key:compact("Nundah district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/104/0/0/0/264"},
      {key:compact("Pinkenba Eagle Farm"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/106/0/0/0/264"},
      {key:compact("Racecourse precinct"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/107/0/0/0/264"},
      {key:compact("Richlands Wacol corridor"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/108/0/0/0/264"},
      {key:compact("River gateway"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/109/0/0/0/264"},
      {key:compact("Rochedale urban community"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/110/0/0/0/264"},
      {key:compact("Sandgate district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/111/0/0/0/264"},
      {key:compact("Sandgate Road"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/112/0/0/0/264"},
      {key:compact("Sherwood Graceville district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/113/0/0/0/264"},
      {key:compact("South Brisbane riverside"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/114/0/0/0/264"},
      {key:compact("Spring Hill"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/115/0/0/0/264"},
      {key:compact("Stephens district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/97/0/0/0/264"},
      {key:compact("Taringa"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/116/0/0/0/264"},
      {key:compact("Toombul Nundah"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/117/0/0/0/264"},
      {key:compact("Toowong Auchenflower"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/118/0/0/0/264"},
      {key:compact("Toowong Indooroopilly district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/119/0/0/0/264"},
      {key:compact("The Gap"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/502/0/0/0/264"},
      {key:compact("Wakerley"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/120/0/0/0/264"},
      {key:compact("West End Woolloongabba district"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/121/0/0/0/264"},
      {key:compact("Western gateway"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/122/0/0/0/264"},
      {key:compact("Willawong"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/123/0/0/0/264"},
      {key:compact("Woolloongabba centre"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/124/0/0/0/264"},
      {key:compact("Wynnum Manly"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/125/0/0/0/264"},
      {key:compact("Wynnum West"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/126/0/0/0/264"},
      {key:compact("Yeerongpilly Transit Oriented Development"),url:"https://cityplan.brisbane.qld.gov.au/eplan/rules/0/127/0/0/0/264"},
    ];
    function zoneUrlFromLabel(label){
      if(!label) return null;
      const clean = String(label).replace(/\(.*?\)/g," ").replace(/\bzone\b/ig," ").trim();
      const tokens = clean.split(/\s+/);
      const code = tokens[0]?.toUpperCase() || "";
      if(code && ZONING_CODE_URL[code]) return ZONING_CODE_URL[code];
      const compactLabel = compact(clean);
      for(const key in ZONING_CODE_URL){
        if(compactLabel.includes(key.toLowerCase())) return ZONING_CODE_URL[key];
      }
      for(const {rx,url} of ZONING_RULE_MAP){
        if(rx.test(clean)) return url;
      }
      return null;
    }
    let lastZoneLabel=null;
    const isTBCOverlayTitle=t=>/trad(?:itional|ition|iation)\s*building\s*char(?:acter|ter)/i.test(String(t||""));
    const neighbourhoodPlanUrlFromTitle=title=>{
      const normalized = compact(title);
      for(const entry of NEIGHBOURHOOD_PLAN_MAP){
        if(normalized.includes(entry.key)) return entry.url;
      }
      return null;
    };
    const buildPlanningSchemeLink=(title,{zoneLabel}={})=>{
      if(!title) return CITY_PLAN_BASE;
      const specificZone=zoneLabel || lastZoneLabel;
      const term=String(title).replace(/\s+/g," ").trim();
      if(!term) return CITY_PLAN_BASE;
      if(/biodivers/i.test(term)) return BIODIVERSITY_RULE_URL;
      if(/bushfire/i.test(term)) return BUSHFIRE_RULE_URL;
      if(/coast(al|el)\s*hazard/i.test(term)) return COASTAL_HAZARD_RULE_URL;
      if(/heritage/i.test(term)) return HERITAGE_RULE_URL;
      if(/waterway\s*corridors?\s*flood/i.test(term)) return FLOOD_RULE_URL;
      if(/flood|overland\s*flow|creek|river/i.test(term)) return FLOOD_RULE_URL;
      if(isTBCOverlayTitle(term)){
        if(/demol/i.test(term)) return TBC_DEMOLITION_RULE_URL;
        if(/design/i.test(term)) return TBC_DESIGN_RULE_URL;
        return TBC_DESIGN_RULE_URL;
      }
      if(/transport\s*noise/i.test(term)) return TRANSPORT_NOISE_RULE_URL;
      if(/landslide/i.test(term)) return LANDSLIDE_RULE_URL;
      if(/pre[\s-]*1911/i.test(term)) return PRE_1911_RULE_URL;
      if(/industrial\s*amenity/i.test(term)) return INDUSTRIAL_AMENITY_RULE_URL;
      if(/key\s*civic\s*space|iconic\s*vista/i.test(term)) return KEY_CIVIC_VISTA_RULE_URL;
      if(/road\s*hierarchy/i.test(term)) return ROAD_HIERARCHY_RULE_URL;
      if(/significant\s*landscape\s*tree/i.test(term)) return SIGNIFICANT_LANDSCAPE_TREE_RULE_URL;
      if(/waterway\s*corridors?/i.test(term)) return WATERWAY_CORRIDORS_RULE_URL;
      if(/wetlands?/i.test(term)) return WETLAND_RULE_URL;
      const neighbourhoodPlanUrl = neighbourhoodPlanUrlFromTitle(term);
      if(neighbourhoodPlanUrl) return neighbourhoodPlanUrl;
      const isZoningContext = /\bzoning?\b/i.test(term) || !!specificZone;
      const zoneTermRaw = isZoningContext && specificZone ? specificZone : term;
      const zoneTerm = zoneTermRaw.replace(/\(.*?\)/g," ").replace(/\bzone\b/ig," ").trim() || zoneTermRaw;
      // try specific zone explicit mapping first
      if(specificZone){
        const specClean=specificZone.replace(/\(.*?\)/g," ").replace(/\bzone\b/ig," ").trim();
        const url = zoneUrlFromLabel(specClean);
        if(url) return url;
      }
      for(const {rx,url} of ZONING_RULE_MAP){ if(rx.test(zoneTerm)) return url; }
      const aliasUrl = zoneUrlFromLabel(zoneTerm);
      if(aliasUrl) return aliasUrl;
      if(isZoningContext) return null; // avoid falling back to search for zoning
      const isSmallLot=/small/i.test(lastParcelInfo?.classText||"");
      if(/dwelling|house/i.test(zoneTerm)) return isSmallLot ? SMALL_LOT_RULE_URL : STANDARD_LOT_RULE_URL;
      const searchTerm = specificZone || zoneTerm;
      const q=encodeURIComponent(`${searchTerm} City Plan 2014`);
      return `${CITY_PLAN_BASE}?search=${q}`;
    };
    let renderPulse=null;
    const startRenderPulse=()=>{ if(renderPulse) return; renderPulse=setInterval(()=>{ try{ view.requestRender?.(); }catch{} }, 2500); };
    const stopRenderPulse=()=>{ if(renderPulse){ clearInterval(renderPulse); renderPulse=null; } };
    let wakeLock=null;
    const ensureWakeLock=async()=>{
      if(!("wakeLock" in navigator)) return false;
      try{
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", ()=>{ wakeLock=null; });
        return true;
      }catch{ return false; }
    };
    const releaseWakeLock=async()=>{
      try{ await wakeLock?.release?.(); }catch{}
      wakeLock=null;
    };
    document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && wakeLock){ ensureWakeLock(); } });
    const withTimeout=async(promise,ms,label)=>{
      const timeoutMs = Math.max(0, Math.round(ms * backgroundFactor()));
      let timer;
      try{
        return await Promise.race([
          promise,
          new Promise((_,rej)=>{ timer=setTimeout(()=>rej(new Error(label||"timeout")), timeoutMs); })
        ]);
      }finally{
        clearTimeout(timer);
      }
    };
    // POD detection runs entirely in-browser; backend upload flag remains for future use
    const PDF_WORKER_SRC="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    let pdfLibPromise=null;
    const ensurePdfjs=async()=>{
      if(window.pdfjsLib) return window.pdfjsLib;
      if(!pdfLibPromise){
        pdfLibPromise=new Promise((resolve,reject)=>{
          const script=document.createElement("script");
          script.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.crossOrigin="anonymous";
          script.referrerPolicy="no-referrer";
          script.onload=()=>{
            if(window.pdfjsLib){
              try{
                window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDF_WORKER_SRC;
              }catch(e){ console.warn("pdfjs worker init failed",e); }
              resolve(window.pdfjsLib);
            }else{
              reject(new Error("pdf.js did not load"));
            }
          };
          script.onerror=()=>reject(new Error("Failed to load pdf.js"));
          document.head.appendChild(script);
        });
      }
      return pdfLibPromise;
    };
    async function extractPdfText(file){
      if(!file) throw new Error("No file selected");
      await ensurePdfjs();
      if(!window.pdfjsLib) throw new Error("PDF parser not available");
      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({data:buffer}).promise;
      let text="";
      for(let i=1;i<=pdf.numPages;i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(item=>item.str||"").filter(Boolean);
        text += strings.join(" ") + "\n";
      }
      return text;
    }
    function parseSubdivisionsFromText(text){
      if(!text) return [];
      const lines = text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
      const subdivisions=[];
      const planRegex=/\b((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/i;
      const planLooseRegex=/((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)/i;
      const lotRegex=/\b(?:lot|lot\s*no\.?)\s*[:#-]?\s*([0-9A-Za-z-]+)\b/i;
      const comboRegex=/(\d+[A-Za-z-]?)(?:\s*(?:\/|on)\s*|\s*)((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)/i;
      const areaRegex=/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:m2|m\u00b2|sqm|square metres?)/i;
      const addUnique=(lot,plan,areaSqm,raw)=>{
        const key=`${lot||""}_${plan||""}`;
        if(!subdivisions.some(sub=>`${sub.lot}_${sub.plan}`===key)){
          subdivisions.push({lot:lot||null,plan:plan||null,areaSqm:areaSqm??null,raw});
        }
      };
      [...text.matchAll(/\bLot\s+(\d+[A-Za-z-]?)\s+on\s+((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/ig)]
        .forEach(m=> addUnique(m[1].toUpperCase(), m[2].replace(/[\s-]+/g,"").toUpperCase(), null, m[0]));
      [...text.matchAll(/\b(\d+[A-Za-z-]?)\s*(?:\/|on)?\s*((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/ig)]
        .forEach(m=> addUnique(m[1].toUpperCase(), m[2].replace(/[\s-]+/g,"").toUpperCase(), null, m[0]));
      let current=null;
      const pushCurrent=()=>{
        if(!current) return;
        if(!current.lot && !current.plan) return;
        if(typeof current.areaSqm!=="number"||!Number.isFinite(current.areaSqm)){
          current.areaSqm=null;
        }
        addUnique(current.lot, current.plan, current.areaSqm, current.raw);
      };
      for(const line of lines){
        const normalized=line.replace(/\s+/g," ");
        const lotMatch=normalized.match(lotRegex);
        let planMatch=normalized.match(planRegex);
        if(!planMatch) planMatch=normalized.match(planLooseRegex);
        const comboMatch=normalized.match(comboRegex);
        const areaMatch=normalized.match(areaRegex);
        let candidateLot=null;
        let candidatePlan=null;
        if(comboMatch){
          candidateLot=comboMatch[1].toUpperCase();
          candidatePlan=comboMatch[2].replace(/[\s-]+/g,"").toUpperCase();
        }
        if(lotMatch){
          candidateLot=lotMatch[1].toUpperCase();
        }
        if(planMatch){
          candidatePlan=planMatch[1].replace(/[\s-]+/g,"").toUpperCase();
          if(!candidateLot && typeof planMatch.index==="number"){
            const prefix=normalized.slice(0, planMatch.index).trim();
            const inline=prefix.match(/(\d+[A-Za-z-]?)/);
            if(inline){
              candidateLot=inline[1].toUpperCase();
            }
          }
        }
        const shouldStartNew=!current||
          (candidateLot&&current.lot&&candidateLot!==current.lot)||
          (candidatePlan&&current.plan&&candidatePlan!==current.plan);
        if(shouldStartNew){
          pushCurrent();
          current={lot:null,plan:null,areaSqm:null,raw:normalized};
        }else if(current){
          current.raw=normalized;
        }else{
          current={lot:null,plan:null,areaSqm:null,raw:normalized};
        }
        if(candidateLot){
          current.lot=candidateLot;
        }
        if(candidatePlan){
          current.plan=candidatePlan;
        }
        if(areaMatch){
          const parsed=parseFloat(areaMatch[1].replace(/,/g,""));
          if(!Number.isNaN(parsed)){
            current.areaSqm=parsed;
          }
        }
      }
      pushCurrent();
      return subdivisions;
    }
    const LOT_SCREEN_MARGIN = 1.12;
    function screenshotAspectRatio(){
      try{
        const opts = (typeof getShotOptions === "function") ? getShotOptions() : SHOT_SIZE;
        const w = Number(opts?.width || SHOT_SIZE.width);
        const h = Number(opts?.height || SHOT_SIZE.height);
        if(Number.isFinite(w) && Number.isFinite(h) && h > 0) return w / h;
      }catch{}
      return SHOT_SIZE.width / SHOT_SIZE.height;
    }
    function extentForScreenshotFrame(extent){
      if(!extent) return extent;
      const out = extent.clone?.() || extent;
      let xmin = Number(out.xmin), xmax = Number(out.xmax), ymin = Number(out.ymin), ymax = Number(out.ymax);
      if(![xmin,xmax,ymin,ymax].every(Number.isFinite)) return out;
      if(xmin > xmax) [xmin,xmax] = [xmax,xmin];
      if(ymin > ymax) [ymin,ymax] = [ymax,ymin];
      const aspect = screenshotAspectRatio();
      const cx = (xmin + xmax) / 2;
      const cy = (ymin + ymax) / 2;
      let width = xmax - xmin;
      let height = ymax - ymin;
      if(width <= 0 && height <= 0){ width = SCREEN_BUFFER_METERS * 2; height = width / aspect; }
      else if(width <= 0){ width = Math.max(height * aspect, SCREEN_BUFFER_METERS * 2); }
      else if(height <= 0){ height = Math.max(width / aspect, SCREEN_BUFFER_METERS * 2); }
      width *= LOT_SCREEN_MARGIN;
      height *= LOT_SCREEN_MARGIN;
      const currentAspect = width / height;
      if(currentAspect < aspect) width = height * aspect;
      else if(currentAspect > aspect) height = width / aspect;
      try{
        out.xmin = cx - width / 2;
        out.xmax = cx + width / 2;
        out.ymin = cy - height / 2;
        out.ymax = cy + height / 2;
      }catch{}
      return out;
    }
    function framedExtent(geom){
      try{
        const b=geometryEngine.buffer(geom,SCREEN_BUFFER_METERS,"meters");
        return extentForScreenshotFrame((b&&b.extent)?b.extent:(geom&&geom.extent));
      }catch{return extentForScreenshotFrame(geom && geom.extent);}
    }
    async function withViewOnGeom(geom,fn){
      const vp=view.viewpoint?.clone?.();
      try{
        if(geom?.extent){
          const target=framedExtent(geom);
          await view.goTo(target,{animate:false});
          await waitViewIdle(260);
        }
        return await fn();
      } finally {
        if(vp){ try{ await view.goTo(vp,{animate:false}); await waitViewIdle(160);}catch{} }
      }
    }
    const centroidOf = (g)=>{
      try{
        if (g?.centroid) return g.centroid;
        if (g?.extent?.center) return g.extent.center;
      }catch{}
      return null;
    };
    function getNearbySearchHint(geom){
      if(!lastSearchHint || !lastSearchPoint || !geom) return null;
      try{
        const cen = centroidOf(geom);
        if(!cen) return null;
        const a = projectToViewSR(cen);
        const b = projectToViewSR(lastSearchPoint);
        const d = geometryEngine.distance(a, b, "meters");
        if(d != null && d <= 60) return lastSearchHint;
      }catch{}
      return null;
    }
    const projectToViewSR = (geom)=>{
      try{
        if(!geom || !view?.spatialReference) return geom;
        if(!geom.spatialReference){
          geom.spatialReference = { wkid: 102100 };
        }
        const gSR = geom.spatialReference?.wkid || geom.spatialReference?.latestWkid;
        const vSR = view.spatialReference?.wkid || view.spatialReference?.latestWkid;
        if(gSR && vSR && gSR === vSR) return geom;
        const proj = geometryEngine.project(geom, view.spatialReference);
        return proj || geom;
      }catch{ return geom; }
    };
    const isValidLonLat = (pt)=>{
      if(!pt || typeof pt.x!=="number" || typeof pt.y!=="number") return false;
      const lon=pt.x, lat=pt.y;
      return isFinite(lon) && isFinite(lat) && Math.abs(lon)<=180 && Math.abs(lat)<=90;
    };
    const isInQueensland = (pt)=>{
      if(!isValidLonLat(pt)) return false;
      return pt.x>=110 && pt.x<=160 && pt.y>=-45 && pt.y<=0;
    };
    function normalizeToWebMercator(geom){
      try{
        if(!geom) return geom;
        const sr = geom.spatialReference?.wkid || geom.spatialReference?.latestWkid;
        if(sr===102100 || sr===3857) return geom;
        // Peek at first coordinate to guess units
        const sample = geom.type==="point" ? geom :
          geom.type==="polyline" ? (geom.paths?.[0]?.[0]) :
          geom.type==="polygon" ? (geom.rings?.[0]?.[0]) : null;
        if(sample){
          const x = sample.x ?? sample[0], y = sample.y ?? sample[1];
          if(Math.abs(x)>180 || Math.abs(y)>90){
            geom.spatialReference = { wkid:102100 };
            return geom;
          }
        }
        // assume geographic, project to web mercator
        const projected = geometryEngine.project(geom, {wkid:102100});
        return projected || geom;
      }catch{ return geom; }
    }
    /* ---------------- Map & rules ---------------- */
    const portal=new Portal({url:"https://cornerstonebc.maps.arcgis.com"});
    let webmap=new WebMap({portalItem:{id:"42d4912dc0f04017bdb2296552959eff",portal}});
    const selLayer=new GraphicsLayer({listMode:"hide"}); webmap.add(selLayer);

    // Brisbane City Plan 2014 Bushfire overlay (same dataset used by City Plan online property reports)
    const BRISBANE_BUSHFIRE_LAYER_URL="https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Bushfire_overlay/FeatureServer/0";
    const brisbaneBushfireRenderer={
      type:"unique-value",
      field:"OVL2_CAT",
      defaultSymbol:{type:"simple-fill",color:[0,0,0,0],outline:{color:[120,120,120,0.35],width:0.5}},
      uniqueValueInfos:[
        {value:"BHR_HRZ",label:"High hazard area",symbol:{type:"simple-fill",color:[220,110,100,0.70],outline:{color:[220,110,100,0.95],width:0.4}}},
        {value:"BHR_MRZ",label:"Medium hazard area",symbol:{type:"simple-fill",color:[255,190,60,0.70],outline:{color:[255,190,60,0.95],width:0.4}}},
        {value:"BHR_HRB",label:"High hazard buffer area",symbol:{type:"simple-fill",style:"forward-diagonal",color:[220,110,100,0.70],outline:{color:[220,110,100,0.95],width:0.4}}},
        {value:"BHR_MRB",label:"Medium hazard buffer area",symbol:{type:"simple-fill",style:"backward-diagonal",color:[255,190,60,0.70],outline:{color:[255,190,60,0.95],width:0.8}}},
        {value:"BHR_PI",label:"Potential impact",symbol:{type:"simple-fill",style:"diagonal-cross",color:[0,112,255,0.45],outline:{color:[0,112,255,0.9],width:0.4}}},
        {value:"BHR_POB",label:"Potential impact buffer",symbol:{type:"simple-fill",style:"backward-diagonal",color:[255,0,0,0.55],outline:{color:[255,0,0,0.9],width:0.4}}},
        {value:"BHR_VHI",label:"Very high potential bushfire intensity",symbol:{type:"simple-fill",color:[168,0,0,0.72],outline:{color:[168,0,0,0.95],width:0.6}}},
        {value:"BHR_HI",label:"High potential bushfire intensity",symbol:{type:"simple-fill",color:[255,0,0,0.65],outline:{color:[110,110,110,0.95],width:0.4}}},
        {value:"BHR_MI",label:"Medium potential bushfire intensity",symbol:{type:"simple-fill",color:[255,155,60,0.65],outline:{color:[110,110,110,0.95],width:0.4}}}
      ]
    };
    const brisbaneBushfireLayer=new FeatureLayer({
      url:BRISBANE_BUSHFIRE_LAYER_URL,
      title:"Bushfire overlay - Brisbane City Plan 2014",
      listMode:"show",
      visible:false,
      opacity:0.82,
      minScale:0,
      maxScale:0,
      outFields:["OBJECTID","CAT_DESC","OVL_CAT","OVL2_DESC","OVL2_CAT","DESCRIPTION"],
      popupEnabled:false,
      renderer:brisbaneBushfireRenderer
    });

    // State SPP BPA is kept as a secondary fallback/query layer for comparison, not the primary Brisbane overlay.
    const SPP_BUSHFIRE_LAYER_URL="https://arcgis.spp-dams.wspdigitaltesting.com/arcgis/rest/services/SPP/SPP_Data/MapServer/77";
    const sppBushfireRenderer={
      type:"unique-value",
      field:"CLASS",
      defaultSymbol:{type:"simple-fill",color:[0,0,0,0],outline:{color:[120,120,120,0.35],width:0.5}},
      uniqueValueInfos:[
        {value:"Very High Potential Bushfire Intensity",label:"Very High Potential Bushfire Intensity",symbol:{type:"simple-fill",color:[115,0,0,0.58],outline:{color:[115,0,0,0.9],width:0.8}}},
        {value:"High Potential Bushfire Intensity",label:"High Potential Bushfire Intensity",symbol:{type:"simple-fill",color:[230,0,0,0.5],outline:{color:[204,0,0,0.85],width:0.8}}},
        {value:"Medium Potential Bushfire Intensity",label:"Medium Potential Bushfire Intensity",symbol:{type:"simple-fill",color:[255,170,0,0.42],outline:{color:[214,132,0,0.8],width:0.8}}},
        {value:"Potential Impact Buffer",label:"Potential Impact Buffer",symbol:{type:"simple-fill",style:"forward-diagonal",color:[255,255,255,0],outline:{color:[230,76,0,0.9],width:1}}}
      ]
    };
    const sppBushfireLayer=FILE_MODE
      ? new GraphicsLayer({title:"Bushfire - State SPP BPA fallback unavailable in file mode",listMode:"hide",visible:false})
      : new FeatureLayer({url:SPP_BUSHFIRE_LAYER_URL,title:"Bushfire - State SPP BPA fallback",listMode:"show",visible:false,opacity:0.45,minScale:0,maxScale:0,outFields:["OBJECTID","CLASS"],objectIdField:"OBJECTID",geometryType:"polygon",spatialReference:{wkid:102100},popupEnabled:false,renderer:sppBushfireRenderer});
    webmap.add(brisbaneBushfireLayer);
    webmap.add(sppBushfireLayer);
    const sppBushfireDrawLayer=new GraphicsLayer({listMode:"hide",visible:false});
    webmap.add(sppBushfireDrawLayer);
    try{ brisbaneBushfireLayer.when(()=>console.info("Brisbane City Plan bushfire layer loaded"),err=>console.warn("Brisbane City Plan bushfire layer failed",err)); }catch{}
    try{ if(!FILE_MODE) sppBushfireLayer.when(()=>console.info("State SPP bushfire layer loaded"),err=>console.warn("State SPP bushfire layer failed",err)); }catch{}
    const propertyBoundaryShotLayer=new GraphicsLayer({listMode:"hide"});
    const PROPERTY_BOUNDARY_SHOT_LIMIT=220;
    const propertyBoundaryShotCache=new Map();
    let propertyBoundaryFallbackLayers=null;
    let screenshotSelLayerVisible=null;
    function ensurePropertyBoundaryShotLayer(){
      try{
        const map=view && view.map;
        if(!map || !map.layers) return;
        var has=false;
        try{ has=typeof map.layers.includes==="function" ? map.layers.includes(propertyBoundaryShotLayer) : false; }catch(e){}
        if(!has){
          try{ has=typeof map.layers.some==="function" ? map.layers.some(function(layer){ return layer===propertyBoundaryShotLayer; }) : false; }catch(e){}
        }
        if(!has) map.add(propertyBoundaryShotLayer);
        try{ map.reorder(propertyBoundaryShotLayer,map.layers.length-1); }catch(e){}
      }catch(e){}
    }
    function propertyBoundaryShotSymbol(geom,halo,selected){
      var lineColor=selected ? [167,11,19,1] : [96,104,112,0.72];
      var lineWidth=selected ? (halo?5:2.25) : (halo?2.6:1.05);
      if(geom && geom.type==="polyline") return {type:"simple-line",color:halo?[255,255,255,0.78]:lineColor,width:lineWidth};
      if(geom && geom.type==="point") return {type:"simple-marker",style:"circle",size:selected?(halo?12:8):(halo?8:5),color:halo?[255,255,255,0.15]:(selected?[167,11,19,0.08]:[96,104,112,0.08]),outline:{color:halo?[255,255,255,0.78]:lineColor,width:selected?(halo?3:1.5):(halo?2:1)}};
      return {type:"simple-fill",color:[0,0,0,0],outline:{color:halo?[255,255,255,0.78]:lineColor,width:lineWidth}};
    }
    function addScreenshotPropertyBoundary(geom,selected){
      if(!geom) return;
      try{
        propertyBoundaryShotLayer.add(new Graphic({geometry:geom,symbol:propertyBoundaryShotSymbol(geom,false,!!selected)}));
      }catch(e){}
    }
    function getScreenshotBoundaryQueryGeometry(seedGeom){
      try{ if(view && view.extent) return view.extent; }catch(e){}
      try{
        var bufferMeters=(typeof SCREEN_BUFFER_METERS!=="undefined" && SCREEN_BUFFER_METERS) ? SCREEN_BUFFER_METERS : 75;
        var b=geometryEngine.buffer(seedGeom,bufferMeters,"meters");
        return (b && b.extent) ? b.extent : ((seedGeom && seedGeom.extent) || seedGeom);
      }catch(e){}
      return (seedGeom && seedGeom.extent) || seedGeom;
    }
    function screenshotBoundaryCacheKey(queryGeom){
      try{
        var e=queryGeom && (queryGeom.extent || queryGeom);
        if(e && typeof e.xmin==="number"){
          return [Math.round(e.xmin),Math.round(e.ymin),Math.round(e.xmax),Math.round(e.ymax),view && view.spatialReference && view.spatialReference.wkid].join(":");
        }
      }catch(e){}
      return "";
    }
    function screenshotBoundaryFallbackUrls(){
      var urls=[];
      try{
        if(typeof LOTPLAN_FALLBACK_URLS!=="undefined" && Array.isArray(LOTPLAN_FALLBACK_URLS)){
          for(var i=0;i<LOTPLAN_FALLBACK_URLS.length;i++) urls.push(LOTPLAN_FALLBACK_URLS[i]);
        }
      }catch(e){}
      urls.push(
        "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4",
        "https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/property_boundaries_parcel/FeatureServer/0",
        "https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/property_boundaries_holding/FeatureServer/0",
        "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Property/PropertyBoundaries/MapServer/0"
      );
      var seen={};
      return urls.filter(function(url){
        url=String(url||"");
        if(!url || seen[url]) return false;
        seen[url]=true;
        return /MapServer\/4|property_boundaries_(?:parcel|holding)|PropertyBoundaries\/MapServer\/0/i.test(url);
      });
    }
    async function getScreenshotPropertyBoundaryLayers(){
      var out=[], seen={};
      function add(layer){
        if(!layer || typeof layer.queryFeatures!=="function") return;
        var key=String(layer.url||"")+"|"+String(layer.id||"")+"|"+String(layer.title||"");
        if(seen[key]) return;
        seen[key]=true;
        out.push(layer);
      }
      try{
        if(typeof flattenFeatureNodes==="function"){
          var nodes=flattenFeatureNodes();
          for(var i=0;i<nodes.length;i++){
            var n=nodes[i];
            try{
              if(typeof n.load==="function") await n.load();
              if(n.geometryType && String(n.geometryType).toLowerCase()!=="polygon") continue;
              var parcelish=false;
              try{ parcelish=!!isPropertyBoundaryLayer(n); }catch(e){}
              if(!parcelish && typeof looksLikeParcelLayer==="function"){ try{ parcelish=!!looksLikeParcelLayer(n); }catch(e){} }
              if(!parcelish && typeof hasParcelFields==="function"){ try{ parcelish=!!hasParcelFields(n); }catch(e){} }
              if(parcelish) add(n);
            }catch(e){}
          }
        }
      }catch(e){}
      try{
        if(typeof getParcelLayers==="function"){
          var parcelLayers=await getParcelLayers();
          for(var j=0;j<parcelLayers.length;j++){
            var p=parcelLayers[j];
            try{ if(typeof p.load==="function") await p.load(); }catch(e){}
            if(!p.geometryType || String(p.geometryType).toLowerCase()==="polygon") add(p);
          }
        }
      }catch(e){}
      try{
        if(typeof FeatureLayer==="function"){
          if(!propertyBoundaryFallbackLayers){
            propertyBoundaryFallbackLayers=screenshotBoundaryFallbackUrls().map(function(url){ return new FeatureLayer({url:url,listMode:"hide"}); });
          }
          for(var k=0;k<propertyBoundaryFallbackLayers.length;k++){
            var fl=propertyBoundaryFallbackLayers[k];
            try{
              if(typeof fl.load==="function") await fl.load();
              if(!fl.geometryType || String(fl.geometryType).toLowerCase()==="polygon") add(fl);
            }catch(e){}
          }
        }
      }catch(e){}
      return out;
    }
    async function collectScreenshotPropertyBoundaryGeometries(seedGeom){
      var queryGeom=getScreenshotBoundaryQueryGeometry(seedGeom);
      if(!queryGeom) return [];
      var cacheKey=screenshotBoundaryCacheKey(queryGeom);
      if(cacheKey && propertyBoundaryShotCache.has(cacheKey)) return propertyBoundaryShotCache.get(cacheKey);
      var layers=await getScreenshotPropertyBoundaryLayers();
      var geoms=[], seen={};
      function geomKey(g){
        try{
          var e=g.extent || (g.geometry && g.geometry.extent);
          if(e) return [Math.round(e.xmin*10),Math.round(e.ymin*10),Math.round(e.xmax*10),Math.round(e.ymax*10)].join(":");
        }catch(e){}
        try{ return JSON.stringify(g).slice(0,160); }catch(e){}
        return String(Math.random());
      }
      for(var i=0;i<layers.length && geoms.length<PROPERTY_BOUNDARY_SHOT_LIMIT;i++){
        var layer=layers[i];
        try{
          var res=await layer.queryFeatures({
            geometry:queryGeom,
            spatialRelationship:"intersects",
            returnGeometry:true,
            outSpatialReference:(view && view.spatialReference) ? view.spatialReference : undefined,
            outFields:["*"],
            maxRecordCountFactor:4,
            num:PROPERTY_BOUNDARY_SHOT_LIMIT
          });
          var feats=(res && res.features) || [];
          for(var j=0;j<feats.length && geoms.length<PROPERTY_BOUNDARY_SHOT_LIMIT;j++){
            var g=feats[j] && feats[j].geometry;
            if(!g || (g.type && g.type!=="polygon" && g.type!=="polyline")) continue;
            var key=geomKey(g);
            if(seen[key]) continue;
            seen[key]=true;
            geoms.push(g);
          }
        }catch(e){}
      }
      if(cacheKey){
        propertyBoundaryShotCache.set(cacheKey,geoms);
        try{ if(propertyBoundaryShotCache.size>12) propertyBoundaryShotCache.delete(propertyBoundaryShotCache.keys().next().value); }catch(e){}
      }
      return geoms;
    }
    async function setScreenshotPropertyBoundary(geom){
      try{
        ensurePropertyBoundaryShotLayer();
        propertyBoundaryShotLayer.removeAll();
        suppressPropertyBoundaryLabels(view.map);
        if(screenshotSelLayerVisible===null){ try{ screenshotSelLayerVisible=!!selLayer.visible; }catch(e){ screenshotSelLayerVisible=false; } }
        try{ selLayer.visible=false; }catch(e){}
        if(!geom) return;
        propertyBoundaryShotLayer.visible=true;
        addScreenshotPropertyBoundary(geom,true);
      }catch(e){}
    }
    function clearScreenshotPropertyBoundary(){
      try{ propertyBoundaryShotLayer.removeAll(); propertyBoundaryShotLayer.visible=false; }catch(e){}
      if(screenshotSelLayerVisible!==null){
        try{ selLayer.visible=screenshotSelLayerVisible; }catch(e){}
        screenshotSelLayerVisible=null;
      }
    }
    function suppressPropertyBoundaryLabels(root){
      try{
        walkAny(root,function(node){
          if(!isPropertyBoundaryLayer(node)) return;
          if("labelsVisible" in node){ try{ node.labelsVisible=false; }catch(e){} }
        });
      }catch(e){}
    }
    const view=new MapView({container:"viewDiv",map:webmap,center:BRISBANE,zoom:17,constraints:{snapToZoom:false}});
    function sppBushfireGraphicSymbol(className){
      const cls=String(className||"");
      if(cls==="Very High Potential Bushfire Intensity") return {type:"simple-fill",color:[115,0,0,0.58],outline:{color:[115,0,0,0.9],width:0.8}};
      if(cls==="High Potential Bushfire Intensity") return {type:"simple-fill",color:[230,0,0,0.5],outline:{color:[204,0,0,0.85],width:0.8}};
      if(cls==="Medium Potential Bushfire Intensity") return {type:"simple-fill",color:[255,170,0,0.42],outline:{color:[214,132,0,0.8],width:0.8}};
      if(cls==="Potential Impact Buffer") return {type:"simple-fill",style:"forward-diagonal",color:[255,255,255,0],outline:{color:[230,76,0,0.9],width:1}};
      return {type:"simple-fill",color:[0,0,0,0],outline:{color:[120,120,120,0.35],width:0.5}};
    }
    let sppBushfireRefreshTimer=0;
    let sppBushfireRefreshRun=0;
    let sppBushfireStatusText="Off";
    function setSppBushfireStatus(message){
      sppBushfireStatusText=String(message||"");
      document.querySelectorAll("[data-spp-bushfire-status]").forEach(el=>{
        el.textContent=sppBushfireStatusText;
      });
    }
    function scheduleSppBushfireRefresh(delay=220){
      clearTimeout(sppBushfireRefreshTimer);
      sppBushfireRefreshTimer=setTimeout(()=>{ refreshSppBushfireGraphics(); },delay);
    }
    async function refreshSppBushfireGraphics(){
      const run=++sppBushfireRefreshRun;
      try{
        if(FILE_MODE){ setSppBushfireStatus("State SPP fallback unavailable in file mode"); return; }
        const on=!!sppBushfireLayer.visible;
        try{ sppBushfireDrawLayer.visible=on; }catch{}
        if(!on){ try{ sppBushfireDrawLayer.removeAll(); }catch{} setSppBushfireStatus("Off"); return; }
        await sppBushfireLayer.when();
        if(!view?.extent) return;
        setSppBushfireStatus("Loading state bushfire overlay...");
        const extent=view.extent.toJSON ? view.extent.toJSON() : view.extent;
        if(!extent.spatialReference) extent.spatialReference={wkid:view.spatialReference?.wkid||102100};
        const outSR=view.spatialReference?.wkid||102100;
        const body=new URLSearchParams({
          f:"json",
          where:"1=1",
          outFields:"CLASS",
          returnGeometry:"true",
          geometry:JSON.stringify(extent),
          geometryType:"esriGeometryEnvelope",
          inSR:String(outSR),
          outSR:String(outSR),
          spatialRel:"esriSpatialRelIntersects",
          resultRecordCount:"2000"
        });
        const response=await fetch(`${SPP_BUSHFIRE_LAYER_URL}/query`,{
          method:"POST",
          headers:{"content-type":"application/x-www-form-urlencoded"},
          body
        });
        const res=await response.json();
        if(!response.ok || res.error) throw new Error(res?.error?.message || `SPP query failed ${response.status}`);
        if(run!==sppBushfireRefreshRun) return;
        sppBushfireDrawLayer.removeAll();
        (res.features||[]).forEach(f=>{
          if(!f.geometry?.rings) return;
          const geometry={type:"polygon",rings:f.geometry.rings,spatialReference:f.geometry.spatialReference||extent.spatialReference};
          sppBushfireDrawLayer.add(new Graphic({geometry,attributes:f.attributes,symbol:sppBushfireGraphicSymbol(f.attributes?.CLASS)}));
        });
        const count=(res.features||[]).length;
        setSppBushfireStatus(count ? `${count} state bushfire features drawn` : "No state bushfire features in this map view");
        console.info("SPP bushfire graphics drawn",count);
      }catch(e){
        setSppBushfireStatus(`State bushfire request failed: ${e?.message||e}`);
        console.warn("SPP bushfire graphics failed",e);
      }
    }
    try{ sppBushfireLayer.watch("visible",on=>{ if(on) scheduleSppBushfireRefresh(0); else{ sppBushfireDrawLayer.visible=false; sppBushfireDrawLayer.removeAll(); setSppBushfireStatus("Off"); } }); }catch{}
    try{ view.watch("stationary",stationary=>{ if(stationary && sppBushfireLayer.visible) scheduleSppBushfireRefresh(180); }); }catch{}
    const inText=(t,p="")=>String(t||"")+" "+String(p||"");
    const isDNT=(title,id="",tags=[])=>{const t=String(title||""); const i=String(id||""); const tag=(tags||[]).join("|"); return /do[\s-]*not[\s-]*touch/i.test(t)||/do[\s-]*not[\s-]*touch/i.test(i)||/do[\s-]*not[\s-]*touch/i.test(tag);};
    const isUtility=(title,id="",tags=[])=>/\b(utilit(y|ies)|power|electric|telecom|gas|water|sewer|storm[-\s]?water|reticulation|service)\b/i.test(inText(title,id)+" "+(tags||[]).join(" "));
    const isWaterOrSewer=(path)=>/\b(water|sewer|storm[\s-]*water|drainage|watercourse)\b/i.test(String(path||""));
    const isAcid=(t,p="")=>/\bacid\b/i.test(inText(t,p));
    const isTransport=(t,p="")=>/\b(transport|road|rail|corridor|traffic|cycle|bikeway|pedestrian|carpark|parking|transit|bus|ferry)\b/i.test(inText(t,p));
    const isAir=(t,p="")=>/\b(air\s*quality|air-quality|air|pollution)\b/i.test(inText(t,p));
    const isNoise=(t,p="")=>/\b(noise|acoustic|transport.*noise.*corridor|tnc)\b/i.test(inText(t,p));
    const isZoning=(t,p="")=>{
      const hay=inText(t,p);
      if(/\b(zoning|zone|zones)\b/i.test(hay)) return true;
      return ZONING_CODE_RX.test(hay);
    };
    const isBushfire=(t,p="")=>/\b(bush[-\s]?fire|bushfire|bush\s*fire|wild[-\s]?fire|fire\s*hazard)\b/i.test(inText(t,p));
    const kidsOf=n=>(n.layers?.toArray?.()??n.layers)||(n.sublayers?.toArray?.()??n.sublayers)||[];
    const nodePath=n=>{const bits=[]; let cur=n; while(cur){bits.unshift(cur.title||cur.id||"node"); cur=cur.parent;} return bits.join(" / ");};
    const ALWAYS_ON_IDS=new Set();
    const utilityVisSnapshot = new Map();
    let utilitiesToggleState = false;
    let utilToggleBtn = null;
    const SUPPRESSED_UTILITY_IDS = new Set();
    let lastSearchHint = null;
    let lastSearchPoint = null;
    const QUU_LIVE_UTILITY_LAYERS = [
      { id:"quu_water_service_live", title:"Utilities - QUU Water Service Connection", url:"https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Water_OpenData/FeatureServer/19" },
      { id:"quu_sewer_service_live", title:"Utilities - QUU Sewer Service Connection", url:"https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Sewer_OpenData/FeatureServer/30" },
      { id:"quu_recycled_service_live", title:"Utilities - QUU Recycled Water Service Connection", url:"https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Recycled_Water_OpenData/FeatureServer/27" }
    ];
    function addQUULiveUtilities(map){
      try{
        if(FILE_MODE) return;
        if(!map || !map.layers) return;
        let utilGroup = null;
        walkAny(map,(n)=>{
          if(utilGroup) return;
          const t = String(n?.title||"");
          if(/\butilities\b/i.test(t) && n?.layers?.add){
            utilGroup = n;
          }
        });
        const existingUrls = new Set();
        walkAny(map,(n)=>{
          const u = n?.url || n?.portalItem?.url;
          if(u) existingUrls.add(String(u));
        });
        QUU_LIVE_UTILITY_LAYERS.forEach(cfg=>{
          if(existingUrls.has(cfg.url)) return;
          const lyr = new FeatureLayer({
            id: cfg.id,
            title: cfg.title,
            url: cfg.url,
            visible: false,
            listMode: "show",
            popupEnabled: false,
            legendEnabled: true,
            minScale: 0,
            maxScale: 0,
            outFields: ["*"]
          });
          if(utilGroup && utilGroup.layers?.add){
            utilGroup.layers.add(lyr);
          }else{
            map.add(lyr);
          }
          try{ lyr.visible=false; }catch{}
        });
      }catch(e){ console.warn("QUU live layers add failed", e); }
    }
    function forceUtilitiesOff(){
      utilitiesToggleState = false;
      setUtilitiesVisible(false);
      getQUULiveUtilityLayers().forEach(n=>{ if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} } });
    }
    function getQUULiveUtilityLayers(){
      const out=[];
      try{
        QUU_LIVE_UTILITY_LAYERS.forEach(cfg=>{
          const lyr = view?.map?.findLayerById?.(cfg.id);
          if(lyr) out.push(lyr);
        });
      }catch{}
      return out;
    }
    function suppressDuplicateServiceConnections(map){
      try{
        const liveUrls = new Set(QUU_LIVE_UTILITY_LAYERS.map(l=>String(l.url)));
        walkAny(map,(n)=>{
          if(!n || !("visible" in n)) return;
          const title = String(n.title||"");
          const path = nodePath(n);
          const url = String(n.url||"");
          const isService = /\bservice\b/i.test(title) || /\bservice\b/i.test(path) || /\bconnection\b/i.test(title) || /\bconnection\b/i.test(path);
          const isUtilityService = isService && /\b(water|sewer|recycled)\b/i.test(title+" "+path);
          const isLive = liveUrls.has(url);
          if(isUtilityService && !isLive){
            SUPPRESSED_UTILITY_IDS.add(n.id || url || title);
            if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
            try{ n.listMode="hide"; }catch{}
          }
        });
      }catch(e){ console.warn("Suppress duplicate service connections failed", e); }
    }
    function isSuppressedUtility(node){
      if(!node) return false;
      const key = node.id || node.url || node.title || "";
      return SUPPRESSED_UTILITY_IDS.has(key);
    }
    function walkAny(node,cb,inheritedDNT=false){
      if(!node) return;
      const t=node.title||node.id||"", id=node.id||"", tg=node.portalItem?.tags||[];
      const flag=inheritedDNT||isDNT(t,id,tg);
      cb(node,flag);
      (kidsOf(node)||[]).forEach(ch=>walkAny(ch,cb,flag));
    }
    function getUtilityNodes(){
      const nodes=[];
      walkAny(view.map,(n,underDNT)=>{
        if(underDNT || !("visible" in n)) return;
        const t=n.title||"", p=nodePath(n), tg=n.portalItem?.tags||[];
        if(isSuppressedUtility(n)) return;
        if(isUtility(t,n.id,tg) || isWaterOrSewer(p)) nodes.push(n);
      });
      return nodes;
    }
    function updateUtilityToggleLabel(){
      const btn = utilToggleBtn || $("btnUtilityToggleMap");
      if(!btn) return;
      const on = utilitiesToggleState;
      btn.setAttribute("title", on ? "Hide utilities" : "Show utilities");
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("active", on);
    }
    function setUtilitiesVisible(on){
      const nodes=getUtilityNodes();
      if(on){
        utilityVisSnapshot.clear();
        nodes.forEach(n=>{
          if(!utilityVisSnapshot.has(n)) utilityVisSnapshot.set(n, !!n.visible);
          try{ n.visible=true; }catch{}
          try{ n.listMode="show"; }catch{}
          let p=n.parent;
          while(p){
            if("visible" in p){ try{p.visible=true;}catch{} }
            p=p.parent;
          }
        });
        getQUULiveUtilityLayers().forEach(n=>{
          if(!utilityVisSnapshot.has(n)) utilityVisSnapshot.set(n, !!n.visible);
          try{ n.visible=true; }catch{}
          try{ n.listMode="show"; }catch{}
        });
      }else{
        nodes.forEach(n=>{
          if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
        });
        getQUULiveUtilityLayers().forEach(n=>{
          if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
        });
      }
      utilitiesToggleState = on;
      updateUtilityToggleLabel();
      try{ layerList.refresh(); }catch{}
    }
    function isPropertyBoundaryLayer(node){
      if(!node) return false;
      var tags = (node.portalItem && node.portalItem.tags) || node.tags || [];
      var hay = [
        node.title || "",
        node.id || "",
        node.url || "",
        (node.portalItem && node.portalItem.url) || "",
        Array.isArray(tags) ? tags.join(" ") : String(tags || ""),
        typeof nodePath === "function" ? nodePath(node) : ""
      ].join(" ").toLowerCase();
      return /\b(property[\s_-]*boundar|parcel[\s_-]*boundar|boundaries[\s_-]*[-\s]*parcel|land[\s_-]*parcel[\s_-]*property[\s_-]*framework|dcdb|cadast|cadastral|property_boundaries_(?:parcel|holding))\b/i.test(hay);
    }
    function keepPropertyBoundaryVisible(node){
      if(!isPropertyBoundaryLayer(node)) return false;
      if("visible" in node){ try{ node.visible=true; }catch(e){} }
      if("listMode" in node){ try{ node.listMode="hide"; }catch(e){} }
      try{ node.minScale=0; node.maxScale=0; }catch(e){}
      if(node.type==="sublayer"){ try{ node.updateFromJSON({minScale:0,maxScale:0}); }catch(e){} }
      var p=node.parent;
      while(p){ if("visible" in p){ try{ p.visible=true; }catch(e){} } p=p.parent; }
      return true;
    }
    function forcePropertyBoundariesVisible(root){
      try{ walkAny(root,function(node){ keepPropertyBoundaryVisible(node); }); }catch(e){}
    }
    function keepOnHidden(node){ if(keepLegacyBushfireHidden(node)) return; if("visible"in node){try{node.visible=true;}catch{}} if("listMode"in node){try{node.listMode="hide";}catch{}} try{node.minScale=0;node.maxScale=0;}catch{} if(node.type==="sublayer"){ try{ node.updateFromJSON({minScale:0,maxScale:0}); }catch{} } let p=node.parent; while(p){ if("visible"in p){try{p.visible=true;}catch{}} p=p.parent; } }
    function startHidden(node){ if(keepLegacyBushfireHidden(node)) return; if(isSppBushfireLayer(node)) return; if(keepPropertyBoundaryVisible(node)) return; if("visible"in node){try{node.visible=false;}catch{}} if("listMode"in node){try{node.listMode="show";}catch{} }}
    function enforceOverlayRules(){ walkAny(webmap,(node,underDNT)=>{ if(node.type==="graphics"){try{node.listMode="hide";}catch{} return;} if(!("visible"in node)) return; const alwaysOn=ALWAYS_ON_IDS.has(node.id); (underDNT||alwaysOn)?keepOnHidden(node):startHidden(node); }); }
    function enforceDNTVisibleInMap(){
      walkAny(view?.map,(node,underDNT)=>{
        if(!underDNT) return;
        keepOnHidden(node);
      });
    }
    ;[300,900,1800,3500].forEach(ms=> setTimeout(()=>{ try{ensureSppBushfireLayer(); enforceOverlayRules(); forceUtilitiesOff();}catch{} },ms));
    async function initialiseWebMap(){
      showLoading(true);
      try{
        await webmap.load();
        addQUULiveUtilities(webmap);
        suppressDuplicateServiceConnections(webmap);
        ensureSppBushfireLayer(); enforceOverlayRules();
        forceUtilitiesOff();
        try{ await withTimeout(view.when(), 12000, "view ready"); }catch{}
      }catch(e){
        console.warn("WebMap auth/fail; fallback basemap",e);
        webmap=new WebMap({basemap:"streets-vector"});
        webmap.add(selLayer);
        webmap.add(brisbaneBushfireLayer);
        webmap.add(sppBushfireLayer);
        webmap.add(sppBushfireDrawLayer);
        addQUULiveUtilities(webmap);
        suppressDuplicateServiceConnections(webmap);
        view.map=webmap;
        forceUtilitiesOff();
      } finally {
        showLoading(false);
      }
    }
    const mapStartupReady = initialiseWebMap();
    view.when(()=>{
      forceUtilitiesOff();
      try{
        getQUULiveUtilityLayers().forEach(n=>{
          view.whenLayerView(n).then(lv=>{ if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} } try{ lv.visible=false; }catch{} }).catch(()=>{});
        });
      }catch{}
    });
    view.ui.add(new Home({view}),"top-left");
    view.ui.add(new ScaleBar({view,unit:"metric"}),"bottom-left");
    const layerList=new LayerList({view,listItemCreatedFunction(e){
      const item=e.item, node=item.sublayer||item.layer;
      if(!node) return;
      if(keepLegacyBushfireHidden(node)){ item.visible=false; item.panel=null; return; }
      if(node.type==="graphics"){ item.visible=false; item.panel=null; try{node.listMode="hide";}catch{} return; }
      let cur=node, inDNT=false;
      while(cur){ const t=cur.title||"", i=cur.id||"", tg=cur.portalItem?.tags||[]; if(isDNT(t,i,tg)){ inDNT=true; break; } cur=cur.parent; }
      const alwaysOn=ALWAYS_ON_IDS.has(node.id);
      if(inDNT||alwaysOn||isPropertyBoundaryLayer(node)){ keepOnHidden(node); item.visible=false; item.panel=null; }
      else{ try{node.listMode="show";}catch{} item.panel={content:"legend"}; }
    }});
    view.ui.add(new Expand({view,content:layerList,expandIconClass:"esri-icon-layers",expanded:false}),"top-right");
    utilToggleBtn = (()=> {
      const btn=document.createElement("button");
      btn.id="btnUtilityToggleMap";
      btn.type="button";
      btn.className="esri-widget esri-widget--button util-toggle-btn";
      btn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3.5c-3.2 4-5.5 7.2-5.5 9.7A5.5 5.5 0 0 0 12 18.7a5.5 5.5 0 0 0 5.5-5.5c0-2.5-2.3-5.7-5.5-9.7z"></path>
      </svg>`;
      btn.addEventListener("click",()=> setUtilitiesVisible(!utilitiesToggleState));
      updateUtilityToggleLabel();
      return btn;
    })();
    view.ui.add(utilToggleBtn,{position:"top-right",index:1});
    view.ui.add(new Expand({view,content:new Legend({view}),expandIconClass:"esri-icon-legend"}),"top-right");
    view.ui.add(new Expand({view,content:new BasemapGallery({view}),expandIconClass:"esri-icon-basemap"}),"top-right");
    view.ui.add(new Fullscreen({view}),"top-right");
    /* --- Search widget (address + Lot/Plan) --- */
    const search=new Search({
      view,
      includeDefaultSources:false,
      popupEnabled:true,
      allPlaceholder:"Search address or Lot/Plan (e.g., 12/SP12345)",
      suggestionsEnabled:true,
      minSuggestCharacters:1
    });
    view.ui.add(search,{position:"top-right",index:0});
    /* ---------------- Status ---------------- */
    view.watch("extent",()=>{ const c=view.center; setText("statusCoords",`Coords: ${c.longitude.toFixed(5)}, ${c.latitude.toFixed(5)}`); setText("statusZoom",`Zoom: ${view.zoom.toFixed(1)}`); setText("statusScale",`Scale: 1:${Math.round(view.scale)}`); });
    /* ---------------- Parcel selection ---------------- */
    const parseNumberLike=raw=>{ if(raw==null) return null; let s=String(raw).trim(); if(!s) return null; const hasHA=/(^|[^a-z])ha([^a-z]|$)/i.test(s)||/\bhectare(s)?\b/i.test(s); s=s.replace(/,/g,"").replace(/square\s*met(re|er)s?/ig,"").replace(/m2|m\u00B2|sqm|sq\.?m/ig,"").trim(); let n=parseFloat(s); if(isNaN(n)) return null; if(hasHA) n*=10000; return n; };
    function getLotAreaSqm(attrs){ const strong=["LOT_AREA_M2","LOT_SIZE_M2","LOT_SIZE_SQM","LOT_AREA_SQM","AREA_SQM","SITE_AREA_SQM","LAND_AREA_SQM","LOT_AREA","LOT_SIZE","SITE_AREA","LAND_AREA","AREA_M2","AREA (M2)","AREA(M2)","AREA_M^2","AREA_HA","HECTARES"]; for(const k of strong){ const v=k in attrs?parseNumberLike(attrs[k]):null; if(v!=null){ if(v>0&&v<50&&(k==="AREA_HA"||k==="HECTARES")) return v*10000; return v; } } for(const k2 in attrs){ const v2=attrs[k2]; if(/(lot|site|land).*area/i.test(k2)||/area.*(sqm|m2|m\^2|square)/i.test(k2)||(/(lot|site).*size/i.test(k2))){ const val=parseNumberLike(v2); if(val) return val; } } return null; }
    function parseParcelMeta(attrs){
      const keys=rx=>Object.keys(attrs).find(k=>rx.test(k));
      const lot=attrs["LOT"]??attrs["LOTNO"]??attrs["LOT_NO"]??attrs["LOTNUMBER"]??(keys(/^lot[\w_]*$/i)&&String(attrs[keys(/^lot[\w_]*$/i)]));
      const plan=attrs["PLAN"]??attrs["PLANNO"]??attrs["PLAN_NO"]??(keys(/^plan[\w_]*$/i)&&String(attrs[keys(/^plan[\w_]*$/i)]));
      let lotplan=_pick(attrs, LOTPLAN_FIELDS);
      if(!lotplan && lot && plan) lotplan=lot+"/"+plan;
      if(!lotplan){
        for(const key in attrs){
          const s=String(attrs[key]||"").toUpperCase();
          const m=s.match(/\b(\d+)\s*\/\s*([A-Z]{1,4}\s*\d{1,8})\b/);
          if(m){ lotplan=m[1]+"/"+m[2].replace(/\s+/g,""); break; }
        }
      }
      return {lot,plan,lotplan};
    }
    const normalizePlanCode=p=>{
      let s=String(p||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
      s=s.replace(/^([A-Z]+)0+/, "$1");
      return s;
    };
    const normalizeLotPlanVal=s=>{
      // Lot numbers are digits only; strip all non-digits and leading zeros
      return String(s||"").replace(/[^0-9]/g,"").replace(/^0+/,"");
    };
    function matchesLotPlan(feature, lot, plan){
      try{
        const meta = parseParcelMeta(feature?.attributes||{});
        const lotN = normalizeLotPlanVal(lot);
        const planN = normalizePlanCode(plan);
        const lpField = normalizePlanCode(meta.lotplan||"");
        if(lotN && planN && lpField){
          if(lpField.includes(lotN) && lpField.includes(planN)) return true;
          const compact = `${lotN}${planN}`;
          if(lpField === compact || lpField === `${lotN}/${planN}`) return true;
        }
        if(lotN && planN){
          if(normalizeLotPlanVal(meta.lot)===lotN && normalizePlanCode(meta.plan)===planN) return true;
        }
      }catch{}
      return false;
    }
    function matchesPlanOnly(feature, plan){
      try{
        const planN = normalizePlanCode(plan);
        if(!planN) return false;
        const meta = parseParcelMeta(feature?.attributes||{});
        const planField = normalizePlanCode(meta.plan);
        const lpField = normalizePlanCode(meta.lotplan||"");
        return planField===planN || (lpField && lpField.includes(planN));
      }catch{ return false; }
    }
    function scoreLotPlan(feature, lot, plan){
      try{
        const meta = parseParcelMeta(feature?.attributes||{});
        const lotN = normalizeLotPlanVal(lot);
        const planN = normalizePlanCode(plan);
        const lpField = normalizePlanCode(meta.lotplan||"");
        const lotField = normalizeLotPlanVal(meta.lot);
        const planField = normalizePlanCode(meta.plan);
        const planMatch = planN
          ? (planField===planN || (lpField && lpField.includes(planN)))
          : true;
        const lotMatch = lotN
          ? (lotField===lotN || (lpField && lpField.includes(lotN)))
          : true;
        // If either provided part doesn't match, discard this candidate
        if(!planMatch || !lotMatch) return 0;
        let score = 0;
        if(lotN && lotField===lotN) score += 3;
        if(planN && planField===planN) score += 3;
        if(lotN && planN && lpField){
          const compact = `${lotN}${planN}`;
          if(lpField === compact || lpField === `${lotN}/${planN}`) score += 5;
          if(lpField.includes(lotN) && lpField.includes(planN)) score += 2;
        }
        if(planN && lpField && lpField.startsWith(planN)) score += 1;
        return score;
      }catch{ return 0; }
    }
    function isExactLotPlan(feature, lot, plan){
      try{
        const meta = parseParcelMeta(feature?.attributes||{});
        const lotN = normalizeLotPlanVal(lot);
        const planN = normalizePlanCode(plan);
        const lpField = normalizePlanCode(meta.lotplan||"");
        if(!lotN || !planN) return false;
        if(lpField === `${lotN}/${planN}` || lpField === `${lotN}${planN}`) return true;
        if(normalizeLotPlanVal(meta.lot)===lotN && normalizePlanCode(meta.plan)===planN) return true;
        return false;
      }catch{ return false; }
    }
    const geomAreaSqmSafe=g=>{ try{ const a=Math.abs(geometryEngine.planarArea(g,"square-meters")||0); return a>0?a:null; }catch{ return null; } };
    function smartJoin(parts){ return parts.filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
    const _get = (o, ks) => { for (const k of ks) if (k in o && String(o[k] ?? "").trim()) return String(o[k]).trim(); return null; };
    function parseCouncil(attrs){
      if(!attrs) return null;
      const first=(...keys)=>{ for(const k of keys){ if(k in attrs){ const v=String(attrs[k]??"").trim(); if(v) return v; } } return null; };
      return first("COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY") || "Brisbane City Council";
    }
    /* ===== Robust Address Resolver (tolerant field names + fallbacks) ===== */
    const ADDR_DEBUG = false; // set true to log candidates
    const FULL_ADDR_FIELDS = [
      "FULL_ADDRESS","ADDRESS_FULL","GNAF_FULL_ADDRESS","GNAF_ADDRESS",
      "SITE_ADDRESS","PROPERTY_ADDRESS","PROP_ADDRESS","PRIMARY_ADDRESS",
      "ADDR_FULL","ADDR_LABEL","ADDRESS","STREET_ADDRESS","POSTAL_ADDRESS",
      "FULLADDR","FULL_ADD","FULL_ADDRE","SITE_ADDR","SITE_ADD","PROP_ADD",
      "PROPERTY_ADDR","PROPERTY_ADD","ADDRESS1","ADDRESS_1","ADDR1"
    ];
    const PART_FIELDS = {
      unit:  ["UNIT_NO","UNIT_NUMBER","UNIT","APARTMENT","FLAT","SUITE","SUB_UNIT","APT","FLAT_NO","UNITNO","UNITNUM"],
      numP:  ["HOUSE_PREFIX","NUMBER_PREFIX","ADDR_NUM_PREFIX","NUMBER_PRE","NO_PRE","HSE_PRE"],
      num:   ["HOUSE_NO","HOUSE_NUMBER","STREET_NO","STREET_NUMBER","PRIMARY_NO","PROPERTY_NO","NUMBER","HSE_NO","HSE_NUM","ADDR_NO"],
      numS:  ["HOUSE_SUFFIX","NUMBER_SUFFIX","ADDR_NUM_SUFFIX","NUMBER_SUF","NO_SUF","HSE_SUF"],
      stNm:  ["STREET_NAME","ST_NAME","ROAD_NAME","RD_NAME","ADD_STREET_NAME","STREET","ST_NAM","RD_NAM"],
      stTp:  ["STREET_TYPE","ST_TYPE","ROAD_TYPE","RD_TYPE","ADDR_TYPE","ST_TYP","RD_TYP"],
      stSf:  ["STREET_SUFFIX","ST_SUFFIX","ROAD_SUFFIX","RD_SUFFIX","ST_SUF","RD_SUF"],
      suburb:["SUBURB","SUBURB_NAME","LOCALITY","LOCALITY_NAME","TOWN","CITY","SUB_NAME","LOCALITY_N"],
      state: ["STATE","STATE_ABBR","STATE_CODE"],
      post:  ["POSTCODE","POST_CODE","ZIP","PSTCODE","PST_CD"]
    };
    const LOTPLAN_FIELDS = [
      "LOT/PLAN","LOT_PLAN","LOT_PLAN_NO","LOTPLAN","LOTPLAN_NO","LOTPLAN_TXT","LOT_PLAN_TXT","LOT_PLAN_TEXT","LOTPLAN_TEXT"
    ];
    function _pick(attrs, keys){
      if(!attrs) return null;
      const keyMap = {};
      for(const k of Object.keys(attrs)){
        keyMap[String(k).toLowerCase()] = k;
      }
      for(const k of keys){
        const key = (k in attrs) ? k : keyMap[String(k).toLowerCase()];
        if(key){
          const v = String(attrs[key] ?? "").trim();
          if(v && v.toUpperCase()!=="NULL") return v;
        }
      }
      return null;
    }
    const _smartJoin = smartJoin;
    function buildAddressFromParts(attrs){
      const unit=_pick(attrs,PART_FIELDS.unit);
      const numP=_pick(attrs,PART_FIELDS.numP);
      const num =_pick(attrs,PART_FIELDS.num);
      const numS=_pick(attrs,PART_FIELDS.numS);
      const stNm=_pick(attrs,PART_FIELDS.stNm);
      const stTp=_pick(attrs,PART_FIELDS.stTp);
      const stSf=_pick(attrs,PART_FIELDS.stSf);
      const suburb=_pick(attrs,PART_FIELDS.suburb);
      const state=_pick(attrs,PART_FIELDS.state) || "QLD";
      const post =_pick(attrs,PART_FIELDS.post);
      const line1=_smartJoin([ unit ? (unit+"/") : null, _smartJoin([numP,num,numS]), _smartJoin([stNm,stTp,stSf]) ]);
      const line2=_smartJoin([ suburb, state, post ]);
      return _smartJoin([line1,line2]) || null;
    }
    function parseAddress(attrs){
      if(!attrs) return null;
      const full = _pick(attrs, FULL_ADDR_FIELDS);
      if(full && (isLikelyStreetAddress(full) || isAddressLikeLoose(full))) return full;
      const lotPlan = _pick(attrs, LOTPLAN_FIELDS);
      if(lotPlan){
        const s = String(lotPlan ?? "").trim();
        if(/\d{1,5}\s+[A-Za-z].*\d{4}\b/.test(s)) return s;
      }
      const built = buildAddressFromParts(attrs);
      if(built) return built;
      for(const k in attrs){
        const v = String(attrs[k]??"").trim();
        if(!v) continue;
        if(isLikelyStreetAddress(v)) return v;
      }
      for(const k in attrs){
        const v = String(attrs[k]??"").trim();
        if(!v) continue;
        const m=v.match(/\b\d{1,5}[A-Za-z]?\s+[A-Za-z][A-Za-z\s.'-]+(?:\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway)\b)[^,;]*?(?:,\s*[A-Za-z][A-Za-z\s.'-]+)?(?:\s+(?:QLD|Queensland))?\s*\d{4}\b/i);
        if(m) return m[0].replace(/\s+/g," ").trim();
      }
      return null;
    }
    async function resolveZoneLabel(layers, geom){
      if(!layers?.length || !geom) return null;
      for(const n of layers){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          const q=await n.queryFeatures({geometry:geom,outFields:["*"],returnGeometry:false,num:1,maxRecordCountFactor:2});
          const f=q.features?.[0];
          if(!f) continue;
          const attrs=f.attributes||{};
          const fromDomain = domainValueName(n, attrs, {preferZone:true});
          if(fromDomain) return fromDomain;
          const uv=getUVInfo(n.renderer, attrs);
          const uvLabel = uv?.label ? String(uv.label).trim() : null;
          const isShortCode = v => /^[A-Z0-9]+$/.test(v||"") && String(v||"").length <= 4;
          if(uvLabel && !isShortCode(uvLabel) && isZoneFullName(uvLabel)) return uvLabel;
          if(uvLabel && isShortCode(uvLabel)){
            const expanded = expandZoneCode(uvLabel);
            if(expanded) return expanded;
          }
          const bestName = bestZoneNameFromAttrs(attrs);
          if(bestName) return bestName;
          const guess=guessLabelFromAttrs(attrs);
          if(guess) return guess;
          if(uvLabel) return uvLabel;
        }catch{}
      }
      return null;
    }
    // ensure suburb (and optionally state/postcode) appears on the address line
    function ensureSuburbInAddress(addr, attrs){
      if(!addr) return addr;
      const _p = (obj, keys)=>{
        for(const k of keys){
          if(k in obj){
            const v=String(obj[k]??"").trim();
            if(v && v.toUpperCase()!=="NULL") return v;
          }
        }
        return null;
      };
      const suburb=_p(attrs||{}, PART_FIELDS.suburb);
      const state=_p(attrs||{}, PART_FIELDS.state) || "QLD";
      const post =_p(attrs||{}, PART_FIELDS.post);
      if(!suburb) return addr;
      const norm = s => String(s||"").toUpperCase().replace(/[,\s]+/g," ").trim();
      if (norm(addr).includes(norm(suburb))) return addr;
      const rxTail = new RegExp(String.raw`(?:,\s*)?(?:QLD|Queensland)\s*${post?String.raw`\b${post}\b`:''}\s*$`,"i");
      const tailWanted = `${suburb} ${state}${post?` ${post}`:""}`;
      if (rxTail.test(addr)){
        return addr.replace(rxTail, `, ${tailWanted}`);
      }
      return `${addr.replace(/\s+,/g, ",")}, ${tailWanted}`;
    }
    function looksLikeAddressLayer(node){
      const hay = ((node.title||"")+" "+nodePath(node)).toLowerCase();
      return /\b(gnaf|address|addr|property\s*address|site\s*address|street\s*address|address\s*points|locality|suburb|road\s*centerline|road\s*centreline)\b/.test(hay);
    }
    function hasAddressFields(node){
      try{
        const fields = node?.fields || [];
        return fields.some(f=>{
          const n = String(f?.name||"").toLowerCase();
          return /(address|addr|street|road|house|unit|locality|suburb|postcode|post_code)/.test(n);
        });
      }catch{ return false; }
    }
    async function scanAddressLayers(lotGeom, focusPoint=null){
      const nodes = flattenFeatureNodes();
      const centroid = focusPoint || centroidOf(lotGeom);
      const candidates = [];
      const scoreCandidate = (feature, addr, baseScore)=>{
        let score = baseScore;
        try{
          if(feature?.geometry && lotGeom){
            const g = projectToViewSR(feature.geometry);
            if(g?.type==="point"){
              try{
                if(geometryEngine.contains(lotGeom, g)) score += 4;
              }catch{}
              if(centroid){
                try{
                  const d = geometryEngine.distance(centroid, g, "meters");
                  if(d <= 25) score += 2;
                  else if(d <= 60) score += 1;
                }catch{}
              }
            }else if(g){
              try{
                const inter = geometryEngine.intersect(lotGeom, g);
                const interArea = inter ? Math.abs(geometryEngine.planarArea(inter, "square-meters") || 0) : 0;
                if(interArea > 0){
                  const featArea = Math.abs(geometryEngine.planarArea(g, "square-meters") || 0);
                  const ratio = featArea > 0 ? interArea / featArea : 0;
                  if(ratio >= 0.5) score += 4;
                  else if(ratio >= 0.2) score += 3;
                  else score += 1;
                }
              }catch{}
            }
          }
        }catch{}
        if(/\d/.test(addr)) score += 1;
        return score;
      };
      const looseAddrFromAttrs = (attrs)=>{
        if(!attrs) return null;
        let best = null;
        let bestScore = -999;
        for(const k of Object.keys(attrs)){
          const v = String(attrs[k] ?? "").trim();
          if(!v) continue;
          if(!/\d/.test(v)) continue;
          let score = 0;
          if(isLikelyStreetAddress(v)) score += 8;
          if(isAddressLikeLoose(v)) score += 5;
          if(/\b\d{4}\b/.test(v)) score += 2;
          if(/\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway)\b/i.test(v)) score += 2;
          if(/^(?:[A-Z0-9]|[^a-z]){1,10}$/.test(v)) score -= 6;
          if(/(owner|company|business|name)/i.test(k)) score -= 4;
          if(score > bestScore){
            bestScore = score;
            best = v;
          }
        }
        return best;
      };
      for(const n of nodes){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          if(!looksLikeAddressLayer(n) && !hasAddressFields(n)) continue;
          const outFields = ["*"];
          const r1 = await n.queryFeatures({
            geometry: lotGeom, spatialRelationship: "intersects",
            returnGeometry: false, outFields, maxRecordCountFactor: 3
          });
          (r1.features||[]).forEach(f=>{
            let addr = parseAddress(f.attributes);
            if(!addr) addr = looseAddrFromAttrs(f.attributes);
            if(addr) candidates.push({addr, score: scoreCandidate(f, addr, 3), layer:n});
          });
          if(centroid){
            const r2 = await n.queryFeatures({
              geometry: centroid, distance: 80, units: "meters",
              spatialRelationship: "intersects", returnGeometry: false,
              outFields, maxRecordCountFactor: 3
            });
            (r2.features||[]).forEach(f=>{
              let addr = parseAddress(f.attributes);
              if(!addr) addr = looseAddrFromAttrs(f.attributes);
              if(addr) candidates.push({addr, score: scoreCandidate(f, addr, 1), layer:n});
            });
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("Address layer failed:", n.title, e);
        }
      }
      candidates.sort((a,b)=>
        (b.score-a.score) ||
        ((/\d/.test(b.addr)?1:0)-(/\d/.test(a.addr)?1:0)) ||
        (b.addr.length-a.addr.length)
      );
      if(ADDR_DEBUG) console.log("Address candidates:", candidates);
      return candidates.length ? candidates[0].addr : null;
    }
    function isLikelyStreetAddress(s){
      if(!s) return false;
      const v = String(s).trim();
      if(!v) return false;
      const hasNumberName = /\b\d{1,5}[A-Za-z]?\s+[A-Za-z][A-Za-z\s.'-]{2,}\b/i.test(v);
      const hasRange = /\b\d{1,5}\s*(?:-|\u2013)\s*\d{1,5}\s+[A-Za-z][A-Za-z\s.'-]{2,}\b/i.test(v);
      const hasUnit = /\b(?:Unit|U|Shop|Suite|Level|Lvl|Apt|Apartment|Flat|Lot)\s*\d+[A-Za-z]?\s*\/\s*\d{1,5}/i.test(v);
      const hasType = /\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway)\b/i.test(v);
      if((hasNumberName || hasRange) && hasType) return true;
      if((hasNumberName || hasRange) && /,\s*[A-Za-z][A-Za-z\s.'-]+/.test(v)) return true; // has suburb/city
      if(hasUnit && (hasType || hasNumberName || hasRange)) return true;
      if(/\bLot\s+\d+\b/i.test(v) && /Plan/i.test(v)) return true;
      return hasNumberName || hasRange || hasUnit;
    }
    function isAddressLikeLoose(s){
      if(!s) return false;
      const v = String(s).trim();
      if(!v) return false;
      if(!/\d/.test(v)) return false;
      if(/\b\d{4}\b/.test(v)) return true; // has postcode
      if(/\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway)\b/i.test(v)) return true;
      return false;
    }
    function extractBusinessName(attrs){
      if(!attrs) return null;
      const keyHints = /(business|trading|company|owner|occupier|tenant|name|enterprise|store|shop|organisation|organization)/i;
      let best = null;
      let bestScore = -999;
      for(const k of Object.keys(attrs)){
        const v = String(attrs[k] ?? "").trim();
        if(!v) continue;
        if(/brisbane\s*city/i.test(v)) continue;
        if(/\b(council|city council|local council|lga)\b/i.test(v)) continue;
        if(/\blot\s*type\s*parcel\b/i.test(v)) continue;
        if(/\bparcel\b/i.test(v) && v.length <= 20) continue;
        if(/\bfreehold\b/i.test(v)) continue;
        if(/\d/.test(v)) continue;
        if(v.length < 3) continue;
        let score = 0;
        if(keyHints.test(k)) score += 6;
        if(/[A-Za-z]{3,}/.test(v)) score += 2;
        if(v.length >= 12) score += 2;
        if(/^(unknown|null|n\/a|na)$/i.test(v)) score -= 6;
        if(score > bestScore){ bestScore = score; best = v; }
      }
      return best;
    }
    async function resolveBestAddress(geom, parcelFeature, hintAddress, hintPoint){
      let addr = parcelFeature ? parseAddress(parcelFeature.attributes||{}) : null;
      let addrFromGeo = false;
      let weak = !addr || addr.trim().length<=4 || /^[A-Z]{2,3}$/.test(addr.trim()) || !isLikelyStreetAddress(addr);
      const normAddr = s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
      if(hintAddress && (isLikelyStreetAddress(hintAddress) || isAddressLikeLoose(hintAddress))){
        const hint = String(hintAddress).trim();
        if(!addr || normAddr(addr) !== normAddr(hint)){
          addr = hint;
          weak = false;
        }
      }
      if(weak){
        try{
          const fromLayers = await scanAddressLayers(geom, hintPoint);
          if(fromLayers) addr = fromLayers;
        }catch(e){
          if(ADDR_DEBUG) console.warn("scanAddressLayers error:", e);
        }
      }
      if(!addr || addr.trim().length<=4 || !isLikelyStreetAddress(addr)){
        try{
          const cen0 = hintPoint || centroidOf(geom);
          let cen = cen0;
          try{
            if(cen0 && geometryEngine?.project){
              cen = geometryEngine.project(cen0, {wkid:4326}) || cen0;
            }
          }catch{}
          if(cen){
            const res = await locator.locationToAddress(GEOCODER_URL,{location:cen});
            addr = res?.address || res?.attributes?.Match_addr || res?.attributes?.LongLabel || res?.attributes?.Address || addr;
            if(addr && /\d/.test(String(addr))) addrFromGeo = true;
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("reverse geocode failed:", e);
        }
      }
      if(!addr || !isLikelyStreetAddress(addr)){
        const built = parcelFeature ? buildAddressFromParts(parcelFeature.attributes||{}) : null;
        if(built && isLikelyStreetAddress(built)) addr = built;
      }
      if(addr && !isLikelyStreetAddress(addr) && !addrFromGeo && !isAddressLikeLoose(addr)){
        if(hintAddress && isAddressLikeLoose(hintAddress)) addr = String(hintAddress).trim();
        else addr = null;
      }
      // Ensure suburb is included using the parcel's attributes when available
      addr = ensureSuburbInAddress(addr, parcelFeature?.attributes || {});
      if((!addr || !isLikelyStreetAddress(addr)) && parcelFeature?.attributes){
        const lp = _pick(parcelFeature.attributes, LOTPLAN_FIELDS);
        if(lp) addr = `Lot ${lp}`;
      }
      if(!addr || !isLikelyStreetAddress(addr)){
        const biz = extractBusinessName(parcelFeature?.attributes);
        if(biz) addr = biz;
      }
      if(ADDR_DEBUG && parcelFeature){
        console.log("Parcel attr keys:", Object.keys(parcelFeature.attributes||{}));
        window.dumpAddressFields = ()=> console.table(
          Object.fromEntries(Object.keys(parcelFeature.attributes||{}).map(k=>[k,parcelFeature.attributes[k]]))
        );
      }
      return addr || "Address unavailable";
    }
    function flattenFeatureNodes(){ const out=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) out.push(n); }); return out; }
    const PARCEL_FIELD_RX=/\b(LOT(?:_?PLAN)?|LOT\/PLAN|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM|PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT|PARCEL|PARCEL_ID|PROP(?:ERTY)?_?ID?)\b/i;
    function hasParcelFields(node){
      try{
        const flds=node.fields||[];
        return flds.some(f=>PARCEL_FIELD_RX.test(String(f.name||"")));
      }catch{return false;}
    }
    const looksLikeParcelLayer=node=>{
      const hay=((node.title||"")+" "+nodePath(node)+" "+(node.url||"")).toLowerCase();
      return /(cadast|parcel|dcdb|lot|property)/i.test(hay);
    };
    async function findParcelAtPoint(point){
      const all=flattenFeatureNodes();
      const pref=[],rest=[];
      for(const n of all){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          if(n.geometryType!=="polygon") continue;
          (looksLikeParcelLayer(n)||hasParcelFields(n)?pref:rest).push(n);
        }catch{}
      }
      const layers=[...pref,...rest];
      const collect=async(opts)=>{ const out=[]; for(const L of layers){ try{ const r=await L.queryFeatures({...opts,returnGeometry:true,outFields:["*"],maxRecordCountFactor:2,num:MAX_LEGEND_FEATURES}); (r.features||[]).forEach(f=>out.push({layer:L,feature:f})); }catch{} } return out; };
      let cand=await collect({geometry:point,spatialRelationship:"intersects"});
      let contains=cand.filter(({feature})=>{ try{ return geometryEngine.contains(feature.geometry,point); }catch{ return false; } });
      if(contains.length){
        let best=contains[0], bestD=Infinity;
        for(const c of contains){ let d=Infinity; try{ const cen=centroidOf(c.feature.geometry); d=geometryEngine.distance(point,cen)||Infinity; }catch{} if(d<bestD){ best=c; bestD=d; } }
        return best.feature;
      }
      cand=await collect({geometry:point,distance:1.5,units:"meters",spatialRelationship:"intersects"});
      if(cand.length){
        let best=cand[0], bestD=Infinity;
        for(const c of cand){ let d=Infinity; try{ const near=geometryEngine.nearestCoordinate(c.feature.geometry,point); d=near?.distance??Infinity; }catch{} if(d<bestD){ best=c; bestD=d; } }
        return best.feature;
      }
      return null;
    }
    let lastParcelInfo={feature:null,lotText:"--",areaText:"-- "+M2,classText:"--",addressText:"--",councilText:"Brisbane City Council"};
    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || ("-- "+M2));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Brisbane City Council");
      updateSetbacksPanel();
    }
    function lotAreaForSetbacks(feat, info=lastParcelInfo){
      const attrs = feat?.attributes || {};
      return getLotAreaSqm(attrs)
        ?? geomAreaSqmSafe(feat?.geometry)
        ?? parseNumberLike(info?.areaText)
        ?? null;
    }
    function setbackWallHeightFromInput(raw){
      const parsed = parseNumberLike(raw);
      return parsed != null && parsed > 0 ? parsed : 4.5;
    }
    function currentSetbackWallHeight(){
      return setbackWallHeightFromInput($("setbackWallHeight")?.value);
    }
    function metresText(v, decimals=3){
      if(v == null || !Number.isFinite(Number(v))) return "--";
      return Number(v).toFixed(decimals).replace(/\.?0+$/,"") + " m";
    }
    function ringArea2D(points){
      if(!points?.length) return 0;
      let sum = 0;
      for(let i=0;i<points.length;i++){
        const a = points[i], b = points[(i+1)%points.length];
        sum += (a[0] * b[1]) - (b[0] * a[1]);
      }
      return sum / 2;
    }
    function largestOuterRing(geom){
      const rings = geom?.rings || [];
      if(!rings.length) return null;
      let best = null, bestArea = 0;
      for(const ring of rings){
        if(!Array.isArray(ring) || ring.length < 3) continue;
        const area = Math.abs(ringArea2D(ring));
        if(area > bestArea){ best = ring; bestArea = area; }
      }
      return best;
    }
    function localMetricPointsForRing(geom){
      const ring = largestOuterRing(geom);
      if(!ring) return null;
      const pts = ring
        .filter(p=>Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(p=>[Number(p[0]), Number(p[1])]);
      if(pts.length < 3) return null;
      const originX = pts.reduce((s,p)=>s+p[0],0) / pts.length;
      const originY = pts.reduce((s,p)=>s+p[1],0) / pts.length;
      const wkid = geom?.spatialReference?.wkid;
      if(wkid === 4326){
        const latRad = originY * Math.PI / 180;
        const xScale = 111320 * Math.cos(latRad);
        const yScale = 110540;
        return pts.map(([x,y])=>[(x-originX)*xScale, (y-originY)*yScale]);
      }
      const r = 6378137;
      const latRad = 2 * Math.atan(Math.exp(originY / r)) - Math.PI / 2;
      const scale = Math.max(0.2, Math.cos(latRad));
      return pts.map(([x,y])=>[(x-originX)*scale, (y-originY)*scale]);
    }
    function orientedLotMetrics(geom, areaSqm){
      const pts = localMetricPointsForRing(geom);
      if(!pts?.length) return null;
      const angles = [];
      const seen = new Set();
      for(let i=0;i<pts.length;i++){
        const a = pts[i], b = pts[(i+1)%pts.length];
        const dx = b[0]-a[0], dy = b[1]-a[1];
        if(Math.hypot(dx,dy) < 0.25) continue;
        let angle = Math.atan2(dy, dx);
        angle = ((angle % (Math.PI/2)) + (Math.PI/2)) % (Math.PI/2);
        const key = Math.round(angle * 10000);
        if(seen.has(key)) continue;
        seen.add(key);
        angles.push(angle);
      }
      if(!angles.length) angles.push(0);
      let best = null;
      for(const angle of angles){
        const c = Math.cos(angle), s = Math.sin(angle);
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(const [x,y] of pts){
          const rx = x*c + y*s;
          const ry = -x*s + y*c;
          if(rx<minX) minX=rx;
          if(rx>maxX) maxX=rx;
          if(ry<minY) minY=ry;
          if(ry>maxY) maxY=ry;
        }
        const w = maxX-minX, h = maxY-minY;
        const rectArea = w*h;
        if(!best || rectArea < best.rectArea){
          best = {rectArea, shortSide:Math.min(w,h), longSide:Math.max(w,h)};
        }
      }
      if(!best || !best.shortSide || !best.longSide) return null;
      const avgWidth = areaSqm && best.longSide ? areaSqm / best.longSide : best.shortSide;
      const width = Math.max(0, avgWidth || best.shortSide);
      const depth = areaSqm && width ? areaSqm / width : best.longSide;
      return {
        width,
        frontage: width,
        depth,
        boundingWidth: best.shortSide,
        boundingDepth: best.longSide,
        method: "oriented parcel estimate"
      };
    }
    function estimateLotDimensionsForSetbacks(geom, areaSqm){
      const oriented = orientedLotMetrics(geom, areaSqm);
      if(oriented) return oriented;
      try{
        const ext = geom?.extent;
        if(!ext) return null;
        const a = Math.abs(Number(areaSqm) || 0);
        const w = Math.abs((ext.xmax ?? 0) - (ext.xmin ?? 0));
        const h = Math.abs((ext.ymax ?? 0) - (ext.ymin ?? 0));
        if(!w || !h) return null;
        const sr = geom?.spatialReference?.wkid;
        let scale = 1;
        if(sr !== 4326){
          const y = ((ext.ymin ?? 0) + (ext.ymax ?? 0)) / 2;
          const r = 6378137;
          const latRad = 2 * Math.atan(Math.exp(y / r)) - Math.PI / 2;
          scale = Math.max(0.2, Math.cos(latRad));
        }
        const shortSide = Math.min(w, h) * scale;
        const longSide = Math.max(w, h) * scale;
        const avgWidth = a && longSide ? a / longSide : shortSide;
        return {
          width: avgWidth || shortSide,
          frontage: avgWidth || shortSide,
          depth: a && (avgWidth || shortSide) ? a / (avgWidth || shortSide) : longSide,
          boundingWidth: shortSide,
          boundingDepth: longSide,
          method: "extent estimate"
        };
      }catch{
        return null;
      }
    }
    function formatSetbackArea(areaSqm){
      return areaSqm != null ? `${Math.round(areaSqm).toLocaleString()} ${M2}` : `-- ${M2}`;
    }
    const QDC_NARROW_FRONTAGE_TABLE = [
      {min:14.5,max:15.0,low:1.425,mid:1.9,label:"14.501 m to 15 m"},
      {min:14.0,max:14.5,low:1.35,mid:1.8,label:"14.001 m to 14.5 m"},
      {min:13.5,max:14.0,low:1.275,mid:1.7,label:"13.501 m to 14 m"},
      {min:13.0,max:13.5,low:1.2,mid:1.6,label:"13.001 m to 13.5 m"},
      {min:12.5,max:13.0,low:1.125,mid:1.5,label:"12.501 m to 13 m"},
      {min:12.0,max:12.5,low:1.05,mid:1.4,label:"12.001 m to 12.5 m"},
      {min:11.5,max:12.0,low:0.975,mid:1.3,label:"11.501 m to 12 m"},
      {min:11.0,max:11.5,low:0.9,mid:1.2,label:"11.001 m to 11.5 m"},
      {min:10.5,max:11.0,low:0.825,mid:1.1,label:"10.501 m to 11 m"},
      {min:-Infinity,max:10.5,low:0.75,mid:1.0,label:"10.5 m or less"}
    ];
    function qdcNarrowFrontageRow(frontage){
      if(frontage == null || frontage > 15) return null;
      return QDC_NARROW_FRONTAGE_TABLE.find(r=>frontage > r.min && frontage <= r.max) || QDC_NARROW_FRONTAGE_TABLE[QDC_NARROW_FRONTAGE_TABLE.length-1];
    }
    function qdcSideRearSetbackFor(height, frontage){
      const h = Math.max(0, Number(height) || 0);
      const narrow = qdcNarrowFrontageRow(frontage);
      if(h <= 4.5){
        return {
          value: narrow ? narrow.low : 1.5,
          basis: narrow ? `QDC Table A2 narrow frontage band ${narrow.label}` : "QDC A2(a)(i)"
        };
      }
      if(h <= 7.5){
        return {
          value: narrow ? narrow.mid : 2,
          basis: narrow ? `QDC Table A2 narrow frontage band ${narrow.label}` : "QDC A2(a)(ii)"
        };
      }
      return {
        value: 2 + (0.5 * Math.ceil((h - 7.5) / 3)),
        basis: "QDC A2(a)(iii) and A2(b)(ii) for height over 7.5 m"
      };
    }
    function smallLotRearSetbackFor(height, depth){
      const h = Math.max(0, Number(height) || 0);
      if(depth == null){
        return { value:null, detail:"Average depth could not be estimated from the selected parcel." };
      }
      if(depth > 35){
        return { value:6, detail:"Average depth over 35 m." };
      }
      if(depth > 25){
        return h <= 4.5
          ? { value:6, detail:"Average depth over 25 m and up to 35 m; 3 m may be available where the required open-space and solar-access outcome is met." }
          : { value:6, detail:"Average depth over 25 m and up to 35 m, and wall height over 4.5 m." };
      }
      return h <= 4.5
        ? { value:3, detail:"Average depth 25 m or less; 1.5 m may be available where the required open-space and solar-access outcome is met." }
        : { value:4.5, detail:"Average depth 25 m or less, and wall height over 4.5 m." };
    }
    function calculateBccSetbacks(feat=lastParcelInfo.feature, opts={}){
      const info = opts.info || lastParcelInfo || {};
      const wallHeight = setbackWallHeightFromInput(opts.wallHeight ?? $("setbackWallHeight")?.value);
      const areaSqm = lotAreaForSetbacks(feat, info);
      const dimensions = estimateLotDimensionsForSetbacks(feat?.geometry, areaSqm);
      if(!feat && areaSqm == null){
        return {
          empty: true,
          notes: ["Select a parcel to calculate the applicable setback source."]
        };
      }
      if(areaSqm == null){
        return {
          empty: true,
          notes: ["Lot area is unavailable, so the setback source cannot be selected."]
        };
      }
      const isSmallLot = areaSqm < 450;
      const classLabel = isSmallLot ? "Small lot" : "Standard lot";
      const frontage = dimensions?.frontage ?? dimensions?.width ?? null;
      const depth = dimensions?.depth ?? null;
      const metricDetail = [
        frontage != null ? `estimated average width/frontage ${metresText(frontage)}` : "width unavailable",
        depth != null ? `estimated average depth ${metresText(depth)}` : "depth unavailable"
      ].join("; ");
      if(isSmallLot){
        const rear = smallLotRearSetbackFor(wallHeight, depth);
        const narrowSmall = frontage != null && frontage <= 7.5;
        const nonHabitable = wallHeight <= 3.5
          ? "0.5 m may apply for qualifying non-habitable side walls; 0 m/built-to-boundary options need the AO6/AO18 conditions."
          : "Wall height is over 3.5 m, so the 0.5 m non-habitable side-wall concession is not indicated.";
        return {
          regime: "small-lot",
          classLabel,
          areaSqm,
          dimensions,
          wallHeight,
          sourceLabel: "BCC City Plan 2014 - Dwelling house (small lot) code",
          sourceUrl: SMALL_LOT_RULE_URL,
          rows: [
            {
              boundary: "Lot metrics",
              value: `${metresText(frontage)} width / ${metresText(depth)} depth`,
              detail: `${metricDetail}. Width is estimated from the selected parcel geometry.`
            },
            {
              boundary: "Primary street",
              value: "3 m to 6 m",
              detail: "6 m where adjoining houses are 6 m or more; otherwise the least adjoining setback, but not less than 3 m; 3 m where there is no adjoining dwelling house."
            },
            {
              boundary: "Secondary street",
              value: "1.5 m",
              detail: "Covered car accommodation needs 5.5 m where the street setback is less than 5.5 m."
            },
            {
              boundary: "Side",
              value: "1 m",
              detail: `Habitable-space side setback. ${nonHabitable}`
            },
            {
              boundary: "Rear",
              value: rear.value == null ? "--" : metresText(rear.value, 1),
              detail: rear.detail
            },
            {
              boundary: "Width trigger",
              value: frontage == null ? "--" : (narrowSmall ? "7.5 m or less" : "Over 7.5 m"),
              detail: narrowSmall
                ? "The small-lot narrow-width threshold is triggered. Some built-to-boundary outcomes allow longer or different walls, subject to zone and adjoining-lot conditions."
                : "The 7.5 m narrow-width threshold is not triggered by the estimated width."
            }
          ],
          notes: [
            "This uses area under 450 m2 as the small-lot trigger from the available parcel data.",
            "Rear lots under 600 m2 can also be small lots under City Plan; this tool does not subtract access-handle area.",
            "Approved building envelopes, neighbourhood plans, overlays, easements, adjoining wall/window conditions and referral relaxations can override or add requirements."
          ]
        };
      }
      const sideRear = qdcSideRearSetbackFor(wallHeight, frontage);
      const isNarrowQdc = frontage != null && frontage <= 15;
      return {
        regime: "standard-lot",
        classLabel,
        areaSqm,
        dimensions,
        wallHeight,
        sourceLabel: "Queensland Development Code MP 1.2",
        sourceUrl: QDC_MP12_URL,
        rows: [
          {
            boundary: "Lot metrics",
            value: `${metresText(frontage)} frontage / ${metresText(depth)} depth`,
            detail: `${metricDetail}. QDC narrow-lot Table A2 uses road frontage; this is an estimated frontage from the selected parcel geometry.`
          },
          {
            boundary: "Road frontage",
            value: "6 m base",
            detail: "QDC MP 1.2 road setbacks can also use adjoining dwelling setbacks, corner-lot rules and carport exceptions."
          },
          {
            boundary: "Side and rear",
            value: sideRear.value == null ? "--" : metresText(sideRear.value),
            detail: `For wall height ${metresText(wallHeight, 1)}. ${sideRear.basis}.`
          },
          {
            boundary: "Narrow lots",
            value: isNarrowQdc ? "Table A2 applied" : "Not triggered",
            detail: isNarrowQdc
              ? "Estimated frontage is 15 m or less, so the QDC narrow-lot side/rear table is used for heights up to 7.5 m."
              : "Estimated frontage is over 15 m, so the standard QDC side/rear height bands are used."
          }
        ],
        notes: [
          "This uses the QDC MP 1.2 path for lots 450 m2 and over.",
          "For walls less than 750 mm from a side or rear boundary, QDC maintenance-free wall requirements may also apply.",
          "BCC City Plan overlays, neighbourhood plans, easements, approved building envelopes and referral relaxations can still affect siting."
        ]
      };
    }
    function setbackInfoToHTML(info){
      if(!info || info.empty){
        const msg = info?.notes?.[0] || "Select a parcel.";
        return `<p class='setback-muted'>${htmlEsc(msg)}</p>`;
      }
      const source = info.sourceUrl
        ? `<a href="${htmlEsc(info.sourceUrl)}" target="_blank" rel="noopener">${htmlEsc(info.sourceLabel)}</a>`
        : htmlEsc(info.sourceLabel || "Setback source");
      const dimParts = [
        info.wallHeight != null ? `Wall height: ${metresText(info.wallHeight, 1)}` : null,
        info.dimensions?.frontage != null ? `Width/frontage: ${metresText(info.dimensions.frontage)}` : null,
        info.dimensions?.depth != null ? `Depth: ${metresText(info.dimensions.depth)}` : null
      ].filter(Boolean).join(". ");
      const dimText = dimParts ? `. ${dimParts}.` : "";
      const rows = (info.rows || []).map(row=>(
        `<tr><th>${htmlEsc(row.boundary)}</th><td><span class="setback-value">${htmlEsc(row.value)}</span><span class="setback-detail">${htmlEsc(row.detail)}</span></td></tr>`
      )).join("");
      const notes = (info.notes || []).length
        ? `<ul class="setback-notes">${info.notes.map(n=>`<li>${htmlEsc(n)}</li>`).join("")}</ul>`
        : "";
      return [
        `<p class="setback-summary">${htmlEsc(info.classLabel)} - ${htmlEsc(formatSetbackArea(info.areaSqm))}${htmlEsc(dimText)}</p>`,
        `<p class="setback-source">Source: ${source}</p>`,
        `<table class="setback-table"><tbody>${rows}</tbody></table>`,
        notes
      ].join("");
    }
    function updateSetbacksPanel(){
      const el = $("setbacksContent");
      if(!el) return;
      el.innerHTML = setbackInfoToHTML(calculateBccSetbacks());
    }
    (function initSetbackHeightInput(){
      const input = $("setbackWallHeight");
      if(!input) return;
      input.addEventListener("input", ()=>{
        try{ lastReportHTML = null; lastReportTitle = "Property Report"; }catch{}
        updateSetbacksPanel();
      });
    })();
    window.calculateBccSetbacks = calculateBccSetbacks;
    function outlineSelection(geom){
      selLayer.removeAll();
      if(!geom) return;
      selLayer.add(new Graphic({geometry:geom,symbol:{type:"simple-fill",color:[0,0,0,0],outline:{color:"#a70b13",width:2}}}));
    }
    function parcelInfoFromFeature(feat){
      const attrs=feat?.attributes||{};
      const meta=parseParcelMeta(attrs);
      const lotplan=meta.lotplan || ((meta.lot||meta.plan)?[meta.lot,meta.plan].filter(Boolean).join("/"):"--");
      const area=getLotAreaSqm(attrs) ?? geomAreaSqmSafe(feat.geometry) ?? null;
      const cls=(area!=null && area<450)?"Small lot":"Standard lot";
      // Parse address from feature, then ensure suburb/state/postcode are included
      let address=parseAddress(attrs) || "--";
      if(address && address!=="--") address = ensureSuburbInAddress(address, attrs);
      const council=parseCouncil(attrs) || "Brisbane City Council";
      return { lotText:lotplan||"--", areaText:area!=null?(Math.round(area).toLocaleString()+" "+M2):("-- "+M2), classText:cls, addressText:address, councilText:council };
    }
    function updateBadgesFromFeature(feat){
      const info=parcelInfoFromFeature(feat);
      if($("lotBadge")) $("lotBadge").textContent="Lot: "+info.lotText;
      if($("areaBadge")) $("areaBadge").textContent="Area: "+info.areaText;
      if($("classBadge")) $("classBadge").textContent="Class: "+info.classText;
      lastParcelInfo={feature:feat,...info};
      updateSummaryPanel();
    }
    const bufferedAOIFor=(node,geom)=>{ try{ const gt=(node.geometryType||"").toLowerCase(); if(gt==="point"||gt==="multipoint"||gt==="polyline") return geometryEngine.buffer(geom,TOUCH_BUFFER_M,"meters"); }catch{} return geom; };
    async function countFeatures(node,geom){
      const g=bufferedAOIFor(node,geom);
      try{
        if(typeof node.queryFeatureCount==="function"){
          const c=await withTimeout(node.queryFeatureCount({geometry:g,spatialRelationship:"intersects"}), QUERY_TIMEOUT_MS, "countFeatures");
          if(c!=null) return Number(c)||0;
        }
      }catch{}
      try{
        if(typeof node.queryFeatures==="function"){
          const q=await withTimeout(node.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:1}), QUERY_TIMEOUT_MS, "countFeatures");
          return q?.features?.length?1:0;
        }
      }catch{}
      return 0;
    }
    let reportInProgress = false;
    let parcelFocusJobId = 0;
    async function hideUnusedOverlaysFor(geom, shouldContinue=()=>true){
      const nodes=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) nodes.push(n); });
      for(const n of nodes){
        if(!shouldContinue()) return;
        const t=n.title||n.id||"", id=n.id||"", tg=n.portalItem?.tags||[];
        if(isDNT(t,id,tg)) continue;
        if(isUtility(t,id,tg)) continue;
        if(isWaterOrSewer(nodePath(n))) continue;
        if(/contours?/i.test(t)){
          if(!shouldContinue()) return;
          if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
          try{ n.listMode = "show"; }catch{}
          continue;
        }
        try{ await n.load(); const cnt=await countFeatures(n,geom); if(!shouldContinue()) return; if("listMode"in n) n.listMode=cnt>0?"show":"hide"; }catch{}
      }
      if(!shouldContinue()) return;
      try{ layerList.refresh(); }catch{}
    }
    function underDNTChain(node){
      let cur=node;
      while(cur){
        const t=cur.title||"", id=cur.id||"", tg=cur.portalItem?.tags||[];
        if(isDNT(t,id,tg)) return true;
        cur=cur.parent;
      }
      return false;
    }
    // Side overlay summary (no utilities)
    const sideOverlayIndex = new Map();
    function isNodeVisible(node){
      try{
        if(node && "visible" in node) return !!node.visible;
      }catch{}
      return false;
    }
    function setOverlayVisibility(node, on){ if(keepPropertyBoundaryVisible(node)) return;
      if(!node) return;
      if(keepLegacyBushfireHidden(node)) return;
      if(isBrisbaneBushfireLayer(node)){
        try{ brisbaneBushfireLayer.visible=!!on; }catch{}
        try{ brisbaneBushfireLayer.listMode="show"; }catch{}
        return;
      }
      if(isSppBushfireLayer(node)){
        try{ sppBushfireLayer.visible=!!on; }catch{}
        try{ sppBushfireDrawLayer.visible=!!on; }catch{}
        if(on){ setSppBushfireStatus("Loading state bushfire overlay..."); scheduleSppBushfireRefresh(0); }
        else{ try{ sppBushfireDrawLayer.removeAll(); }catch{} setSppBushfireStatus("Off"); }
        return;
      }
      try{ node.visible = !!on; }catch{}
      if(on){
        try{ node.listMode = "show"; }catch{}
      }
      let p = node.parent;
      while(p){
        if("visible" in p){ try{ p.visible = true; }catch{} }
        p = p.parent;
      }
    }
    function updateOverlayToggleButton(btn, node){
      if(!btn) return;
      const on = isNodeVisible(node);
      btn.textContent = on ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("title", on ? "Hide overlay" : "Show overlay");
    }
    async function bushfireLegendHTMLFor(layerNode, geom, label){
      if(!geom || !layerNode) return "";
      try{
        const legend = await withTimeout(legendFromRendererUsingFeatures(layerNode, geom), QUERY_TIMEOUT_MS, label || "bushfire legend");
        const legendItems = legend?.items || [];
        if(!legendItems.length) return "";
        return `<div class="leg" style="margin-top:4px">${legendItems.map(k=>`<div class="row">${k.swatchHTML}${htmlEsc(k.label)}</div>`).join("")}</div>`;
      }catch{
        return "";
      }
    }
    (function initSideOverlayToggle(){
      const ul = $("sumOverlays");
      if(!ul) return;
      ul.addEventListener("click", (evt)=>{
        const btn = evt.target.closest(".ov-toggle");
        if(!btn) return;
        evt.preventDefault();
        const key = btn.getAttribute("data-ov-key");
        if(!key) return;
        const node = sideOverlayIndex.get(key);
        if(!node) return;
        const next = !isNodeVisible(node);
        setOverlayVisibility(node, next);
        updateOverlayToggleButton(btn, node);
        try{ layerList.refresh(); }catch{}
      });
    })();
    async function updateSideOverlaySummary(geom){
      const ul = $("sumOverlays");
      if (!ul) return;
      ul.innerHTML = "<li><i>Scanning</i></li>";
      sideOverlayIndex.clear();
      const items = [];
      let itemIdx = 0;
      const bneBushfireKey = `ov-${itemIdx++}`;
      sideOverlayIndex.set(bneBushfireKey, brisbaneBushfireLayer);
      let bneBushfireCount = 0;
      try{ bneBushfireCount = geom ? await withTimeout(countFeatures(brisbaneBushfireLayer, geom), 8000, "Brisbane bushfire count") : 0; }catch{}
      if(bneBushfireCount > 0){
        const bneBushfireVisible = isNodeVisible(brisbaneBushfireLayer);
        const bneBushfireToggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${bneBushfireKey}" aria-pressed="${bneBushfireVisible}" title="${bneBushfireVisible ? "Hide overlay" : "Show overlay"}">${bneBushfireVisible ? "Hide" : "Show"}</button>`;
        const bneBushfireLegendHTML = await bushfireLegendHTMLFor(brisbaneBushfireLayer, geom, "Brisbane bushfire legend");
        items.push(`<li><div class="ov-title"><span class="ov-name">Bushfire overlay - Brisbane City Plan 2014</span> <span style="color:#777">(${bneBushfireCount})</span>${bneBushfireToggleHTML}</div><div style="font-size:11px;color:#667085;margin:3px 0 4px">Intersects the selected parcel.</div>${bneBushfireLegendHTML}</li>`);
      }

      const sppKey = `ov-${itemIdx++}`;
      sideOverlayIndex.set(sppKey, sppBushfireLayer);
      const sppDisplayNode = getSppBushfireDisplayNode();
      let sppBushfireCount = 0;
      try{ sppBushfireCount = geom ? await withTimeout(countFeatures(sppDisplayNode, geom), 8000, "State bushfire count") : 0; }catch{}
      if(sppBushfireCount > 0){
        const sppVisible = isNodeVisible(sppBushfireLayer);
        const sppToggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${sppKey}" aria-pressed="${sppVisible}" title="${sppVisible ? "Hide overlay" : "Show overlay"}">${sppVisible ? "Hide" : "Show"}</button>`;
        const sppBushfireLegendHTML = await bushfireLegendHTMLFor(sppDisplayNode, geom, "State bushfire legend");
        items.push(`<li><div class="ov-title"><span class="ov-name">State Bushfire prone area fallback</span> <span style="color:#777">(${sppBushfireCount})</span>${sppToggleHTML}</div><div data-spp-bushfire-status style="font-size:11px;color:#667085;margin:3px 0 4px">${sppBushfireStatusText}</div>${sppBushfireLegendHTML}</li>`);
      }
      const nodes = flattenFeatureNodes().filter(n=>{
        if(keepLegacyBushfireHidden(n)) return false;
        const t=n.title||"", id=n.id||"", tg=n.portalItem?.tags||[];
        const p=nodePath(n);
        if(isUtility(t,id,tg) || isWaterOrSewer(p)) return false;
        // Always include zoning and Traditional Building Character layers, even if under DNT
        if(isZoning(t,p) || isTBCOverlayTitle(t)) return true;
        return !underDNTChain(n);
      });
      for (const n of nodes){
        try{
          const t = n.title || "", id = n.id || "", tg = n.portalItem?.tags || [];
          const p = nodePath(n);
          if (isUtility(t,id,tg) || isWaterOrSewer(p)) continue;
          if (isManagedBushfireLayer(n)) continue;
          if (/contours?/i.test(t)) continue;
          await n.load();
          let cnt = 0;
          try{
            cnt = await withTimeout(countFeatures(n, geom), 8000, "summary overlay count");
          }catch{}
          if (cnt <= 0 && isZoning(t,p)){
            // If zoning query is slow or blocked, still show the layer name
            cnt = 1;
          }
          if (cnt <= 0) continue;
          let keys=[];
          try{ ({ items: keys } = await legendFromRendererUsingFeatures(n, geom)); }catch{ keys=[]; }
          const keyHTML = keys.length
            ? `<div class="leg" style="margin-top:4px">${keys.map(k =>
                `<div class="row">${k.swatchHTML}${htmlEsc(k.label)}</div>`
              ).join("")}</div>`
            : "";
          const title = htmlEsc(t || "Layer");
          const isBiodiversity = /biodivers/i.test(t || "");
          const isBushfire = /bushfire/i.test(t || "");
          const isCoastalHazard = /coast(al|el)\s*hazard/i.test(t || "");
          const isHeritage = /heritage/i.test(t || "");
          const isWaterwayCorridorsFlood = /waterway\s*corridors?\s*flood/i.test(t || "");
          const isFlooding = isWaterwayCorridorsFlood || /flood|overland\s*flow|creek|river/i.test(t || "");
          const isTBC = isTBCOverlayTitle(t);
          const isTransportNoise = /transport\s*noise/i.test(t || "");
          const isLandslide = /landslide/i.test(t || "");
          const isPre1911 = /pre[\s-]*1911/i.test(t || "");
          const isIndustrialAmenity = /industrial\s*amenity/i.test(t || "");
          const isKeyCivicVista = /key\s*civic\s*space|iconic\s*vista/i.test(t || "");
          const isRoadHierarchy = /road\s*hierarchy/i.test(t || "");
          const isSignificantLandscapeTree = /significant\s*landscape\s*tree/i.test(t || "");
          const isWaterwayCorridors = /waterway\s*corridors?/i.test(t || "");
          const isWetland = /wetlands?/i.test(t || "");
          const isNeighbourhoodPlan = !!neighbourhoodPlanUrlFromTitle(t || "");
          let schemeLink = (isZoning(t,p) || isBiodiversity || isBushfire || isCoastalHazard || isHeritage || isFlooding || isTBC || isTransportNoise || isLandslide || isPre1911 || isIndustrialAmenity || isKeyCivicVista || isRoadHierarchy || isSignificantLandscapeTree || isWaterwayCorridors || isWetland || isNeighbourhoodPlan) ? buildPlanningSchemeLink(t) : null;
          if(!schemeLink && isZoning(t,p) && keys.length){
            for(const k of keys){
              if(!k?.label) continue;
              schemeLink = buildPlanningSchemeLink(k.label,{zoneLabel:k.label});
              if(schemeLink) break;
            }
          }
          if(!schemeLink && keys.length){
            for(const k of keys){
              const alt = neighbourhoodPlanUrlFromTitle(k?.label || "");
              if(alt){ schemeLink = alt; break; }
            }
          }
          const schemeHTML = schemeLink ? `<a href="${schemeLink}" target="_blank" rel="noopener" style="font-size:12px;text-decoration:none;margin-left:6px">Planning scheme</a>` : "";
          const key = `ov-${itemIdx++}`;
          sideOverlayIndex.set(key, n);
          const isVisible = isNodeVisible(n);
          const toggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${key}" aria-pressed="${isVisible}" title="${isVisible ? "Hide overlay" : "Show overlay"}">${isVisible ? "Hide" : "Show"}</button>`;
          items.push(
            `<li>
               <div class="ov-title"><span class="ov-name">${title}</span> <span style="color:#777">(${cnt})</span>${schemeHTML}${toggleHTML}</div>
               ${keyHTML}
             </li>`
          );
        }catch{
          /* ignore layer errors */
        }
      }
      ul.innerHTML = items.length
        ? items.join("")
        : "<li><i>No overlays intersect this parcel.</i></li>";
    }
    async function focusOnParcelFeature(feat,{shouldZoom=false,hintAddress=null,hintPoint=null}={}){
      if(!feat || !feat.geometry) return;
      await mapStartupReady;
      const focusJob = ++parcelFocusJobId;
      const geom = normalizeToWebMercator(projectToViewSR(feat.geometry));
      feat.geometry = geom;
      updateBadgesFromFeature(feat);
      // Draw selection differently for points vs polygons
      selLayer.removeAll();
      if(geom.type==="point" || geom.type==="multipoint"){
        selLayer.add(new Graphic({geometry:geom,symbol:{type:"simple-marker",style:"circle",size:10,color:[167,11,19,0.2],outline:{color:"#a70b13",width:2}}}));
      }else{
        outlineSelection(geom);
      }
      if(shouldZoom){
        try{
          if(geom.type==="point" || geom.type==="multipoint"){
            await view.goTo({target:geom, zoom:18});
          }else{
            const ext = geom.extent || framedExtent(geom);
            if(ext){
              await view.goTo({target:ext.expand(1.2), animate:true});
            }else if(geom.centroid){
              await view.goTo({target:geom.centroid, zoom:18});
            }else{
              await view.goTo({target:geom, zoom:18});
            }
          }
        }catch(err){
          console.warn("goTo failed", err);
        }
      }
      const overlayList = $("sumOverlays");
      if(overlayList) overlayList.innerHTML = "<li><i>Scanning</i></li>";
      setTimeout(()=>{
        const stillCurrent = ()=> focusJob === parcelFocusJobId && !reportInProgress;
        (async()=>{
          try{
            const addr=await resolveBestAddress(geom, feat, hintAddress, hintPoint);
            if(focusJob !== parcelFocusJobId) return;
            lastParcelInfo.addressText=addr||lastParcelInfo.addressText||"Address unavailable";
            updateSummaryPanel();
          }catch{}
        })();
        (async()=>{
          try{
            if(!stillCurrent()) return;
            await hideUnusedOverlaysFor(geom, stillCurrent);
            if(!stillCurrent()) return;
            await updateSideOverlaySummary(geom);
          }catch{}
        })();
      }, 80);
    }
    view.on("click", async ev=>{
      try{
        showLoading(true);
        await mapStartupReady;
        lastReportHTML = null;
        lastReportTitle = "Property Report";
        const actions = $("rptActions");
        if(actions) actions.style.display = "none";
        const parcel=await findParcelAtPoint(ev.mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        const hint = getNearbySearchHint(parcel?.geometry);
        await focusOnParcelFeature(parcel,{hintAddress:hint,hintPoint:ev.mapPoint});
      } finally { showLoading(false); }
    });
    /* ---------------- Legend helpers ---------------- */
    async function swatchHTML(symbol){
      try{
        const el=await symbolUtils.renderPreviewHTML(symbol,{size:[SWATCH_PX-2,SWATCH_PX-2]});
        if(el.tagName?.toLowerCase()==="canvas"){ return `<span class="swbox"><img alt="" src="${el.toDataURL("image/png")}"></span>`; }
        try{ el.setAttribute("width","100%"); el.setAttribute("height","100%"); }catch{}
        return `<span class="swbox">${el.outerHTML}</span>`;
      }catch{ return `<span class="swbox" style="background:#cfcfcf"></span>`; }
    }
    const guessLabelFromAttrs = attrs => {
      if (!attrs) return null;
      const patt = [
        /zone.*(name|desc|label|category|type)/i,
        /(planning|scheme).*zone/i,
        /(zone|category|type|class|desc|label)/i
      ];
      const candidates = [];
      for (const r of patt) {
        for (const k of Object.keys(attrs)) {
          if (!r.test(k)) continue;
          const v = String(attrs[k] ?? "").trim();
          if (!v) continue;
          candidates.push(v);
        }
        if (candidates.length) break;
      }
      if (!candidates.length) return null;
      const score = v => {
        let s = 0;
        if (/\s/.test(v)) s += 4;
        if (v.length >= 8) s += 3;
        if (/[a-z]/.test(v)) s += 2;
        if (/^[A-Z0-9]+$/.test(v) && v.length <= 4) s -= 6; // likely a short code
        return s;
      };
      candidates.sort((a,b)=> score(b)-score(a));
      return candidates[0] || null;
    };
    function getUVInfo(renderer,attrs){
      if(!renderer||!attrs) return null;
      const fields=[renderer.field,renderer.field2,renderer.field3].filter(Boolean);
      const delim=renderer.fieldDelimiter??", ";
      if(!fields.length) return null;
      const parts=fields.map(f=>attrs[f]); const key=parts.join(delim);
      const infos=renderer.uniqueValueInfos||[];
      let info=infos.find(u=>String(u.value)===String(key));
      if(!info) info=infos.find(u=>Array.isArray(u.values)&&u.values.some(v=>String(v)===String(key)));
      if(!info && fields.length===1){
        info=infos.find(u=>String(u.value)===String(attrs[fields[0]]))||
              infos.find(u=>Array.isArray(u.values)&&u.values.some(v=>String(v)===String(attrs[fields[0]])));
      }
      return info||null;
    }
    const ZONE_KEYS=["ZONE_CODE","ZONE","ZONE_NAME","ZONING","ZONE_LABEL","ZONE_DESC","ZONE_TYPE","ZONE_CATEGORY","PLANNING_ZONE"];
    const ZONE_CODE_MAP = {
      LDR: "Low density residential",
      LMR: "Low-medium density residential",
      MDR: "Medium density residential",
      HDR: "High density residential",
      CR: "Character residential",
      TAC: "Tourist accommodation"
    };
    const isZoneFullName = v => /\bzone\b/i.test(String(v||""));
    const expandZoneCode = v => {
      const key = String(v||"").trim().toUpperCase();
      return ZONE_CODE_MAP[key] || null;
    };
    function bestZoneNameFromAttrs(attrs){
      if(!attrs) return null;
      let best = null;
      let bestScore = -999;
      const keyPenalty = /(objectid|globalid|shape|area|length|gid|id|code|date|time)/i;
      const keyBonus = /(zone|zoning|name|desc|description|label|category|type)/i;
      const wordBonus = /(residential|industry|industrial|mixed|centre|center|rural|special|community|tourist|low|medium|high|character|neighbourhood|neighborhood)/i;
      for(const k of Object.keys(attrs)){
        const v = String(attrs[k] ?? "").trim();
        if(!v) continue;
        if(/^\d+(\.\d+)?$/.test(v)) continue;
        if(v.length < 5) continue;
        let score = 0;
        if(/\s/.test(v)) score += 3;
        if(/zone/i.test(v)) score += 6;
        if(wordBonus.test(v)) score += 4;
        if(keyBonus.test(k)) score += 3;
        if(keyPenalty.test(k)) score -= 4;
        if(/^[A-Z0-9]+$/.test(v) && v.length <= 4) score -= 8;
        if(v.length >= 12) score += 2;
        if(score > bestScore){
          bestScore = score;
          best = v;
        }
      }
      return (best && isZoneFullName(best)) ? best : null;
    }
    function domainValueName(layerNode, attrs, {preferZone=false}={}){
      try{
        if(!layerNode || !attrs) return null;
        const fields = layerNode.fields || [];
        let best = null;
        let bestScore = -999;
        const isZoney = s => /\bzone\b/i.test(s||"");
        for(const fld of fields){
          const name = fld?.name;
          if(!name) continue;
          const dom = fld?.domain;
          if(!dom || dom.type !== "coded-value") continue;
          const code = attrs[name];
          if(code==null) continue;
          const hit = (dom.codedValues || []).find(c => String(c.code) === String(code));
          const label = hit?.name ? String(hit.name).trim() : "";
          if(!label) continue;
          let score = 0;
          if(isZoney(label)) score += 6;
          if(/\b(residential|industry|industrial|mixed|centre|rural|low|medium|high|character|tourist)\b/i.test(label)) score += 4;
          if(label.length >= 8) score += 2;
          if(preferZone && !isZoney(label)) score -= 2;
          if(score > bestScore){ best = label; bestScore = score; }
        }
        return best;
      }catch{ return null; }
    }
    function pickZoneLabel(attrs, layerNode){
      if(!attrs) return null;
      const dom = domainValueName(layerNode, attrs, {preferZone:true});
      if(dom && isZoneFullName(dom)) return dom;
      const bestName = bestZoneNameFromAttrs(attrs);
      if(bestName) return bestName;
      const code=String(attrs.ZONE_CODE ?? attrs.ZONE ?? "").trim();
      const name=String(attrs.ZONE_NAME ?? attrs.ZONING ?? "").trim();
      const expanded = expandZoneCode(code);
      if(expanded) return expanded;
      if(code && name && isZoneFullName(name)) return name;
      for(const k of ZONE_KEYS){ const v=attrs[k]; if(v!=null && String(v).trim()) return String(v).trim(); }
      return null;
    }
    async function legendFromRendererUsingFeatures(layerNode,lotGeom){
      const gt=(layerNode.geometryType||"").toLowerCase();
      const isZone=isZoning(layerNode.title||"",nodePath(layerNode));
      const g=(gt==="point"||gt==="multipoint"||gt==="polyline") ? geometryEngine.buffer(lotGeom,TOUCH_BUFFER_M,"meters") : lotGeom;
      let feats=[];
      try{
        const q=await withTimeout(
          layerNode.queryFeatures({
            geometry:g,
            spatialRelationship:"intersects",
            returnGeometry:true,
            outFields:["*"],
            maxRecordCountFactor:2,
            num:currentReportOptions.maxLegend
          }),
          QUERY_TIMEOUT_MS,
          "legend query"
        );
        feats=q?.features||[];
      }catch{}
      if(!feats.length) return {items:[]};
      const itemMap=new Map();
      for(const f of feats){
        const gph=new Graphic({geometry:f.geometry,attributes:f.attributes,layer:layerNode});
        let sym=null;
        try{ sym=await symbolUtils.getDisplayedSymbol(gph,view); }catch{}
        if(!sym){
          const r=layerNode.renderer; sym = r?.symbol || r?.defaultSymbol || f.symbol || null;
        }
        if(!sym) continue;
        let label=isZone?pickZoneLabel(f.attributes, layerNode):null;
        if(!label){
          const r=layerNode.renderer;
          if(r?.type==="unique-value"){
            const info=getUVInfo(r,f.attributes);
            if(info) label=info.label ?? String(info.value ?? (info.values||[]).join(", "));
          }else if(r?.type==="class-breaks" && r.field){
            const v=Number(f.attributes?.[r.field]);
            if(!Number.isNaN(v)){
              const info=(r.classBreakInfos||[]).find(b=>{
                const min=(b.minValue==null?-Infinity:b.minValue), max=(b.maxValue==null?Infinity:b.maxValue);
                return v>=min && v<=max;
              });
              label=info?.label ?? (info ? `${info.minValue ?? ""} - ${info.maxValue ?? ""}` : null);
            }
          }
        if(!label) label=r?.label || layerNode.title || guessLabelFromAttrs(f.attributes) || "Class";
        }
        const sw=await swatchHTML(sym);
        if(!itemMap.has(label)) itemMap.set(label,{label,swatchHTML:sw});
      }
      if(!itemMap.size){
        try{
          const r=layerNode.renderer;
          const sym=r?.symbol || r?.defaultSymbol || layerNode.symbol;
          if(sym){
            const sw=await swatchHTML(sym);
            itemMap.set(layerNode.title||"Layer",{label:layerNode.title||"Layer",swatchHTML:sw});
          }
        }catch{}
      }
      return {items:[...itemMap.values()]};
    }
    async function legendFromRendererAllItems(layerNode){
      const r=layerNode?.renderer;
      if(!r) return {items:[]};
      const itemMap=new Map();
      const pushItem=async(label,symbol)=>{
        if(!label || itemMap.has(label)) return;
        if(!symbol) return;
        const sw=await swatchHTML(symbol);
        itemMap.set(label,{label,swatchHTML:sw});
      };
      if(r.type==="unique-value"){
        const infos=[
          ...(r.uniqueValueInfos||[]),
          ...((r.uniqueValueGroups||[]).flatMap(g=>g.uniqueValueInfos||[]))
        ];
        for(const info of infos){
          const label=String(info.label ?? info.value ?? (Array.isArray(info.values)? info.values.join(", "): "Class"));
          await pushItem(label, info.symbol || r.defaultSymbol || r.symbol);
        }
        if(!itemMap.size){
          await pushItem(r.label || layerNode.title || "Layer", r.defaultSymbol || r.symbol);
        }
      }else if(r.type==="class-breaks"){
        for(const info of (r.classBreakInfos||[])){
          const label=String(info.label ?? `${info.minValue ?? ""} - ${info.maxValue ?? ""}`);
          await pushItem(label, info.symbol || r.defaultSymbol || r.symbol);
        }
        if(!itemMap.size){
          await pushItem(r.label || layerNode.title || "Layer", r.defaultSymbol || r.symbol);
        }
      }else{
        await pushItem(r.label || layerNode.title || "Layer", r.symbol || r.defaultSymbol);
      }
      return {items:[...itemMap.values()]};
    }
    /* ---------------- HARD-WIRED MATCHING ---------------- */
    const HARDWIRED = {
      bushfire: [
        /bush\s*fire/i, /bushfire/i, /bush-?fire/i, /wild\s*fire/i, /bpa\b/i,
        /bushfire\s*prone/i, /bushfire\s*hazard/i, /qfes/i
      ],
      ffdi: [
        /\bffdi\b/i, /fire\s*danger\s*index/i, /forest\s*fire\s*danger\s*index/i
      ],
      noise: [
        /transport\s*noise\s*corridor/i, /tnc\b/i, /state.*road.*noise/i,
        /road.*traffic.*noise/i, /tmr.*noise/i, /acoustic.*corridor/i
      ]
    };
    function strHay(node){ return ((node.title||"")+" "+nodePath(node)+" "+(node.url||"")).toLowerCase(); }
    function leafDisplayNodes(root){
      const out=[];
      const visit=(n)=>{
        const kids=(kidsOf(n)||[]);
        if(kids.length){ kids.forEach(visit); }
        else{ if("visible" in n) out.push(n); }
      };
      visit(root);
      return out;
    }
    function collectLeafDisplayNodesByPredicate(pred, {includeDNT=false, leafFilter=null}={}){
      const out=[], seen=new Set();
      const pushUnique=(node)=>{
        if(!node || !("visible" in node)) return;
        if(leafFilter && !leafFilter(node)) return;
        const key=nodePath(node)||node.id||node.title||"node";
        if(seen.has(key)) return;
        seen.add(key);
        out.push(node);
      };
      walkAny(view.map,(n,underDNT)=>{
        if(!includeDNT && underDNT) return;
        if(isSuppressedUtility(n)) return;
        const t=n.title||"", p=nodePath(n), id=n.id||"", tg=n.portalItem?.tags||[];
        if(!pred(n,t,p,id,tg)) return;
        const kids=kidsOf(n)||[];
        if(kids.length){ leafDisplayNodes(n).forEach(pushUnique); }
        else{ pushUnique(n); }
      });
      return out;
    }
    function isFFDIDisplayNode(node){
      return HARDWIRED.ffdi.some(rx=>rx.test(strHay(node)));
    }
    function isBrisbaneBushfireLayer(node){
      return node===brisbaneBushfireLayer || /services2\.arcgis\.com\/dEKgZETqwmDAh1rP\/ArcGIS\/rest\/services\/Bushfire_overlay\/FeatureServer(?:\/0)?\b/i.test(String(node?.url||""));
    }
    function isSppBushfireLayer(node){
      return node===sppBushfireLayer || node===sppBushfireDrawLayer || node?.parent===sppBushfireLayer || /arcgis\.spp-dams\.wspdigitaltesting\.com\/arcgis\/rest\/services\/SPP\/SPP_Data\/MapServer(?:\/77)?\b/i.test(String(node?.url||""));
    }
    function isManagedBushfireLayer(node){
      return isBrisbaneBushfireLayer(node) || isSppBushfireLayer(node);
    }
    function keepLegacyBushfireHidden(node){
      if(!node || isManagedBushfireLayer(node)) return false;
      const t=node.title||"", p=nodePath(node);
      if(!isBushfire(t,p)) return false;
      if("visible" in node){ try{ node.visible=false; }catch(e){} }
      if("listMode" in node){ try{ node.listMode="hide"; }catch(e){} }
      return true;
    }
    function getSppBushfireDisplayNode(){
      try{
        return sppBushfireLayer.findSublayerById?.(77) || sppBushfireLayer.sublayers?.find?.(s=>Number(s.id)===77) || sppBushfireLayer.sublayers?.toArray?.().find(s=>Number(s.id)===77) || sppBushfireLayer;
      }catch{ return sppBushfireLayer; }
    }
    function ensureSppBushfireLayer(){
      try{
        const map=view?.map||webmap;
        if(!map?.layers) return;
        const ensureLayer=(layer)=>{
          if(!layer) return;
          let has=false;
          try{ has=typeof map.layers.includes==="function" ? map.layers.includes(layer) : false; }catch{}
          if(!has) map.add(layer);
        };
        ensureLayer(brisbaneBushfireLayer);
        ensureLayer(sppBushfireLayer);
        ensureLayer(sppBushfireDrawLayer);
        try{ map.reorder(brisbaneBushfireLayer, Math.max(0, map.layers.length-3)); }catch{}
        try{ map.reorder(sppBushfireLayer, Math.max(0, map.layers.length-2)); }catch{}
        try{ map.reorder(sppBushfireDrawLayer, Math.max(0, map.layers.length-1)); }catch{}
        try{ if(typeof map.layers.includes==="function" && map.layers.includes(selLayer)) map.reorder(selLayer, Math.max(0, map.layers.length-1)); }catch{}
      }catch{}
    }
    function collectAllBushfireDisplayNodes(){
      ensureSppBushfireLayer();
      return [brisbaneBushfireLayer,getSppBushfireDisplayNode(),sppBushfireDrawLayer];
    }
    function collectAllFFDIDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=>{
        const hay=strHay(n);
        return HARDWIRED.ffdi.some(rx=>rx.test(hay));
      },{includeDNT:true});
    }
    function collectAllNoiseDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=>{
        const hay=strHay(n);
        return HARDWIRED.noise.some(rx=>rx.test(hay)) || isNoise(t,p);
      },{includeDNT:true});
    }
    /* ---------------- Flood detection + FloodWise helpers ---------------- */
    const isFlood = (t,p="") => /\bflood\b/i.test(inText(t,p)) ||
      /\boverland\s*flow\b/i.test(inText(t,p)) ||
      /\bstorm\s*tide\b/i.test(inText(t,p)) ||
      /\bbrisbane\s*river\b/i.test(inText(t,p)) ||
      /\bflood\s*risk\s*overall\b/i.test(inText(t,p));
    function collectAllFloodDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=>{
        const hay = strHay(n);
        return /\bflood\b|overland\s*flow|storm\s*tide|brisbane\s*river|flood\s*risk\s*overall/i.test(hay) || isFlood(t,p);
      },{includeDNT:true});
    }
    // Property holding datasets
    const ODS = "https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/property-boundaries-holding/records";
    const HOLDING_FS = "https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/property_boundaries_holding/FeatureServer/0/query";
    const LOTPLAN_FALLBACK_URLS = [
      // Addresses (points) first to avoid projection issues
      "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/0",
      // Cadastral polygons second
      "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4",
      // BCC fallback
      "https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/property_boundaries_parcel/FeatureServer/0"
    ];
    const BCC_ODS_BASE = "https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets";
    const BCC_ODS_LOTPLAN_DATASETS = [
      { id: "sealed-plan-boundaries", title: "Sealed Plan boundaries (BCC Open Data)" },
      { id: "property-boundaries-parcel", title: "Property boundaries - Parcel (BCC Open Data)" }
    ];
    const _odsSchemaCache = new Map();
    const warmFloodwiseImages=new Set();
    function warmFloodwiseReport(url){
      if(!url) return;
      try{
        const req=fetch(url,{mode:"no-cors",cache:"no-store"});
        if(req && typeof req.catch==="function"){
          req.catch(()=>warmFloodwiseViaImage(url));
        }
      }catch{
        warmFloodwiseViaImage(url);
      }
    }
    function warmFloodwiseViaImage(url){
      try{
        const img=new Image();
        img.decoding="async";
        img.referrerPolicy="no-referrer";
        img.src=url;
        warmFloodwiseImages.add(img);
        const clear=()=>warmFloodwiseImages.delete(img);
        img.onload=clear;
        img.onerror=clear;
        setTimeout(clear,20000);
      }catch{}
    }
    async function _odsFetch(url){
      const res = await fetch(url, {mode:"cors"});
      if(!res.ok) throw new Error("ODS fetch failed: "+res.status);
      return await res.json();
    }
    function _wktOfExtent(ext){
      const ring = [[ext.xmin,ext.ymin],[ext.xmin,ext.ymax],[ext.xmax,ext.ymax],[ext.xmax,ext.ymin],[ext.xmin,ext.ymin]]
        .map(([x,y])=>`${x} ${y}`).join(",");
      return `POLYGON((${ring}))`;
    }
    function _extractHolding(rec){
      if(!rec) return null;
      const keys = Object.keys(rec);
      const k = keys.find(k=>/holding(_?id)?$/i.test(k))
        || keys.find(k=>/property(_?id)?$/i.test(k))
        || keys.find(k=>/holding/i.test(k));
      if(!k) return null;
      const val = rec[k];
      return val==null || val==="" ? null : val;
    }
    function plainGeometry(geom){
      if(!geom) return null;
      if(typeof geom.toJSON === "function"){
        try{ return geom.toJSON(); }catch{}
      }
      try{ return JSON.parse(JSON.stringify(geom)); }catch{}
      return null;
    }
    function guessGeometryType(g){
      if(!g) return null;
      if(g.rings) return "esriGeometryPolygon";
      if(g.paths) return "esriGeometryPolyline";
      if(typeof g.x === "number" && typeof g.y === "number") return "esriGeometryPoint";
      if(typeof g.xmin === "number" && typeof g.ymin === "number") return "esriGeometryEnvelope";
      return null;
    }
    async function fetchHoldingViaFeatureService(geom){
      const plain = plainGeometry(geom);
      if(!plain) return null;
      const geometryType = guessGeometryType(plain) || "esriGeometryPolygon";
      const sr = plain.spatialReference?.wkid || 4326;
      const params = new URLSearchParams({
        f: "json",
        returnGeometry: "true",
        outFields: "PROPERTY_ID",
        spatialRel: "esriSpatialRelIntersects",
        geometryType,
        inSR: String(sr),
        outSR: String(sr),
        resultRecordCount: "5"
      });
      params.set("geometry", JSON.stringify(plain));
      const res = await fetch(HOLDING_FS, {
        method: "POST",
        mode: "cors",
        headers: {"Content-Type":"application/x-www-form-urlencoded"},
        body: params
      });
      if(!res.ok) throw new Error("Holding FS query failed: "+res.status);
      const json = await res.json();
      const features = json?.features || [];
      if(!features.length) return null;
      if(geometryType === "esriGeometryPolygon" && typeof geometryEngine?.intersect === "function"){
        let bestId = null;
        let bestArea = -1;
        for(const f of features){
          const id = f?.attributes?.PROPERTY_ID ?? f?.attributes?.property_id ?? null;
          if(id == null || !f?.geometry) continue;
          try{
            const inter = geometryEngine.intersect(geom, f.geometry);
            const area = inter ? Math.abs(geometryEngine.planarArea(inter, "square-meters") || 0) : 0;
            if(area > bestArea){ bestArea = area; bestId = id; }
          }catch{}
        }
        if(bestId != null) return bestId;
      }
      const attrs = features?.[0]?.attributes;
      const id = attrs?.PROPERTY_ID ?? attrs?.property_id ?? null;
      return id==null ? null : id;
    }
    async function resolveHoldingViaOds(geom){
      let candidate = null;
      const tryFetch = async(whereClause)=>{
        const q = `${ODS}?limit=1&where=${whereClause}`;
        const j = await _odsFetch(q);
        return _extractHolding(j?.results?.[0]);
      };
      if(geom){
        try{
          const cen = centroidOf(geom);
          if(cen){
            candidate = await tryFetch(`distance(geo_point_2d,geopoint'${cen.longitude} ${cen.latitude}')<5`);
            if(candidate) return String(candidate);
          }
        }catch{}
      }
      if(geom?.extent){
        try{
          const wkt = _wktOfExtent(geom.extent);
          candidate = await tryFetch(`intersects(geo_shape,geom'${encodeURIComponent(wkt)}')`);
          if(candidate) return String(candidate);
        }catch{}
      }
      return null;
    }
    async function resolveFloodwiseHolding({geom}){
      if(!geom) return null;
      try{
        const fsHolding = await fetchHoldingViaFeatureService(geom);
        if(fsHolding) return String(fsHolding);
      }catch{}
      try{
        const fallback = await resolveHoldingViaOds(geom);
        if(fallback) return String(fallback);
      }catch{}
      return null;
    }
    function buildFWPRUrl(holdingId){
      return holdingId ? `https://fwpr.brisbane.qld.gov.au/?holding=${encodeURIComponent(holdingId)}` : null;
    }
    /* ---------------- Screenshot plumbing ---------------- */
    function reportScaleText(){
      const scale = Number(view?.scale);
      return Number.isFinite(scale) && scale > 0 ? `Scale 1:${Math.round(scale).toLocaleString()}` : "";
    }
    function withReportScale(shot){
      if(shot && !shot.scaleText) shot.scaleText = reportScaleText();
      return shot;
    }
    async function takeReportScreenshot(options){
      const shot = await view.takeScreenshot(options);
      return withReportScale(shot);
    }
    function reportScaleHTML(shot){
      const text = shot?.scaleText || "";
      return text ? `<div class="map-scale">${htmlEsc(text)}</div>` : "";
    }
    const ancestors=node=>{const out=[]; let p=node?.parent; while(p){out.push(p); p=p.parent;} return out;};
    const owningLayer=node=>{let c=node; while(c && c.type==="sublayer") c=c.parent; return c && c.type!=="sublayer" ? c : null;};
    async function awaitRenderFor(nodes){
      const layers=[...new Set(nodes.map(n=>owningLayer(n)).filter(Boolean))];
      const views=[]; for(const L of layers){ try{views.push(await view.whenLayerView(L));}catch{} }
      const renderTimeout = renderTimeoutMs();
      const idleExtra = currentReportOptions?.fast ? 80 : 120;
      if(views.length){ try{await withTimeout(reactiveUtils.whenOnce(()=>views.every(v=>v.updating===false)), renderTimeout, "layer render wait");}catch{} }
      try{ await withTimeout(waitViewIdle(idleExtra), renderTimeout, "view idle"); }catch{}
    }
    async function sumCounts(nodes,geom){ let t=0; for(const n of nodes){ t+=await countFeatures(n,geom); } return t; }
    function saveVisibility(root){ const map=new Map(); walkAny(root,(n)=>{ if("visible"in n){ map.set(nodePath(n),{vis:!!n.visible,op:n.opacity,min:n.minScale,max:n.maxScale,blend:n.blendMode,labels:n.labelsVisible}); } }); return map; }
    function restoreVisibility(root,snap){ walkAny(root,(n)=>{ if("visible"in n){ const k=nodePath(n); if(snap.has(k)){ const s=snap.get(k); try{n.visible=s.vis;}catch{} if("opacity"in n && s.op!==undefined){ try{n.opacity=s.op;}catch{} } if("blendMode"in n && s.blend!==undefined){ try{n.blendMode=s.blend;}catch{} } if("labelsVisible" in n && s.labels!==undefined){ try{n.labelsVisible=s.labels;}catch{} } try{n.minScale=s.min;n.maxScale=s.max;}catch{} } } }); }
    async function screenshotFor(nodes,title,lotGeom,legendOnLot=false,{forceAllVisible=false,legendUseExtent=false,legendAllRendererItems=false}={}){
      if(!nodes?.length || !lotGeom) return null;
      const present=forceAllVisible ? [...nodes] : [];
      if(!forceAllVisible){ for(const n of nodes){ if(await countFeatures(n,lotGeom)>0) present.push(n); } }
      if(!present.length && !forceAllVisible) return null;
      const visSnap=saveVisibility(view.map), scaleSnap=new Map(), opSnap=new Map(), blendSnap=new Map();
      try{
        return await withViewOnGeom(lotGeom, async ()=>{
          walkAny(view.map,(n)=>{
            if(!("visible"in n)) return;
            if(underDNTChain(n)) return;
            if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
          });
          enforceDNTVisibleInMap();
          try{ selLayer.visible=true; }catch{}
          const targets = present.length ? present : nodes;
          for(const n of targets){
            for(const a of [n,...ancestors(n)]){
              if(!("visible"in a)) continue;
              try{ a.visible=true; }catch{}
              if("minScale"in a || "maxScale"in a){
                if(!scaleSnap.has(a)) scaleSnap.set(a,{min:a.minScale,max:a.maxScale});
                try{ a.minScale=0; a.maxScale=0; }catch{}
              }
            }
            if("blendMode"in n){ if(!blendSnap.has(n)) blendSnap.set(n,n.blendMode); }
            if("opacity"in n){ if(!opSnap.has(n))    opSnap.set(n,n.opacity); }
          }
          await setScreenshotPropertyBoundary(lotGeom);
          if(targets.some(isSppBushfireLayer)) await refreshSppBushfireGraphics();
          await awaitRenderFor(targets);
          await waitViewIdle(80);
          const shotOpts = getShotOptions();
          let shot=null;
          try{
            shot=await withTimeout(
              takeReportScreenshot(shotOpts),
              SCREENSHOT_TIMEOUT_MS,
              "screenshot"
            );
          }catch(e){
            console.warn("screenshot timeout", e);
          }
          if(!shot) return null;
          let legendGeom=lotGeom;
          if(legendUseExtent && view?.extent){ legendGeom=view.extent; }
          else if(!legendOnLot){ try{ const onScr=geometryEngine.intersect(lotGeom,view.extent); if(onScr) legendGeom=onScr; }catch{} }
          const legendParts=[];
          const legendLabels=[];
          for(const n of targets){
            if(underDNTChain(n)) continue;
            if(typeof n.queryFeatures!=="function" && typeof n.queryFeatureCount!=="function") continue;
            try{
              const res=legendAllRendererItems
                ? await withTimeout(legendFromRendererAllItems(n), QUERY_TIMEOUT_MS, "legend build")
                : await withTimeout(legendFromRendererUsingFeatures(n,legendGeom), QUERY_TIMEOUT_MS, "legend build");
              const items=res?.items||[];
              if(items.length){
                for(const item of items){
                  if(item?.label) legendLabels.push(String(item.label));
                }
                const inner=items.map(i=>`<div class="row">${i.swatchHTML}${i.label.replace(/&/g,"&amp;")}</div>`).join("");
                legendParts.push(`<div style="margin-bottom:6px"><b>${(n.title||"Layer").replace(/&/g,"&amp;")}</b><div class="leg" style="margin-top:4px">${inner}</div></div>`);
              }
            }catch{}
          }
          const count=await sumCounts(nodes,lotGeom);
          const hasNeighbourhoodPlan=/neighbou?rhood\s*plan/i.test(title||"");
          let schemeLink=buildPlanningSchemeLink(title);
          if(hasNeighbourhoodPlan && legendLabels.length){
            for(const lbl of legendLabels){
              const alt=neighbourhoodPlanUrlFromTitle(lbl);
              if(alt){ schemeLink=alt; break; }
            }
          }
          return {
            title,
            id:"rpt-"+slug(title),
            dataUrl:shot.dataUrl,scaleText:shot.scaleText,
            legendHTML:legendParts.join(""),
            count,
            schemeLink
          };
        });
      } finally {
        for(const [n,op] of opSnap){ try{n.opacity=op;}catch{} }
        for(const [n,bl] of blendSnap){ try{n.blendMode=bl;}catch{} }
        for(const [n,sc] of scaleSnap){ try{n.minScale=sc.min;n.maxScale=sc.max;}catch{} }
        clearScreenshotPropertyBoundary();
        restoreVisibility(view.map,visSnap); forcePropertyBoundariesVisible(view.map);
      }
    }
    function setRpt(msg,pct,doneStepId){
      const bar=$("rptBar"), m=$("rptMsg");
      if(m && msg!=null) m.textContent=msg;
      if(bar && pct!=null) bar.style.width=Math.max(0,Math.min(100,pct))+"%";
      if(doneStepId){ const step=$(doneStepId); if(step) step.classList.add("rptDone"); }
    }
    async function addMandatorySection(shots, title, collectorFn, geom, baseShot, emptyNote){
      try{
        const nodes = collectorFn();
        if(nodes.length){
          const s = await screenshotFor(nodes, title, geom, false, {forceAllVisible:true});
          if(!s){ shots.push({title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote,schemeLink:buildPlanningSchemeLink(title)}); }
          else { if((s.count||0)===0) s.note=emptyNote; shots.push(s); }
        }else{
          shots.push({title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote,schemeLink:buildPlanningSchemeLink(title)});
        }
      }catch(err){
        console.warn("Mandatory section failed:", title, err);
        shots.push({title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote+" (layer unavailable)",schemeLink:buildPlanningSchemeLink(title)});
      }
    }
    function dedupeShotsByTitle(shots, title){
      const target=(title||"").trim().toLowerCase();
      if(!target) return;
      let seen=false;
      for(let i=shots.length-1;i>=0;i--){
        const cur=(shots[i]?.title||"").trim().toLowerCase();
        if(cur===target){
          if(seen){ shots.splice(i,1); }
          else{ seen=true; }
        }
      }
    }
    let lastReportHTML=null, lastReportTitle="Property Report";
    /* ---------------- Build report ---------------- */
    $("btnPrintReport").addEventListener("click", async ()=>{
      const actions=$("rptActions");
      if(actions) actions.style.display="none";
      $("rptOverlay").style.display="grid";
      try{
        const result = await buildAndOpenReport();
        if(result && result.html){
          lastReportHTML = result.html;
          lastReportTitle = result.title || "Property Report";
          setRpt("Report ready. Choose an option below.", 100, "rptS4");
          const msg=$("rptReadyMsg"); if(msg) msg.textContent="Report ready. Choose an option below.";
          if(actions) actions.style.display="flex";
        }else{
          $("rptOverlay").style.display="none";
        }
      }catch(e){
        console.error(e);
        alert("Could not create report.");
        $("rptOverlay").style.display="none";
      }
    });
    async function buildAndOpenReport(){
      let keepAliveTimer=null;
      let wakeHeld=false;
      reportInProgress = true;
      parcelFocusJobId++;
      try{
        wakeHeld = await ensureWakeLock();
        startRenderPulse();
        keepAliveTimer = setInterval(()=>{
          try{ navigator.serviceWorker?.controller?.postMessage("ping"); }catch{}
        }, 120000);
        showLoading(true);
        setRpt("Loading map", 8);
        await mapStartupReady;
        try{ await view.when(); }catch{}
        setRpt("Locating parcel", 12);
        const isHidden = document?.visibilityState === "hidden";
        const isFastMode = isHidden;
        let maxLegendCap = isFastMode ? FAST_MAX_LEGEND_FEATURES : MAX_LEGEND_FEATURES;
        let maxOtherCap = isFastMode ? FAST_MAX_OTHER : MAX_OTHER_LAYERS;
        let heavyOverlayLoad = false;
        currentReportOptions = { fast: isFastMode, maxLegend: maxLegendCap, maxOther: maxOtherCap };
        let geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Brisbane City Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry; ({lotText,areaText,classText,addressText,councilText}=lastParcelInfo);
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){ const info=parcelInfoFromFeature(probe); geom=probe.geometry; ({lotText,areaText,classText,addressText,councilText}=info); lastParcelInfo={feature:probe,...info}; }
        }
        setRpt("Parcel located", 18, "rptS1");
        if(geom){
          setRpt("Resolving address...", 25);
          try{ addressText=await resolveBestAddress(geom,lastParcelInfo.feature,lastParcelInfo.addressText); }catch{}
          setRpt("Address resolved", 35, "rptS2");
          lastParcelInfo.addressText = addressText || lastParcelInfo.addressText;
        }
        setRpt("Rendering base map", 42);
        let baseShot = null;
        const captureBaseShot = async()=>{
          const visSnap = saveVisibility(view.map);
          const baseBasemap = view.map?.basemap;
          try{
            try{
              if(view.map?.basemap) view.map.basemap = "satellite";
            }catch{}
            walkAny(view.map,(n)=>{
              if(!("visible" in n)) return;
              if(n.type==="feature" || n.type==="sublayer"){
                if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
              }
            });
            enforceDNTVisibleInMap();
            try{ selLayer.visible=true; }catch{}
            await setScreenshotPropertyBoundary(geom);
            await waitViewIdle(120);
            try{ await withTimeout(waitViewIdle(280), SCREENSHOT_TIMEOUT_MS, "base idle settle"); }catch{}
            try{ await withTimeout(waitViewIdle(280), SCREENSHOT_TIMEOUT_MS, "base idle settle 2"); }catch{}
            return await withTimeout(
              takeReportScreenshot(getShotOptions()),
              SCREENSHOT_TIMEOUT_MS,
              "base screenshot"
            );
          } finally {
            clearScreenshotPropertyBoundary();
            restoreVisibility(view.map,visSnap); forcePropertyBoundariesVisible(view.map);
            try{
              if(baseBasemap) view.map.basemap = baseBasemap;
            }catch{}
          }
        };
        try{
          baseShot = geom
            ? await withViewOnGeom(geom, captureBaseShot)
            : await captureBaseShot();
        }catch(e){
          console.warn("base map screenshot skipped", e);
        }
        if(!baseShot){ baseShot = {dataUrl:BLANK_PNG, legendHTML:"", count:0}; }
        setRpt("Collecting overlays", 55);
        const cats = geom ? await (async()=>{
          const out={zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],bushfire:[],others:[]};
          const arr=[]; walkAny(view.map,(n,underDNT)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function") && !underDNT) arr.push(n); });
          const cap=(list,max)=> (max>0 && list.length>max) ? list.slice(0,max) : list;
          for(const n of arr){
            try{
              if(isSppBushfireLayer(n)) continue;
              await n.load();
              const cnt=await countFeatures(n,geom); if(!cnt) continue;
              const t=n.title||"", p=nodePath(n);
              if(isZoning(t,p)) out.zoning.push(n);
              else if(isUtility(t,n.id,n.portalItem?.tags||[]) || isWaterOrSewer(p)) out.utilities.push(n);
              else if(isAcid(t,p)) out.acid.push(n);
              else if(isNoise(t,p)) out.noise.push(n);
              else if(isTransport(t,p)) out.transport.push(n);
              else if(isAir(t,p)) out.air.push(n);
              else if(isBushfire(t,p)) continue;
              else out.others.push(n);
            }catch{}
          }
          const overlayHits = out.zoning.length + out.utilities.length + out.acid.length + out.transport.length + out.air.length + out.noise.length + out.bushfire.length + out.others.length;
          heavyOverlayLoad = (!isFastMode) && overlayHits >= HEAVY_OVERLAY_THRESHOLD;
          if(heavyOverlayLoad){
            maxLegendCap = Math.min(maxLegendCap, HEAVY_MAX_LEGEND_FEATURES);
            maxOtherCap = Math.min(maxOtherCap, HEAVY_MAX_OTHER);
          }
          const zoningCap = heavyOverlayLoad ? HEAVY_MAX_ZONING_LAYERS : MAX_ZONING_LAYERS;
          const utilityCap = heavyOverlayLoad ? HEAVY_MAX_UTILITY_LAYERS : MAX_UTILITY_LAYERS;
          const transportCap = heavyOverlayLoad ? HEAVY_MAX_TRANSPORT_LAYERS : MAX_TRANSPORT_LAYERS;
          out.zoning = cap(out.zoning, zoningCap);
          out.utilities = cap(out.utilities, utilityCap);
          out.transport = cap(out.transport, transportCap);
          out.others = cap(out.others, maxOtherCap);
          return out;
        })() : {zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],others:[]};
        currentReportOptions = { fast: isFastMode || heavyOverlayLoad, maxLegend: maxLegendCap, maxOther: maxOtherCap };
        // --- Detect flood overlays and resolve FloodWise link ---
        let hasFlood = false;
        let floodFWPRUrl = null;
        try{
          const floodNodes = collectAllFloodDisplayNodes();
          const floodCount = geom ? await sumCounts(floodNodes, geom) : 0;
          hasFlood = floodCount > 0;
        }catch{ hasFlood = false; }
        if(hasFlood && geom){
          try{
            const lotplan = (lastParcelInfo?.lotText||"").toUpperCase(); // "12/SP12345"
            const holding = await resolveFloodwiseHolding({geom});
            floodFWPRUrl = buildFWPRUrl(holding);
            if(floodFWPRUrl){ warmFloodwiseReport(floodFWPRUrl); }
          }catch{}
        }
        const shots=[];
        const skipMinor = isFastMode || heavyOverlayLoad;
        const tasks=[
          ["Zoning", async()=>{
            if(cats.zoning.length){
              let zoneName = await resolveZoneLabel(cats.zoning, geom);
              if(!zoneName){
                try{
                  const res = await withTimeout(legendFromRendererUsingFeatures(cats.zoning[0], geom), QUERY_TIMEOUT_MS, "zoning legend label");
                  const firstLabel = res?.items?.[0]?.label;
                  if(firstLabel) zoneName = String(firstLabel).trim();
                }catch{}
              }
              if(!zoneName && cats.zoning[0]?.title) zoneName = cats.zoning[0].title;
              if(zoneName) lastZoneLabel = zoneName;
              const s=await screenshotFor(cats.zoning,"Zoning",geom,true);
              if(s){
                s.schemeLink = buildPlanningSchemeLink(zoneName || "Zoning",{zoneLabel:zoneName||undefined});
                shots.push(s);
              }
            }
          }],
          // Flood Awareness snapshot
          ["Flood Awareness", async()=>{
            const all = collectAllFloodDisplayNodes();
            if(all.length && geom){
              const s = await screenshotFor(all,"Flood Awareness",geom,false,{forceAllVisible:true});
              if(s) shots.push(s);
            }
          }],
          ["Bushfire Hazard", async()=>{ await addMandatorySection(shots,"Bushfire Hazard - Brisbane City Plan 2014",collectAllBushfireDisplayNodes,geom,baseShot,"No Brisbane City Plan bushfire overlay intersects this parcel"); }],
          ["FFDI", async()=>{ await addMandatorySection(shots,"FFDI",collectAllFFDIDisplayNodes,geom,baseShot,"No FFDI layer"); }],
          ["Utilities", async()=>{ const all=collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=> isUtility(t,id,tg)||isWaterOrSewer(p),{includeDNT:true}); if(all.length){ const s=await screenshotFor(all,"Utilities",geom,false,{forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); } } ],
          ["Acid overlays", async()=>{ if(skipMinor) return; if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); }}],
          ["Transport", async()=>{ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); }}],
          ["Air quality", async()=>{ if(skipMinor) return; if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); }}],
          ["Transport Noise Corridor", async()=>{ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,baseShot,"No noise Lv"); }],
          ["Other overlays", async()=>{
            if(skipMinor) return;
            let added=0;
            const maxOther = maxOtherCap;
            for (const n of cats.others) {
              if(added>=maxOther) break;
              const t=n.title||"", p=nodePath(n);
              const hay=strHay(n);
              if (HARDWIRED.ffdi.some(rx=>rx.test(hay)) || isBushfire(t,p) || isNoise(t,p)) continue;
              const s=await screenshotFor([n], n.title || "Overlay", geom);
              if (s){ shots.push(s); added++; }
            }
          }]
        ];
        for(let i=0;i<tasks.length;i++){
          const [name,fn]=tasks[i];
          setRpt(`Rendering ${name}`, 55 + Math.round(((i+1)/tasks.length)*30));
          await fn();
        }
        dedupeShotsByTitle(shots,"Transport Noise Corridor");
        setRpt("Overlays rendered", 87, "rptS3");
// === Pick a title for the exported doc ===
const makeDocTitle = () => {
  const hasAddr = addressText && addressText !== "--" && !/Address unavailable/i.test(addressText);
  const base = hasAddr
    ? addressText
    : (lotText && lotText !== "--" ? `Lot ${lotText}, ${councilText}` : "Property Report - Brisbane Interactive Mapping");
  // sanitize so browsers use it cleanly for Save as PDF filenames
  return String(base)
    .replace(/[\/\\:*?"<>|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};
const docTitle = makeDocTitle();
setRpt("Composing document", 93);
        const now=new Date();
        const fmt=d=> d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
        const esc=htmlEsc;
        const logoSrc="./images/Flavour icon.png";
        const html=[];
        html.push("<!doctype html><meta charset='utf-8'><title>", esc(docTitle), "</title>");
        html.push("<style>",
          ":root{--brand:#a70b13;--brand2:#7f0e15;--brand3:#c1121f;--bg:#f3f5f7;--ink:#0b0d12;--border:#e1e3e6;--radius:14px;--shadow:0 10px 30px rgba(16,21,28,.08);--panel:#ffffff;--panel-2:#f8f9fb;--muted:#5b6470;--soft:#f8f0f1}",
          "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:18px;color:var(--ink);background:radial-gradient(1200px 600px at 100% -10%, #fde9ea 0%, rgba(253,233,234,0) 60%), var(--bg);line-height:1.45}",
          "a{color:var(--brand2)}",
          ".card{border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin:10px 0;background:var(--panel);box-shadow:var(--shadow)}",
          ".brandbar{display:flex;align-items:center;gap:12px;padding:14px 16px;margin:-14px -14px 14px -14px;color:#fff;background:linear-gradient(90deg,var(--brand),var(--brand2));border-radius:var(--radius) var(--radius) 0 0;box-shadow:var(--shadow)}",
          ".brandbar img{width:28px;height:28px;border:1px solid #ddd;background:#fff;border-radius:6px}",
          ".brandbar h1{margin:0;font-size:18px;font-weight:800;letter-spacing:.2px}",
          ".brandbar .muted{margin-left:auto;opacity:.95;font-weight:600}",
          ".rpt-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px}",
          ".propmap{grid-column:1 / -1}",
          ".propmap-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:16px;align-items:start}",
          ".badge-pill{display:inline-block;border:1px solid var(--border);border-radius:999px;padding:3px 9px;margin:3px 6px 0 0;background:#fff;font-size:11px;font-weight:600;color:var(--ink)}",
          ".kv{margin-top:8px;font-size:14px;color:var(--ink)}.kv div{margin:4px 0}",
          "img.map{display:block;width:auto;max-width:100%;height:auto;border:1px solid #e6e8ec;border-radius:12px;box-shadow:0 6px 14px rgba(16,21,28,.08);background:#fff;margin:0}",
          ".map-scale{margin-top:6px;font-size:12px;font-weight:700;color:var(--muted,#5b6470);letter-spacing:0}",
          ".section-title{margin:0 0 8px;font-size:16px;letter-spacing:.2px;color:var(--brand2)}",
          ".section-title:after{content:\"\";display:block;width:36px;height:3px;margin-top:6px;border-radius:999px;background:linear-gradient(90deg,var(--brand),var(--brand2))}",
          ".overlay-header{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid #edf0f3}",
          ".overlay-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start}",
          ".backbtn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(167,11,19,.22);border-radius:999px;padding:5px 12px;font-size:11px;font-weight:700;color:var(--brand2);text-decoration:none;background:#fff;box-shadow:0 1px 0 rgba(16,21,28,.05)}.backbtn:hover{background:#fff0f1;border-color:var(--brand)}",
          ".sumlist{margin:6px 0 0 18px;padding:0}.sumlist li{margin:8px 0 12px}",
          ".sumlist li::marker{color:var(--brand2)}",
          ".note{margin-top:8px;font-size:13px;color:var(--brand);font-weight:700;background:#fff4f4;border:1px solid #f3c7c7;border-radius:10px;padding:6px 10px;display:inline-block}",
          ".leg{font-size:13px;line-height:1.4;margin-top:8px}.leg .row{display:flex;align-items:center;gap:8px;margin:2px 0}",
          ".leg .swbox{display:inline-flex;align-items:center;justify-content:center;width:16px;height:14px;padding:1px;border:1px solid #9aa0a6;border-radius:4px;overflow:hidden;background:#fff}",
          ".leg .swbox img,.leg .swbox svg,.leg .swbox canvas{width:100%;height:100%;display:block;object-fit:contain}",
          ".map-legend{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;align-items:start}",
          ".map-legend .leg{margin-top:0;background:var(--panel-2);border:1px solid rgba(167,11,19,.18);border-radius:10px;padding:10px}",
          "@media (max-width: 900px){.map-legend{grid-template-columns:1fr}}",
          ".rpt-footer{margin-top:14px;padding-top:8px;border-top:1px dashed var(--border);font-size:12px;color:var(--muted)}",
          ".page-break{break-before:page;page-break-before:always}",
          ".page-break-after{break-after:page;page-break-after:always}",
          ".disclaimer{background:linear-gradient(180deg,#fff7f7 0%, #ffffff 100%);border:1px solid #f2c7c9}",
          ".disclaimer .disclaimer-lead{font-size:14px;color:#7f0e15;font-weight:600}",
          ".disclaimer-list{margin:10px 0 0 18px;color:var(--ink)}",
          ".disclaimer-list li{margin:6px 0}",
          ".disclaimer-foot{margin-top:12px;padding-top:10px;border-top:1px dashed #e6b9bc;color:#6b7280;font-size:12px}",
          "@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.card{page-break-inside:avoid}}",
          "</style>");
        html.push("<body>");
        html.push("<div class='card brandbar'><img src='",logoSrc,"' alt='Logo' style='width:28px;height:28px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/><h1>",esc((addressText && addressText!=="--") ? addressText : "Brisbane Interactive Mapping - Preliminary Report"),"</h1><div class='muted'>",fmt(now),"</div></div>");
        html.push("<div class='rpt-grid'>");
          html.push("<div class='card propmap'>",
                      "<div class='propmap-grid'>",
                        "<div>",
                          "<h2 class='section-title'>Property</h2>",
                          "<div class='badge-pill'>Lot: ",esc(lotText),"</div>",
                          "<div class='badge-pill'>Area: ",esc(areaText),"</div>",
                          "<div class='badge-pill'>Class: ",esc(classText),"</div>",
                          "<div class='kv'>",
                            "<div><b>Address:</b> ",esc(addressText),"</div>",
                            "<div><b>Council:</b> ",esc(councilText),"</div>",
                          "</div>",
                          "<div id='summary' style='margin-top:14px'>",
                            "<h2 class='section-title' style='margin-top:0'>Summary</h2>");
                            if(shots.length){
                              html.push("<ul class='sumlist'>");
                              for(const s of shots){
                                const ct=(s.count!=null)?(" ("+s.count+" feature"+(s.count===1?"":"s")+")"):"";
                                const schemeLink=s.schemeLink||buildPlanningSchemeLink(s.title);
                                const schemeHTML=schemeLink ? ` <a class='sum-link' style='font-size:12px;text-decoration:none' target='_blank' rel='noopener' href='${esc(schemeLink)}'>Planning scheme</a>` : "";
                                html.push("<li><a class='sum-link' style='color:#7a0f16;font-weight:700;text-decoration:none' href='#",s.id,"'>",esc(s.title),"</a>",ct,(s.note?(" - "+esc(s.note)):""),schemeHTML,"</li>");
                              }
                              html.push("</ul>");
                            }else{
                              html.push("<i>No overlays intersect this parcel (excluding DNT groups).</i>");
                            }
                          html.push("</div>",
                        "</div>",
                        "<div><h2 class='section-title'>Map</h2><img class='map' src='",baseShot.dataUrl,"' alt='Map'>",reportScaleHTML(baseShot),"</div>",
                      "</div>",
                      "<div class='rpt-footer'>Generated by CornerstonePlus. Confirm against the current planning scheme and authoritative datasets before relying on this report.</div>",
                    "</div>");
        html.push("</div>");
        // --- FloodWise Property Report card (if flood present) ---
        if(hasFlood){
          html.push(
            "<div class='card'>",
              "<div class='overlay-header'>",
                "<h2 class='section-title' style='margin:0'>FloodWise Property Report</h2>",
              "</div>",
              floodFWPRUrl
                ? `<p>Flood mapping affects this parcel. The FloodWise Property Report search is already running so the document is ready the moment you open it.</p>
                   <p><a href='${floodFWPRUrl}' target='_blank' rel='noopener' class='backbtn' style='font-weight:700'>Open FloodWise Report ↗</a></p>`
                : `<p>Flood mapping affects this parcel. Brisbane City Council now hosts the FloodWise Property Report inside the Flood Awareness Map, so launch that tool to generate the latest document for this property.</p>
                   <p><a href='https://fam.brisbane.qld.gov.au/?page=Map---Standard' target='_blank' rel='noopener' class='backbtn'>Open Flood Awareness Map ↗</a></p>`,
              "<div class='rpt-footer'>Use the FloodWise report for development/floor level decisions; map snapshots here are indicative only.</div>",
            "</div>"
          );
        }
        for(const s of shots){
          const schemeLink = s.schemeLink || buildPlanningSchemeLink(s.title);
          html.push("<div class='card' id='",s.id,"'>",
            "<div class='overlay-header'>",
              "<h2 class='section-title' style='margin:0'>",esc(s.title),"</h2>",
              "<div class='overlay-actions'>",
              schemeLink ? `<a class='backbtn' target='_blank' rel='noopener' href='${esc(schemeLink)}'>Open planning scheme</a>` : "",
              "<a class='backbtn' href='#summary'>Back to Summary</a>",
              "</div>",
            "</div>",
            "<div class='map-legend'>",
              "<div><img class='map' src='",s.dataUrl,"' alt='",esc(s.title),"'>",reportScaleHTML(s),"</div>",
              "<div class='leg'>", (s.note ? "<div class='note'>"+esc(s.note)+"</div>" : ""), (s.legendHTML || ""), "</div>",
            "</div>",
          "</div>");
        }
        html.push(
          "<div class='card page-break disclaimer'>",
            "<div class='overlay-header'>",
              "<h2 class='section-title' style='margin:0'>Disclaimer</h2>",
            "</div>",
            "<p class='disclaimer-lead'>This report is a high-level snapshot only and must be verified against authoritative sources.</p>",
            "<ul class='disclaimer-list'>",
              "<li>No legal, planning, building or certification advice is provided.</li>",
              "<li>Mapping layers may be sourced from third parties and can change without notice.</li>",
              "<li>Cornerstone does not guarantee the accuracy, completeness or currency of any data shown.</li>",
              "<li>You should obtain independent professional advice and confirm information with the relevant authority before acting.</li>",
              "<li>To the maximum extent permitted by law, Cornerstone disclaims liability for loss or damage arising from use of this report.</li>",
            "</ul>",
            "<div class='disclaimer-foot'><strong>Terms of Use &amp; Privacy Policy:</strong> Refer to the CornerstonePlus Terms &amp; Privacy page for full details.</div>",
          "</div>"
        );
        html.push("<div class='card rpt-footer'><img src='",logoSrc,"' alt='Logo' style='width:18px;height:18px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/> Brisbane City Council - CornerstonePlus. Indicative only.</div>");
        html.push("</body>");
        const htmlOut = html.join("");
        return {html: htmlOut, title: docTitle || "Property Report"};
      }catch(e){ console.error(e); alert("Could not create report."); return null; }
      finally{
        stopRenderPulse();
        reportInProgress = false;
        clearInterval(keepAliveTimer);
        await releaseWakeLock();
        showLoading(false);
      }
    }
    (function wireReportActions(){
      const openBtn=$("openReportBtn");
      if(openBtn){
        openBtn.addEventListener("click", ()=>{
          if(!isAccessActive()){
            setGateMessage("Session expired", "Your access window has ended. Please purchase again to open a report.");
            setGateVisible(true);
            setTimerVisible(false);
            return;
          }
          if(!lastReportHTML){ alert("Report not ready yet."); return; }
          const w=window.open("about:blank","_blank");
          if(!w){ alert("Please allow pop-ups to view the report."); return; }
          w.document.open();
          w.document.write(lastReportHTML);
          w.document.close();
          try{ w.document.title = lastReportTitle; }catch{}
          document.getElementById("rptOverlay").style.display="none";
          finalizeTokenAndLock();
        });
      }
    })();
    /* ---------------- Tabs & Home ---------------- */
    ;[["summary"],["setbacks"],["proposal"],["yield"]].forEach(([name])=>{
      const t=$("tab-"+name), p=$("panel-"+name);
      if(!t||!p) return;
      t.addEventListener("click",()=>{
        document.querySelectorAll(".tab").forEach(el=> el.setAttribute("aria-selected","false"));
        document.querySelectorAll(".panel").forEach(el=> el.classList.remove("active"));
        t.setAttribute("aria-selected","true"); p.classList.add("active");
      });
    });
    $("btnHome").addEventListener("click",()=>{
      fetch("Index.html",{method:"HEAD"}).then(()=>{ window.location.href="Index.html"; })
        .catch(()=>{
          if (history.length > 1) {
            history.back();
          } else {
            window.location.href = "./";
          }
        });
    });
    /* ---------------- POD Upload ---------------- */
    (function initPodUpload(){
      const form = $("podForm");
      const input = $("podFile");
      const statusEl = $("podStatus");
      const list = $("podResultList");
      const wrap = $("podResultWrap");
      const submitBtn = $("podSubmitBtn");
      if(!form || !input || !statusEl) return;
      const setStatus = (msg, isError=false)=>{
        statusEl.textContent = msg;
        statusEl.classList.toggle("error", !!isError);
      };
      const setBusy = busy=>{
        if(submitBtn){
          submitBtn.disabled = busy;
          submitBtn.textContent = busy ? "Uploading..." : "Upload & Import";
        }
        if(input){
          input.disabled = busy;
        }
      };
      const renderResults = (items=[])=>{
        if(!wrap || !list) return;
        if(!items.length){
          wrap.hidden = true;
          list.innerHTML = "";
          return;
        }
        wrap.hidden = false;
        list.innerHTML = items.map(sub=>{
          const lotRaw = sub.lot || "";
          const planRaw = sub.plan || "";
          const lot = htmlEsc(lotRaw || "?");
          const plan = htmlEsc(planRaw || "Unknown plan");
          const area = sub.areaSqm ? `${sub.areaSqm.toLocaleString()} sqm` : "Area N/A";
          const btn = (sub.lot && sub.plan)
            ? `<button class="pod-zoom-btn" data-lot="${attrEsc(lotRaw)}" data-plan="${attrEsc(planRaw)}">Use</button>`
            : "";
          return `<li><div class="pod-result-row">${btn}<div>Lot ${lot} on ${plan} (${area})</div></div></li>`;
        }).join("");
      };
      list?.addEventListener("click", async evt=>{
        const btn = evt.target.closest(".pod-zoom-btn");
        if(!btn) return;
        evt.preventDefault();
        let {lot, plan} = btn.dataset;
        if(!lot || !plan){
          const txt = (btn.closest(".pod-result-row")?.innerText || "").trim();
          const m = txt.match(/Lot\s+(\S+)\s+on\s+(\S+)/i);
          if(m){ lot = m[1]; plan = m[2]; }
        }
        if(!lot || !plan){
          setStatus("Missing lot/plan on selection.", true);
          return;
        }
        setBusy(true);
        setStatus(`Zooming to Lot ${lot} on ${plan}...`);
        const ok = await focusOnLotPlan(lot, plan);
        setBusy(false);
        setStatus(ok ? `Focused on Lot ${lot} on ${plan}.` : `Could not locate Lot ${lot} on ${plan} in the available parcel datasets.`, !ok);
      });
      input.addEventListener("change",()=>{
        const file = input.files && input.files[0];
        const nameEl = $("podFileName");
        if(file){
          if(nameEl) nameEl.textContent = file.name;
          setStatus(`Ready to import ${file.name}`);
        }else{
          if(nameEl) nameEl.textContent = "No file chosen";
          setStatus("Select a POD PDF to begin.");
          renderResults([]);
        }
      });
      form.addEventListener("submit", async evt=>{
        evt.preventDefault();
        if(!input.files || !input.files.length){
          setStatus("Choose a POD PDF first.", true);
          return;
        }
        const file = input.files[0];
        setBusy(true);
        setStatus("Parsing PDF locally...");
        renderResults([]);
        try{
          const text = await extractPdfText(file);
          if(!text || !text.trim()){
            throw new Error("PDF did not contain readable text.");
          }
          const subdivisions = parseSubdivisionsFromText(text);
          renderResults(subdivisions);
          const count = subdivisions.length;
          let msg = count ? `Parsed ${count} subdivision${count===1? "":"s"} locally.` : "No subdivisions detected.";
          let statusError = false;
          const focusTarget = subdivisions.find(sub=>sub.lot && sub.plan);
          if(count === 1 && focusTarget){
            const zoomed = await focusOnLotPlan(focusTarget.lot, focusTarget.plan);
            if(zoomed){
              msg += ` Zoomed to Lot ${focusTarget.lot} on ${focusTarget.plan}.`;
            }else{
              msg += ` Could not locate Lot ${focusTarget.lot} on ${focusTarget.plan} in the available parcel datasets.`;
              statusError = true;
            }
          }else if(count > 1){
            msg += " Choose a lot below to zoom.";
          }
          msg += " Upload to ArcGIS coming soon.";
          setStatus(msg, statusError);
        }catch(err){
          console.error(err);
          setStatus(err.message || "Local parsing failed", true);
        }finally{
          setBusy(false);
        }
      });
      const dropZone = $("podDropZone");
      const setFile = file=>{
        if(!file) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        const nameEl = $("podFileName");
        if(nameEl) nameEl.textContent = file.name;
        setStatus(`Ready to import ${file.name}`);
      };
      const prevent = e=>{ e.preventDefault(); e.stopPropagation(); };
      ["dragenter","dragover","dragleave","drop"].forEach(ev=>{
        dropZone?.addEventListener(ev, prevent);
      });
      dropZone?.addEventListener("dragenter", ()=> dropZone.classList.add("dragover"));
      dropZone?.addEventListener("dragleave", ()=> dropZone.classList.remove("dragover"));
      dropZone?.addEventListener("dragend", ()=> dropZone.classList.remove("dragover"));
      dropZone?.addEventListener("drop", ev=>{
        dropZone.classList.remove("dragover");
        const file = ev.dataTransfer?.files?.[0];
        if(file && file.type==="application/pdf"){
          setFile(file);
        }else{
          setStatus("Drop a PDF file.", true);
        }
      });
    })();
    /* ============================================================
       === Lot/Plan Search source (QLD) ============================
       ============================================================ */
    function normalizePlanText(p){ return String(p||"").toUpperCase().replace(/\s+/g,""); }
    function parseLotPlan(text){
      if(!text) return null;
      let s=String(text).toUpperCase();
      s=s.replace(/[,]+/g," ").replace(/\bon\b/ig," ").replace(/\blot\b/ig," ").replace(/\s+/g," ").trim();
      s=s.replace(/^\s*D(?=\s*\d)/, ""); // handle "D 6/RP732" or "D6/RP732"
      s=s.replace(/^\s*D\s+/, "");       // fallback
      s=s.trim();
      let m = s.match(/(\d+)\s*\/\s*([A-Z]{1,4}\s*\d{1,8})/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      m = s.match(/(\d+)\s+([A-Z]{1,4}\s*\d{1,8})/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      m = s.match(/([A-Z]{1,4}\s*\d{1,8})\s+(\d+)/);
      if(m) return {lot:m[2], plan:normalizePlanText(m[1])};
      m = s.match(/(\d+)([A-Z]{1,4}\s*\d{1,8})/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      return null;
    }
    let _parcelLayerCache=null;
    async function getParcelLayers(){
      if(_parcelLayerCache) return _parcelLayerCache;
      const candidates=flattenFeatureNodes();
      const layers=[];
      for(const n of candidates){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          const isPoly = n.geometryType==="polygon";
          const hasFields = hasParcelFields(n);
          if(isPoly && (looksLikeParcelLayer(n) || hasFields)){
            layers.push(n);
          }else if(!isPoly && hasFields){
            layers.push(n);
          }
        }catch{}
      }
      _parcelLayerCache=layers;
      return layers;
    }
    function escSQL(s){ return String(s).replace(/'/g,"''"); }
    function isIntegerField(f){ const t=String(f.type||"").toLowerCase(); return t.indexOf("integer")!==-1; }
    function isTextField(f){ const t=String(f.type||"").toLowerCase(); return t.indexOf("string")!==-1; }
    function sqlField(name){
      const n = String(name||"");
      return /[^A-Za-z0-9_]/.test(n) ? `"${n.replace(/"/g,'""')}"` : n;
    }
    function odsField(name){
      const n = String(name||"");
      return /[^A-Za-z0-9_]/.test(n) ? `"${n.replace(/"/g,'""')}"` : n;
    }
    function odsExtractRecords(json){
      const rows = json?.results || json?.records || json?.data || [];
      return rows.map(r=>r?.record || r).filter(Boolean);
    }
    async function getOdsFields(datasetId){
      if(_odsSchemaCache.has(datasetId)) return _odsSchemaCache.get(datasetId);
      let fields = [];
      try{
        const res = await fetch(`${BCC_ODS_BASE}/${datasetId}`);
        if(res.ok){
          const json = await res.json();
          const raw = json?.fields || json?.dataset?.fields || json?.results?.fields;
          if(Array.isArray(raw)){
            fields = raw.map(f=>f?.name || f).filter(Boolean);
          }
        }
      }catch{}
      if(!fields.length){
        try{
          const res = await fetch(`${BCC_ODS_BASE}/${datasetId}/records?limit=1`);
          if(res.ok){
            const json = await res.json();
            const rec = odsExtractRecords(json)[0];
            const attrs = rec?.fields || rec;
            if(attrs) fields = Object.keys(attrs);
          }
        }catch{}
      }
      _odsSchemaCache.set(datasetId, fields);
      return fields;
    }
    function geojsonToEsriGeometry(geo){
      if(!geo || !geo.type) return null;
      const sr = { wkid: 4326 };
      const ring = r=>r.map(pt=>[pt[0], pt[1]]);
      if(geo.type==="Point"){
        return { type:"point", x: geo.coordinates[0], y: geo.coordinates[1], spatialReference: sr };
      }
      if(geo.type==="LineString"){
        return { type:"polyline", paths:[geo.coordinates.map(pt=>[pt[0], pt[1]])], spatialReference: sr };
      }
      if(geo.type==="MultiLineString"){
        return { type:"polyline", paths: geo.coordinates.map(path=>path.map(pt=>[pt[0], pt[1]])), spatialReference: sr };
      }
      if(geo.type==="Polygon"){
        return { type:"polygon", rings: geo.coordinates.map(ring), spatialReference: sr };
      }
      if(geo.type==="MultiPolygon"){
        return { type:"polygon", rings: geo.coordinates.flatMap(poly=>poly.map(ring)), spatialReference: sr };
      }
      return null;
    }
    function projectIfNeeded(geom){
      if(!geom) return null;
      try{
        const sr = geom.spatialReference || {};
        if(view?.spatialReference?.isWebMercator && (sr.wkid===4326 || sr.wkid===84)){
          return webMercatorUtils.geographicToWebMercator(geom);
        }
      }catch{}
      return geom;
    }
    function buildOdsLotPlanWhere(fields, lot, plan){
      if(!fields || !fields.length) return null;
      const pick = (rx)=> fields.find(f=>rx.test(String(f))) || fields.find(f=>rx.test(String(f).toLowerCase()));
      const lotField = pick(/\blot\b|lotno|lot_no|lotnumber|lot_num|lotnum/i);
      const planField = pick(/\bplan\b|planno|plan_no|plan_number/i);
      const lotPlanField = pick(/lot[_-]?plan|lotplan|lot_plan/i);
      const lotU = escSQL(String(lot).toUpperCase());
      const planU = escSQL(String(plan).toUpperCase());
      const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
      const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      const clauses = [];
      if(lotPlanField){
        const f = odsField(lotPlanField);
        clauses.push(
          `${f}='${lotPlanFull}'`,
          `${f}='${lotPlanCompact}'`,
          `startswith(${f},'${lotPlanFull}')`,
          `startswith(${f},'${lotPlanCompact}')`,
          `${f} LIKE '%${lotPlanCompact}%'`
        );
      }
      if(lotField && planField){
        const lf = odsField(lotField);
        const pf = odsField(planField);
        clauses.push(`(${lf}='${lotU}' AND (${pf}='${planU}' OR ${pf} LIKE '%${planU}%'))`);
      }
      return clauses.length ? clauses.join(" OR ") : null;
    }
    function extractOdsGeometry(rec){
      if(!rec) return null;
      const g = rec.geometry || rec?.fields?.geo_shape || rec?.fields?.geometry || rec?.fields?.the_geom;
      if(g && g.type) return geojsonToEsriGeometry(g);
      const gp = rec?.fields?.geo_point_2d || rec?.fields?.geo_point || rec?.fields?.point;
      if(gp && (gp.lat != null || gp.lon != null)){
        return { type:"point", x: gp.lon ?? gp.lng, y: gp.lat, spatialReference: { wkid: 4326 } };
      }
      return null;
    }
    async function queryLotPlanFallbackOds(lot, plan){
      const results = [];
      for(const ds of BCC_ODS_LOTPLAN_DATASETS){
        try{
          const fields = await getOdsFields(ds.id);
          const where = buildOdsLotPlanWhere(fields, lot, plan);
          const params = new URLSearchParams({ limit: "10" });
          if(where){
            params.set("where", where);
          }else{
            params.set("q", `${lot}${plan} ${lot}/${plan} ${plan}`);
          }
          const url = `${BCC_ODS_BASE}/${ds.id}/records?${params.toString()}`;
          let res = await fetch(url);
          if(!res.ok && where){
            const qp = new URLSearchParams({ limit: "10", q: `${lot}${plan} ${lot}/${plan} ${plan}` });
            res = await fetch(`${BCC_ODS_BASE}/${ds.id}/records?${qp.toString()}`);
          }
          if(!res.ok) continue;
          const json = await res.json();
          const recs = odsExtractRecords(json);
          for(const rec of recs){
            const attrs = rec.fields || rec;
            let geom = extractOdsGeometry(rec);
            if(geom && !geom.spatialReference) geom.spatialReference = { wkid: 4326 };
            geom = projectIfNeeded(geom);
            if(!geom) continue;
            const g = new Graphic({ geometry: geom, attributes: attrs });
            results.push({ layer: { title: ds.title }, feature: g });
          }
          if(results.length) break;
        }catch(e){
          console.warn("ODS lot/plan fallback error:", ds.id, e?.message || e);
        }
      }
      return results;
    }
    function buildFallbackLotPlanWhere(lot, plan){
      if(!lot || !plan) return null;
      const lotU = escSQL(String(lot).toUpperCase());
      const planU = escSQL(plan.toUpperCase());
      const planCompact = escSQL(plan.toUpperCase().replace(/[^A-Z0-9]/g,""));
      const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
      const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      return [
        "(",
        `  UPPER(lot)='${lotU}'`,
        `  OR UPPER(lotplan) LIKE '%${lotPlanFull}%'`,
        `  OR REPLACE(REPLACE(REPLACE(UPPER(lotplan),' ',''),'-',''),'/','') LIKE '%${lotPlanCompact}%'`,
        ") AND (",
        `  UPPER(plan) LIKE '%${planU}%'`,
        `  OR REPLACE(REPLACE(REPLACE(UPPER(plan),' ',''),'-',''),'/','') LIKE '%${planCompact}%'`,
        `  OR REPLACE(REPLACE(REPLACE(UPPER(lotplan),' ',''),'-',''),'/','') LIKE '%${lotPlanCompact}%'`,
        ")"
      ].join("\n");
    }
    async function queryLotPlanFallback(lot, plan){
      if(!LOTPLAN_FALLBACK_URLS.length) return [];
      const results=[];
      const compact = `${lot}${plan}`.toUpperCase().replace(/[^A-Z0-9]/g,"");
      const planU = String(plan||"").toUpperCase();
      const lotU = String(lot||"").toUpperCase();
      for(const url of LOTPLAN_FALLBACK_URLS){
        const isLotplanOnly = /LandParcelPropertyFramework/gi.test(url);
        const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
        const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
        const where = isLotplanOnly
          ? [
              `UPPER(lotplan)='${lotPlanFull}'`,
              `UPPER(lotplan)='${lotPlanCompact}'`,
              `REPLACE(REPLACE(REPLACE(UPPER(lotplan),' ',''),'-',''),'/','')='${lotPlanCompact}'`
            ].join(" OR ")
          : (buildFallbackLotPlanWhere(lot, plan) || `UPPER(lotplan)='${lotPlanCompact}'`);
        try{
          const params = new URLSearchParams({
            f:"json",
            where,
            outFields:"*",
            returnGeometry:"true",
            outSR:String(view?.spatialReference?.wkid||3857),
            maxRecordCountFactor:"5"
          });
          const res = await fetch(`${url}/query`,{
            method:"POST",
            headers:{"Content-Type":"application/x-www-form-urlencoded"},
            body:params
          });
          if(!res.ok) throw new Error("Fallback lot plan query failed: "+res.status);
          const json = await res.json();
          (json.features||[]).forEach(f=>{
            const g = Graphic.fromJSON ? Graphic.fromJSON(f) : new Graphic({geometry:f.geometry,attributes:f.attributes});
            if(!g.geometry && f.geometry) g.geometry = f.geometry;
            if(g.geometry && !g.geometry.spatialReference){
              g.geometry.spatialReference = view?.spatialReference || { wkid: 102100 };
            }
            results.push({layer:{title:"Lot/Plan (Fallback)"}, feature:g});
          });
          if(results.length) break;
        }catch(e){
          console.warn("Lot/Plan fallback error:", e);
        }
      }
      // If strict queries failed, try a looser search on the main cadastre polygons
      if(!results.length){
        const cadUrl = LOTPLAN_FALLBACK_URLS.find(u=>/LandParcelPropertyFramework\/MapServer\/4/i.test(u));
        if(cadUrl){
          try{
            const whereLoose = [
              `UPPER(lotplan) LIKE '%${compact}%'`,
              `UPPER(lotplan) LIKE '%${planU}%'`,
              `UPPER(lotplan) LIKE '%${lotU}/${planU}%'`,
              `REPLACE(REPLACE(UPPER(lotplan), ' ', ''), '/', '') LIKE '%${compact}%'`
            ].join(" OR ");
            const params = new URLSearchParams({
              f:"json",
              where:whereLoose,
              outFields:"*",
              returnGeometry:"true",
              outSR:String(view?.spatialReference?.wkid||3857),
              maxRecordCountFactor:"5"
            });
            const res = await fetch(`${cadUrl}/query`,{
              method:"POST",
              headers:{"Content-Type":"application/x-www-form-urlencoded"},
              body:params
            });
            if(res.ok){
              const json = await res.json();
              (json.features||[]).forEach(f=>{
                const g = Graphic.fromJSON ? Graphic.fromJSON(f) : new Graphic({geometry:f.geometry,attributes:f.attributes});
                if(!g.geometry && f.geometry) g.geometry = f.geometry;
                if(g.geometry && !g.geometry.spatialReference){
                  g.geometry.spatialReference = view?.spatialReference || { wkid: 102100 };
                }
                results.push({layer:{title:"Lot/Plan (Fallback loose)"}, feature:g});
              });
            }
          }catch(e){
            console.warn("Lot/Plan loose fallback error:", e);
          }
        }
      }
      if(!results.length){
        try{
          const odsHits = await queryLotPlanFallbackOds(lot, plan);
          if(odsHits?.length) results.push(...odsHits);
        }catch(e){
          console.warn("ODS fallback error:", e?.message || e);
        }
      }
      return results;
    }
    function buildLotPlanWhere(layer, lot, plan){
      const flds = Array.isArray(layer.fields)?layer.fields:[];
      const lotFields = flds.filter(f=>{
        const nm = (f.name||"").toUpperCase();
        if(/LOT_AREA/.test(nm)) return false;
        return /\b(LOT|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM)\b/.test(nm) || /^LOT$/.test(nm);
      });
      // If the layer has no lot/plan fields, still allow searching by address text
      if(!lotFields.length && !flds.some(f=>/\b(PLAN|LOTPLAN|LOT_PLAN)\b/i.test(f.name||""))){
        const addrFields = flds.filter(f=>/(address|addr|street|road|locality|suburb)/i.test(String(f.name||"")));
        const term = `${lot} ${plan}`.trim();
        if(addrFields.length && term){
          const termU = escSQL(term.toUpperCase());
          return addrFields.map(f=>`UPPER(${f.name}) LIKE '%${termU}%'`).join(" OR ");
        }
      }
      const planFields = flds.filter(f=>{
        const nm = (f.name||"").toUpperCase();
        return /\b(PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT|LOT\/PLAN)\b/.test(nm);
      });
      const lotClauses=[];
      const lotNum = Number(lot);
      for(const f of lotFields){
        if(isIntegerField(f) && !Number.isNaN(lotNum)){
          lotClauses.push(`${sqlField(f.name)}=${lotNum}`);
        }else if(isTextField(f)){
          const lotU = escSQL(String(lot).toUpperCase());
          lotClauses.push(`UPPER(${sqlField(f.name)}) LIKE '%${lotU}%'`);
        }
      }
      const planClauses=[];
      const planU = escSQL(plan.toUpperCase());
      const planCompact = escSQL(plan.toUpperCase().replace(/[^A-Z0-9]/g,""));
      const planParts = String(plan||"").toUpperCase().replace(/[^A-Z0-9]/g,"").match(/^([A-Z]+)0*([0-9]+)$/);
      const planLetters = planParts ? planParts[1] : null;
      const planDigits = planParts ? planParts[2] : null;
      const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
      const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      for(const f of planFields){
        if(isTextField(f)){
          const fieldExpr = `UPPER(${sqlField(f.name)})`;
          const scrubExpr = `REPLACE(REPLACE(REPLACE(${fieldExpr},' ',''),'-',''),'/','')`;
          planClauses.push(`${fieldExpr} LIKE '%${planU}%'`);
          planClauses.push(`${scrubExpr} LIKE '%${planCompact}%'`);
          if(planLetters && planDigits){
            planClauses.push(`${fieldExpr} LIKE '%${escSQL(planLetters)}%${escSQL(planDigits)}%'`);
            planClauses.push(`${scrubExpr} LIKE '%${escSQL(planLetters)}%${escSQL(planDigits)}%'`);
          }
          if(/LOT[_ ]?PLAN|LOTPLAN|LOT_PLAN/i.test(f.name)){
            planClauses.push(`${fieldExpr} LIKE '%${lotPlanFull}%'`);
            planClauses.push(`${scrubExpr} LIKE '%${lotPlanCompact}%'`);
          }
        }
      }
      // Also allow lot/plan matching on any plan field if we have both parts
      if(planFields.length){
        const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
        const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
        for(const f of planFields){
          if(!isTextField(f)) continue;
          const fieldExpr = `UPPER(${sqlField(f.name)})`;
          const scrubExpr = `REPLACE(REPLACE(REPLACE(${fieldExpr},' ',''),'-',''),'/','')`;
          planClauses.push(`${fieldExpr} LIKE '%${lotPlanFull}%'`);
          planClauses.push(`${scrubExpr} LIKE '%${lotPlanCompact}%'`);
          if(planLetters && planDigits){
            planClauses.push(`${scrubExpr} LIKE '%${escSQL(String(lot).toUpperCase())}%${escSQL(planLetters)}%${escSQL(planDigits)}%'`);
          }
        }
      }
      const parts=[];
      if(lotClauses.length) parts.push("("+lotClauses.join(" OR ")+")");
      if(planClauses.length) parts.push("("+planClauses.join(" OR ")+")");
      if(!parts.length) return null;
      const isAddresses = /addresses/i.test(layer?.title||"");
      if(isAddresses){
        const lpField = flds.find(f=>String(f?.name||"").toLowerCase()==="lotplan");
        if(lpField && isTextField(lpField)){
          const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
          const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
          const fieldExpr = `UPPER(${sqlField(lpField.name)})`;
          const scrubExpr = `REPLACE(REPLACE(REPLACE(${fieldExpr},' ',''),'-',''),'/','')`;
          return [
            `${fieldExpr} LIKE '%${lotPlanFull}%'`,
            `${fieldExpr} LIKE '%${lotPlanCompact}%'`,
            `${scrubExpr} LIKE '%${lotPlanCompact}%'`,
            `(${parts.join(" OR ")})`
          ].join(" OR ");
        }
        return parts.join(" OR ");
      }
      return parts.join(" AND ");
    }
    async function queryLotPlanAcrossLayers(lot, plan){
      const layers = await getParcelLayers();
      const out=[];
      console.log("[LotPlan] layers", layers.map(l=>({title:l.title, id:l.id, geom:l.geometryType, hasFields:hasParcelFields(l)})));
      // Fast-path: query Addresses layer by lotplan directly (same source as summary)
      try{
        const addrLayer = layers.find(l=>/addresses/i.test(l?.title||""));
        if(addrLayer){
          const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
          const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
          const lpField = (addrLayer.fields||[]).find(f=>String(f?.name||"").toLowerCase()==="lotplan");
          const lotField = (addrLayer.fields||[]).find(f=>String(f?.name||"").toLowerCase()==="lot");
          const planField = (addrLayer.fields||[]).find(f=>String(f?.name||"").toLowerCase()==="plan");
          const whereParts = [];
          if(lpField && isTextField(lpField)){
            const fieldExpr = `UPPER(${sqlField(lpField.name)})`;
            const scrubExpr = `REPLACE(REPLACE(REPLACE(${fieldExpr},' ',''),'-',''),'/','')`;
            whereParts.push(
              `${fieldExpr}='${lotPlanFull}'`,
              `${fieldExpr}='${lotPlanCompact}'`,
              `${scrubExpr}='${lotPlanCompact}'`,
              `${fieldExpr} LIKE '%${lotPlanFull}%'`,
              `${scrubExpr} LIKE '%${lotPlanCompact}%'`,
              `${fieldExpr} LIKE '%${escSQL(String(lot).toUpperCase())}%${escSQL(String(plan).toUpperCase())}%'`,
              `${scrubExpr} LIKE '%${escSQL(String(lot).toUpperCase())}%${escSQL(String(plan).toUpperCase())}%'`
            );
          }
          if(lotField && planField){
            const lotU = escSQL(String(lot).toUpperCase());
            const planU = escSQL(String(plan).toUpperCase());
            const where2 = [
              `UPPER(${sqlField(lotField.name)})='${lotU}'`,
              `REPLACE(UPPER(${sqlField(lotField.name)}),' ','')='${lotU}'`
            ].join(" OR ");
            const where3 = [
              `UPPER(${sqlField(planField.name)})='${planU}'`,
              `REPLACE(UPPER(${sqlField(planField.name)}),' ','')='${planU}'`
            ].join(" OR ");
            whereParts.push(`((${where2}) AND (${where3}))`);
          }
          if(whereParts.length){
            const where = whereParts.join(" OR ");
            console.log("[LotPlan] where", addrLayer.title, where);
            let q = null;
            try{
              q = await addrLayer.queryFeatures({
                where,
                outFields:["*"],
                returnGeometry:true,
                maxRecordCountFactor:5
              });
            }catch(err){
              console.warn("[LotPlan] query error", addrLayer.title, err?.message || err);
            }
            console.log("[LotPlan] hits", addrLayer.title, q?.features?.length || 0, "sample", q?.features?.[0]?.attributes);
            if(!(q?.features?.length)){
              // Looser plan-only query, then filter client-side by lot/plan
              try{
                const planRaw = String(plan||"").toUpperCase();
                const parts = planRaw.replace(/[^A-Z0-9]/g,"").match(/^([A-Z]+)0*([0-9]+)$/);
                const planLetters = parts ? parts[1] : planRaw.replace(/[^A-Z]/g,"");
                const planDigits = parts ? parts[2] : planRaw.replace(/[^0-9]/g,"");
                const lpField = (addrLayer.fields||[]).find(f=>String(f?.name||"").toLowerCase()==="lotplan");
                const planField = (addrLayer.fields||[]).find(f=>String(f?.name||"").toLowerCase()==="plan");
                const fieldExprs = [];
                if(lpField) fieldExprs.push(`UPPER(${sqlField(lpField.name)})`);
                if(planField) fieldExprs.push(`UPPER(${sqlField(planField.name)})`);
                if(fieldExprs.length && planLetters && planDigits){
                  const likeLetters = escSQL(planLetters);
                  const likeDigits = escSQL(planDigits);
                  const clauses = fieldExprs.map(fe=>`(${fe} LIKE '%${likeLetters}%' AND ${fe} LIKE '%${likeDigits}%')`);
                  const whereLoose = clauses.join(" OR ");
                  console.log("[LotPlan] where loose", addrLayer.title, whereLoose);
                  const q2 = await addrLayer.queryFeatures({
                    where: whereLoose,
                    outFields:["*"],
                    returnGeometry:true,
                    maxRecordCountFactor:5
                  });
                  const feats = q2?.features || [];
                  const filtered = feats.filter(f=>matchesLotPlan(f, lot, plan));
                  console.log("[LotPlan] hits loose", addrLayer.title, filtered.length, "sample", filtered?.[0]?.attributes);
                  for(const f of filtered){
                    out.push({layer:addrLayer, feature:f});
                  }
                }
              }catch(err){
                console.warn("[LotPlan] loose query error", addrLayer.title, err?.message || err);
              }
              try{
                const sample = await addrLayer.queryFeatures({
                  where: "1=1",
                  outFields: ["lot","plan","lotplan"],
                  returnGeometry: false,
                  num: 5
                });
                console.log("[LotPlan] sample lot/plan", sample?.features?.map(f=>f.attributes));
              }catch{}
            }
            for(const f of (q.features||[])){
              const attrs = f.attributes || {};
              if(!attrs.lotplan && lotField && planField && attrs[lotField.name] != null && attrs[planField.name] != null){
                attrs.lotplan = String(attrs[lotField.name]).trim() + String(attrs[planField.name]).trim();
                f.attributes = attrs;
              }
              out.push({layer:addrLayer, feature:f});
            }
          }
        }
      }catch{}
      for(const L of layers){
        try{
          const where = buildLotPlanWhere(L, lot, plan);
          console.log("[LotPlan] where", L.title, where);
          if(L?.title && /addresses/i.test(L.title)){
            try{
              console.log("[LotPlan] fields", L.title, (L.fields||[]).map(f=>f.name));
            }catch{}
          }
          if(!where) continue;
          const q = await L.queryFeatures({
            where,
            outFields:["*"],
            returnGeometry:true,
            maxRecordCountFactor:5
          });
          for(const f of (q.features||[])){
            out.push({layer:L, feature:f});
          }
        }catch(e){ /* ignore per-layer errors */ }
      }
      if(!out.length){
        const fallback = await queryLotPlanFallback(lot, plan);
        if(fallback?.length) out.push(...fallback);
      }
      return out;
    }
    async function focusOnLotPlan(lot, plan){
      if(!lot || !plan) return false;
      try{
        showLoading(true);
        await mapStartupReady;
        await view.when();
        const lotTrim = String(lot).trim();
        const planTrim = String(plan).trim();
        console.log("[LotPlan] searching", lotTrim, planTrim);
        const pickBest = hits=>{
          if(!hits || !hits.length) return null;
          const exact = hits.find(r=>isExactLotPlan(r.feature, lotTrim, planTrim));
          if(exact) return exact;
          let best=null,bestScore=0;
          for(const r of hits){
            const s=scoreLotPlan(r.feature, lotTrim, planTrim);
            if(s>bestScore){ best=r; bestScore=s; }
          }
          if(bestScore>0 && best) return best;
          const planOnly = hits.find(r=>matchesPlanOnly(r.feature, planTrim));
          return planOnly || null;
        };
        // Try fallback first (statewide cadastre)
        const fb = await queryLotPlanFallback(lotTrim, planTrim);
        const fbBest = pickBest(fb);
        if(fbBest){
          let feat = fbBest.feature;
          if(feat?.geometry && (feat.geometry.type==="point" || feat.geometry.type==="multipoint")){
            const p = await findParcelAtPoint(feat.geometry);
            if(p) feat = p;
          }
          await focusOnParcelFeature(feat,{shouldZoom:true});
          return true;
        }
        const layerHits = await queryLotPlanAcrossLayers(lotTrim, planTrim);
        if(layerHits && layerHits.length){
          const bestLayer = pickBest(layerHits);
          if(bestLayer){
            let feat = bestLayer.feature;
            if(feat?.geometry && (feat.geometry.type==="point" || feat.geometry.type==="multipoint")){
              const p = await findParcelAtPoint(feat.geometry);
              if(p) feat = p;
            }
            await focusOnParcelFeature(feat,{shouldZoom:true});
            return true;
          }
        }
        console.warn("[LotPlan] no matching hits for", lotTrim, planTrim);
        return false;
      }catch(err){
        console.warn("focusOnLotPlan error:", err);
        return false;
      }finally{
        showLoading(false);
      }
    }
    const lotPlanSource = {
      name: "Lot/Plan (QLD)",
      placeholder: "12/SP12345 or 'Lot 12 on SP12345'",
      getSuggestions: async (params)=>{
        const raw = params?.suggestTerm || params?.searchTerm || params?.text || search?.viewModel?.searchTerm || "";
        const p = parseLotPlan(raw);
        console.log("[LotPlan] suggest", raw, p);
        if(!p) return [];
        return [{ key: p.lot+"/"+p.plan, text: "Lot "+p.lot+" on "+p.plan, sourceIndex: 0 }];
      },
      getResults: async (params)=>{
        let txt = params?.text || params?.searchTerm || params?.suggestResult?.text || search?.viewModel?.searchTerm || "";
        if(params.suggestResult && params.suggestResult.key) txt = params.suggestResult.key;
        const p = parseLotPlan(txt);
        console.log("[LotPlan] results", txt, p);
        if(!p) return [];
        const matches = await queryLotPlanAcrossLayers(p.lot, p.plan);
        return matches.map((m)=>({
          name: "Lot "+p.lot+" on "+p.plan+" - "+(m.layer.title||"Parcels"),
          feature: m.feature,
          extent: m.feature?.geometry?.extent
        }));
      },
      zoomScale: 1000
    };
    const addressSource = {
      url: GEOCODER_URL,
      name: "Address (ArcGIS)",
      placeholder: "Search address",
      singleLineFieldName: "SingleLine",
      countryCode: "AUS",
      maxResults: 6,
      maxSuggestions: 6
    };
    search.sources = [lotPlanSource, addressSource];
    search.activeSourceIndex = 0;
    try{
      search.viewModel?.watch("searchTerm", (term)=>{
        if(parseLotPlan(term)){
          search.activeSourceIndex = 0;
        }else{
          search.activeSourceIndex = 1;
        }
      });
    }catch{}
    search.on("select-result", async (e)=>{
      try{
        const feat = e.result && e.result.feature;
        const hint = e?.result?.name
          || e?.result?.feature?.attributes?.Match_addr
          || e?.result?.feature?.attributes?.LongLabel
          || e?.result?.feature?.attributes?.Address
          || e?.result?.feature?.attributes?.address;
        lastSearchHint = hint || null;
        lastSearchPoint = feat?.geometry || e?.result?.extent?.center || null;
        if(feat && feat.geometry){
          await focusOnParcelFeature(feat,{shouldZoom:true,hintAddress:hint,hintPoint:feat.geometry});
        }
      }catch(err){ console.warn("select-result handler:", err); }
    });
    search.on("search-complete", (e)=>{
      try{
        const first = e?.results?.[0]?.results?.[0];
        if(!first) return;
        const hint = first?.name
          || first?.feature?.attributes?.Match_addr
          || first?.feature?.attributes?.LongLabel
          || first?.feature?.attributes?.Address
          || first?.feature?.attributes?.address;
        if(hint) lastSearchHint = hint;
        if(first?.feature?.geometry || first?.extent?.center){
          lastSearchPoint = first.feature?.geometry || first.extent?.center;
        }
      }catch{}
    });
