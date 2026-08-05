// Extracted from LCC.html. Keep this file as the independent page brain for LCC.
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
    /* ---------------- ArcGIS imports ---------------- */
    import Portal from "https://js.arcgis.com/4.30/@arcgis/core/portal/Portal.js";
    import WebMap from "https://js.arcgis.com/4.30/@arcgis/core/WebMap.js";
    import MapView from "https://js.arcgis.com/4.30/@arcgis/core/views/MapView.js";
    import Graphic from "https://js.arcgis.com/4.30/@arcgis/core/Graphic.js";
    import GraphicsLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/GraphicsLayer.js";
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
    import * as symbolUtils from "https://js.arcgis.com/4.30/@arcgis/core/symbols/support/symbolUtils.js";
    import * as locator from "https://js.arcgis.com/4.30/@arcgis/core/rest/locator.js";
    import esriConfig from "https://js.arcgis.com/4.30/@arcgis/core/config.js";

    /* ---------------- Tunables ---------------- */
    const TOUCH_BUFFER_M = 6;
    const SWATCH_PX = 16;
    const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
    const LOGAN=[153.1024711187046,-27.76239839483306]; // Provided center
    const START_SCALE = 36111.909643; // Provided scale (unused after aligning zoom)
    const M2="m2";
    const HOUSES_OUT = 3;
    const HOUSE_LOT_METERS = 25;
    const SCREEN_BUFFER_METERS = HOUSES_OUT * HOUSE_LOT_METERS;
    const SHOT_SIZE = { width: 1280, height: 900 };
    const LOTPLAN_FALLBACK_URLS = [
      "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/0",
      "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4",
      "https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/property_boundaries_parcel/FeatureServer/0",
      "https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/property_boundaries_holding/FeatureServer/0",
      "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Property/PropertyBoundaries/MapServer/0"
    ];

    /* ---- CORS allow-list for address queries ---- */
    const CORS_HOSTS = [
        "www.arcgis.com",
        "services.arcgis.com",
        "services2.arcgis.com",
        "gisservices.information.qld.gov.au",
        "spatial-gis.information.qld.gov.au",
        "gis.brisbane.qld.gov.au",
        "maps.moretonbay.qld.gov.au",
        "maps.logan.qld.gov.au"
    ];
    addCorsHosts(esriConfig, CORS_HOSTS);

    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async function(extra){ extra = (typeof extra==="number")?extra:240; try{ await reactiveUtils.whenOnce(function(){ return !view.updating; }); }catch(e){} await raf(); await sleep(extra); };

    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null,
      countdownTimer: null
    };

    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/14A3cv6Qe6sFa9J3c57ss0C";



    const setGateVisible = function(on){
      var gate = $("accessGate");
      if(!gate) return;
      gate.classList.toggle("active", !!on);
      gate.setAttribute("aria-hidden", on ? "false" : "true");
    };

    const setGateMessage = function(title, msg){
      setText("accessGateTitle", title);
      setText("accessGateMsg", msg);
    };





    const startCountdown = function(expiresAt){
      var expiry = new Date(expiresAt);
      var tick = function(){
        var ms = expiry - new Date();
        if(ms <= 0){
          stopCountdown();
          handleExpiry();
          return;
        }
        var el = $("accessCountdown");
        if(el) el.textContent = formatRemaining(ms);
      };
      tick();
      accessState.countdownTimer = setInterval(tick, 1000);
      setTimerVisible(true);
    };

    const stopCountdown = function(){
      if(accessState.countdownTimer){
        clearInterval(accessState.countdownTimer);
        accessState.countdownTimer = null;
      }
    };

    const handleExpiry = function(){
      accessState.active = false;
      setGateMessage("Session expired", "Your 24-hour access window has ended. Please purchase again to continue.");
      setGateVisible(true);
      setTimerVisible(false);
    };

    const initAccessGate = async function(){
      if(window.__LOT_WISE_FILE_MODE__){
        accessState.active = false;
        accessState.expiresAt = null;
        setPaymentLink(PAYMENT_FALLBACK_URL);
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        return;
      }
      accessState.key = getQueryParam("key");
      var sessionId = getQueryParam("session_id");
      accessState.paymentUrl = await loadPaymentUrl();
      setPaymentLink(accessState.paymentUrl || PAYMENT_FALLBACK_URL);

      var homeBtn = $("accessGateHome");
      if(homeBtn){
        homeBtn.addEventListener("click", function(){ window.location.href = "Index.html"; });
      }

      if(!accessState.key && sessionId){
        var returnPath = "LCC.html";
        window.location.href = "/api/stripe/success?session_id=" + encodeURIComponent(sessionId) + "&return=" + encodeURIComponent(returnPath);
        return;
      }

      if(!accessState.key){
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        setTimerVisible(false);
        return;
      }

      var result = await checkToken(accessState.key);
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

    const isAccessActive = function(){
      if(window.__LOT_WISE_FILE_MODE__) return false;
      if(!accessState.active || !accessState.expiresAt) return false;
      return new Date(accessState.expiresAt) > new Date();
    };

    const finalizeTokenAndLock = async function(){
      if(window.__LOT_WISE_FILE_MODE__) return;
      if(!accessState.key){
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        setTimerVisible(false);
        return;
      }
      try{
        await fetch("/api/finalise-token?key=" + encodeURIComponent(accessState.key), { method: "POST" });
      }catch(e){}
      stopCountdown();
      accessState.active = false;
      setGateMessage("Payment required", "Access used. Please purchase again to continue.");
      setGateVisible(true);
      setTimerVisible(false);
    };

    initAccessGate();    const valOr=function(v,def){ return (v===undefined||v===null)?def:v; };
    const PDF_WORKER_SRC="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    if(window.pdfjsLib){
      try{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDF_WORKER_SRC;
      }catch(e){ console.warn("pdfjs worker init failed",e); }
    }else{
      console.warn("pdf.js library failed to load; POD detection disabled.");
    }
    async function extractPdfText(file){
      if(!file) throw new Error("No file selected");
      if(!window.pdfjsLib) throw new Error("PDF parser not available");
      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({data:buffer}).promise;
      let text="";
      for(var i=1;i<=pdf.numPages;i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(function(item){ return item.str||""; }).filter(Boolean);
        text += strings.join(" ") + "\\n";
      }
      return text;
    }
        
        
        function parseSubdivisionsFromText(text){
      if(!text) return [];
      const lines = text.split(/\r?\n/).map(function(t){ return t.trim(); }).filter(Boolean);
      const subdivisions=[];
      const planRegex=/\b((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/i;
      const planLooseRegex=/((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)/i;
      const lotRegex=/\b(?:lot|lot\s*no\.?)\s*[:#-]?\s*([0-9A-Za-z-]+)\b/i;
      const comboRegex=/(\d+[A-Za-z-]?)(?:\s*(?:\/|on)\s*|\s*)((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)/i;
      const areaRegex=/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:m2|m\u00b2|sqm|square metres?)/i;

      const addUnique=function(lot,plan,areaSqm,raw){
        const key=(lot||"")+"_"+(plan||"");
        if(!subdivisions.some(function(sub){ return (sub.lot+"_"+sub.plan)===key; })){
          subdivisions.push({
            lot:lot||null,
            plan:plan||null,
            areaSqm:areaSqm==null?null:areaSqm,
            raw:raw
          });
        }
      };

      [...text.matchAll(/\bLot\s+(\d+[A-Za-z-]?)\s+on\s+((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/ig)]
        .forEach(function(m){ addUnique(m[1].toUpperCase(), m[2].replace(/[\s-]+/g,"").toUpperCase(), null, m[0]); });
      [...text.matchAll(/\b(\d+[A-Za-z-]?)\s*(?:\/|on)?\s*((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/ig)]
        .forEach(function(m){ addUnique(m[1].toUpperCase(), m[2].replace(/[\s-]+/g,"").toUpperCase(), null, m[0]); });

      let current=null;
      const pushCurrent=function(){
        if(!current) return;
        if(!current.lot && !current.plan) return;
        if(typeof current.areaSqm!=="number"||!isFinite(current.areaSqm)){
          current.areaSqm=null;
        }
        addUnique(current.lot, current.plan, current.areaSqm, current.raw);
      };

      for(let idx=0; idx<lines.length; idx++){
        const line=lines[idx];
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
            if(inline) candidateLot=inline[1].toUpperCase();
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
          if(!isNaN(parsed)){
            current.areaSqm=parsed;
          }
        }
      }
      pushCurrent();
      return subdivisions;
    }


function framedExtent(geom){
      try{
        var b=geometryEngine.buffer(geom,SCREEN_BUFFER_METERS,"meters");
        return (b&&b.extent)?b.extent:(geom&&geom.extent);
      }catch(e){ return geom && geom.extent; }
    }
    async function withViewOnGeom(geom,fn){
      var vp = (view.viewpoint && typeof view.viewpoint.clone==="function") ? view.viewpoint.clone() : null;
      try{
        if(geom && geom.extent){
          var target=framedExtent(geom);
          await view.goTo(target,{animate:false});
          await waitViewIdle(260);
        }
        return await fn();
      } finally {
        if(vp){ try{ await view.goTo(vp,{animate:false}); await waitViewIdle(160);}catch(e){} }
      }
    }
    const centroidOf = function(g){
      try{
        if (g && g.centroid) return g.centroid;
        if (g && g.extent && g.extent.center) return g.extent.center;
      }catch(e){}
      return null;
    };
    const projectToViewSR=function(geom){
      try{
        if(!geom || !view || !view.spatialReference) return geom;
        if(!geom.spatialReference){
          geom.spatialReference = { wkid: 102100 };
        }
        const gSR = (geom.spatialReference && (geom.spatialReference.wkid||geom.spatialReference.latestWkid));
        const vSR = (view.spatialReference && (view.spatialReference.wkid||view.spatialReference.latestWkid));
        if(gSR && vSR && gSR===vSR) return geom;
        const proj = geometryEngine.project(geom, view.spatialReference);
        return proj || geom;
      }catch(e){ return geom; }
    };
    function normalizeToWebMercator(geom){
      try{
        if(!geom) return geom;
        const sr = (geom.spatialReference && (geom.spatialReference.wkid||geom.spatialReference.latestWkid));
        if(sr===102100 || sr===3857) return geom;
        const sample = geom.type==="point" ? geom :
          geom.type==="polyline" ? (geom.paths && geom.paths[0] && geom.paths[0][0]) :
          geom.type==="polygon" ? (geom.rings && geom.rings[0] && geom.rings[0][0]) : null;
        if(sample){
          const x = sample.x!=null ? sample.x : sample[0];
          const y = sample.y!=null ? sample.y : sample[1];
          if(Math.abs(x)>180 || Math.abs(y)>90){
            geom.spatialReference = { wkid:102100 };
            return geom;
          }
        }
        const projected = geometryEngine.project(geom, {wkid:102100});
        return projected || geom;
      }catch(e){ return geom; }
    }

    /* ---------------- Map & rules ---------------- */
    const portal=new Portal({url:"https://www.arcgis.com"});
    // Use Logan WebMap item id
    let webmap=new WebMap({portalItem:{id:"e58a1a64e2e747cbb667ffd0b4e01b33",portal:portal}});
    const selLayer=new GraphicsLayer({listMode:"hide"}); webmap.add(selLayer);
    // Use provided center/scale
    const view=new MapView({container:"viewDiv",map:webmap,center:LOGAN,zoom:17,constraints:{snapToZoom:false}});

    const inText=function(t,p){ return String(t||"")+" "+String(p||""); };
    const isDNT=function(title,id,tags){
      title=String(title||""); id=String(id||""); tags=(tags||[]).join("|");
      return /do[\s-]*not[\s-]*touch/i.test(title) || /do[\s-]*not[\s-]*touch/i.test(id) || /do[\s-]*not[\s-]*touch/i.test(tags);
    };
    const isUtility=function(title,id,tags){ return /\b(utilit(y|ies)|power|electric|telecom|gas|water|sewer|storm[-\s]?water|reticulation|service)\b/i.test(inText(title,id)+" "+(tags||[]).join(" ")); };
    const isWaterOrSewer=function(path){ return /\b(water|sewer|storm[\s-]*water|drainage|watercourse)\b/i.test(String(path||"")); };
    const isAcid=function(t,p){ return /\bacid\b/i.test(inText(t,p)); };
      const isTransport=function(t,p){
        const hay=inText(t,p);
        if(/\b(transport|road|rail|traffic|cycle|bikeway|pedestrian|carpark|parking|transit|bus|ferry)\b/i.test(hay)) return true;
        if(/\bcorridor\b/i.test(hay) && !/\b(water|waterway|wetland|bio|biodiversity|habitat|conservation|vegetation|riparian|environment|green)\b/i.test(hay)) return true;
        return false;
      };
    const isAir=function(t,p){ return /\b(air\s*quality|air-quality|air|pollution)\b/i.test(inText(t,p)); };
    const isNoise=function(t,p){ return /\b(noise|acoustic|transport.*noise.*corridor|tnc)\b/i.test(inText(t,p)); };
    const isZoning=function(t,p){ return /\b(zoning|zone|zones)\b/i.test(inText(t,p)); };
    const isBushfire=function(t,p){ return /\b(bush[-\s]?fire|bushfire|bush\s*fire|wild[-\s]?fire|fire\s*hazard)\b/i.test(inText(t,p)); };
    const planKey=function(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,""); };
    const zoneBaseKey=function(s){ return planKey(s).replace(/zonecode|zone/g,""); };
    const LOGAN_ZONE_LINKS=new Map([
      [zoneBaseKey("Centre"),"https://logan.isoplan.com.au/eplan/rules/0/25/0/0/0/203"],
      [zoneBaseKey("Community facilities"),"https://logan.isoplan.com.au/eplan/rules/0/28/0/0/0/203"],
      [zoneBaseKey("Emerging community"),"https://logan.isoplan.com.au/eplan/rules/0/29/0/0/0/203"],
      [zoneBaseKey("Environmental management and conservation"),"https://logan.isoplan.com.au/eplan/rules/0/30/0/0/0/203"],
      [zoneBaseKey("Low density residential"),"https://logan.isoplan.com.au/eplan/rules/0/31/0/0/0/203"],
      [zoneBaseKey("Low impact industry"),"https://logan.isoplan.com.au/eplan/rules/0/32/0/0/0/203"],
      [zoneBaseKey("Low-medium density residential"),"https://logan.isoplan.com.au/eplan/rules/0/33/0/0/0/203"],
      [zoneBaseKey("Medium density residential"),"https://logan.isoplan.com.au/eplan/rules/0/34/0/0/0/203"],
      [zoneBaseKey("Medium impact industry"),"https://logan.isoplan.com.au/eplan/rules/0/41/0/0/0/203"],
      [zoneBaseKey("Mixed use"),"https://logan.isoplan.com.au/eplan/rules/0/40/0/0/0/203"],
      [zoneBaseKey("Recreation and open space"),"https://logan.isoplan.com.au/eplan/rules/0/39/0/0/0/203"],
      [zoneBaseKey("Rural"),"https://logan.isoplan.com.au/eplan/rules/0/38/0/0/0/203"],
      [zoneBaseKey("Rural residential"),"https://logan.isoplan.com.au/eplan/rules/0/37/0/0/0/203"],
      [zoneBaseKey("Special purpose"),"https://logan.isoplan.com.au/eplan/rules/0/36/0/0/0/203"],
      [zoneBaseKey("Specialised centre"),"https://logan.isoplan.com.au/eplan/rules/0/35/0/0/0/203"]
    ]);
    const LOGAN_OVERLAY_LINKS=new Map([
      [planKey("Biodiversity corridor"),"https://logan.isoplan.com.au/eplan/rules/0/63/0/0/0/203"],
      [planKey("Bushfire Hazard"),"https://logan.isoplan.com.au/eplan/rules/0/62/0/0/0/203"],
      [planKey("Extractive resources"),"https://logan.isoplan.com.au/eplan/rules/0/61/0/0/0/203"],
      [planKey("Flood Risk"),"https://logan.isoplan.com.au/eplan/rules/0/60/0/0/0/203"],
      [planKey("Heritage"),"https://logan.isoplan.com.au/eplan/rules/0/58/0/0/0/203"],
      [planKey("Landslide hazard and steep slope area"),"https://logan.isoplan.com.au/eplan/rules/0/57/0/0/0/203"]
    ]);
    const LOGAN_SETBACK_SOURCES={
      dwellingHouse:"https://s3-ap-southeast-2.amazonaws.com/lcc-docs-planning/root/Logan%20Planning%20Scheme%202015/LPS%202015%20V9.0%20%28February%202023%29/Code%20Compliance%20Tables%20%28LPS%20V9%29/9-3-2%20Dual%20occ%20Dwelling%20house%20-%20Code%20compliance%20%28LPS%20v9%29.docx",
      eplan:"https://logan.isoplan.com.au/eplan/",
      qdc:"https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code"
    };
    const LOGAN_SETBACK_ZONE_CONFIG={
      low:{name:"Low density residential",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Low density residential")),road:"qdc",sideRear:"qdc"},
      lowAcreage:{name:"Low density residential - Acreage precinct",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Low density residential")),road:10,sideRear:3},
      lowSmallAcreage:{name:"Low density residential - Small acreage precinct",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Low density residential")),road:10,sideRear:3},
      lowMedium:{name:"Low-medium density residential",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Low-medium density residential")),road:4,sideRear:"qdc"},
      emerging:{name:"Emerging community",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Emerging community")),road:10,sideRear:3},
      environmental:{name:"Environmental management and conservation",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Environmental management and conservation")),road:20,sideRear:10},
      ruralResidential:{name:"Rural residential",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Rural residential")),road:"ruralResidential",sideRear:3},
      rural:{name:"Rural",source:LOGAN_ZONE_LINKS.get(zoneBaseKey("Rural")),road:20,sideRear:10}
    };
    const findLoganZoneLink=function(title,labels){
      var searchTerms=[title].concat(labels||[]).filter(Boolean);
      for(var i=0;i<searchTerms.length;i++){
        var base=zoneBaseKey(searchTerms[i]);
        if(LOGAN_ZONE_LINKS.has(base)) return LOGAN_ZONE_LINKS.get(base);
      }
      return null;
    };
    const findLoganOverlayLink=function(title,labels){
      var searchTerms=[title].concat(labels||[]).filter(Boolean);
      for(var i=0;i<searchTerms.length;i++){
        var key=planKey(searchTerms[i]);
        if(LOGAN_OVERLAY_LINKS.has(key)) return LOGAN_OVERLAY_LINKS.get(key);
      }
      return null;
    };

    function kidsOf(n){
      var arr=null;
      if(n && n.layers){ arr = (n.layers && typeof n.layers.toArray==="function") ? n.layers.toArray() : n.layers; }
      if(!arr && n && n.sublayers){ arr = (n.sublayers && typeof n.sublayers.toArray==="function") ? n.sublayers.toArray() : n.sublayers; }
      return arr || [];
    }
        function nodePath(n){
      var bits=[], cur=n;
      while(cur){ bits.unshift(cur.title||cur.id||"node"); cur=cur.parent; }
      return bits.join(" / ");
    }
    const utilityVisSnapshot = new Map();
    let utilitiesToggleState = false;
    let utilToggleBtn = null;

    function walkAny(node,cb,inheritedDNT){
      if(!node) return;
      inheritedDNT = !!inheritedDNT;
      var t=node.title||node.id||"", id=node.id||"", tg=(node.portalItem && node.portalItem.tags) || [];
      var flag=inheritedDNT||isDNT(t,id,tg);
      cb(node,flag);
      var kids = kidsOf(node);
      for(var i=0;i<kids.length;i++){ walkAny(kids[i],cb,flag); }
    }
    function getUtilityNodes(){
      var nodes=[];
      walkAny(view.map,function(n,underDNT){
        if(underDNT || !("visible" in n)) return;
        var t=n.title||"", p=nodePath(n), tg=(n.portalItem && n.portalItem.tags)||[];
        if(isUtility(t,n.id,tg) || isWaterOrSewer(p)) nodes.push(n);
      });
      return nodes;
    }
    function updateUtilityToggleLabel(){
      var btn = utilToggleBtn || document.getElementById("btnUtilityToggleMap");
      if(!btn) return;
      var on = utilitiesToggleState;
      btn.setAttribute("title", on ? "Hide utilities" : "Show utilities");
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("active", on);
    }
    function setUtilitiesVisible(on){
      var nodes=getUtilityNodes();
      if(on){
        utilityVisSnapshot.clear();
        nodes.forEach(function(n){
          if(!utilityVisSnapshot.has(n)) utilityVisSnapshot.set(n, !!n.visible);
          try{ n.visible=true; }catch(e){}
          try{ n.listMode="show"; }catch(e){}
          var p=n.parent;
          while(p){
            if("visible" in p){ try{ p.visible=true; }catch(e){} }
            p=p.parent;
          }
        });
      }else{
        nodes.forEach(function(n){
          var prev = utilityVisSnapshot.has(n) ? utilityVisSnapshot.get(n) : false;
          try{ n.visible=prev; }catch(e){}
        });
      }
      utilitiesToggleState = on;
      updateUtilityToggleLabel();
      try{ layerList.refresh(); }catch(e){}
    }

    function keepOnHidden(node){
      if("visible" in node){ try{ node.visible=true; }catch(e){} }
      if("listMode" in node){ try{ node.listMode="hide"; }catch(e){} }
      try{ node.minScale=0; node.maxScale=0; }catch(e){}
      if(node.type==="sublayer"){ try{ node.updateFromJSON({minScale:0,maxScale:0}); }catch(e){} }
      var p=node.parent;
      while(p){ if("visible" in p){ try{ p.visible=true; }catch(e){} } p=p.parent; }
    }
    function startHidden(node){
      if("visible" in node){ try{ node.visible=false; }catch(e){} }
      if("listMode" in node){ try{ node.listMode="show"; }catch(e){} }
    }
    function enforceOverlayRules(){
      walkAny(webmap,function(node,underDNT){
        if(node.type==="graphics"){ try{node.listMode="hide";}catch(e){} return; }
        if(!("visible" in node)) return;
        if(underDNT) keepOnHidden(node); else startHidden(node);
      });
    }
    ;[300,900,1800,3500].forEach(function(ms){ setTimeout(function(){ try{enforceOverlayRules();}catch(e){} },ms); });
    (async()=>{
      showLoading(true);
      try{
        // Only replace the WebMap when the item itself cannot load. loadAll() also
        // rejects when a single optional child layer is unavailable; treating that
        // as a map failure used to discard every healthy Logan layer.
        await webmap.load();
      }catch(e){
        console.warn("WebMap failed to load; using fallback basemap",e);
        webmap=new WebMap({basemap:"streets-vector"});
        webmap.add(selLayer);
        view.map=webmap;
        showLoading(false);
        return;
      }

      try{
        await webmap.loadAll();
      }catch(e){
        console.warn("One or more WebMap layers failed to load; keeping available Logan layers",e);
      }

      try{ enforceOverlayRules(); }
      finally{ showLoading(false); }
    })();
view.ui.add(new Home({view:view}),"top-left");
    view.ui.add(new ScaleBar({view:view,unit:"metric"}),"bottom-left");
    const layerList=new LayerList({view:view,listItemCreatedFunction:function(e){
      const item=e.item, node=item.sublayer||item.layer;
      if(!node) return;
      if(node.type==="graphics"){ item.visible=false; item.panel=null; try{node.listMode="hide";}catch(e){} return; }
      let cur=node, inDNT=false;
      while(cur){
        const t=cur.title||"", i=cur.id||"", tg=(cur.portalItem&&cur.portalItem.tags)||[];
        if(isDNT(t,i,tg)){ inDNT=true; break; }
        cur=cur.parent;
      }
      if(inDNT){ keepOnHidden(node); item.visible=false; item.panel=null; }
      else{ try{node.listMode="show";}catch(e){} item.panel={content:"legend"}; }
    }});
    view.ui.add(new Expand({view:view,content:layerList,expandIconClass:"esri-icon-layers",expanded:false}),"top-right");

    view.when(()=>{ 
      utilToggleBtn = (function(){
        const btn=document.createElement("button");
        btn.id="btnUtilityToggleMap";
        btn.type="button";
        btn.className="esri-widget esri-widget--button util-toggle-btn";
        btn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3.5c-3.2 4-5.5 7.2-5.5 9.7A5.5 5.5 0 0 0 12 18.7a5.5 5.5 0 0 0 5.5-5.5c0-2.5-2.3-5.7-5.5-9.7z"></path>
        </svg>`;
        btn.addEventListener("click",function(){ setUtilitiesVisible(!utilitiesToggleState); });
        updateUtilityToggleLabel();
        return btn;
      })();
      view.ui.add(utilToggleBtn,{position:"top-right",index:2});
    });

    view.ui.add(new Expand({view:view,content:new Legend({view:view}),expandIconClass:"esri-icon-legend"}),"top-right");
    view.ui.add(new Expand({view:view,content:new BasemapGallery({view:view}),expandIconClass:"esri-icon-basemap"}),"top-right");
    view.ui.add(new Fullscreen({view:view}),"top-right");

    /* --- Search widget (address + Lot/Plan) --- */
    const search=new Search({
      view:view,
      includeDefaultSources:true,
      popupEnabled:true,
      allPlaceholder:"Search address or Lot/Plan (e.g., 12/SP12345)"
    });
    view.ui.add(search,{position:"top-right",index:0});

    /* ---------------- Status ---------------- */
    view.watch("extent",function(){
      var c=view.center;
      setText("statusCoords","Coords: " + c.longitude.toFixed(5) + ", " + c.latitude.toFixed(5));
      setText("statusZoom","Zoom: " + view.zoom.toFixed(1));
      setText("statusScale","Scale: 1:" + Math.round(view.scale));
    });

    /* ---------------- Parcel selection ---------------- */
    const parseNumberLike=function(raw){
      if(raw==null) return null;
      var s=String(raw).trim(); if(!s) return null;
      var hasHA=/(^|[^a-z])ha([^a-z]|$)/i.test(s)||/\bhectare(s)?\b/i.test(s);
      s=s.replace(/,/g,"").replace(/square\s*met(re|er)s?/ig,"").replace(/m2|m\u00B2|sqm|sq\.?m/ig,"").trim();
      var n=parseFloat(s); if(isNaN(n)) return null;
      if(hasHA) n*=10000; return n;
    };
    function getLotAreaSqm(attrs){
      const strong=["LOT_AREA_M2","LOT_SIZE_M2","LOT_SIZE_SQM","LOT_AREA_SQM","AREA_SQM","SITE_AREA_SQM","LAND_AREA_SQM","LOT_AREA","LOT_SIZE","SITE_AREA","LAND_AREA","AREA_M2","AREA (M2)","AREA(M2)","AREA_M^2","AREA_HA","HECTARES"];
      for(var i=0;i<strong.length;i++){
        var k=strong[i];
        var v=(k in attrs)?parseNumberLike(attrs[k]):null;
        if(v!=null){
          if(v>0&&v<50&&(k==="AREA_HA"||k==="HECTARES")) return v*10000;
          return v;
        }
      }
      for(var k2 in attrs){
        var v2=attrs[k2];
        if(/(lot|site|land).*area/i.test(k2)||/area.*(sqm|m2|m\^2|square)/i.test(k2)||(/(lot|site).*size/i.test(k2))){
          var val=parseNumberLike(v2); if(val) return val;
        }
      }
      return null;
    }
    function parseParcelMeta(attrs){
      const keys=function(rx){ for(var k in attrs){ if(rx.test(k)) return k; } return null; };
      const lot=attrs["LOT"]||attrs["LOTNO"]||attrs["LOT_NO"]||attrs["LOTNUMBER"]||(keys(/^lot[\w_]*$/i)?String(attrs[keys(/^lot[\w_]*$/i)]):null);
      const plan=attrs["PLAN"]||attrs["PLANNO"]||attrs["PLAN_NO"]||(keys(/^plan[\w_]*$/i)?String(attrs[keys(/^plan[\w_]*$/i)]):null);
      let lotplan=attrs["LOT_PLAN"]||attrs["LOT_PLAN_NO"]||attrs["LOTPLAN"]||attrs["LOTPLAN_NO"]||attrs["LOTPLAN_TXT"]||attrs["LOT_PLAN_TXT"]||attrs["LOT_PLAN_TEXT"]||attrs["LOTPLAN_TEXT"];
      if(!lotplan && lot && plan) lotplan=lot+"/"+plan;
      if(!lotplan){
        for(var key in attrs){
          var s=String(attrs[key]||"").toUpperCase();
          var m=s.match(/\b(\d+)\s*\/\s*([A-Z]{1,4}\s*\d{1,8})\b/);
          if(m){ lotplan=m[1]+"/"+m[2].replace(/\s+/g,""); break; }
        }
      }
      return {lot:lot,plan:plan,lotplan:lotplan};
    }
    const geomAreaSqmSafe=function(g){ try{ var a=Math.abs(geometryEngine.planarArea(g,"square-meters")||0); return a>0?a:null; }catch(e){ return null; } };

    function smartJoin(parts){
      var out=[];
      for(var i=0;i<parts.length;i++){ if(parts[i]) out.push(parts[i]); }
      return out.join(" ").replace(/\s+/g," ").trim();
    }
    const _get=function(o,ks){ for(var i=0;i<ks.length;i++){ var k=ks[i]; if(k in o && String(valOr(o[k],"")).trim()) return String(o[k]).trim(); } return null; };

    function parseCouncil(attrs){
      if(!attrs) return null;
      const first=function(){
        for(var i=0;i<arguments.length;i++){
          var k=arguments[i];
          if(k in attrs){ var v=String(attrs[k]||"").trim(); if(v) return v; }
        }
        return null;
      };
      return first("COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY") || "Logan City Council";
    }

    const ADDR_DEBUG=false;

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

    function _pick(attrs, keys){
      for(var i=0;i<keys.length;i++){
        var k=keys[i];
        if(k in attrs){
          var v = String(valOr(attrs[k],"")).trim();
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
      const state  = _pick(attrs,PART_FIELDS.state) || "QLD";
      const post   = _pick(attrs,PART_FIELDS.post);

      const line1=_smartJoin([ unit ? (unit+"/") : null, _smartJoin([numP,num,numS]), _smartJoin([stNm,stTp,stSf]) ]);
      const line2=_smartJoin([ suburb, state, post ]);
      return _smartJoin([line1,line2]) || null;
    }

    function parseAddress(attrs){
      if(!attrs) return null;
      for(var i=0;i<FULL_ADDR_FIELDS.length;i++){
        var f = FULL_ADDR_FIELDS[i], v = attrs[f];
        if(v!=null){
          var s = String(v).trim();
          if(s && s.toUpperCase()!=="NULL") return s;
        }
      }
      const candidates=["LOT_PLAN","LOT_PLAN_NO","LOTPLAN","LOTPLAN_NO","LOTPLAN_TXT","LOT_PLAN_TXT","LOT_PLAN_TEXT","LOTPLAN_TEXT"];
      for(var j=0;j<candidates.length;j++){
        var s2 = String(valOr(attrs[candidates[j]],"")).trim();
        if(/\d{1,5}\s+[A-Za-z].*\d{4}\b/.test(s2)) return s2;
      }
      const built = buildAddressFromParts(attrs);
      if(built) return built;
      for(var k in attrs){
        var v2 = String(valOr(attrs[k],"")).trim();
        if(!v2) continue;
        var m=v2.match(/\b\d{1,5}\s+[A-Za-z][A-Za-z\s.'-]+(?:\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade)\b)[^,;]*?(?:,\s*[A-Za-z][A-Za-z\s.'-]+)?(?:\s+(?:QLD|Queensland))?\s*\d{4}\b/i);
        if(m) return m[0].replace(/\s+/g," ").trim();
      }
      return null;
    }

    /* ===== SAFE VERSION: ensure suburb appended (no template literals/optional chaining) ===== */
    function ensureSuburbInAddress(addr, attrs){
      if(!addr) return addr;

      const _p = function(obj, keys){
        for (var i=0;i<keys.length;i++){
          var k = keys[i];
          if (k in obj){
            var v = String(valOr(obj[k],"")).trim();
            if (v && v.toUpperCase() !== "NULL") return v;
          }
        }
        return null;
      };

      const suburb = _p(attrs||{}, PART_FIELDS.suburb);
      const state  = _p(attrs||{}, PART_FIELDS.state) || "QLD";
      const post   = _p(attrs||{}, PART_FIELDS.post);

      if(!suburb) return addr;

      const norm = function(s){ return String(s||"").toUpperCase().replace(/[, \s]+/g," ").trim(); };
      if (norm(addr).includes(norm(suburb))) return addr;

      const reEscape = function(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
      const postRx   = post ? "\\b" + reEscape(post) + "\\b" : "";
      const pat      = "(?:,\\s*)?(?:QLD|Queensland)\\s*" + postRx + "\\s*$";
      const rxTail   = new RegExp(pat, "i");

      const tailWanted = suburb + " " + state + (post ? " " + post : "");

      if (rxTail.test(addr)){
        return addr.replace(rxTail, ", " + tailWanted);
      }
      return addr.replace(/\s+,/g, ",") + ", " + tailWanted;
    }

    function looksLikeAddressLayer(node){
      const hay = (String(node.title||"")+" "+nodePath(node)).toLowerCase();
      return /\b(gnaf|address|addr|property\s*address|site\s*address|street\s*address|address\s*points|locality|suburb|road\s*centerline|road\s*centreline)\b/.test(hay);
    }

    function flattenFeatureNodes(){
      const out=[];
      walkAny(view.map,function(n){
        if(n && (n.type==="feature"||n.type==="sublayer") &&
           (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) out.push(n);
      });
      return out;
    }
    const PARCEL_FIELD_RX=/\b(LOT(?:_?PLAN)?|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM|PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT|PARCEL|PARCEL_ID|PROP(?:ERTY)?_?ID?)\b/i;
    function hasParcelFields(node){
      try{
        const flds=node.fields||[];
        for(let i=0;i<flds.length;i++){
          if(PARCEL_FIELD_RX.test(String(flds[i].name||""))) return true;
        }
      }catch(e){}
      return false;
    }
    const looksLikeParcelLayer=function(node){
      const hay=((node.title||"")+" "+nodePath(node)+" "+(node.url||"")).toLowerCase();
      return /(cadast|parcel|dcdb|lot|property)/i.test(hay);
    };

    async function scanAddressLayers(lotGeom){
      const nodes = flattenFeatureNodes().filter(function(n){ try{ return looksLikeAddressLayer(n); }catch(e){return false;} });
      const centroid = centroidOf(lotGeom);
      const candidates = [];

      for(var i=0;i<nodes.length;i++){
        const n=nodes[i];
        try{
          await n.load();
          const outFields = ["*"];

          const r1 = await n.queryFeatures({
            geometry: lotGeom, spatialRelationship: "intersects",
            returnGeometry: false, outFields: outFields, maxRecordCountFactor: 3
          });
          (r1.features||[]).forEach(function(f){
            const addr = parseAddress(f.attributes);
            if(addr) candidates.push({addr:addr, score:3, layer:n});
          });

          if(centroid){
            const r2 = await n.queryFeatures({
              geometry: centroid, distance: 40, units: "meters",
              spatialRelationship: "intersects", returnGeometry: false,
              outFields: outFields, maxRecordCountFactor: 3
            });
            (r2.features||[]).forEach(function(f){
              const addr = parseAddress(f.attributes);
              if(addr) candidates.push({addr:addr, score:2, layer:n});
            });
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("Address layer failed:", n.title, e);
        }
      }

      candidates.sort(function(a,b){
        return (b.score-a.score) ||
               (((/\d/.test(b.addr)?1:0)-(/\d/.test(a.addr)?1:0))) ||
               (b.addr.length-a.addr.length);
      });
      return candidates.length ? candidates[0].addr : null;
    }

    async function resolveBestAddress(geom, parcelFeature){
      let attrs = parcelFeature ? (parcelFeature.attributes||{}) : null;
      let addr = attrs ? parseAddress(attrs) : null;
      const weak = !addr || addr.trim().length<=4 || /^[A-Z]{2,3}$/.test(addr.trim());

      if(weak){
        try{
          const fromLayers = await scanAddressLayers(geom);
          if(fromLayers) addr = fromLayers;
        }catch(e){
          if(ADDR_DEBUG) console.warn("scanAddressLayers error:", e);
        }
      }

      if(!addr || addr.trim().length<=4){
        try{
          const cen = centroidOf(geom);
          if(cen){
            const res = await locator.locationToAddress(GEOCODER_URL,{location:cen});
            addr = (res && (res.address || (res.attributes && (res.attributes.Match_addr || res.attributes.LongLabel || res.attributes.Address)))) || addr;
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("reverse geocode failed:", e);
        }
      }

      addr = ensureSuburbInAddress(addr, attrs || {});
      return addr || "Address unavailable";
    }

    async function findParcelAtPoint(point){
      const all=flattenFeatureNodes();
      const pref=[],rest=[];
      for(var i=0;i<all.length;i++){
        var n=all[i];
        try{
          await n.load();
          if(n.geometryType!=="polygon") continue;
          (looksLikeParcelLayer(n)||hasParcelFields(n)?pref:rest).push(n);
        }catch(e){}
      }
      const layers=pref.concat(rest);
      const collect=async function(opts){
        const out=[];
        for(var i=0;i<layers.length;i++){
          const L=layers[i];
          try{
            const qOpts = Object.assign({}, opts, {returnGeometry:true,outFields:["*"],maxRecordCountFactor:2});
            const r=await L.queryFeatures(qOpts);
            (r.features||[]).forEach(function(f){ out.push({layer:L,feature:f}); });
          }catch(e){}
        }
        return out;
      };
      let cand=await collect({geometry:point,spatialRelationship:"intersects"});
      let contains=cand.filter(function(x){ try{ return geometryEngine.contains(x.feature.geometry,point); }catch(e){ return false; } });
      if(contains.length){
        let best=contains[0], bestD=Infinity;
        for(var i=0;i<contains.length;i++){
          const c=contains[i];
          let d=Infinity; try{ const cen=centroidOf(c.feature.geometry); d=geometryEngine.distance(point,cen)||Infinity; }catch(e){}
          if(d<bestD){ best=c; bestD=d; }
        }
        return best.feature;
      }
      cand=await collect({geometry:point,distance:1.5,units:"meters",spatialRelationship:"intersects"});
      if(cand.length){
        let best=cand[0], bestD=Infinity;
        for(var j=0;j<cand.length;j++){
          const c2=cand[j];
          let d2=Infinity; try{ const near=geometryEngine.nearestCoordinate(c2.feature.geometry,point); d2=(near && near.distance)||Infinity; }catch(e){}
          if(d2<bestD){ best=c2; bestD=d2; }
        }
        return best.feature;
      }
      return null;
    }

    var lastParcelInfo={feature:null,lotText:"--",areaText:"-- "+M2,classText:"--",addressText:"--",councilText:"Logan City Council"};

    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || ("-- "+M2));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Logan City Council");
      updateLccSetbacksPanel();
    }

    function outlineSelection(geom){
      selLayer.removeAll();
      if(!geom) return;
      selLayer.add(new Graphic({geometry:geom,symbol:{type:"simple-fill",color:[0,0,0,0],outline:{color:"#a70b13",width:2}}}));
    }
    function parcelInfoFromFeature(feat){
      const attrs= (feat && feat.attributes) || {};
      const meta=parseParcelMeta(attrs);
      const lotplan= meta.lotplan || ((meta.lot||meta.plan)?[meta.lot,meta.plan].filter(function(x){return !!x;}).join("/"):"--");
      const area= valOr(getLotAreaSqm(attrs), valOr(geomAreaSqmSafe(feat.geometry), null));
      const cls=(area!=null && area<450)?"Small lot":"Standard lot";
      var address=parseAddress(attrs) || "--";
      if(address && address!=="--") address = ensureSuburbInAddress(address, attrs);
      const council=parseCouncil(attrs) || "Logan City Council";
      return {
        lotText: lotplan||"--",
        areaText: (area!=null) ? (Math.round(area).toLocaleString()+" "+M2) : ("-- "+M2),
        classText: cls,
        addressText: address,
        councilText: council
      };
    }
    function updateBadgesFromFeature(feat){
      const info=parcelInfoFromFeature(feat);
      lastParcelInfo={feature:feat,lotText:info.lotText,areaText:info.areaText,classText:info.classText,addressText:info.addressText,councilText:info.councilText};
      updateSummaryPanel();
    }

    var lastLccSetbackContext={route:null,zoneLabel:"Not resolved",labels:[],source:"pending"};

    function setbackWallHeightFromInput(raw){
      var vals=[raw,$("lccSetbackWallHeight") && $("lccSetbackWallHeight").value,$("lccSetbackWallHeightTab") && $("lccSetbackWallHeightTab").value]
        .filter(function(v){ return v!==undefined && v!==null && String(v).trim()!==""; });
      var n=Number(vals[0]);
      return Number.isFinite(n) && n>0 ? n : 4.5;
    }
    function metresText(v, digits){
      digits = digits==null ? 1 : digits;
      if(v==null) return "--";
      if(typeof v==="string") return v;
      var n=Number(v);
      if(!Number.isFinite(n)) return "--";
      return n.toLocaleString(undefined,{maximumFractionDigits:digits})+" m";
    }
    function formatSetbackArea(areaSqm){
      if(!Number.isFinite(areaSqm)) return "-- "+M2;
      return Math.round(areaSqm).toLocaleString()+" "+M2;
    }
    function lotAreaForSetbacks(feat, info){
      info = info || lastParcelInfo || {};
      var attrs=(feat && feat.attributes) || {};
      return valOr(getLotAreaSqm(attrs), valOr(geomAreaSqmSafe(feat && feat.geometry), parseNumberLike(info.areaText)));
    }
    function ringArea2D(points){
      var sum=0;
      for(var i=0;i<points.length;i++){
        var a=points[i], b=points[(i+1)%points.length];
        sum += (Number(a[0])||0)*(Number(b[1])||0) - (Number(b[0])||0)*(Number(a[1])||0);
      }
      return sum/2;
    }
    function largestOuterRing(geom){
      var rings=(geom && geom.rings) || [];
      if(!rings.length) return null;
      var best=null, bestArea=-Infinity;
      for(var i=0;i<rings.length;i++){
        var ring=rings[i];
        if(!Array.isArray(ring) || ring.length<4) continue;
        var area=Math.abs(ringArea2D(ring));
        if(area>bestArea){ best=ring; bestArea=area; }
      }
      return best;
    }
    function localMetricPointsForRing(geom,ring){
      var clean=(ring||[]).map(function(p){ return [Number(p && p[0]),Number(p && p[1])]; }).filter(function(p){ return Number.isFinite(p[0])&&Number.isFinite(p[1]); });
      if(clean.length<3) return [];
      var sr=geom && geom.spatialReference;
      var looksGeographic=!!(sr && (sr.isGeographic || sr.wkid===4326 || sr.latestWkid===4326)) || clean.every(function(p){ return Math.abs(p[0])<=180&&Math.abs(p[1])<=90; });
      if(!looksGeographic) return clean.map(function(p){ return {x:p[0],y:p[1]}; });
      var lat=clean.reduce(function(sum,p){ return sum+p[1]; },0)/clean.length;
      var latRad=lat*Math.PI/180;
      var mx=111320*Math.max(0.15,Math.cos(latRad));
      var my=110540;
      return clean.map(function(p){ return {x:p[0]*mx,y:p[1]*my}; });
    }
    function orientedLotMetricsForSetbacks(points){
      if(!points || points.length<3) return null;
      var best=null;
      for(var i=0;i<points.length-1;i++){
        var a=points[i], b=points[i+1];
        var dx=b.x-a.x, dy=b.y-a.y;
        if(Math.hypot(dx,dy)<0.2) continue;
        var angle=Math.atan2(dy,dx);
        var cos=Math.cos(angle), sin=Math.sin(angle);
        var minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
        for(var j=0;j<points.length;j++){
          var p=points[j];
          var u=p.x*cos+p.y*sin;
          var v=-p.x*sin+p.y*cos;
          if(u<minU) minU=u;
          if(u>maxU) maxU=u;
          if(v<minV) minV=v;
          if(v>maxV) maxV=v;
        }
        var w=maxU-minU, d=maxV-minV, area=w*d;
        if(w>0 && d>0 && (!best || area<best.area)) best={width:Math.min(w,d),depth:Math.max(w,d),area:area};
      }
      return best;
    }
    function estimateLotDimensionsForSetbacks(geom,areaSqm){
      var ring=largestOuterRing(geom);
      var pts=localMetricPointsForRing(geom,ring);
      var oriented=orientedLotMetricsForSetbacks(pts);
      if(oriented && Number.isFinite(oriented.width) && Number.isFinite(oriented.depth)){
        return {width:oriented.width,frontage:oriented.width,depth:oriented.depth,source:"estimated from selected lot geometry"};
      }
      if(Number.isFinite(areaSqm) && areaSqm>0){
        var side=Math.sqrt(areaSqm);
        return {width:side,frontage:side,depth:side,source:"estimated from lot area"};
      }
      return {width:null,frontage:null,depth:null,source:"unavailable"};
    }
    const QDC_NARROW_FRONTAGE_TABLE=[
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
      if(frontage==null || frontage>15) return null;
      return QDC_NARROW_FRONTAGE_TABLE.find(function(r){ return frontage>r.min && frontage<=r.max; }) || QDC_NARROW_FRONTAGE_TABLE[QDC_NARROW_FRONTAGE_TABLE.length-1];
    }
    function qdcSideRearSetbackFor(height, frontage){
      var h=Math.max(0,Number(height)||0);
      var narrow=qdcNarrowFrontageRow(frontage);
      if(h<=4.5) return {value:narrow?narrow.low:1.5,basis:narrow?("QDC Table A2 narrow frontage band "+narrow.label):"QDC MP 1.2 side/rear height band up to 4.5 m"};
      if(h<=7.5) return {value:narrow?narrow.mid:2,basis:narrow?("QDC Table A2 narrow frontage band "+narrow.label):"QDC MP 1.2 side/rear height band over 4.5 m and up to 7.5 m"};
      return {value:2+(0.5*Math.ceil((h-7.5)/3)),basis:"QDC MP 1.2 2 m plus 0.5 m for every 3 m, or part, over 7.5 m"};
    }
    function classifyLccSetbackRoute(label){
      var k=planKey(label);
      if(!k) return null;
      if(k.includes("environmentalmanagementandconservation")) return "environmental";
      if(k.includes("emergingcommunity")) return "emerging";
      if(k.includes("lowmediumdensityresidential") || k.includes("lowmedium")) return "lowMedium";
      if(k.includes("lowdensityresidential") || k.includes("lowdensity")){
        if(k.includes("smallacreage")) return "lowSmallAcreage";
        if(k.includes("acreage")) return "lowAcreage";
        return "low";
      }
      if(k.includes("ruralresidential")) return "ruralResidential";
      if(k==="rural" || k.includes("ruralzone")) return "rural";
      return null;
    }
    function uniqueSetbackLabels(labels){
      var out=[], seen=new Set();
      for(var i=0;i<labels.length;i++){
        var text=String(labels[i]||"").trim();
        if(!text) continue;
        var key=planKey(text);
        if(seen.has(key)) continue;
        seen.add(key);
        out.push(text);
      }
      return out;
    }
    async function labelsFromLayerForLccSetbacks(layerNode,geom){
      var labels=[];
      var title=(layerNode && layerNode.title) || nodePath(layerNode);
      if(classifyLccSetbackRoute(title)) labels.push(title);
      try{
        var g=bufferedAOIFor(layerNode,geom);
        var q=await layerNode.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:10,maxRecordCountFactor:2});
        (q.features||[]).forEach(function(f){
          var attrs=f.attributes||{};
          labels.push(pickZoneLabel(attrs),guessLabelFromAttrs(attrs));
        });
      }catch(e){}
      try{
        var res=await legendFromRendererUsingFeatures(layerNode,geom);
        (res.items||[]).forEach(function(item){ labels.push(item.label); });
      }catch(e){}
      return uniqueSetbackLabels(labels);
    }
    async function resolveLccSetbackContext(geom){
      if(!geom) return {route:null,zoneLabel:"No parcel selected",labels:[],source:"none"};
      var nodes=flattenFeatureNodes().filter(function(n){
        var t=(n&&n.title)||"", p=nodePath(n);
        return !underDNTChain(n) && (isZoning(t,p) || !!classifyLccSetbackRoute(t+" "+p));
      });
      var allLabels=[];
      for(var i=0;i<nodes.length;i++){
        var n=nodes[i];
        try{
          await n.load();
          var cnt=await countFeatures(n,geom);
          if(cnt<=0) continue;
          var labels=await labelsFromLayerForLccSetbacks(n,geom);
          allLabels.push.apply(allLabels,labels);
          for(var j=0;j<labels.length;j++){
            var route=classifyLccSetbackRoute(labels[j]);
            if(route) return {route:route,zoneLabel:labels[j],labels:uniqueSetbackLabels(allLabels),source:n.title||nodePath(n)};
          }
        }catch(e){}
      }
      var unique=uniqueSetbackLabels(allLabels);
      var route=null;
      for(var k=0;k<unique.length;k++){ route=classifyLccSetbackRoute(unique[k]); if(route) break; }
      return {route:route,zoneLabel:route?(unique.find(function(l){ return classifyLccSetbackRoute(l)===route; })||LOGAN_SETBACK_ZONE_CONFIG[route].name):"Zoning not matched",labels:unique,source:"zoning scan"};
    }
    function loganRoadSetbackText(cfg, route){
      if(!cfg) return {value:"Confirm manually",detail:"Zoning was not matched to a Logan dwelling-house road-boundary outcome."};
      if(cfg.road==="qdc") return {value:"QDC MP 1.1 / MP 1.2",detail:"Logan AO1 applies QDC MP 1.1 for lots under 450 m2 and QDC MP 1.2 for lots 450 m2 or greater, unless a Logan AO4 road-boundary override applies."};
      if(cfg.road==="ruralResidential") return {value:"10 m",detail:"Rural residential AO4. Carbrook precinct lots fronting Mount Cotton Road or Beenleigh-Redland Bay Road use 20 m."};
      return {value:metresText(cfg.road),detail:"Logan AO4 road-boundary clearance."};
    }
    function calculateLccSetbacks(feat, opts){
      feat = feat || lastParcelInfo.feature;
      opts = opts || {};
      if(!feat || !feat.geometry) return {empty:true,notes:["Select a Logan parcel first."]};
      var info=opts.info || lastParcelInfo || {};
      var wallHeight=setbackWallHeightFromInput(opts.wallHeight);
      var areaSqm=lotAreaForSetbacks(feat, info);
      var dimensions=estimateLotDimensionsForSetbacks(feat.geometry,areaSqm);
      var context=opts.context || lastLccSetbackContext || {};
      var route=context.route;
      var cfg=LOGAN_SETBACK_ZONE_CONFIG[route];
      var rows=[], notes=[];
      var sources=[
        {label:"Logan dual occupancy and dwelling house code compliance table",url:LOGAN_SETBACK_SOURCES.dwellingHouse},
        {label:"Logan Planning Scheme ePlan",url:LOGAN_SETBACK_SOURCES.eplan}
      ];
      if(cfg && cfg.source) sources.push({label:cfg.name+" zone code",url:cfg.source});

      rows.push({boundary:"Lot metrics",value:metresText(dimensions.frontage)+" frontage / "+metresText(dimensions.depth)+" depth",detail:"Area "+formatSetbackArea(areaSqm)+". Width/frontage and depth are "+dimensions.source+"."});
      rows.push({boundary:"Planning context",value:cfg?cfg.name:"Not automatically matched",detail:context.zoneLabel && (!cfg || context.zoneLabel!==cfg.name) ? context.zoneLabel : (context.source||"")});

      if(!cfg){
        sources.push({label:"Queensland Development Code",url:LOGAN_SETBACK_SOURCES.qdc});
        rows.push({boundary:"Setback source",value:"Confirm manually",detail:"The zoning layer did not resolve to a supported Logan dwelling-house setback zone."});
        notes.push("Use the Logan Planning Scheme property report and QDC where applicable. Previous approvals, plans of development, building envelopes, easements and overlays can change siting outcomes.");
        return {regime:"logan-unmatched",classLabel:"Logan zoning not matched",areaSqm:areaSqm,dimensions:dimensions,wallHeight:wallHeight,sourceLabel:sources[0].label,sourceUrl:sources[0].url,rows:rows,notes:notes,sources:sources,context:context};
      }

      var road=loganRoadSetbackText(cfg, route);
      rows.push({boundary:"Road boundary",value:road.value,detail:road.detail});
      rows.push({boundary:"Carport concession",value:"0 m where AO4 conditions are met",detail:"Carport max 6 m by 6 m, max 3.5 m high, and unenclosed except where the rear attaches to a structure."});

      if(cfg.sideRear==="qdc"){
        var qdc=qdcSideRearSetbackFor(wallHeight,dimensions.frontage);
        rows.push({boundary:"Side and rear",value:metresText(qdc.value),detail:"For wall height "+metresText(wallHeight)+". "+qdc.basis+"."});
        sources.push({label:"Queensland Development Code",url:LOGAN_SETBACK_SOURCES.qdc});
      }else{
        rows.push({boundary:"Side and rear",value:metresText(cfg.sideRear),detail:"Logan AO5 side and rear boundary clearance for this zone or precinct."});
      }
      rows.push({boundary:"Rear lots",value:"4.9 m garage setback where triggered",detail:"Applies where a rear lot shares access by access strip, easement or common property with four or more rear lots."});

      if(route==="ruralResidential"){
        notes.push("Rural residential road setbacks depend on precinct and road frontage. Confirm Carbrook, Cottage rural, Park living or Park residential precinct details in the current ePlan.");
      }
      if(route==="low"){
        notes.push("Low density residential precincts can alter outcomes. Acreage and Small acreage use 10 m road and 3 m side/rear clearances; other low density residential lots generally use QDC unless another Logan AO applies.");
      }
      notes.push("Logan AO3/AO4/AO5/AO6 and QDC MP 1.1/1.2 can be overridden or added to by zone-code provisions, overlays, approved envelopes, easements and development approvals.");
      return {regime:"logan-"+route,classLabel:cfg.name,areaSqm:areaSqm,dimensions:dimensions,wallHeight:wallHeight,sourceLabel:sources[0].label,sourceUrl:sources[0].url,rows:rows,notes:notes,sources:sources,context:context};
    }
    function setbackInfoToHTML(info){
      if(!info || info.empty){
        var msg=(info && info.notes && info.notes[0]) || "Select a parcel.";
        return '<p class="setback-muted">'+htmlEsc(msg)+'</p>';
      }
      var sources=(info.sources||[]).length
        ? (info.sources||[]).map(function(s){ return '<a href="'+htmlEsc(s.url)+'" target="_blank" rel="noopener">'+htmlEsc(s.label)+'</a>'; }).join(" | ")
        : (info.sourceUrl ? '<a href="'+htmlEsc(info.sourceUrl)+'" target="_blank" rel="noopener">'+htmlEsc(info.sourceLabel)+'</a>' : htmlEsc(info.sourceLabel || "Setback source"));
      var dimParts=[
        info.wallHeight!=null ? "Wall height: "+metresText(info.wallHeight) : null,
        info.dimensions && info.dimensions.frontage!=null ? "Width/frontage: "+metresText(info.dimensions.frontage) : null,
        info.dimensions && info.dimensions.depth!=null ? "Depth: "+metresText(info.dimensions.depth) : null
      ].filter(Boolean).join(". ");
      var dimText=dimParts ? ". "+dimParts+"." : "";
      var rows=(info.rows||[]).map(function(row){
        return '<tr><th>'+htmlEsc(row.boundary)+'</th><td><span class="setback-value">'+htmlEsc(row.value)+'</span><span class="setback-detail">'+htmlEsc(row.detail)+'</span></td></tr>';
      }).join("");
      var notes=(info.notes||[]).length ? '<ul class="setback-notes">'+info.notes.map(function(n){ return '<li>'+htmlEsc(n)+'</li>'; }).join("")+'</ul>' : "";
      return [
        '<p class="setback-summary">'+htmlEsc(info.classLabel)+' - '+htmlEsc(formatSetbackArea(info.areaSqm))+htmlEsc(dimText)+'</p>',
        '<p class="setback-source">Source: '+sources+'</p>',
        '<table class="setback-table"><tbody>'+rows+'</tbody></table>',
        notes
      ].join("");
    }
    function setLccSetbacksHTML(html){
      if($("lccSetbacksContent")) $("lccSetbacksContent").innerHTML=html;
      if($("lccSetbacksTabContent")) $("lccSetbacksTabContent").innerHTML=html;
    }
    function updateLccSetbacksPanel(){
      setLccSetbacksHTML(setbackInfoToHTML(calculateLccSetbacks()));
    }
    function resetLccSetbackContext(){
      lastLccSetbackContext={route:null,zoneLabel:"Resolving zoning",labels:[],source:"pending"};
    }
    async function refreshLccSetbacksForGeometry(geom){
      if(!geom){ updateLccSetbacksPanel(); return lastLccSetbackContext; }
      setLccSetbacksHTML('<p class="setback-muted">Resolving Logan zoning...</p>');
      lastLccSetbackContext=await resolveLccSetbackContext(geom);
      updateLccSetbacksPanel();
      return lastLccSetbackContext;
    }
    (function initLccSetbackHeightInputs(){
      var ids=["lccSetbackWallHeight","lccSetbackWallHeightTab"];
      function sync(source){
        ids.forEach(function(id){
          var input=$(id);
          if(input && input!==source) input.value=source.value;
        });
        try{ lastReportHTML=null; lastReportTitle="Property Report"; }catch(e){}
        updateLccSetbacksPanel();
      }
      ids.forEach(function(id){
        var input=$(id);
        if(!input) return;
        input.addEventListener("input",function(){ sync(input); });
        input.addEventListener("change",function(){ sync(input); });
      });
    })();
    window.calculateLccSetbacks=calculateLccSetbacks;

    const bufferedAOIFor=function(node,geom){
      try{
        const gt=String(node.geometryType||"").toLowerCase();
        if(gt==="point"||gt==="multipoint"||gt==="polyline") return geometryEngine.buffer(geom,TOUCH_BUFFER_M,"meters");
      }catch(e){}
      return geom;
    };
    async function countFeatures(node,geom){
      const g=bufferedAOIFor(node,geom);
      try{
        if(typeof node.queryFeatureCount==="function"){
          const c=await node.queryFeatureCount({geometry:g,spatialRelationship:"intersects"});
          return Number(c)||0;
        }
      }catch(e){}
      try{
        if(typeof node.queryFeatures==="function"){
          const q=await node.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:1});
          return (q.features&&q.features.length)?1:0;
        }
      }catch(e){}
      return 0;
    }

    async function swatchHTML(symbol){
      try{
        const el=await symbolUtils.renderPreviewHTML(symbol,{size:[SWATCH_PX-2,SWATCH_PX-2]});
        if(el && el.tagName && el.tagName.toLowerCase()==="canvas"){ return '<span class="swbox"><img alt="" src="'+el.toDataURL("image/png")+'"></span>'; }
        try{ if(el){ el.setAttribute("width","100%"); el.setAttribute("height","100%"); } }catch(e){}
        return '<span class="swbox">'+(el?el.outerHTML:"")+'</span>';
      }catch(e){ return '<span class="swbox" style="background:#cfcfcf"></span>'; }
    }
    const guessLabelFromAttrs = function(attrs){
      if (!attrs) return null;
      const patt = [
        /zone.*(name|type|desc|label|category|code)?/i,
        /(planning|scheme).*zone/i,
        /(zone|category|type|class|desc|label)/i
      ];
      for (var i=0;i<patt.length;i++) {
        var r = patt[i];
        var k = Object.keys(attrs).find(function(x){ return r.test(x); });
        if (k) {
          var v = String(valOr(attrs[k],"")).trim();
          if (v) return v;
        }
      }
      return null;
    };
    function getUVInfo(renderer,attrs){
      if(!renderer||!attrs) return null;
      const fields=[renderer.field,renderer.field2,renderer.field3].filter(function(x){return !!x;});
      const delim=(renderer.fieldDelimiter!=null)?renderer.fieldDelimiter:", ";
      if(!fields.length) return null;
      const parts=fields.map(function(f){ return attrs[f]; });
      const key=parts.join(delim);
      const infos=renderer.uniqueValueInfos||[];
      let info=infos.find(function(u){ return String(u.value)===String(key); });
      if(!info) info=infos.find(function(u){ return Array.isArray(u.values)&&u.values.some(function(v){ return String(v)===String(key); }); });
      if(!info && fields.length===1){
        info=infos.find(function(u){ return String(u.value)===String(attrs[fields[0]]); }) ||
             infos.find(function(u){ return Array.isArray(u.values)&&u.values.some(function(v){ return String(v)===String(attrs[fields[0]]); }); });
      }
      return info||null;
    }
    const ZONE_KEYS=["ZONE_CODE","ZONE","ZONE_NAME","ZONING","ZONE_LABEL","ZONE_DESC","ZONE_TYPE","ZONE_CATEGORY","PLANNING_ZONE"];
    function pickZoneLabel(attrs){
  if(!attrs) return null;
  const code=String(valOr(attrs.ZONE_CODE, attrs.ZONE) || "").trim();
  const name=String(valOr(attrs.ZONE_NAME, attrs.ZONING) || "").trim();
  if(code && name) return code + " - " + name;
  for(var i=0;i<ZONE_KEYS.length;i++){
    var k=ZONE_KEYS[i], v=attrs[k];
    if(v!=null && String(v).trim()) return String(v).trim();
  }
  return null;
}
    async function legendFromRendererUsingFeatures(layerNode,lotGeom){
      const gt=String(layerNode.geometryType||"").toLowerCase();
      const isZone=isZoning(layerNode.title||"",nodePath(layerNode));
      const g=(gt==="point"||gt==="multipoint"||gt==="polyline") ? geometryEngine.buffer(lotGeom,TOUCH_BUFFER_M,"meters") : lotGeom;

      let feats=[];
      try{
        const q=await layerNode.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCountFactor:6});
        feats=q.features||[];
      }catch(e){}
      if(!feats.length) return {items:[]};

      const itemMap=new Map();
      for(var i=0;i<feats.length;i++){
        const f=feats[i];
        const gph=new Graphic({geometry:f.geometry,attributes:f.attributes,layer:layerNode});
        let sym=null;
        try{ sym=await symbolUtils.getDisplayedSymbol(gph,view); }catch(e){}
        if(!sym){
          const r=layerNode.renderer; sym = (r && (r.symbol || r.defaultSymbol)) || f.symbol || null;
        }
        if(!sym) continue;

        let label=isZone?pickZoneLabel(f.attributes):null;
        if(!label){
          const r2=layerNode.renderer;
          if(r2 && r2.type==="unique-value"){
            const info=getUVInfo(r2,f.attributes);
            if(info) label= (info.label != null) ? info.label : String(valOr(info.value, (info.values||[]).join(", ")));
          }else if(r2 && r2.type==="class-breaks" && r2.field){
            const v=Number((f.attributes&&f.attributes[r2.field]));
            if(!Number.isNaN(v)){
              const cbi=(r2.classBreakInfos||[]).find(function(b){
                const min=(b.minValue==null?-Infinity:b.minValue), max=(b.maxValue==null?Infinity:b.maxValue);
                return v>=min && v<=max;
              });
              label = (cbi && (cbi.label!=null ? cbi.label : (String(valOr(cbi.minValue,"")) + " to " + String(valOr(cbi.maxValue,""))))) || label;
            }
          }
          if(!label) label=(r2 && r2.label) || layerNode.title || guessLabelFromAttrs(f.attributes) || "Class";
        }
        const sw=await swatchHTML(sym);
        if(!itemMap.has(label)) itemMap.set(label,{label:label,swatchHTML:sw});
      }
      return {items:Array.from(itemMap.values())};
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

    const HARDWIRED = {
      bushfire: [
        /bush\s*fire/i, /bushfire/i, /bush-?fire/i, /wild\s*fire/i, /bpa\b/i,
        /bushfire\s*prone/i, /bushfire\s*hazard/i, /qfes/i
      ],
      noise: [
        /transport\s*noise\s*corridor/i, /tnc\b/i, /state.*road.*noise/i,
        /road.*traffic.*noise/i, /tmr.*noise/i, /acoustic.*corridor/i
      ]
    };
    function strHay(node){ return (String(node.title||"")+" "+nodePath(node)+" "+(node.url||"")).toLowerCase(); }

    function leafDisplayNodes(root){
      const out=[];
      const visit=function(n){
        const kids=kidsOf(n);
        if(kids.length){ for(var i=0;i<kids.length;i++){ visit(kids[i]); } }
        else{ if("visible" in n) out.push(n); }
      };
      visit(root);
      return out;
    }

    function collectLeafDisplayNodesByPredicate(pred, opts){
      opts = opts || {};
      const includeDNT = !!opts.includeDNT;
      const out=[], seen=new Set();
      const pushUnique=function(node){
        if(!node || !("visible" in node)) return;
        const key=nodePath(node)||node.id||node.title||"node";
        if(seen.has(key)) return;
        seen.add(key);
        out.push(node);
      };
      walkAny(view.map,function(n,underDNT){
        if(!includeDNT && underDNT) return;
        const t=n.title||"", p=nodePath(n), id=n.id||"", tg=(n.portalItem && n.portalItem.tags)||[];
        if(!pred(n,t,p,id,tg)) return;
        const kids=kidsOf(n);
        if(kids.length){ leafDisplayNodes(n).forEach(pushUnique); }
        else{ pushUnique(n); }
      });
      return out;
    }

    function collectAllBushfireDisplayNodes(){
      return collectLeafDisplayNodesByPredicate(function(n,t,p,id,tg){
        const hay=strHay(n);
        return HARDWIRED.bushfire.some(function(rx){return rx.test(hay);}) || isBushfire(t,p);
      },{includeDNT:true});
    }
    function collectAllNoiseDisplayNodes(){
      return collectLeafDisplayNodesByPredicate(function(n,t,p,id,tg){
        const hay=strHay(n);
        return HARDWIRED.noise.some(function(rx){return rx.test(hay);}) || isNoise(t,p);
      },{includeDNT:true});
    }

    const ancestors=function(node){ const out=[]; var p=node?node.parent:null; while(p){ out.push(p); p=p.parent; } return out; };
    const owningLayer=function(node){ var c=node; while(c && c.type==="sublayer") c=c.parent; return (c && c.type!=="sublayer") ? c : null; };
    async function awaitRenderFor(nodes){
      const layers=Array.from(new Set(nodes.map(function(n){return owningLayer(n);}).filter(function(x){return !!x;})));
      const views=[];
      for(var i=0;i<layers.length;i++){ try{ views.push(await view.whenLayerView(layers[i])); }catch(e){} }
      if(views.length){ try{ await reactiveUtils.whenOnce(function(){ return views.every(function(v){ return v.updating===false; }); }); }catch(e){} }
      await waitViewIdle(240);
    }
    async function sumCounts(nodes,geom){ let t=0; for(var i=0;i<nodes.length;i++){ t+=await countFeatures(nodes[i],geom); } return t; }

    function saveVisibility(root){
      const map=new Map();
      walkAny(root,function(n){
        if("visible" in n){
          map.set(nodePath(n),{vis:!!n.visible,op:n.opacity,min:n.minScale,max:n.maxScale,blend:n.blendMode});
        }
      });
      return map;
    }
    function restoreVisibility(root,snap){
      walkAny(root,function(n){
        if("visible" in n){
          const k=nodePath(n);
          if(snap.has(k)){
            const s=snap.get(k);
            try{ n.visible=s.vis; }catch(e){}
            if("opacity" in n && s.op!==undefined){ try{ n.opacity=s.op; }catch(e){} }
            if("blendMode" in n && s.blend!==undefined){ try{ n.blendMode=s.blend; }catch(e){} }
            try{ n.minScale=s.min; n.maxScale=s.max; }catch(e){}
          }
        }
      });
    }

    function underDNTChain(node){
      let cur=node;
      while(cur){
        const t=cur.title||"", id=cur.id||"", tg=(cur.portalItem&&cur.portalItem.tags)||[];
        if(isDNT(t,id,tg)) return true;
        cur=cur.parent;
      }
      return false;
    }    function reportScaleText(){
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


    async function screenshotFor(nodes,title,lotGeom,legendOnLot,opts){
      legendOnLot = !!legendOnLot;
      opts = opts || {};
      const forceAllVisible = !!opts.forceAllVisible;
      const legendUseExtent = !!opts.legendUseExtent;
      const legendAllRendererItems = !!opts.legendAllRendererItems;

      if(!nodes || !nodes.length || !lotGeom) return null;

      const present=forceAllVisible ? nodes.slice() : [];
      if(!forceAllVisible){
        for(var i=0;i<nodes.length;i++){ if(await countFeatures(nodes[i],lotGeom)>0) present.push(nodes[i]); }
      }
      if(!present.length && !forceAllVisible) return null;

      const visSnap=saveVisibility(view.map), scaleSnap=new Map(), opSnap=new Map(), blendSnap=new Map();

      try{
        return await withViewOnGeom(lotGeom, async function(){
          walkAny(view.map,function(n){
            if(!("visible"in n)) return;
            if(underDNTChain(n)) return;
            try{ n.visible=false; }catch(e){}
          });
          try{ selLayer.visible=true; }catch(e){}

          const targets = present.length ? present : nodes;

          for(var i=0;i<targets.length;i++){
            var n=targets[i];
            var chain=[n].concat(ancestors(n));
            for(var j=0;j<chain.length;j++){
              var a=chain[j];
              if(!("visible"in a)) continue;
              try{ a.visible=true; }catch(e){}
              if("minScale"in a || "maxScale"in a){
                if(!scaleSnap.has(a)) scaleSnap.set(a,{min:a.minScale,max:a.maxScale});
                try{ a.minScale=0; a.maxScale=0; }catch(e){}
              }
            }
            if("blendMode"in n){ if(!blendSnap.has(n)) blendSnap.set(n,n.blendMode); }
            if("opacity"in n){ if(!opSnap.has(n))    opSnap.set(n,n.opacity); }
          }
          await awaitRenderFor(targets);

          const shot=await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});

          var legendGeom=lotGeom;


          if(legendUseExtent && view?.extent){ legendGeom=view.extent; }


          else if(!legendOnLot){
            try{
              const onScr=geometryEngine.intersect(lotGeom,view.extent);
              if(onScr) legendGeom=onScr;
            }catch(e){}
          }

          const legendParts=[];
          for(var k=0;k<targets.length;k++){
            var ln=targets[k];
            if(underDNTChain(ln)) continue;
            if(typeof ln.queryFeatures!=="function" && typeof ln.queryFeatureCount!=="function") continue;
            const res = legendAllRendererItems
              ? await legendFromRendererAllItems(ln)
              : await legendFromRendererUsingFeatures(ln,legendGeom);
            const items = (res && res.items) || [];
            if(items.length){
              const inner=items.map(function(i){ return '<div class="row">'+i.swatchHTML+i.label.replace(/&/g,"&amp;")+'</div>'; }).join("");
              legendParts.push('<div style="margin-bottom:6px"><b>'+ String(ln.title||"Layer").replace(/&/g,"&amp;") +'</b><div class="leg" style="margin-top:4px">'+inner+'</div></div>');
            }
          }

          const count=await sumCounts(nodes,lotGeom);
          return {title:title,id:"rpt-"+slug(title),dataUrl:shot.dataUrl,scaleText:shot.scaleText,legendHTML:legendParts.join(""),count:count};
        });
      } finally {
        for(const [n,op] of opSnap){ try{n.opacity=op;}catch(e){} }
        for(const [n,bl] of blendSnap){ try{n.blendMode=bl;}catch(e){} }
        for(const [n,sc] of scaleSnap){ try{n.minScale=sc.min;n.maxScale=sc.max;}catch(e){} }
        restoreVisibility(view.map,visSnap);
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
          if(!s){ shots.push({title:title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote}); }
          else { if((s.count||0)===0) s.note=emptyNote; shots.push(s); }
        }else{
          shots.push({title:title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote});
        }
      }catch(err){
        console.warn("Mandatory section failed:", title, err);
        shots.push({title:title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote+" (layer unavailable)"});
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
    $("btnPrintReport").addEventListener("click", async function(){
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
      try{
        showLoading(true);
        setRpt("Locating parcel...", 12);
        var geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Logan City Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry; lotText=lastParcelInfo.lotText; areaText=lastParcelInfo.areaText; classText=lastParcelInfo.classText; addressText=lastParcelInfo.addressText; councilText=lastParcelInfo.councilText;
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){
            const info=parcelInfoFromFeature(probe); geom=probe.geometry;
            lotText=info.lotText; areaText=info.areaText; classText=info.classText; addressText=info.addressText; councilText=info.councilText;
            lastParcelInfo={feature:probe,lotText:lotText,areaText:areaText,classText:classText,addressText:addressText,councilText:councilText};
          }
        }
        setRpt("Parcel located", 18, "rptS1");

        if(geom){
          setRpt("Resolving address...", 25);
          try{ addressText=await resolveBestAddress(geom,lastParcelInfo.feature); }catch(e){}
          setRpt("Address resolved", 35, "rptS2");
          lastParcelInfo.addressText = addressText || lastParcelInfo.addressText;
          setRpt("Resolving setback rules...", 38);
          try{
            lastLccSetbackContext = await resolveLccSetbackContext(geom);
            updateLccSetbacksPanel();
          }catch(e){}
        }

        setRpt("Rendering base map...", 42);
        const baseShot = geom
          ? await withViewOnGeom(geom, async function(){ try{selLayer.visible=true;}catch(e){}; await waitViewIdle(200); return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}); })
          : await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});

        setRpt("Collecting overlays...", 55);
        var cats;
        if(geom){
          cats = await (async function(){
            const out={zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],bushfire:[],others:[]};
            const arr=[];
            walkAny(view.map,function(n,underDNT){
              if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function") && !underDNT) arr.push(n);
            });
            for(var i=0;i<arr.length;i++){
              const n=arr[i];
              try{
                await n.load();
                const cnt=await countFeatures(n,geom); if(!cnt) continue;
                const t=n.title||"", p=nodePath(n);
                if(isZoning(t,p)) out.zoning.push(n);
                else if(isUtility(t,n.id,(n.portalItem && n.portalItem.tags)||[]) || isWaterOrSewer(p)) out.utilities.push(n);
                else if(isAcid(t,p)) out.acid.push(n);
                else if(isNoise(t,p)) out.noise.push(n);
                else if(isTransport(t,p)) out.transport.push(n);
                else if(isAir(t,p)) out.air.push(n);
                else if(isBushfire(t,p)) out.bushfire.push(n);
                else out.others.push(n);
              }catch(e){}
            }
            return out;
          })();
        }else{
          cats={zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],others:[]};
        }

        const shots=[];
        const tasks=[
          ["Zoning", async function(){ if(cats.zoning.length){ const s=await screenshotFor(cats.zoning,"Zoning",geom,true); if(s) shots.push(s); } }],
          ["Bushfire", async function(){ await addMandatorySection(shots,"Bushfire",collectAllBushfireDisplayNodes,geom,baseShot,"No bushfire Lv"); }],
          ["Utilities", async function(){ const all=collectLeafDisplayNodesByPredicate(function(n,t,p,id,tg){ return isUtility(t,id,tg)||isWaterOrSewer(p); },{includeDNT:true}); if(all.length){ const s=await screenshotFor(all,"Utilities",geom,false,{forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); } } ],
          ["Acid overlays", async function(){ if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); } }],
          ["Transport", async function(){ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); } }],
          ["Air quality", async function(){ if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); } }],
          ["Transport Noise Corridor", async function(){ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,baseShot,"No noise Lv"); }],
          ["Other overlays", async function(){ for (var i=0;i<cats.others.length;i++) { const n=cats.others[i]; const t=n.title||"", p=nodePath(n); if (isBushfire(t,p) || isNoise(t,p)) continue; const s=await screenshotFor([n], n.title || "Overlay", geom); if (s) shots.push(s); } }]
        ];
        for(var ti=0;ti<tasks.length;ti++){
          const name=tasks[ti][0], fn=tasks[ti][1];
          setRpt("Rendering " + name + "...", 55 + Math.round(((ti+1)/tasks.length)*30));
          await fn();
        }
        dedupeShotsByTitle(shots,"Transport Noise Corridor");
        setRpt("Overlays rendered", 87, "rptS3");

        setRpt("Composing document...", 93);
        const now=new Date();
        const fmt=function(d){ return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}); };
        const esc=htmlEsc;
        const logoSrc="./images/lot-wise-icon.png";

        // ===== Dynamic titles for print/download =====
        const toFileSafe = function(s){ return String(s).replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim(); };
        const baseName = (lastParcelInfo.addressText && lastParcelInfo.addressText !== "--")
          ? lastParcelInfo.addressText
          : ((lastParcelInfo.lotText && lastParcelInfo.lotText !== "--") ? ("Lot " + lastParcelInfo.lotText) : "Property");
        const reportDisplayTitle = baseName + " - Property Report";
        const reportFileTitle = toFileSafe(reportDisplayTitle);

        const html=[];
        html.push("<!doctype html><meta charset='utf-8'><title>", esc(reportFileTitle), "</title>");
        html.push("<style>",
          ":root{--brand:#a70b13;--brand2:#7f0e15;--bg:#f6f7f9;--ink:#0b0d12;--border:#e1e3e6;--radius:14px;--shadow:0 6px 18px rgba(16,21,28,.08);--panel:#ffffff;--panel-2:#f8f9fb;--muted:#5b6470}",
          "@font-face{font-family:'Hanken Grotesk';font-style:normal;font-weight:300 900;font-display:swap;src:url('./fonts/hanken-grotesk-latin.woff2') format('woff2')}@font-face{font-family:'Hanken Grotesk';font-style:italic;font-weight:300 900;font-display:swap;src:url('./fonts/hanken-grotesk-italic-latin.woff2') format('woff2')}body{font-family:'Hanken Grotesk',sans-serif;margin:18px;color:var(--ink);background:var(--bg);line-height:1.4}",
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
          "@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.card{page-break-inside:avoid}}",
          "</style>");
        html.push("<body>");
        html.push("<div class='card brandbar'><img src='",logoSrc,"' alt='Lot Wise'><h1>", esc(reportDisplayTitle), "</h1><div class='muted'>",fmt(now),"</div></div>");

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
                              for(var si=0;si<shots.length;si++){
                                var ss=shots[si];
                                var ct=(ss.count!=null)?(" ("+ss.count+" feature"+(ss.count===1?"":"s")+")"):"";
                                html.push("<li><a class='sum-link' style='color:#7a0f16;font-weight:700;text-decoration:none' href='#",ss.id,"'>",esc(ss.title),"</a>",ct,(ss.note?(" - "+esc(ss.note)):""),"</li>");
                              }
                              html.push("</ul>");
                            }else{
                              html.push("<i>No overlays intersect this parcel (excluding DNT groups).</i>");
                            }
                          html.push("</div>",
                        "</div>",
                        "<div><h2 class='section-title'>Map</h2><img class='map' src='",baseShot.dataUrl,"' alt='Map'>",reportScaleHTML(baseShot),"</div>",
                      "</div>",
                      "<div class='rpt-footer'>Generated by Lot Wise. Confirm against the current planning scheme and authoritative datasets before relying on this report.</div>",
                    "</div>");
        html.push("</div>");

        for(var si2=0;si2<shots.length;si2++){
          var s=shots[si2];
          html.push("<div class='card' id='",s.id,"'>",
            "<div class='overlay-header'>",
              "<h2 class='section-title' style='margin:0'>",esc(s.title),"</h2>",
              "<div class='overlay-actions'>",
                "<a class='backbtn' href='#summary'>Back to Summary</a>",
              "</div>",
            "</div>",
            "<div class='map-legend'>",
              "<div><img class='map' src='",s.dataUrl,"' alt='",esc(s.title),"'>",reportScaleHTML(s),"</div>",
              "<div class='leg'>", (s.note ? "<div class='note'>"+esc(s.note)+"</div>" : ""), (s.legendHTML || ""), "</div>",
            "</div>",
          "</div>");
        }

        html.push("<div class='card rpt-footer'><img src='",logoSrc,"' alt='Lot Wise' style='width:18px;height:18px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/> Logan City Council - Lot Wise. Indicative only.</div>");
        html.push("</body>");

        const htmlOut = html.join("");
        return {html: htmlOut, title: reportFileTitle};
      }catch(e){ console.error(e); alert("Could not create report."); }
      finally{ showLoading(false); }
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
    [["summary"],["setbacks"],["proposal"],["yield"]].forEach(function(pair){
      const name=pair[0];
      const t=$("tab-"+name), p=$("panel-"+name);
      if(!t||!p) return;
      t.addEventListener("click",function(){
        Array.prototype.forEach.call(document.querySelectorAll(".tab"),function(el){ el.setAttribute("aria-selected","false"); });
        Array.prototype.forEach.call(document.querySelectorAll(".panel"),function(el){ el.classList.remove("active"); });
        t.setAttribute("aria-selected","true"); p.classList.add("active");
      });
    });
    $("btnHome").addEventListener("click",function(event){
      event.preventDefault();
      window.location.assign(new URL("Index.html",window.location.href).href);
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

      const setStatus = function(msg, isError){
        statusEl.textContent = msg;
        statusEl.classList.toggle("error", !!isError);
      };
      const setBusy = function(busy){
        if(submitBtn){
          submitBtn.disabled = busy;
          submitBtn.textContent = busy ? "Uploading..." : "Upload & Import";
        }
        if(input){
          input.disabled = busy;
        }
      };
      const renderResults = function(items){
        items = items || [];
        if(!wrap || !list) return;
        if(!items.length){
          wrap.hidden = true;
          list.innerHTML = "";
          return;
        }
        wrap.hidden = false;
        list.innerHTML = items.map(function(sub){
          const lotRaw = sub.lot || "";
          const planRaw = sub.plan || "";
          const lot = htmlEsc(lotRaw || "?");
          const plan = htmlEsc(planRaw || "Unknown plan");
          const area = sub.areaSqm ? (sub.areaSqm.toLocaleString()+" sqm") : "Area N/A";
          const btn = (sub.lot && sub.plan)
            ? "<button class=\"pod-zoom-btn\" data-lot=\""+attrEsc(lotRaw)+"\" data-plan=\""+attrEsc(planRaw)+"\">Use</button>"
            : "";
          return "<li><div class=\"pod-result-row\">"+btn+"<div>Lot "+lot+" on "+plan+" ("+area+")</div></div></li>";
        }).join("");
      };
      list && list.addEventListener("click", async function(evt){
        const btn = evt.target.closest(".pod-zoom-btn");
        if(!btn) return;
        evt.preventDefault();
        let lot = btn.getAttribute("data-lot");
        let plan = btn.getAttribute("data-plan");
        if(!lot || !plan){
          const txt = (btn.closest(".pod-result-row") || {}).innerText || "";
          const m = txt.match(/Lot\\s+(\\S+)\\s+on\\s+(\\S+)/i);
          if(m){ lot = m[1]; plan = m[2]; }
        }
        if(!lot || !plan){
          setStatus("Missing lot/plan on selection.", true);
          return;
        }
        setBusy(true);
        setStatus("Zooming to Lot "+lot+" on "+plan+"...");
        const ok = await focusOnLotPlan(lot, plan);
        setBusy(false);
        setStatus(ok ? ("Focused on Lot "+lot+" on "+plan+".") : ("Could not locate Lot "+lot+" on "+plan+" in the available parcel datasets."), !ok);
      });

      input.addEventListener("change",function(){
        const file = input.files && input.files[0];
        const nameEl = $("podFileName");
        if(file){
          if(nameEl) nameEl.textContent = file.name;
          setStatus("Ready to import "+file.name);
        }else{
          if(nameEl) nameEl.textContent = "No file chosen";
          setStatus("Select a POD PDF to begin.");
          renderResults([]);
        }
      });

      form.addEventListener("submit", async function(evt){
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
          let msg = count ? ("Parsed "+count+" subdivision"+(count===1? "":"s")+" locally.") : "No subdivisions detected.";
          let statusError = false;
          const focusTarget = subdivisions.find(function(sub){ return sub.lot && sub.plan; });
          if(count === 1 && focusTarget){
            const zoomed = await focusOnLotPlan(focusTarget.lot, focusTarget.plan);
            if(zoomed){
              msg += " Zoomed to Lot "+focusTarget.lot+" on "+focusTarget.plan+".";
            }else{
              msg += " Could not locate Lot "+focusTarget.lot+" on "+focusTarget.plan+" in the available parcel datasets.";
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
      const setFile = function(file){
        if(!file) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        const nameEl = $("podFileName");
        if(nameEl) nameEl.textContent = file.name;
        setStatus("Ready to import "+file.name);
      };
      const prevent = function(e){ e.preventDefault(); e.stopPropagation(); };
      ["dragenter","dragover","dragleave","drop"].forEach(function(ev){
        if(dropZone) dropZone.addEventListener(ev, prevent);
      });
      if(dropZone){
        dropZone.addEventListener("dragenter", function(){ dropZone.classList.add("dragover"); });
        dropZone.addEventListener("dragleave", function(){ dropZone.classList.remove("dragover"); });
        dropZone.addEventListener("dragend", function(){ dropZone.classList.remove("dragover"); });
        dropZone.addEventListener("drop", function(ev){
          dropZone.classList.remove("dragover");
          const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
          if(file && file.type==="application/pdf"){
            setFile(file);
          }else{
            setStatus("Drop a PDF file.", true);
          }
        });
      }
    })();

    /* ============================================================
       === Lot/Plan Search source (QLD) ============================
       ============================================================ */

    function normalizePlanText(p){ return String(p||"").toUpperCase().replace(/\s+/g,""); }
    function parseLotPlan(text){
      if(!text) return null;
      var s=String(text).toUpperCase();
      s=s.replace(/[,]+/g," ").replace(/\bon\b/ig," ").replace(/\blot\b/ig," ").replace(/\s+/g," ").trim();
      var m = s.match(/^\s*(\d+)\s*\/\s*([A-Z]{1,4}\s*\d{1,8})\s*$/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      m = s.match(/^\s*(\d+)\s+([A-Z]{1,4}\s*\d{1,8})\s*$/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      m = s.match(/^\s*([A-Z]{1,4}\s* \d{1,8})\s+(\d+)\s*$/);
      if(m) return {lot:m[2], plan:normalizePlanText(m[1])};
      return null;
    }

    let _parcelLayerCache=null;
    async function getParcelLayers(){
      if(_parcelLayerCache) return _parcelLayerCache;
      const candidates=flattenFeatureNodes();
      const polys=[];
      for(var i=0;i<candidates.length;i++){
        var node=candidates[i];
        try{
          await node.load();
          if(node.geometryType==="polygon" && (looksLikeParcelLayer(node) || hasParcelFields(node))){
            polys.push(node);
          }
        }catch(e){}
      }
      _parcelLayerCache=polys;
      return polys;
    }

    function escSQL(s){ return String(s).replace(/'/g,"''"); }
    function isIntegerField(f){ const t=String(f.type||"").toLowerCase(); return t.indexOf("integer")!==-1; }
    function isTextField(f){ const t=String(f.type||"").toLowerCase(); return t.indexOf("string")!==-1; }

    function buildLotPlanWhere(layer, lot, plan){
      const flds = Array.isArray(layer.fields)?layer.fields:[];
      const lotFields = flds.filter(function(f){
        const nm = String(f.name||"").toUpperCase();
        if(/LOT_AREA/.test(nm)) return false;
        return /\b(LOT|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM)\b/.test(nm) || /^LOT$/.test(nm);
      });
      const planFields = flds.filter(function(f){
        const nm = String(f.name||"").toUpperCase();
        return /\b(PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT)\b/.test(nm);
      });

      const lotClauses=[];
      const lotNum = Number(lot);
      for(var i=0;i<lotFields.length;i++){
        var f=lotFields[i];
        if(isIntegerField(f) && !Number.isNaN(lotNum)){
          lotClauses.push(f.name + "=" + lotNum);
        }else if(isTextField(f)){
          lotClauses.push("UPPER(" + f.name + ") LIKE '%" + escSQL(String(lot).toUpperCase()) + "%'");
        }
      }

      const planClauses=[];
      const planU = escSQL(plan.toUpperCase());
      const planCompact = escSQL(plan.toUpperCase().replace(/[^A-Z0-9]/g,""));
      const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
      const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      for(var j=0;j<planFields.length;j++){
        var f2=planFields[j];
        if(isTextField(f2)){
          var fieldExpr = "UPPER(" + f2.name + ")";
          var scrubExpr = "REPLACE(REPLACE(REPLACE(" + fieldExpr + ", ' ', ''), '-', ''), '/', '')";
          planClauses.push(fieldExpr + " LIKE '%" + planU + "%'");
          planClauses.push(scrubExpr + " LIKE '%" + planCompact + "%'");
          if(/LOT[_ ]?PLAN|LOTPLAN|LOT_PLAN/i.test(f2.name)){
            planClauses.push(fieldExpr + " LIKE '%" + lotPlanFull + "%'");
            planClauses.push(scrubExpr + " LIKE '%" + lotPlanCompact + "%'");
          }
        }
      }

      const parts=[];
      if(lotClauses.length) parts.push("("+lotClauses.join(" OR ")+")");
      if(planClauses.length) parts.push("("+planClauses.join(" OR ")+")");
      if(!parts.length) return null;
      return parts.join(" AND ");
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
        "  UPPER(lot)='"+lotU+"'",
        "  OR UPPER(lotplan) LIKE '%"+lotPlanFull+"%'",
        "  OR REPLACE(REPLACE(REPLACE(UPPER(lotplan),' ',''),'-',''),'/','') LIKE '%"+lotPlanCompact+"%'",
        ") AND (",
        "  UPPER(plan) LIKE '%"+planU+"%'",
        "  OR REPLACE(REPLACE(REPLACE(UPPER(plan),' ',''),'-',''),'/','') LIKE '%"+planCompact+"%'",
        "  OR REPLACE(REPLACE(REPLACE(UPPER(lotplan),' ',''),'-',''),'/','') LIKE '%"+lotPlanCompact+"%'",
        ")"
      ].join("\\n");
    }

    async function queryLotPlanFallback(lot, plan){
      if(!LOTPLAN_FALLBACK_URLS.length) return [];
      const results=[];
      const compact = (""+lot+plan).toUpperCase().replace(/[^A-Z0-9]/g,"");
      for(const url of LOTPLAN_FALLBACK_URLS){
        const isLotplanOnly = /LandParcelPropertyFramework/gi.test(url);
        const where = isLotplanOnly
          ? "UPPER(lotplan)='"+compact+"'"
          : (buildFallbackLotPlanWhere(lot, plan) || "UPPER(lotplan)='"+compact+"'");
        try{
          const params = new URLSearchParams({
            f:"json",
            where:where,
            outFields:"*",
            returnGeometry:"true",
            outSR:String((view && view.spatialReference && view.spatialReference.wkid)||3857),
            maxRecordCountFactor:"5"
          });
          const res = await fetch(url+"/query",{
            method:"POST",
            headers:{"Content-Type":"application/x-www-form-urlencoded"},
            body:params
          });
          if(!res.ok) throw new Error("Fallback lot plan query failed: "+res.status);
          const json = await res.json();
          (json.features||[]).forEach(function(f){
            const g = (Graphic.fromJSON ? Graphic.fromJSON(f) : new Graphic({geometry:f.geometry,attributes:f.attributes}));
            if(!g.geometry && f.geometry) g.geometry = f.geometry;
            if(g.geometry && !g.geometry.spatialReference && view && view.spatialReference){
              g.geometry.spatialReference = view.spatialReference;
            }
            results.push({layer:{title:"Lot/Plan (Fallback)"}, feature:g});
          });
          if(results.length) break;
        }catch(e){
          console.warn("Lot/Plan fallback error:", e);
        }
      }
      return results;
    }

    async function queryLotPlanAcrossLayers(lot, plan){
      const layers = await getParcelLayers();
      const out=[];
      for(var i=0;i<layers.length;i++){
        const L=layers[i];
        try{
          const where = buildLotPlanWhere(L, lot, plan);
          if(!where) continue;
          const q = await L.queryFeatures({
            where: where,
            outFields:["*"],
            returnGeometry:true,
            maxRecordCountFactor:5
          });
          for(var j=0;j<(q.features||[]).length;j++){
            out.push({layer:L, feature:q.features[j]});
          }
        }catch(e){ /* per-layer errors ignored */ }
      }
      if(!out.length){
        const fallback = await queryLotPlanFallback(lot, plan);
        if(fallback && fallback.length) out.push.apply(out,fallback);
      }
      return out;
    }

    async function focusOnLotPlan(lot, plan){
      if(!lot || !plan) return false;
      try{
        await view.when();
        showLoading(true);
        console.log("[LotPlan] searching", lot, plan);
        const fb = await queryLotPlanFallback(lot, plan);
        if(fb && fb.length){
          await focusOnParcelFeature(fb[0].feature,{shouldZoom:true});
          return true;
        }
        const matches = await queryLotPlanAcrossLayers(lot, plan);
        if(matches && matches.length){
          await focusOnParcelFeature(matches[0].feature,{shouldZoom:true});
          return true;
        }
        console.warn("[LotPlan] no hits for", lot, plan);
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
      getSuggestions: async function(params){
        const p = parseLotPlan(params.text);
        if(!p) return [];
        return [{ key: p.lot+"/"+p.plan, text: "Lot "+p.lot+" on "+p.plan, sourceIndex: 0 }];
      },
      getResults: async function(params){
        let txt = params.text || "";
        if(params.suggestResult && params.suggestResult.key) txt = params.suggestResult.key;
        const p = parseLotPlan(txt);
        if(!p) return [];
        const matches = await queryLotPlanAcrossLayers(p.lot, p.plan);
        return matches.map(function(m,i){
          var ext = (m.feature && m.feature.geometry && m.feature.geometry.extent) ? m.feature.geometry.extent : null;
          return { name: "Lot "+p.lot+" on "+p.plan+" - "+(m.layer.title||"Parcels"), feature: m.feature, extent: ext };
        });
      },
      zoomScale: 1000
    };

    search.sources.add(lotPlanSource);

    search.on("select-result", async function(e){
      try{
        const feat = e.result && e.result.feature;
        if(feat && feat.geometry){
          await focusOnParcelFeature(feat,{shouldZoom:true});
        }
      }catch(err){ console.warn("select-result handler:", err); }
    });

    async function hideUnusedOverlaysFor(geom){
      const nodes=[];
      walkAny(view.map,function(n){
        if(n && (n.type==="feature"||n.type==="sublayer") &&
           (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) nodes.push(n);
      });
      for(var i=0;i<nodes.length;i++){
        const n=nodes[i];
        const t=n.title||n.id||"", id=n.id||"", tg=(n.portalItem && n.portalItem.tags)||[];
        if(isDNT(t,id,tg)) continue;
        if(isUtility(t,id,tg)) continue;
        if(isWaterOrSewer(nodePath(n))) continue;
        try{ await n.load(); const cnt=await countFeatures(n,geom); if("listMode"in n) n.listMode=cnt>0?"show":"hide"; }catch(e){}
      }
      try{ layerList.refresh(); }catch(e){}
    }

        const sideOverlayIndex = new Map();
    function isNodeVisible(node){
      try{
        if(node && "visible" in node) return !!node.visible;
      }catch{}
      return false;
    }
    function setOverlayVisibility(node, on){
      if(!node) return;
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
      ul.innerHTML = "<li><i>Scanning...</i></li>";

      sideOverlayIndex.clear();
      let itemIdx = 0;
      const items = [];
      const nodes = flattenFeatureNodes().filter(function(n){ return !underDNTChain(n); });

      for (var i=0;i<nodes.length;i++){
        const n = nodes[i];
        try{
          const t = n.title || "", id = n.id || "", tg = (n.portalItem && n.portalItem.tags) || [];
          const p = nodePath(n);
          if (isUtility(t,id,tg) || isWaterOrSewer(p)) continue;

          await n.load();

          const cnt = await countFeatures(n, geom);
          if (cnt <= 0) continue;

          const res = await legendFromRendererUsingFeatures(n, geom);
          const keys = res.items || [];
          const keyHTML = keys.length
            ? '<div class="leg" style="margin-top:4px">' + keys.map(function(k){
                return '<div class="row">'+k.swatchHTML+htmlEsc(k.label)+'</div>';
              }).join("") + '</div>'
            : "";

          const title = htmlEsc(t || "Layer");
          var schemeLink = isZoning(t,p) ? findLoganZoneLink(t, keys.map(function(k){ return k.label; })) : null;
          if(!schemeLink){
            schemeLink = findLoganOverlayLink(t, keys.map(function(k){ return k.label; }));
          }
          const schemeHTML = schemeLink ? '<a href="'+schemeLink+'" target="_blank" rel="noopener" style="font-size:12px;text-decoration:none;margin-left:6px">Planning scheme</a>' : "";
          const key = `ov-${itemIdx++}`;
          sideOverlayIndex.set(key, n);
          const isVisible = isNodeVisible(n);
          const toggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${key}" aria-pressed="${isVisible}" title="${isVisible ? "Hide overlay" : "Show overlay"}">${isVisible ? "Hide" : "Show"}</button>`;
          items.push(
            '<li>' +
               '<div class="ov-title">'+title+' <span style="color:#777">('+cnt+')</span>'+schemeHTML+toggleHTML+'</div>' +
               keyHTML +
            '</li>'
          );
        }catch(err){
          /* ignore layer errors */
        }
      }

      ul.innerHTML = items.length
        ? items.join("")
        : "<li><i>No overlays intersect this parcel.</i></li>";
    }

    async function focusOnParcelFeature(feat,{shouldZoom=false}={}){
      if(!feat || !feat.geometry) return;
      const geom = normalizeToWebMercator(projectToViewSR(feat.geometry));
      feat.geometry = geom;
      resetLccSetbackContext();
      updateBadgesFromFeature(feat);
      selLayer.removeAll();
      if(geom.type==="point" || geom.type==="multipoint"){
        selLayer.add(new Graphic({geometry:geom,symbol:{type:"simple-marker",style:"circle",size:10,color:[167,11,19,0.2],outline:{color:"#a70b13",width:2}}}));
      }else{
        outlineSelection(geom);
      }
      await hideUnusedOverlaysFor(geom);
      await refreshLccSetbacksForGeometry(geom);
      try{
        const addr=await resolveBestAddress(geom, feat);
        lastParcelInfo.addressText=addr||lastParcelInfo.addressText||"Address unavailable";
        updateSummaryPanel();
      }catch(e){}
      updateSideOverlaySummary(geom);
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
    }

    view.on("click", async function(ev){
      try{
        showLoading(true);
        const parcel=await findParcelAtPoint(ev.mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        await focusOnParcelFeature(parcel,{shouldZoom:true});
      } finally { showLoading(false); }
    });
