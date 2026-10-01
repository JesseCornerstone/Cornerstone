// Extracted from SRRC.html. Keep this file as the independent page brain for SRRC.
import {
  $,
  addCorsHosts,
  attrEsc,
  applyReportMapScale,
  backgroundFactor,
  composeLandscapePropertyReport,
  queryQueenslandCadastralData,
  checkToken,
  formatRemaining,
  getReportMapScale,
  getQueryParam,
  htmlEsc,
  ensureQueenslandFfdiLayer,
  organizePlanningSchemeLayers,
  initPodUpload,
  isQueenslandFfdiLayer,
  loadPaymentUrl,
  raf,
  REPORT_MAP_SCALE,
  reportMapScaleText,
  resolvePropertyReportAddress,
  setPaymentLink,
  setReportFrameHTML,
  setReportViewerVisible,
  setText,
  setTimerVisible,
  showLoading,
  showPropertyInfoPopup,
  prepareMandatoryOverlayReportSection,
  queryStrictOverlayFeatureHits,
  sleep,
  slug,
  prepareNativeParcelReferences,
  wireSearchResultSelection,
  withSatelliteBasemap
} from "../council-hub.js?v=20260911-council-parity";
    import Portal from "https://js.arcgis.com/4.30/@arcgis/core/portal/Portal.js";
    import WebMap from "https://js.arcgis.com/4.30/@arcgis/core/WebMap.js";
    import MapView from "https://js.arcgis.com/4.30/@arcgis/core/views/MapView.js";
    import Graphic from "https://js.arcgis.com/4.30/@arcgis/core/Graphic.js";
    import GraphicsLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/GraphicsLayer.js";
    import GroupLayer from "https://js.arcgis.com/4.30/@arcgis/core/layers/GroupLayer.js";
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
    import * as symbolUtils from "https://js.arcgis.com/4.30/@arcgis/core/symbols/support/symbolUtils.js";
    import * as locator from "https://js.arcgis.com/4.30/@arcgis/core/rest/locator.js";
    import esriConfig from "https://js.arcgis.com/4.30/@arcgis/core/config.js";

    /* Tunables */
    const TOUCH_BUFFER_M = 6;
    const SWATCH_PX = 16;
    const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
    const resolveUniformReportAddress = (geometry, parcelFeature, hintAddress, hintPoint) =>
      resolvePropertyReportAddress({
        geometry,
        parcelFeature,
        hintAddress,
        hintPoint,
        scanAddressLayers: typeof scanAddressLayers === "function" ? scanAddressLayers : null,
        reverseGeocode: point => point
          ? locator.locationToAddress(GEOCODER_URL, { location: point })
          : null
      });
    const SRRC_CENTER = [152.63583737978115,-28.027413275017153];
    const SRRC_SCALE = 288895.277144;
    const M2="m²";
    const SHOT_SIZE = { width: 1280, height: 900 };
    addCorsHosts(esriConfig,[
      "www.arcgis.com",
      "services3.arcgis.com",
      "esriprod.scenicrim.qld.gov.au",
      "spatial-gis.information.qld.gov.au",
      "gis.fire.qld.gov.au"
    ]);

    /* Helpers */
    const waitViewIdle=async(extra=150)=>{try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{} await raf(); await sleep(extra);};
    const withViewOnExtent=async(ext,fn)=>{const vp=view.viewpoint?.clone?.(); try{ if(ext){ await view.goTo(ext,{animate:false}); await waitViewIdle(200);} return await fn(); } finally{ if(vp){ try{ await view.goTo(vp,{animate:false}); await waitViewIdle(120);}catch{} } }};
    const formatAddressDisplay=addr=>{
      if(addr==null) return "--";
      const txt=String(addr).trim();
      if(!txt || txt==="--" || /^(undefined|null)$/i.test(txt) || /address unavailable/i.test(txt) || /^(?:QLD|Queensland)(?:\s+\d{4})?$/i.test(txt)) return "--";
      return txt;
    };
    const centroidOf=(g)=>{
      try{
        if(g?.centroid) return g.centroid;
        if(g?.extent?.center) return g.extent.center;
      }catch{}
      return null;
    };
    const withViewOnGeom=async(geom,fn)=>{
      const vp=view.viewpoint?.clone?.();
      try{
        await applyReportMapScale(view,geom,waitViewIdle);
        return await fn();
      } finally {
        if(vp){ try{ await view.goTo(vp,{animate:false}); await waitViewIdle(160);}catch{} }
      }
    };

    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null
    };

    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/7sY3cv2zY4kxa9J4g97ss0E";


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




    const initAccessGate = async()=>{
      if(window.__LOT_WISE_FILE_MODE__){
        accessState.active = false;
        accessState.expiresAt = null;
        setPaymentLink(PAYMENT_FALLBACK_URL);
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        return;
      }
      accessState.key = getQueryParam("key");
      const sessionId = getQueryParam("session_id");
      accessState.paymentUrl = await loadPaymentUrl();
      setPaymentLink(accessState.paymentUrl || PAYMENT_FALLBACK_URL);

      const homeBtn = $("accessGateHome");
      if(homeBtn){
        homeBtn.addEventListener("click", ()=>{ window.location.href = "Index.html"; });
      }

      if(!accessState.key && sessionId){
        const returnPath = "SRRC.html";
        window.location.href = `/api/stripe/success?session_id=${encodeURIComponent(sessionId)}&return=${encodeURIComponent(returnPath)}`;
        return;
      }

      if(!accessState.key){
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        return;
      }

      const result = await checkToken(accessState.key);
      if(!result.ok){
        setGateMessage("Access denied", result.error || "This access link is invalid or expired.");
        setGateVisible(true);
        return;
      }

      accessState.active = true;
      accessState.expiresAt = result.expiresAt;
      setGateVisible(false);
    };

    const isAccessActive = ()=>{
      if(window.__LOT_WISE_FILE_MODE__) return false;
      if(!accessState.active || !accessState.expiresAt) return false;
      return new Date(accessState.expiresAt) > new Date();
    };

    const finalizeTokenAndLock = async()=>{
      if(window.__LOT_WISE_FILE_MODE__) return;
      if(!accessState.key){
        setGateMessage("Payment required", "A valid purchase is required to use this map.");
        setGateVisible(true);
        return;
      }
      try{
        await fetch(`/api/finalise-token?key=${encodeURIComponent(accessState.key)}`, { method: "POST" });
      }catch{}
      accessState.active = false;
      setGateMessage("Payment required", "Access used. Please purchase again to continue.");
      setGateVisible(true);
    };

    initAccessGate();

    function showRptOverlay(on){ const el=$("rptOverlay"); if(el) el.style.display=on?"grid":"none"; }
    function setRpt(msg,pct,doneStepId){
      const bar=$("rptBar"), m=$("rptMsg");
      if(m && msg!=null) m.textContent=msg;
      if(bar && pct!=null) bar.style.width=Math.max(0,Math.min(100,pct))+"%";
      if(doneStepId){ const step=$(doneStepId); if(step) step.classList.add("rptDone"); }
    }

    const portal=new Portal({url:"https://www.arcgis.com"});

    /* Map */
    let webmap=new WebMap({portalItem:{id:"1a8566bfdf414c4f8361d7cda14e34a9",portal}});
    const selLayer=new GraphicsLayer({listMode:"hide"}); webmap.add(selLayer);
    const view=new MapView({container:"viewDiv",map:webmap,center:SRRC_CENTER,zoom:17,constraints:{snapToZoom:false}});

    const inText=(t,p="")=>String(t||"")+" "+String(p||"");
    const isDNT=(title,id="",tags=[])=>{
      const t=String(title||""); const i=String(id||""); const tag=(tags||[]).join("|");
      return /do[\s-]*not[\s-]*touch/i.test(t)||/do[\s-]*not[\s-]*touch/i.test(i)||/do[\s-]*not[\s-]*touch/i.test(tag);
    };
    const isUtility=(title,id="",tags=[])=>/\b(utilit(y|ies)|power|electric|telecom|gas|water|sewer|storm[-\s]?water|reticulation|service)\b/i.test(inText(title,id)+" "+(tags||[]).join(" "));
    const isWaterOrSewer=(path)=>/\b(water|sewer|storm[\s-]*water|drainage|watercourse)\b/i.test(String(path||""));
    const isAcid=(t,p="")=>/\bacid\b/i.test(inText(t,p));
    const isTransport=(t,p="")=>/\b(transport|road|rail|corridor|traffic|cycle|bikeway|pedestrian|carpark|parking|transit|bus|ferry)\b/i.test(inText(t,p));
    const isAir=(t,p="")=>/\b(air\s*quality|air-quality|air|pollution)\b/i.test(inText(t,p));
    const isNoise=(t,p="")=>/\b(noise|acoustic)\b/i.test(inText(t,p));
    const isZoning=(t,p="")=>/\b(zoning|zone|zones)\b/i.test(inText(t,p));
    const isBushfire=(t,p="")=>/\b(bush[-\s]?fire|bushfire|wild[-\s]?fire|fire\s*hazard)\b/i.test(inText(t,p));
    const planKey=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
    const zoneBaseKey=s=>planKey(s).replace(/zonecode|zone/g,"");
    const SRRC_ZONE_LINKS=new Map([
      [zoneBaseKey("Community Facilities"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/128/0/0/0/74"],
      [zoneBaseKey("Conservation"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/127/0/0/0/74"],
      [zoneBaseKey("District Centre"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/126/0/0/0/74"],
      [zoneBaseKey("Emerging Community"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/125/0/0/0/74"],
      [zoneBaseKey("Industry"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/124/0/0/0/74"],
      [zoneBaseKey("Limited Development"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/123/0/0/0/74"],
      [zoneBaseKey("Local Centre"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/122/0/0/0/74"],
      [zoneBaseKey("Low Density Residential"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/121/0/0/0/74"],
      [zoneBaseKey("Low-medium Density Residential"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/120/0/0/0/74"],
      [zoneBaseKey("Major Centre"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/119/0/0/0/74"],
      [zoneBaseKey("Major Tourism"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/118/0/0/0/74"],
      [zoneBaseKey("Minor Tourism"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/117/0/0/0/74"],
      [zoneBaseKey("Mixed Use"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/116/0/0/0/74"],
      [zoneBaseKey("Neighbourhood Centre"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/115/0/0/0/74"],
      [zoneBaseKey("Recreation and Open Space"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/114/0/0/0/74"],
      [zoneBaseKey("Rural Residential"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/113/0/0/0/74"],
      [zoneBaseKey("Rural"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/112/0/0/0/74"],
      [zoneBaseKey("Special Purpose"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/111/0/0/0/74"],
      [zoneBaseKey("Township"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/110/0/0/0/74"]
    ]);
    const SRRC_OVERLAY_LINKS=new Map([
      [planKey("Agricultural Land Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/105/0/0/0/74"],
      [planKey("Agricultural Land Classification"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/105/0/0/0/74"],
      [planKey("Agricultural Land Buffer Area"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/105/0/0/0/74"],
      [planKey("Airport Environs and Defence Land Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/104/0/0/0/74"],
      [planKey("Bushfire Hazard Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/103/0/0/0/74"],
      [planKey("Environmental Significance Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/102/0/0/0/74"],
      [planKey("Extractive Resources Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/101/0/0/0/74"],
      [planKey("Flood Hazard Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/100/0/0/0/74"],
      [planKey("Landslide Hazard and Steep Slope Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/99/0/0/0/74"],
      [planKey("Local Heritage Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/98/0/0/0/74"],
      [planKey("Regional Infrastructure Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/97/0/0/0/74"],
      [planKey("Water Resource Catchments Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/96/0/0/0/74"],
      [planKey("Master Plan Areas Overlay Code"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/95/0/0/0/74"],
      [planKey("Transport Noise Corridor Overlay"),"https://planningscheme.scenicrim.qld.gov.au/eplan/rules/0/94/0/0/0/74"]
    ]);
    const SRRC_SETBACK_SOURCES={
      dwellingHouse:"https://www.scenicrim.qld.gov.au/files/assets/public/v/1/planning-and-permits/planning-schemes/planning-scheme-fact-sheets/dwelling_houses_and_secondary_dwellings_30june2023.pdf",
      planningScheme:"https://planningscheme.scenicrim.qld.gov.au/eplan/",
      qdc:"https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code"
    };
    const SRRC_SETBACK_ZONE_CONFIG={
      low:{name:"Low Density Residential",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Low Density Residential")),group:"urban"},
      lowMedium:{name:"Low-medium Density Residential",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Low-medium Density Residential")),group:"urban"},
      minorTourism:{name:"Minor Tourism",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Minor Tourism")),group:"urban"},
      township:{name:"Township",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Township")),group:"urban"},
      limitedDevelopment:{name:"Limited Development",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Limited Development")),group:"largeLot"},
      ruralResidential:{name:"Rural Residential",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Rural Residential")),group:"largeLot"},
      rural:{name:"Rural",source:SRRC_ZONE_LINKS.get(zoneBaseKey("Rural")),group:"rural"}
    };
    const findSrrcZoneLink=(title,labels=[])=>{
      const searchTerms=[title, ...labels].filter(Boolean);
      for(const term of searchTerms){
        const base=zoneBaseKey(term);
        if(SRRC_ZONE_LINKS.has(base)) return SRRC_ZONE_LINKS.get(base);
      }
      return null;
    };
    const findSrrcOverlayLink=(title,labels=[])=>{
      const searchTerms=[title, ...labels].filter(Boolean);
      for(const term of searchTerms){
        const key=planKey(term);
        for(const [entryKey, url] of SRRC_OVERLAY_LINKS){
          if(key === entryKey || key.includes(entryKey) || entryKey.includes(key)) return url;
        }
      }
      return null;
    };

    const kidsOf=n=>(n.layers?.toArray?.()??n.layers)||(n.sublayers?.toArray?.()??n.sublayers)||[];
        const nodePath=n=>{const bits=[]; let cur=n; while(cur){bits.unshift(cur.title||cur.id||"node"); cur=cur.parent;} return bits.join(" / ");};
    const ALWAYS_ON_IDS=new Set();
    const utilityVisSnapshot = new Map();
    let utilitiesToggleState = false;
    let utilToggleBtn = null;

    function walkAny(node,cb,inheritedDNT=false){
      if(!node) return;
      const t=node.title||node.id||"", id=node.id||"", tg=node.portalItem?.tags||[];
      const flag=inheritedDNT||isDNT(t,id,tg);
      cb(node,flag);
      (kidsOf(node)||[]).forEach(ch=>walkAny(ch,cb,flag));
    }
    let srrcBasemapWatchHandle=null;
    async function hideSrrcBasemapParcelLines(root=view?.map||webmap){
      const basemap=root?.basemap;
      if(!basemap) return;
      try{ await basemap.load?.(); }catch{}
      const styleLayers=[];
      for(const collection of [basemap.baseLayers,basemap.referenceLayers]){
        if(!collection) continue;
        if(typeof collection.toArray==="function") styleLayers.push(...collection.toArray());
        else if(Array.isArray(collection)) styleLayers.push(...collection);
      }
      for(const layer of styleLayers){
        if(typeof layer?.setStyleLayerVisibility!=="function") continue;
        try{ await layer.load?.(); }catch{}
        try{
          if(layer.getStyleLayer?.("Parcel/line")) layer.setStyleLayerVisibility("Parcel/line","none");
        }catch{}
      }
    }
    function watchSrrcBasemap(root){
      try{srrcBasemapWatchHandle?.remove?.();}catch{}
      try{
        srrcBasemapWatchHandle=root?.watch?.("basemap",()=>{
          setTimeout(()=>{hideSrrcBasemapParcelLines(root).catch(()=>{});},0);
        })||null;
      }catch{srrcBasemapWatchHandle=null;}
    }
    function getUtilityNodes(){
      const nodes=[];
      walkAny(view.map,(n,underDNT)=>{
        if(underDNT || !("visible" in n)) return;
        const t=n.title||"", p=nodePath(n), tg=n.portalItem?.tags||[];
        if(isUtility(t,n.id,tg) || isWaterOrSewer(p)) nodes.push(n);
      });
      return nodes;
    }
    function updateUtilityToggleLabel(){
      const btn = utilToggleBtn || document.getElementById("btnUtilityToggleMap");
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
      }else{
        nodes.forEach(n=>{
          const prev = utilityVisSnapshot.has(n) ? utilityVisSnapshot.get(n) : false;
          try{ n.visible=prev; }catch{}
        });
      }
      utilitiesToggleState = on;
      updateUtilityToggleLabel();
      try{ layerList.refresh(); }catch{}
    }

    function keepOnHidden(node){ if("visible"in node){try{node.visible=true;}catch{}} if("listMode"in node){try{node.listMode="hide";}catch{}} try{node.minScale=0;node.maxScale=0;}catch{} if(node.type==="sublayer"){ try{ node.updateFromJSON({minScale:0,maxScale:0}); }catch{} } let p=node.parent; while(p){ if("visible"in p){try{p.visible=true;}catch{}} p=p.parent; } }
    function startHidden(node){ if("visible"in node){try{node.visible=false;}catch{}} if("listMode"in node){try{node.listMode="show";}catch{} }}
    function enforceOverlayRules(){ walkAny(webmap,(node,underDNT)=>{ if(node.type==="graphics"){try{node.listMode="hide";}catch{} return;} if(!("visible"in node)) return; underDNT?keepOnHidden(node):startHidden(node); }); }
    function removeRetiredSrrcFfdiLayers(){
      const retired=[];
      walkAny(webmap,node=>{
        const url=String(node?.url||"");
        if(/gisext\.qfes\.qld\.gov\.au\/arcgis\/rest\/services\/Redi\/FFDI_h20\/MapServer(?:\/0)?\b/i.test(url)) retired.push(node);
      });
      retired.forEach(node=>{
        try{
          const collection=node?.parent?.layers||webmap?.layers;
          collection?.remove?.(node);
        }catch{}
      });
      return retired.length;
    }
    ;[300,900,1800,3500].forEach(ms=> setTimeout(()=>{ try{enforceOverlayRules(); hideSrrcBasemapParcelLines().catch(()=>{});}catch{} },ms));
    async function initialiseWebMap(){
      showLoading(true);
      try{
        // Load the web-map definition without requiring every child service to
        // succeed. The retired QFES FFDI endpoint previously made loadAll()
        // reject and caused the complete Scenic Rim map to be discarded.
        await webmap.load();
        watchSrrcBasemap(webmap);
        await hideSrrcBasemapParcelLines(webmap);
        removeRetiredSrrcFfdiLayers();
        ensureQueenslandFfdiLayer(webmap,FeatureLayer,esriConfig);
        enforceOverlayRules();
        try{ await view.when(); }catch{}
      }catch(e){
        console.warn("Scenic Rim web map failed to load; using fallback basemap",e);
        webmap=new WebMap({basemap:"streets-vector"});
        webmap.add(selLayer);
        ensureQueenslandFfdiLayer(webmap,FeatureLayer,esriConfig);
        view.map=webmap;
        watchSrrcBasemap(webmap);
        await hideSrrcBasemapParcelLines(webmap);
      }finally{
        showLoading(false);
      }
    }
    const mapStartupReady=initialiseWebMap();
view.ui.add(new Home({view}),"top-left");
    view.ui.add(new ScaleBar({view,unit:"metric"}),"bottom-left");
    const layerList=new LayerList({view,listItemCreatedFunction(e){
      const item=e.item, node=item.sublayer||item.layer;
      if(!node) return;
      if(node.type==="graphics"){ item.visible=false; item.panel=null; try{node.listMode="hide";}catch{} return; }
      let cur=node, inDNT=false;
      while(cur){ const t=cur.title||"", i=cur.id||"", tg=cur.portalItem?.tags||[]; if(isDNT(t,i,tg)){ inDNT=true; break; } cur=cur.parent; }
      if(inDNT){ keepOnHidden(node); item.visible=false; item.panel=null; }
      else{ try{node.listMode="show";}catch{} item.panel={content:"legend"}; }
    }});
    view.ui.add(new Expand({view,content:layerList,expandIconClass:"esri-icon-layers",expanded:false}),"top-right");
    const refreshPlanningSchemeLayerList=()=>{
      try{
        organizePlanningSchemeLayers(view?.map||webmap,GroupLayer);
        layerList.refresh();
      }catch{}
    };
    [500,1500,3500,7000,12000].forEach(delay=>setTimeout(refreshPlanningSchemeLayerList,delay));

    const ensureUtilityToggle=()=>{
      if(utilToggleBtn) return;
      const btn=document.createElement("button");
      btn.id="btnUtilityToggleMap";
      btn.type="button";
      btn.className="esri-widget esri-widget--button util-toggle-btn";
      btn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3.5c-3.2 4-5.5 7.2-5.5 9.7A5.5 5.5 0 0 0 12 18.7a5.5 5.5 0 0 0 5.5-5.5c0-2.5-2.3-5.7-5.5-9.7z"></path>
      </svg>`;
      btn.addEventListener("click",()=> setUtilitiesVisible(!utilitiesToggleState));
      utilToggleBtn = btn;
      updateUtilityToggleLabel();
      view.ui.add(utilToggleBtn,{position:"top-right",index:3});
    };
    ensureUtilityToggle();
    view.when(ensureUtilityToggle);
    setTimeout(ensureUtilityToggle, 800);

    view.ui.add(new Expand({view,content:new Legend({view}),expandIconClass:"esri-icon-legend"}),"top-right");
    view.ui.add(new Expand({view,content:new BasemapGallery({view}),expandIconClass:"esri-icon-basemap"}),"top-right");
    view.ui.add(new Fullscreen({view}),"top-right");
    const search=new Search({view,includeDefaultSources:true,popupEnabled:true,allPlaceholder:"Search address"});
    view.ui.add(search,{position:"top-right",index:0});

    view.watch("extent",()=>{ const c=view.center; setText("statusCoords",`Coords: ${c.longitude.toFixed(5)}, ${c.latitude.toFixed(5)}`); setText("statusZoom",`Zoom: ${view.zoom.toFixed(1)}`); setText("statusScale",`Scale: 1:${Math.round(view.scale)}`); });

    /* Parcel selection & badges */
    const parseNumberLike=raw=>{ if(raw==null) return null; let s=String(raw).trim(); if(!s) return null; const hasHA=/(^|[^a-z])ha([^a-z]|$)/i.test(s)||/\bhectare(s)?\b/i.test(s); s=s.replace(/,/g,"").replace(/square\s*met(re|er)s?/ig,"").replace(/m2|m\u00B2|sqm|sq\.?m/ig,"").trim(); let n=parseFloat(s); if(isNaN(n)) return null; if(hasHA) n*=10000; return n; };
    function getLotAreaSqm(attrs){ const strong=["LOT_AREA_M2","LOT_SIZE_M2","LOT_SIZE_SQM","LOT_AREA_SQM","AREA_SQM","SITE_AREA_SQM","LAND_AREA_SQM","LOT_AREA","LOT_SIZE","SITE_AREA","LAND_AREA","AREA_M2","AREA (M2)","AREA(M2)","AREA_M^2","AREA_HA","HECTARES"]; for(const k of strong){ const v=k in attrs?parseNumberLike(attrs[k]):null; if(v!=null){ if(v>0&&v<50&&(k==="AREA_HA"||k==="HECTARES")) return v*10000; return v; } } for(const k2 in attrs){ const v2=attrs[k2]; if(/(lot|site|land).*area/i.test(k2)||/area.*(sqm|m2|m\^2|square)/i.test(k2)||(/(lot|site).*size/i.test(k2))){ const val=parseNumberLike(v2); if(val) return val; } } return null; }
    function parseParcelMeta(attrs){ const keys=rx=>Object.keys(attrs).find(k=>rx.test(k)); const lot=attrs["LOT"]??attrs["LOTNO"]??attrs["LOT_NO"]??attrs["LOTNUMBER"]??(keys(/^lot[\w_]*$/i)&&String(attrs[keys(/^lot[\w_]*$/i)])); const plan=attrs["PLAN"]??attrs["PLANNO"]??attrs["PLAN_NO"]??(keys(/^plan[\w_]*$/i)&&String(attrs[keys(/^plan[\w_]*$/i)])); let lotplan=attrs["LOT_PLAN"]??attrs["LOT_PLAN_NO"]??attrs["LOTPLAN"]??attrs["LOTPLAN_NO"]??attrs["LOTPLAN_TXT"]??attrs["LOT_PLAN_TXT"]??attrs["LOT_PLAN_TEXT"]??attrs["LOTPLAN_TEXT"]; if(!lotplan && lot && plan) lotplan=lot+"/"+plan; if(!lotplan){ for(const key in attrs){ const s=String(attrs[key]||"").toUpperCase(); const m=s.match(/\b(\d+)\s*\/\s*([A-Z]{1,4}\s*\d+)\b/); if(m){ lotplan=m[1]+"/"+m[2].replace(/\s+/g,""); break; } } } return {lot,plan,lotplan}; }
    const geomAreaSqmSafe=g=>{ try{ const a=Math.abs(geometryEngine.planarArea(g,"square-meters")||0); return a>0?a:null; }catch{ return null; } };

    /* Address helpers */
    function smartJoin(parts){ return parts.filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }

    const ADDR_DEBUG=false;
    const FULL_ADDR_FIELDS=[
      "FULL_ADDRESS","ADDRESS_FULL","GNAF_FULL_ADDRESS","GNAF_ADDRESS",
      "SITE_ADDRESS","PROPERTY_ADDRESS","PROP_ADDRESS","PRIMARY_ADDRESS",
      "ADDR_FULL","ADDR_LABEL","ADDRESS","STREET_ADDRESS","POSTAL_ADDRESS",
      "FULLADDR","FULL_ADD","FULL_ADDRE","SITE_ADDR","SITE_ADD","PROP_ADD",
      "PROPERTY_ADDR","PROPERTY_ADD","ADDRESS1","ADDRESS_1","ADDR1"
    ];
    const PART_FIELDS={
      unit:["UNIT_NO","UNIT_NUMBER","UNIT","APARTMENT","FLAT","SUITE","SUB_UNIT","APT","FLAT_NO","UNITNO","UNITNUM"],
      numP:["HOUSE_PREFIX","NUMBER_PREFIX","ADDR_NUM_PREFIX","NUMBER_PRE","NO_PRE","HSE_PRE"],
      num:["HOUSE_NO","HOUSE_NUMBER","STREET_NO","STREET_NUMBER","PRIMARY_NO","PROPERTY_NO","NUMBER","HSE_NO","HSE_NUM","ADDR_NO"],
      numS:["HOUSE_SUFFIX","NUMBER_SUFFIX","ADDR_NUM_SUFFIX","NUMBER_SUF","NO_SUF","HSE_SUF"],
      stNm:["STREET_NAME","ST_NAME","ROAD_NAME","RD_NAME","ADD_STREET_NAME","STREET","ST_NAM","RD_NAM"],
      stTp:["STREET_TYPE","ST_TYPE","ROAD_TYPE","RD_TYPE","ADDR_TYPE","ST_TYP","RD_TYP"],
      stSf:["STREET_SUFFIX","ST_SUFFIX","ROAD_SUFFIX","RD_SUFFIX","ST_SUF","RD_SUF"],
      suburb:["SUBURB","SUBURB_NAME","LOCALITY","LOCALITY_NAME","TOWN","CITY","SUB_NAME","LOCALITY_N"],
      state:["STATE","STATE_ABBR","STATE_CODE"],
      post:["POSTCODE","POST_CODE","ZIP","PSTCODE","PST_CD"]
    };
    const LOTPLAN_FIELDS=[
      "LOT_PLAN","LOT_PLAN_NO","LOTPLAN","LOTPLAN_NO","LOTPLAN_TXT","LOT_PLAN_TXT","LOT_PLAN_TEXT","LOTPLAN_TEXT"
    ];
    function _pick(attrs,keys){
      for(const k of keys){
        if(k in (attrs||{})){
          const v=String(attrs[k]??"").trim();
          if(v && v.toUpperCase()!=="NULL") return v;
        }
      }
      return null;
    }
    const _smartJoin=smartJoin;
    function buildAddressFromParts(attrs){
      const unit=_pick(attrs,PART_FIELDS.unit);
      const numP=_pick(attrs,PART_FIELDS.numP);
      const num=_pick(attrs,PART_FIELDS.num);
      const numS=_pick(attrs,PART_FIELDS.numS);
      const stNm=_pick(attrs,PART_FIELDS.stNm);
      const stTp=_pick(attrs,PART_FIELDS.stTp);
      const stSf=_pick(attrs,PART_FIELDS.stSf);
      const suburb=_pick(attrs,PART_FIELDS.suburb);
      const state=_pick(attrs,PART_FIELDS.state) || "QLD";
      const post=_pick(attrs,PART_FIELDS.post);
      const line1=_smartJoin([unit?(unit+"/"):null,_smartJoin([numP,num,numS]),_smartJoin([stNm,stTp,stSf])]);
      const line2=_smartJoin([suburb,state,post]);
      return _smartJoin([line1,line2]) || null;
    }
    function parseAddress(attrs){
      if(!attrs) return null;
      for(const f of FULL_ADDR_FIELDS){
        if(f in attrs){
          const s=String(attrs[f]??"").trim();
          if(s && s.toUpperCase()!=="NULL") return s;
        }
      }
      for(const f of LOTPLAN_FIELDS){
        const s=String(attrs[f]??"").trim();
        if(/\d{1,5}\s+[A-Za-z].*\d{4}\b/.test(s)) return s;
      }
      const built=buildAddressFromParts(attrs);
      if(built) return built;
      for(const k in attrs){
        const v=String(attrs[k]??"").trim();
        if(!v) continue;
        const m=v.match(/\b\d{1,5}\s+[A-Za-z][A-Za-z\s.'-]+(?:\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade)\b)[^,;]*?(?:,\s*[A-Za-z][A-Za-z\s.'-]+)?(?:\s+(?:QLD|Queensland))?\s*\d{4}\b/i);
        if(m) return m[0].replace(/\s+/g," ").trim();
      }
      return null;
    }
    function ensureSuburbInAddress(addr,attrs){
      if(!addr) return addr;
      const _p=(obj,keys)=>{
        for(const k of keys){
          if(k in (obj||{})){
            const v=String(obj[k]??"").trim();
            if(v && v.toUpperCase()!=="NULL") return v;
          }
        }
        return null;
      };
      const suburb=_p(attrs,PART_FIELDS.suburb);
      const state=_p(attrs,PART_FIELDS.state) || "QLD";
      const post=_p(attrs,PART_FIELDS.post);
      if(!suburb) return addr;
      const norm=s=>String(s||"").toUpperCase().replace(/[,\s]+/g," ").trim();
      if(norm(addr).includes(norm(suburb))) return addr;
      const rxTail=new RegExp(String.raw`(?:,\s*)?(?:QLD|Queensland)\s*${post?String.raw`\b${post}\b`:''}\s*$`,"i");
      const tailWanted=`${suburb} ${state}${post?` ${post}`:""}`;
      if(rxTail.test(addr)){
        return addr.replace(rxTail,`, ${tailWanted}`);
      }
      return `${addr.replace(/\s+,/g,",")}, ${tailWanted}`;
    }
    function looksLikeAddressLayer(node){
      const hay=((node.title||"")+" "+nodePath(node)).toLowerCase();
      return /\b(gnaf|address|addr|property\s*address|site\s*address|street\s*address|address\s*points|locality|suburb|road\s*centerline|road\s*centreline)\b/.test(hay);
    }

    async function scanAddressLayers(lotGeom){
      const nodes=flattenFeatureNodes().filter(n=>{ try{ return looksLikeAddressLayer(n);}catch{ return false;} });
      const centroid=centroidOf(lotGeom);
      const candidates=[];

      for(const n of nodes){
        try{
          await n.load();
          const outFields=["*"];
          const r1=await n.queryFeatures({geometry:lotGeom,spatialRelationship:"intersects",returnGeometry:false,outFields,maxRecordCountFactor:3});
          (r1.features||[]).forEach(f=>{
            const addr=parseAddress(f.attributes);
            if(addr) candidates.push({addr,score:3,layer:n});
          });
          if(centroid){
            const r2=await n.queryFeatures({geometry:centroid,distance:40,units:"meters",spatialRelationship:"intersects",returnGeometry:false,outFields,maxRecordCountFactor:3});
            (r2.features||[]).forEach(f=>{
              const addr=parseAddress(f.attributes);
              if(addr) candidates.push({addr,score:2,layer:n});
            });
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("Address layer failed:", n?.title, e);
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

    async function reverseGeocodeAddress(point){
      try{
        const res = await locator.locationToAddress(GEOCODER_URL,{ location: point });
        const a = res?.address || res?.attributes?.Match_addr || res?.attributes?.LongLabel || res?.attributes?.Address;
        return a ? a.replace(/\s+/g," ").trim() : null;
      }catch{ return null; }
    }

    async function resolveBestAddress(geom, parcelFeature){
      try{ return await resolveUniformReportAddress(geom,parcelFeature); }
      catch(error){ console.warn("Shared report address resolution failed; using SRRC fallback",error); }
      let addr = parcelFeature ? parseAddress(parcelFeature.attributes||{}) : null;
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
          const cen = centroidOf(geom) || geometryEngine.centroid(geom);
          if(cen){
            const rev = await reverseGeocodeAddress(cen);
            if(rev) addr = rev;
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("reverse geocode failed:", e);
        }
      }

      addr = ensureSuburbInAddress(addr, parcelFeature?.attributes || {});
      if(ADDR_DEBUG && parcelFeature){
        console.log("Parcel attr keys:", Object.keys(parcelFeature.attributes||{}));
        window.dumpAddressFields = ()=> console.table(
          Object.fromEntries(Object.keys(parcelFeature.attributes||{}).map(k=>[k,parcelFeature.attributes[k]]))
        );
      }
      return addr || "Address unavailable";
    }

    function flattenFeatureNodes(){ const out=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) out.push(n); }); return out; }
    const looksLikeParcelLayer=node=>/(cadast|parcel|dcdb|lot|property)/i.test((node.title||"").toLowerCase());

    /* Parcel picking */
    async function findParcelAtPoint(point){
      const all=flattenFeatureNodes();
      const pref=[],rest=[];
      for(const n of all){ try{ await n.load(); }catch{} if(n.geometryType!=="polygon") continue; (looksLikeParcelLayer(n)?pref:rest).push(n); }
      const parcelLayers=pref.filter(n=>!isQueenslandFfdiLayer(n));
      const layers=parcelLayers.length?parcelLayers:rest.filter(n=>!isQueenslandFfdiLayer(n));

      const collect=async(opts)=>{ const out=[]; for(const L of layers){ try{ const r=await L.queryFeatures({...opts,returnGeometry:true,outFields:["*"],maxRecordCountFactor:2}); (r.features||[]).forEach(f=>out.push({layer:L,feature:f})); }catch{} } return out; };

      let cand=await collect({geometry:point,spatialRelationship:"intersects"});
      let contains=cand.filter(({feature})=>{ try{ return geometryEngine.contains(feature.geometry,point); }catch{ return false; } });
      if(contains.length){
        let best=contains[0], bestD=Infinity;
        for(const c of contains){
          let d=Infinity; try{ const cen=geometryEngine.centroid(c.feature.geometry); d=geometryEngine.distance(point,cen)||Infinity; }catch{}
          if(d<bestD){ best=c; bestD=d; }
        }
        return best.feature;
      }

      cand=await collect({geometry:point,distance:1.5,units:"meters",spatialRelationship:"intersects"});
      if(cand.length){
        let best=cand[0], bestD=Infinity;
        for(const c of cand){
          let d=Infinity; try{ const near=geometryEngine.nearestCoordinate(c.feature.geometry,point); d=near?.distance??Infinity; }catch{}
          if(d<bestD){ best=c; bestD=d; }
        }
        return best.feature;
      }
      return null;
    }

    /* Info + badges */
    let podParcelLayerCache = null;
    function podEscSQL(value){ return String(value).replace(/'/g,"''"); }
    function podIsIntegerField(field){ return String(field.type||"").toLowerCase().indexOf("integer") !== -1; }
    function podIsTextField(field){ return String(field.type||"").toLowerCase().indexOf("string") !== -1; }
    function podLooksLikeLotPlanLayer(layer){
      try{
        const hay = String(layer.title||"") + " " + String(layer.id||"") + " " + String(layer.url||"");
        if(/cadast|parcel|dcdb|lot|property/i.test(hay)) return true;
        const fields = Array.isArray(layer.fields) ? layer.fields : [];
        const names = fields.map(field=>field.name||"").join(" ");
        return /\b(LOT|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM|PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT)\b/i.test(names);
      }catch{ return false; }
    }
    async function podParcelLayers(){
      if(podParcelLayerCache) return podParcelLayerCache;
      const polys=[];
      const nodes = typeof flattenFeatureNodes === "function" ? flattenFeatureNodes() : [];
      for(const node of nodes){
        try{
          await node.load?.();
          if(node.geometryType === "polygon" && podLooksLikeLotPlanLayer(node)) polys.push(node);
        }catch{}
      }
      podParcelLayerCache = polys;
      return podParcelLayerCache;
    }
    function podBuildLotPlanWhere(layer, lot, plan){
      const fields = Array.isArray(layer.fields) ? layer.fields : [];
      const lotFields = fields.filter(field=>{
        const name = String(field.name||"").toUpperCase();
        if(/LOT_AREA/.test(name)) return false;
        return /\b(LOT|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM)\b/.test(name) || name === "LOT";
      });
      const planFields = fields.filter(field=>{
        const name = String(field.name||"").toUpperCase();
        return /\b(PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT)\b/.test(name);
      });
      const lotClauses=[];
      const lotNum = Number(lot);
      for(const field of lotFields){
        if(podIsIntegerField(field) && !Number.isNaN(lotNum)) lotClauses.push(field.name + "=" + lotNum);
        else if(podIsTextField(field)) lotClauses.push("UPPER(" + field.name + ") LIKE '%" + podEscSQL(String(lot).toUpperCase()) + "%'" );
      }
      const planClauses=[];
      const planU = podEscSQL(String(plan).toUpperCase());
      const planCompact = podEscSQL(String(plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      const lotPlanFull = podEscSQL((String(lot)+"/"+plan).toUpperCase());
      const lotPlanCompact = podEscSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      for(const field of planFields){
        if(!podIsTextField(field)) continue;
        const fieldExpr = "UPPER(" + field.name + ")";
        const scrubExpr = "REPLACE(REPLACE(REPLACE(" + fieldExpr + ",' ',''),'-',''),'/','')";
        planClauses.push(fieldExpr + " LIKE '%" + planU + "%'" );
        planClauses.push(scrubExpr + " LIKE '%" + planCompact + "%'" );
        if(/LOT[_ ]?PLAN|LOTPLAN|LOT_PLAN/i.test(field.name)){
          planClauses.push(fieldExpr + " LIKE '%" + lotPlanFull + "%'" );
          planClauses.push(scrubExpr + " LIKE '%" + lotPlanCompact + "%'" );
        }
      }
      const parts=[];
      if(lotClauses.length) parts.push("(" + lotClauses.join(" OR ") + ")");
      if(planClauses.length) parts.push("(" + planClauses.join(" OR ") + ")");
      return parts.length ? parts.join(" AND ") : null;
    }
    async function queryLotPlanAcrossLayers(lot, plan){
      const layers = await podParcelLayers();
      const out=[];
      for(const layer of layers){
        try{
          const where = podBuildLotPlanWhere(layer, lot, plan);
          if(!where) continue;
          const query = await layer.queryFeatures({where,outFields:["*"],returnGeometry:true,maxRecordCountFactor:5});
          for(const feature of (query.features||[])) out.push({layer, feature});
        }catch{}
      }
      return out;
    }

    async function focusOnLotPlan(lot, plan){
      if(!lot || !plan) return false;
      try{
        showLoading(true);
        try{ if(typeof mapStartupReady !== "undefined") await mapStartupReady; }catch{}
        try{ await view.when?.(); }catch{}
        const lotTrim = String(lot).trim();
        const planTrim = String(plan).trim();
        const matches = await queryLotPlanAcrossLayers(lotTrim, planTrim);
        if(!matches || !matches.length) return false;
        let feat = matches[0].feature;
        if(feat?.geometry && (feat.geometry.type==="point" || feat.geometry.type==="multipoint") && typeof findParcelAtPoint === "function"){
          const parcel = await findParcelAtPoint(feat.geometry);
          if(parcel) feat = parcel;
        }
        if(typeof focusOnParcelFeature === "function"){
          await focusOnParcelFeature(feat,{shouldZoom:true});
          return true;
        }
        const geom = feat?.geometry;
        if(!geom) return false;
        if(typeof outlineSelection === "function") outlineSelection(geom);
        if(typeof updateBadgesFromFeature === "function") updateBadgesFromFeature(feat);
        try{
          const target = geom.extent || geom;
          await view.goTo(target,{animate:false});
          if(typeof waitViewIdle === "function") await waitViewIdle(160);
        }catch{
          try{ await view.goTo(geom); }catch{}
        }
        if(typeof hideUnusedOverlaysFor === "function") await hideUnusedOverlaysFor(geom);
        if(typeof refreshGcccSetbacksForGeometry === "function") await refreshGcccSetbacksForGeometry(geom);
        if(typeof refreshSrrcSetbacksForGeometry === "function") await refreshSrrcSetbacksForGeometry(geom);
        if(typeof resolveBestAddress === "function"){
          try{
            const addr = await resolveBestAddress(geom, feat);
            if(addr && typeof lastParcelInfo === "object" && lastParcelInfo) lastParcelInfo.addressText = addr;
            if(typeof updateSummaryPanel === "function") updateSummaryPanel();
          }catch{}
        }
        if(typeof updateSideOverlaySummary === "function") updateSideOverlaySummary(geom);
        return true;
      }catch(err){
        console.warn("focusOnLotPlan error:", err);
        return false;
      }finally{
        showLoading(false);
      }
    }
    initPodUpload({ focusOnLotPlan });

    let lastParcelInfo={feature:null,lotText:"--",areaText:`-- ${M2}`,classText:"--",addressText:"--",councilText:"Scenic Rim Regional Council"};
    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || (`-- ${M2}`));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", formatAddressDisplay(lastParcelInfo.addressText));
      setText("sumCouncil", lastParcelInfo.councilText || "Scenic Rim Regional Council");
      showPropertyInfoPopup(view, lastParcelInfo);
      updateSrrcSetbacksPanel();
    }
    function outlineSelection(geom){
      selLayer.removeAll();
      if(!geom) return;
      selLayer.add(new Graphic({geometry:geom,symbol:{type:"simple-fill",color:[0,0,0,0],outline:{color:"#a70b13",width:2}}}));
    }
    function parseCouncil(attrs){
      if(!attrs) return null;
      const first=(...keys)=>{ for(const k of keys){ if(k in attrs){ const v=String(attrs[k]??"").trim(); if(v) return v; } } return null; };
      return first("COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY") || "Scenic Rim Regional Council";
    }
    function parcelInfoFromFeature(feat){
      const attrs=feat?.attributes||{};
      const meta=parseParcelMeta(attrs);
      const lotplan=meta.lotplan || ((meta.lot||meta.plan)?[meta.lot,meta.plan].filter(Boolean).join("/"):"--");
      const area=getLotAreaSqm(attrs) ?? geomAreaSqmSafe(feat.geometry) ?? null;
      const cls=(area!=null && area<450)?"Small lot":"Standard lot";
      let address=parseAddress(attrs) || "--";
      if(address && address!=="--") address = ensureSuburbInAddress(address, attrs);
      address = formatAddressDisplay(address);
      const council=parseCouncil(attrs) || "Scenic Rim Regional Council";
      return { lotText:lotplan||"--", areaText:area!=null?(Math.round(area).toLocaleString()+" "+M2):`-- ${M2}`, classText:cls, addressText:address, councilText:council };
    }
    function updateBadgesFromFeature(feat){
      const info=parcelInfoFromFeature(feat);
      if($("lotBadge")) $("lotBadge").textContent="Lot: "+info.lotText;
      if($("areaBadge")) $("areaBadge").textContent="Area: "+info.areaText;
      if($("classBadge")) $("classBadge").textContent="Class: "+info.classText;
      lastParcelInfo={feature:feat,...info};
      updateSummaryPanel();
    }

    let lastSrrcSetbackContext={route:null,zoneLabel:"Not resolved",labels:[],source:"pending"};

    function setbackWallHeightFromInput(raw){
      const value = raw ?? $("srrcSetbackWallHeight")?.value;
      const n=Number(value);
      return Number.isFinite(n) && n>0 ? n : 4.5;
    }
    function metresText(v, digits=1){
      if(v==null) return "--";
      if(typeof v==="string") return v;
      const n=Number(v);
      if(!Number.isFinite(n)) return "--";
      return n.toLocaleString(undefined,{maximumFractionDigits:digits})+" m";
    }
    function formatSetbackArea(areaSqm){
      if(!Number.isFinite(areaSqm)) return "--";
      return Math.round(areaSqm).toLocaleString()+" "+M2;
    }
    function lotAreaForSetbacks(feat, info=lastParcelInfo){
      const attrs=feat?.attributes||{};
      const fromAttrs=getLotAreaSqm(attrs);
      if(fromAttrs!=null) return fromAttrs;
      const parsed=parseNumberLike(String(info?.areaText||"").replace(M2,""));
      if(parsed!=null) return parsed;
      return geomAreaSqmSafe(feat?.geometry) ?? null;
    }
    function ringArea2D(points){
      let sum=0;
      for(let i=0;i<points.length;i++){
        const a=points[i], b=points[(i+1)%points.length];
        sum += (Number(a[0])||0)*(Number(b[1])||0) - (Number(b[0])||0)*(Number(a[1])||0);
      }
      return sum/2;
    }
    function largestOuterRing(geom){
      const rings=geom?.rings||[];
      if(!rings.length) return null;
      let best=null, bestArea=-Infinity;
      for(const ring of rings){
        if(!Array.isArray(ring) || ring.length<4) continue;
        const area=Math.abs(ringArea2D(ring));
        if(area>bestArea){ best=ring; bestArea=area; }
      }
      return best;
    }
    function localMetricPointsForRing(geom,ring){
      const clean=(ring||[]).map(p=>[Number(p?.[0]),Number(p?.[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
      if(clean.length<3) return [];
      const sr=geom?.spatialReference;
      const looksGeographic=!!(sr?.isGeographic || sr?.wkid===4326 || sr?.latestWkid===4326 || clean.every(p=>Math.abs(p[0])<=180&&Math.abs(p[1])<=90));
      if(!looksGeographic) return clean.map(([x,y])=>({x,y}));
      const lat=clean.reduce((sum,p)=>sum+p[1],0)/clean.length;
      const latRad=lat*Math.PI/180;
      const mx=111320*Math.max(0.15,Math.cos(latRad));
      const my=110540;
      return clean.map(([x,y])=>({x:x*mx,y:y*my}));
    }
    function orientedLotMetrics(points){
      if(!points || points.length<3) return null;
      let best=null;
      for(let i=0;i<points.length-1;i++){
        const a=points[i], b=points[i+1];
        const dx=b.x-a.x, dy=b.y-a.y;
        if(Math.hypot(dx,dy)<0.2) continue;
        const angle=Math.atan2(dy,dx);
        const cos=Math.cos(angle), sin=Math.sin(angle);
        let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
        for(const p of points){
          const u=p.x*cos+p.y*sin;
          const v=-p.x*sin+p.y*cos;
          if(u<minU) minU=u;
          if(u>maxU) maxU=u;
          if(v<minV) minV=v;
          if(v>maxV) maxV=v;
        }
        const w=maxU-minU, d=maxV-minV, area=w*d;
        if(w>0 && d>0 && (!best || area<best.area)) best={width:Math.min(w,d),depth:Math.max(w,d),area};
      }
      return best;
    }
    function estimateLotDimensionsForSetbacks(geom,areaSqm){
      const ring=largestOuterRing(geom);
      const pts=localMetricPointsForRing(geom,ring);
      const oriented=orientedLotMetrics(pts);
      if(oriented && Number.isFinite(oriented.width) && Number.isFinite(oriented.depth)){
        return {width:oriented.width,frontage:oriented.width,depth:oriented.depth,source:"estimated from selected lot geometry"};
      }
      if(Number.isFinite(areaSqm) && areaSqm>0){
        const side=Math.sqrt(areaSqm);
        return {width:side,frontage:side,depth:side,source:"estimated from lot area"};
      }
      return {width:null,frontage:null,depth:null,source:"unavailable"};
    }
    function classifySrrcSetbackRoute(label){
      const k=planKey(label);
      if(!k) return null;
      if(k.includes("ruralresidential")) return "ruralResidential";
      if(k.includes("lowmediumdensityresidential") || k.includes("lowmedium")) return "lowMedium";
      if(k.includes("lowdensityresidential") || k.includes("lowdensity")) return "low";
      if(k.includes("limiteddevelopment")) return "limitedDevelopment";
      if(k.includes("minortourism")) return "minorTourism";
      if(k.includes("township")) return "township";
      if(k==="rural" || k.includes("ruralzone")) return "rural";
      return null;
    }
    function srrcUrbanSideRearFor(height){
      if(height<=4.5) return {value:1.5,basis:"Wall height up to 4.5 m."};
      if(height<=7.5) return {value:2,basis:"Wall height over 4.5 m and up to 7.5 m."};
      return {value:2 + 0.5*Math.ceil((height-7.5)/3),basis:"2 m plus 0.5 m for every 3 m in height, or part, over 7.5 m."};
    }
    function srrcLargeLotSideRearFor(height){
      if(height<=4.5) return {value:3,basis:"Wall height up to 4.5 m."};
      if(height<=7.5) return {value:5,basis:"Wall height over 4.5 m and up to 7.5 m."};
      return {value:5 + 0.5*Math.ceil((height-7.5)/3),basis:"5 m plus 0.5 m for every 3 m in height, or part, over 7.5 m."};
    }
    function uniqueSetbackLabels(labels){
      const out=[], seen=new Set();
      for(const label of labels){
        const text=String(label||"").trim();
        if(!text) continue;
        const key=planKey(text);
        if(seen.has(key)) continue;
        seen.add(key);
        out.push(text);
      }
      return out;
    }
    async function labelsFromLayerForSrrcSetbacks(layerNode,geom){
      const labels=[];
      const title=layerNode?.title||nodePath(layerNode);
      if(classifySrrcSetbackRoute(title)) labels.push(title);
      try{
        const g=bufferedAOIFor(layerNode,geom);
        const q=await layerNode.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:10,maxRecordCountFactor:2});
        for(const f of (q.features||[])){
          const attrs=f.attributes||{};
          labels.push(pickZoneLabel(attrs),guessLabelFromAttrs(attrs));
        }
      }catch{}
      try{
        const {items}=await legendFromRendererUsingFeatures(layerNode,geom);
        for(const item of items||[]) labels.push(item.label);
      }catch{}
      return uniqueSetbackLabels(labels);
    }
    async function resolveSrrcSetbackContext(geom){
      if(!geom) return {route:null,zoneLabel:"No parcel selected",labels:[],source:"none"};
      const nodes=flattenFeatureNodes().filter(n=>{
        const t=n?.title||"", p=nodePath(n);
        return !underDNTChain(n) && (isZoning(t,p) || !!classifySrrcSetbackRoute(t+" "+p));
      });
      const allLabels=[];
      for(const n of nodes){
        try{
          await n.load();
          const cnt=await countFeatures(n,geom);
          if(cnt<=0) continue;
          const labels=await labelsFromLayerForSrrcSetbacks(n,geom);
          allLabels.push(...labels);
          for(const label of labels){
            const route=classifySrrcSetbackRoute(label);
            if(route) return {route,zoneLabel:label,labels:uniqueSetbackLabels(allLabels),source:n.title||nodePath(n)};
          }
        }catch{}
      }
      const labels=uniqueSetbackLabels(allLabels);
      const route=labels.map(classifySrrcSetbackRoute).find(Boolean)||null;
      return {route,zoneLabel:route?(labels.find(l=>classifySrrcSetbackRoute(l)===route)||SRRC_SETBACK_ZONE_CONFIG[route].name):"Zoning not matched",labels,source:"zoning scan"};
    }
    function calculateSrrcSetbacks(feat=lastParcelInfo.feature, opts={}){
      if(!feat?.geometry){
        return {empty:true,notes:["Select a Scenic Rim parcel first."]};
      }
      const info=opts.info || lastParcelInfo || {};
      const wallHeight=setbackWallHeightFromInput(opts.wallHeight);
      const areaSqm=lotAreaForSetbacks(feat, info);
      const dimensions=estimateLotDimensionsForSetbacks(feat.geometry, areaSqm);
      const context=opts.context || lastSrrcSetbackContext || {};
      const route=context.route;
      const cfg=SRRC_SETBACK_ZONE_CONFIG[route];
      const rows=[];
      const notes=[];
      const sources=[
        {label:"SRRC dwelling houses and secondary dwellings fact sheet",url:SRRC_SETBACK_SOURCES.dwellingHouse},
        {label:"Scenic Rim Planning Scheme ePlan",url:SRRC_SETBACK_SOURCES.planningScheme}
      ];
      if(cfg?.source) sources.push({label:cfg.name+" zone code",url:cfg.source});

      const lotMetric=`${metresText(dimensions.frontage)} width / ${metresText(dimensions.depth)} depth`;
      rows.push({boundary:"Lot metrics",value:lotMetric,detail:`Area ${formatSetbackArea(areaSqm)}. Width/frontage and depth are ${dimensions.source}.`});
      rows.push({boundary:"Planning context",value:cfg?.name || "Not automatically matched",detail:context.zoneLabel && context.zoneLabel!==cfg?.name ? context.zoneLabel : (context.source||"")});

      if(!cfg){
        sources.push({label:"Queensland Development Code",url:SRRC_SETBACK_SOURCES.qdc});
        rows.push({boundary:"Setback source",value:"Confirm manually",detail:"The zoning layer did not resolve to a supported Scenic Rim dwelling-house setback zone."});
        notes.push("Use the Scenic Rim Planning Scheme property report and QDC where applicable. Previous approvals, building envelopes, easements, overlays and referral agency requirements can change siting outcomes.");
        return {regime:"srrc-unmatched",classLabel:"Scenic Rim zoning not matched",areaSqm,dimensions,wallHeight,sourceLabel:sources[0].label,sourceUrl:sources[0].url,rows,notes,sources,context};
      }

      const primaryStreet=(cfg.group==="urban") ? "6 m" : "10 m";
      const secondaryStreet=(["low","lowMedium","minorTourism","township","limitedDevelopment"].includes(route)) ? "3 m" : "10 m";
      rows.push({boundary:"Primary street frontage",value:primaryStreet,detail:"Dwelling house setback from a road frontage under the Scenic Rim dwelling-house table."});
      rows.push({boundary:"Secondary frontage",value:secondaryStreet,detail:"Corner-lot secondary frontage setback under the Scenic Rim dwelling-house table."});

      if(cfg.group==="urban"){
        const sideRear=srrcUrbanSideRearFor(wallHeight);
        rows.push({boundary:"Side and rear",value:metresText(sideRear.value),detail:`For wall height ${metresText(wallHeight)}. ${sideRear.basis}`});
      }else if(cfg.group==="largeLot"){
        const sideRear=srrcLargeLotSideRearFor(wallHeight);
        rows.push({boundary:"Side and rear",value:metresText(sideRear.value),detail:`For wall height ${metresText(wallHeight)}. ${sideRear.basis}`});
      }else if(route==="rural"){
        if(Number.isFinite(areaSqm) && areaSqm<=10000){
          const sideRear=srrcLargeLotSideRearFor(wallHeight);
          rows.push({boundary:"Side and rear",value:metresText(sideRear.value),detail:`Rural zone, no precinct, lot 1 ha or less. For wall height ${metresText(wallHeight)}. ${sideRear.basis}`});
        }else if(Number.isFinite(areaSqm)){
          rows.push({boundary:"Side and rear",value:"6 m",detail:"Rural zone table pathway for lots over 1 ha."});
        }else{
          rows.push({boundary:"Side and rear",value:"6 m / height-based table",detail:"Use 6 m generally; if the Rural lot is 1 ha or less and no precinct applies, use the 3 m / 5 m height-based table."});
          notes.push("Lot area was unavailable, so confirm whether the Rural-zone 1 ha threshold changes the side/rear setback.");
        }
      }

      if(wallHeight>8.5){
        notes.push("The SRRC dwelling-house fact sheet also lists a maximum building height of 2 storeys and 8.5 m. A higher wall height should be checked against the current planning scheme and any overlays.");
      }
      if(route==="limitedDevelopment"){
        notes.push("Limited Development zone outcomes can depend on mapped precincts and historical subdivision circumstances. Confirm the current ePlan property report before relying on the table alone.");
      }
      notes.push("Scenic Rim overlays, existing approvals, building envelopes, easements, road truncations and referral agency requirements can override or add to these minimum setbacks.");
      return {
        regime:`srrc-${route}`,
        classLabel:cfg.name,
        areaSqm,
        dimensions,
        wallHeight,
        sourceLabel:sources[0].label,
        sourceUrl:sources[0].url,
        rows,notes,sources,context
      };
    }
    function setbackInfoToHTML(info){
      if(!info || info.empty){
        const msg=info?.notes?.[0] || "Select a parcel.";
        return `<p class="setback-muted">${htmlEsc(msg)}</p>`;
      }
      const sources=(info.sources||[]).length
        ? (info.sources||[]).map(s=>`<a href="${htmlEsc(s.url)}" target="_blank" rel="noopener">${htmlEsc(s.label)}</a>`).join(" | ")
        : (info.sourceUrl ? `<a href="${htmlEsc(info.sourceUrl)}" target="_blank" rel="noopener">${htmlEsc(info.sourceLabel)}</a>` : htmlEsc(info.sourceLabel || "Setback source"));
      const dimParts=[
        info.wallHeight!=null ? `Wall height: ${metresText(info.wallHeight)}` : null,
        info.dimensions?.frontage!=null ? `Width/frontage: ${metresText(info.dimensions.frontage)}` : null,
        info.dimensions?.depth!=null ? `Depth: ${metresText(info.dimensions.depth)}` : null
      ].filter(Boolean).join(". ");
      const dimText=dimParts ? `. ${dimParts}.` : "";
      const rows=(info.rows||[]).map(row=>(
        `<tr><th>${htmlEsc(row.boundary)}</th><td><span class="setback-value">${htmlEsc(row.value)}</span><span class="setback-detail">${htmlEsc(row.detail)}</span></td></tr>`
      )).join("");
      const notes=(info.notes||[]).length
        ? `<ul class="setback-notes">${info.notes.map(n=>`<li>${htmlEsc(n)}</li>`).join("")}</ul>`
        : "";
      return [
        `<p class="setback-summary">${htmlEsc(info.classLabel)} - ${htmlEsc(formatSetbackArea(info.areaSqm))}${htmlEsc(dimText)}</p>`,
        `<p class="setback-source">Source: ${sources}</p>`,
        `<table class="setback-table"><tbody>${rows}</tbody></table>`,
        notes
      ].join("");
    }
    function updateSrrcSetbacksPanel(){
      const el=$("srrcSetbacksContent");
      if(!el) return;
      el.innerHTML=setbackInfoToHTML(calculateSrrcSetbacks());
    }
    function resetSrrcSetbackContext(){
      lastSrrcSetbackContext={route:null,zoneLabel:"Resolving zoning",labels:[],source:"pending"};
    }
    async function refreshSrrcSetbacksForGeometry(geom){
      if(!geom){ updateSrrcSetbacksPanel(); return lastSrrcSetbackContext; }
      const el=$("srrcSetbacksContent");
      if(el) el.innerHTML=`<p class="setback-muted">Resolving Scenic Rim zoning...</p>`;
      lastSrrcSetbackContext=await resolveSrrcSetbackContext(geom);
      updateSrrcSetbacksPanel();
      return lastSrrcSetbackContext;
    }
    (function initSrrcSetbackHeightInput(){
      const input=$("srrcSetbackWallHeight");
      if(!input) return;
      input.addEventListener("input",()=>{
        try{ lastReportHTML=null; lastReportTitle="Property Report"; }catch{}
        updateSrrcSetbacksPanel();
      });
    })();
    window.calculateSrrcSetbacks=calculateSrrcSetbacks;

    /* Hide unused overlays in LayerList */
    const bufferedAOIFor=(node,geom)=>{ try{ const gt=(node.geometryType||"").toLowerCase(); if(gt==="point"||gt==="multipoint"||gt==="polyline") return geometryEngine.buffer(geom,TOUCH_BUFFER_M,"meters"); }catch{} return geom; };
    async function countFeatures(node,geom){
      const g=bufferedAOIFor(node,geom);
      try{ if(typeof node.queryFeatureCount==="function"){ const c=await node.queryFeatureCount({geometry:g,spatialRelationship:"intersects"}); return Number(c)||0; } }catch{}
      try{ if(typeof node.queryFeatures==="function"){ const q=await node.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:1}); return q.features?.length?1:0; } }catch{}
      return 0;
    }
    async function hideUnusedOverlaysFor(geom){
      const nodes=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) nodes.push(n); });
      for(const n of nodes){
        const t=n.title||n.id||"", id=n.id||"", tg=n.portalItem?.tags||[];
        if(isDNT(t,id,tg)) continue;
        if(isUtility(t,id,tg)) continue;
        if(isWaterOrSewer(nodePath(n))) continue;
        try{ await n.load(); const cnt=await countFeatures(n,geom); if("listMode"in n) n.listMode=cnt>0?"show":"hide"; }catch{}
      }
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

    // Side overlay summary (no utilities) with triggered keys
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
      const ul=$("sumOverlays");
      if(!ul) return;
      ul.innerHTML="<li><i>Scanning&hellip;</i></li>";

      sideOverlayIndex.clear();
      let itemIdx = 0;
      const items=[];
      const nodes=flattenFeatureNodes().filter(n=>!underDNTChain(n));

      for(const n of nodes){
        try{
          const t=n.title||"", id=n.id||"", tg=n.portalItem?.tags||[];
          const p=nodePath(n);
          if(isUtility(t,id,tg) || isWaterOrSewer(p)) continue;

          await n.load();

          const cnt=await countFeatures(n,geom);
          if(cnt<=0) continue;

          const {items:keys}=await legendFromRendererUsingFeatures(n,geom);
          const keyHTML=keys.length
            ? `<div class="leg" style="margin-top:4px">${keys.map(k=>`<div class="row">${k.swatchHTML}${htmlEsc(k.label)}</div>`).join("")}</div>`
            : "";

          const title=htmlEsc(t || "Layer");
          let schemeLink=isZoning(t,p) ? findSrrcZoneLink(t, keys.map(k=>k.label)) : null;
          if(!schemeLink){
            schemeLink = findSrrcOverlayLink(t, keys.map(k=>k.label));
          }
          const schemeHTML=schemeLink ? `<a href="${schemeLink}" target="_blank" rel="noopener" style="font-size:12px;text-decoration:none;margin-left:6px">Planning scheme</a>` : "";
          const key = `ov-${itemIdx++}`;
          sideOverlayIndex.set(key, n);
          const isVisible = isNodeVisible(n);
          const toggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${key}" aria-pressed="${isVisible}" title="${isVisible ? "Hide overlay" : "Show overlay"}">${isVisible ? "Hide" : "Show"}</button>`;
          items.push(
            `<li>
               <div class="ov-title">${title} <span style="color:#777">(${cnt})</span>${schemeHTML}${toggleHTML}</div>
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

    async function selectParcelAtPoint(mapPoint,{searchResult=null}={}){
      try{
        showLoading(true);
        await mapStartupReady;
        const searchedFeature=searchResult?.feature;
        const parcel=searchedFeature?.geometry?.type==="polygon" ? searchedFeature : await findParcelAtPoint(mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        resetSrrcSetbackContext();
        updateBadgesFromFeature(parcel);
        outlineSelection(parcel.geometry);
        await hideUnusedOverlaysFor(parcel.geometry);
        await refreshSrrcSetbacksForGeometry(parcel.geometry);
        try{
          const addr=await resolveBestAddress(parcel.geometry, parcel);
          lastParcelInfo.addressText=formatAddressDisplay(addr || lastParcelInfo.addressText);
          updateSummaryPanel();
        }catch{}
        updateSideOverlaySummary(parcel.geometry);
      } finally { showLoading(false); }
    }
    view.on("click", async ev=>{
      await selectParcelAtPoint(ev.mapPoint);
    });
    wireSearchResultSelection(search, selectParcelAtPoint);

    /* Legend helpers */
    async function swatchHTML(symbol){
      try{
        const el = await symbolUtils.renderPreviewHTML(symbol, { size:[SWATCH_PX-2,SWATCH_PX-2] });
        if(el.tagName?.toLowerCase()==="canvas"){
          return `<span class="swbox"><img alt="" src="${el.toDataURL("image/png")}"></span>`;
        }
        try{ el.setAttribute("width","100%"); el.setAttribute("height","100%"); }catch{}
        return `<span class="swbox">${el.outerHTML}</span>`;
      }catch{
        return `<span class="swbox" style="background:#cfcfcf"></span>`;
      }
    }
    const guessLabelFromAttrs=attrs=>{
      if(!attrs) return null;
      const patt=[/zone.*(name|type|desc|label|category|code)?/i,/(planning|scheme).*zone/i,/(zone|category|type|class|desc|label)/i];
      for(const r of patt){ const k=Object.keys(attrs).find(x=>r.test(x)); if(k){ const v=String(attrs[k]??"").trim(); if(v) return v; } }
      return null;
    };
    function getUVInfo(renderer,attrs){
      if(!renderer||!attrs) return null;
      const fields=[renderer.field,renderer.field2,renderer.field3].filter(Boolean);
      const delim=renderer.fieldDelimiter??", ";
      if(!fields.length) return null;
      const parts=fields.map(f=>attrs[f]);
      const key=parts.join(delim);
      const infos=renderer.uniqueValueInfos||[];
      let info=infos.find(u=>String(u.value)===String(key));
      if(!info) info=infos.find(u=>Array.isArray(u.values)&&u.values.some(v=>String(v)===String(key)));
      if(!info && fields.length===1){
        info=infos.find(u=>String(u.value)===String(attrs[fields[0]]))||
              infos.find(u=>Array.isArray(u.values)&&u.values.some(v=>String(v)===String(attrs[fields[0]])));
      }
      return info||null;
    }
    const ZONE_KEYS=[ "ZONE_CODE","ZONE","ZONE_NAME","ZONING","ZONE_LABEL","ZONE_DESC","ZONE_TYPE","ZONE_CATEGORY","PLANNING_ZONE" ];
    function pickZoneLabel(attrs){
      if(!attrs) return null;
      const code=String(attrs.ZONE_CODE ?? attrs.ZONE ?? "").trim();
      const name=String(attrs.ZONE_NAME ?? attrs.ZONING ?? "").trim();
      if(code && name) return `${code} – ${name}`;
      for(const k of ZONE_KEYS){ const v=attrs[k]; if(v!=null && String(v).trim()) return String(v).trim(); }
      return null;
    }
    async function legendFromRendererUsingFeatures(layerNode,lotGeom,{exact=false,features=null}={}){
      const gt=(layerNode.geometryType||"").toLowerCase();
      const isZone=isZoning(layerNode.title||"",nodePath(layerNode));
      const g=(!exact && (gt==="point"||gt==="multipoint"||gt==="polyline")) ? geometryEngine.buffer(lotGeom,TOUCH_BUFFER_M,"meters") : lotGeom;

      let feats=Array.isArray(features)?features:[];
      if(!Array.isArray(features)){
        try{
          if(exact) feats=(await queryStrictOverlayFeatureHits(layerNode,lotGeom)).features;
          else{
            const q=await layerNode.queryFeatures({ geometry:g,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCountFactor:6 });
            feats=q.features||[];
          }
        }catch{}
      }
      if(!feats.length) return {items:[]};

      const itemMap=new Map();
      for(const f of feats){
        const gph=new Graphic({geometry:f.geometry,attributes:f.attributes,layer:layerNode});
        let sym=null;
        try{ sym = await symbolUtils.getDisplayedSymbol(gph, view); }catch{}
        if(!sym){
          const r=layerNode.renderer;
          sym = r?.symbol || r?.defaultSymbol || f.symbol || null;
        }
        if(!sym) continue;

        let label = isZone ? pickZoneLabel(f.attributes) : null;
        if(!label){
          const r=layerNode.renderer;
          if(r?.type==="unique-value"){
            const info=getUVInfo(r,f.attributes);
            if(info) label = info.label ?? String(info.value ?? (info.values||[]).join(", "));
          }else if(r?.type==="class-breaks" && r.field){
            const v=Number(f.attributes?.[r.field]);
            if(!Number.isNaN(v)){
              const info=(r.classBreakInfos||[]).find(b=>{
                const min=(b.minValue==null?-Infinity:b.minValue);
                const max=(b.maxValue==null? Infinity:b.maxValue);
                return v>=min && v<=max;
              });
              label=info?.label ?? (info ? `${info.minValue ?? ""} – ${info.maxValue ?? ""}` : null);
            }
          }
          if(!label) label=r?.label || layerNode.title || guessLabelFromAttrs(f.attributes) || "Class";
        }
        const sw=await swatchHTML(sym);
        if(!itemMap.has(label)) itemMap.set(label,{label,swatchHTML:sw});
      }
      return {items:[...itemMap.values()]};
    }

    /* Screenshot plumbing */
    function reportScaleText(scale=getReportMapScale(view)){
      return reportMapScaleText(scale);
    }
    function withReportScale(shot){
      if(shot){
        shot.reportScale=getReportMapScale(view);
        shot.scaleText=reportScaleText(shot.reportScale);
      }
      return shot;
    }
    async function takeReportScreenshot(options){
      await prepareNativeParcelReferences(view, waitViewIdle);
      await hideSrrcBasemapParcelLines(view.map);
      const shot = await view.takeScreenshot(options);
      return withReportScale(shot);
    }
    async function settleReportBasemap(){
      try{ await view.map?.basemap?.load?.(); }catch{}
      await hideSrrcBasemapParcelLines(view.map);
      await waitViewIdle(300);
    }
    function reportScaleHTML(shot){
      const text = shot?.scaleText || "";
      return text ? `<div class="map-scale">${htmlEsc(text)}</div>` : "";
    }
    function saveVisibility(root){ const map=new Map(); walkAny(root,(n)=>{ if("visible"in n){ map.set(nodePath(n),{vis:!!n.visible,op:n.opacity,min:n.minScale,max:n.maxScale,blend:n.blendMode,labels:n.labelsVisible}); } }); return map; }
    function restoreVisibility(root,snap){ walkAny(root,(n)=>{ if("visible"in n){ const k=nodePath(n); if(snap.has(k)){ const s=snap.get(k); try{n.visible=s.vis;}catch{} if("opacity"in n && s.op!==undefined){ try{n.opacity=s.op;}catch{} } if("blendMode"in n && s.blend!==undefined){ try{n.blendMode=s.blend;}catch{} } if("labelsVisible"in n && s.labels!==undefined){ try{n.labelsVisible=s.labels;}catch{} } try{n.minScale=s.min;n.maxScale=s.max;}catch{} } } }); }
    const isReportableNode=n=> n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function");

    async function intersectingNodesByCategory(geom){
      const out={zoning:[],bushfire:[],utilities:[],acid:[],transport:[],air:[],noise:[],others:[]};
      const arr=[]; walkAny(view.map,(n,underDNT)=>{ if(isReportableNode(n)&&!underDNT) arr.push(n); });
      for(const n of arr){
        try{
          if(isQueenslandFfdiLayer(n)) continue;
          await n.load();
          const cnt=await countFeatures(n,geom);
          if(!cnt) continue;
          const t=n.title||"", p=nodePath(n), id=n.id||"", tg=n.portalItem?.tags||[];
          if(isZoning(t,p)){ out.zoning.push(n); continue; }
          if(isBushfire(t,p)){ out.bushfire.push(n); continue; }
          if(isUtility(t,id,tg) || isWaterOrSewer(p)){ out.utilities.push(n); continue; }
          if(isAcid(t,p)){ out.acid.push(n); continue; }
          if(isNoise(t,p)){ out.noise.push(n); continue; }
          if(isTransport(t,p)){ out.transport.push(n); continue; }
          if(isAir(t,p)){ out.air.push(n); continue; }
          out.others.push(n);
        }catch{}
      }
      return out;
    }

    const ancestors=node=>{const out=[]; let p=node?.parent; while(p){out.push(p); p=p.parent;} return out;};
    const owningLayer=node=>{let c=node; while(c && c.type==="sublayer") c=c.parent; return c && c.type!=="sublayer" ? c : null;};
    async function awaitRenderFor(nodes){
      const layers=[...new Set(nodes.map(n=>owningLayer(n)).filter(Boolean))];
      const views=[];
      for(const L of layers){ try{views.push(await view.whenLayerView(L));}catch{} }
      if(views.length){
        try{await reactiveUtils.whenOnce(()=>views.every(v=>v.updating===false));}catch{}
      }
      await waitViewIdle(150);
    }
    async function sumCounts(nodes,geom){ let t=0; for(const n of nodes){ t+=await countFeatures(n,geom); } return t; }

    function collectAllUtilitiesNodes(){
      const all = [];
      walkAny(view.map, (n, underDNT)=>{
        if(underDNT) return;
        if(!isReportableNode(n)) return;
        const t = n.title || "", id = n.id || "", tg = n.portalItem?.tags || [];
        if (isUtility(t,id,tg) || isWaterOrSewer(nodePath(n))) all.push(n);
      });
      return all;
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

    const HARDWIRED={
      bushfire:[
        /bush\s*fire/i, /bushfire/i, /bush-?fire/i, /wild\s*fire/i, /bpa\b/i,
        /bushfire\s*prone/i, /bushfire\s*hazard/i, /qfes/i
      ],
      noise:[
        /transport\s*noise\s*corridor/i, /tnc\b/i, /state.*road.*noise/i,
        /road.*traffic.*noise/i, /tmr.*noise/i, /acoustic.*corridor/i
      ]
    };
    const strHay=node=>((node?.title||"")+" "+nodePath(node)+" "+(node?.url||"")).toLowerCase();
    function leafDisplayNodes(root){
      const out=[];
      const visit=n=>{
        const kids=(kidsOf(n)||[]);
        if(kids.length){ kids.forEach(visit); }
        else if("visible" in (n||{})){ out.push(n); }
      };
      visit(root);
      return out;
    }
    function collectLeafDisplayNodesByPredicate(pred,{includeDNT=false}={}){
      const out=[], seen=new Set();
      const pushUnique=node=>{
        if(!node || !("visible" in node)) return;
        const key=nodePath(node)||node.id||node.title||"node";
        if(seen.has(key)) return;
        seen.add(key);
        out.push(node);
      };
      walkAny(view.map,(n,underDNT)=>{
        if(!includeDNT && underDNT) return;
        const t=n.title||"", p=nodePath(n), id=n.id||"", tg=n.portalItem?.tags||[];
        if(!pred(n,t,p,id,tg)) return;
        const kids=kidsOf(n)||[];
        if(kids.length){ leafDisplayNodes(n).forEach(pushUnique); }
        else{ pushUnique(n); }
      });
      return out;
    }
    function collectAllBushfireDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p)=>HARDWIRED.bushfire.some(rx=>rx.test(strHay(n)))||isBushfire(t,p),{includeDNT:true});
    }
    function collectAllFFDIDisplayNodes(){
      const map=(typeof view!=="undefined" && view?.map) || (typeof webmap!=="undefined" ? webmap : null);
      return [ensureQueenslandFfdiLayer(map,FeatureLayer,esriConfig)].filter(Boolean);
    }
    [300,1200,3500].forEach(delay=>setTimeout(()=>{ try{ collectAllFFDIDisplayNodes(); }catch{} },delay));
    function collectAllNoiseDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p)=>HARDWIRED.noise.some(rx=>rx.test(strHay(n)))||isNoise(t,p),{includeDNT:true});
    }

    async function screenshotFor(nodes,title,lotGeom,legendOnLot=false,{forceAllVisible=false,legendUseExtent=false,legendAllRendererItems=false,legendIncludeHiddenNodes=false,legendStrictLotIntersection=false}={}){
      if(!nodes?.length || !lotGeom) return null;
      const present=forceAllVisible ? [...nodes] : [];
      if(!forceAllVisible){ for(const n of nodes){ if(await countFeatures(n,lotGeom)>0) present.push(n); } }
      if(!present.length && !forceAllVisible) return null;

      const visSnap=saveVisibility(view.map), scaleSnap=new Map(), opSnap=new Map(), blendSnap=new Map();
      const strengthenZoning=/\bzoning\b/i.test(String(title||""));

      try{
        return await withViewOnGeom(lotGeom, async ()=>{
          walkAny(view.map,(n,underDNT)=>{ if(!("visible"in n)) return; if(n===selLayer){try{n.visible=true;}catch{}; return;} if(underDNT){try{n.visible=true;}catch{}; return;} try{n.visible=false;}catch{} });
          try{ selLayer.visible=true; }catch{}

          for(const n of present){
            for(const a of [n,...ancestors(n)]){
              if(!("visible"in a)) continue;
              try{ a.visible=true; }catch{}
              if("minScale"in a || "maxScale"in a){
                if(!scaleSnap.has(a)) scaleSnap.set(a,{min:a.minScale,max:a.maxScale});
                try{ a.minScale=0; a.maxScale=0; }catch{}
              }
            }
            if("blendMode"in n){ if(!blendSnap.has(n)) blendSnap.set(n,n.blendMode); }
            if("opacity"in n){
              if(!opSnap.has(n)) opSnap.set(n,n.opacity);
              if(strengthenZoning){
                try{ n.opacity=Math.max(Number(n.opacity)||0,0.8); }catch{}
              }
            }
          }
          await awaitRenderFor(present);
          await waitViewIdle(80);

          const shot=await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});

          let legendGeom=lotGeom;


          if(legendUseExtent && view?.extent){ legendGeom=view.extent; }


          else if(!legendOnLot){ try{ const onScr=geometryEngine.intersect(lotGeom,view.extent); if(onScr) legendGeom=onScr; }catch{} }

          const legendParts=[];
          for(const n of present){
            const res = legendAllRendererItems

              ? await legendFromRendererAllItems(n)

              : await legendFromRendererUsingFeatures(n,legendGeom,{exact:legendStrictLotIntersection});

            const items = res?.items || [];
            if(items.length){
              const inner=items.map(i=>`<div class="row">${i.swatchHTML}${i.label.replace(/&/g,"&amp;")}</div>`).join("");
              legendParts.push(`<div style="margin-bottom:6px"><b>${(n.title||"Layer").replace(/&/g,"&amp;")}</b><div class="leg" style="margin-top:4px">${inner}</div></div>`);
            }
          }

          const count=await sumCounts(nodes,lotGeom);
          return {title,id:"rpt-"+slug(title),dataUrl:shot.dataUrl,scaleText:shot.scaleText,legendHTML:legendParts.join(""),count};
        });
      } finally {
        for(const [n,op] of opSnap){ try{n.opacity=op;}catch{} }
        for(const [n,bl] of blendSnap){ try{n.blendMode=bl;}catch{} }
        for(const [n,sc] of scaleSnap){ try{n.minScale=sc.min;n.maxScale=sc.max;}catch{} }
        restoreVisibility(view.map,visSnap);
      }
    }

    async function captureOverlayBaseShot(geom){
      if(!geom) return null;
      const visSnap=saveVisibility(view.map);
      try{
        return await withViewOnGeom(geom,async()=>{
          walkAny(view.map,(n,underDNT)=>{
            if(!("visible"in n)) return;
            if(n===selLayer){ try{n.visible=true;}catch{} return; }
            if(underDNT){ try{n.visible=true;}catch{} return; }
            try{n.visible=false;}catch{}
          });
          try{selLayer.visible=true;}catch{}
          await settleReportBasemap();
          return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});
        });
      }finally{
        restoreVisibility(view.map,visSnap);
      }
    }

    async function addMandatorySection(shots,title,collectorFn,geom,fallbackShot,emptyNote){
      try{
        const {nodes,captureOptions}=await prepareMandatoryOverlayReportSection(view.map,title,collectorFn);
        if(nodes.length){
          const s=await screenshotFor(nodes,title,geom,false,captureOptions);
          if(!s){ shots.push({title,id:"rpt-"+slug(title),dataUrl:fallbackShot.dataUrl,scaleText:fallbackShot.scaleText,legendHTML:"",count:0,note:emptyNote}); }
          else{
            if((s.count||0)===0) s.note=emptyNote;
            shots.push(s);
          }
        }else{
          shots.push({title,id:"rpt-"+slug(title),dataUrl:fallbackShot.dataUrl,scaleText:fallbackShot.scaleText,legendHTML:"",count:0,note:emptyNote});
        }
      }catch(err){
        console.warn("Mandatory section failed:", title, err);
        shots.push({title,id:"rpt-"+slug(title),dataUrl:fallbackShot.dataUrl,scaleText:fallbackShot.scaleText,legendHTML:"",count:0,note:emptyNote+" (layer unavailable)"});
      }
    }
    function dedupeShotsByTitle(shots,title){
      const needle=(title||"").trim().toLowerCase();
      if(!needle) return;
      let seen=false;
      for(let i=shots.length-1;i>=0;i--){
        const cur=(shots[i]?.title||"").trim().toLowerCase();
        if(cur===needle){
          if(seen){ shots.splice(i,1); }
          else{ seen=true; }
        }
      }
    }

    let lastReportHTML=null, lastReportTitle="Property Report";

    /* Build report */
    $("btnPrintReport").addEventListener("click", async ()=>{
      const actions=$("rptActions");
      if(actions) actions.style.display="none";
      showRptOverlay(true);
      try{
        const result = await buildAndOpenReport();
        if(result && result.html){
          lastReportHTML = result.html;
          lastReportTitle = result.title || "Property Report";
          setRpt("Report ready", 100, "rptS4");
          const msg=$("rptReadyMsg"); if(msg) msg.textContent="Report ready";
          if(actions) actions.style.display="flex";
        }else{
          showRptOverlay(false);
        }
      }catch(e){
        console.error(e);
        alert("Could not create report.");
        showRptOverlay(false);
      }
    });

    // The local VA backend uses this narrow hook to run the same report
    // builder as the visible map. It is only called from a loopback-only
    // headless browser session started by the report API.
    window.__LOT_WISE_REPORT_AUTOMATION__ = Object.freeze({
      focusOnLotPlan: (lot, plan) => focusOnLotPlan(lot, plan),
      buildReport: () => buildAndOpenReport()
    });

    async function buildAndOpenReport(){
      try{
        showLoading(true);
        await mapStartupReady;

        setRpt("Locating parcel...", 12);
        let geom=null, lotText="--", areaText=`-- ${M2}`, classText="--", addressText="--", councilText="Scenic Rim Regional Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry;
          ({lotText,areaText,classText,addressText,councilText}=lastParcelInfo);
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){
            const info=parcelInfoFromFeature(probe);
            geom=probe.geometry;
            ({lotText,areaText,classText,addressText,councilText}=info);
            lastParcelInfo={feature:probe,...info};
          }
        }
        setRpt("Parcel located", 18, "rptS1");

        if(geom){
          setRpt("Resolving address...", 25);
          let resolvedAddr=null;
          try{ resolvedAddr = await resolveBestAddress(geom, lastParcelInfo.feature); }catch{}
          setRpt("Address resolved", 35, "rptS2");
          const cleanAddr=formatAddressDisplay(resolvedAddr || lastParcelInfo.addressText || addressText);
          lastParcelInfo.addressText = cleanAddr;
          addressText = cleanAddr;
          updateSummaryPanel();
          setRpt("Resolving setback rules...", 38);
          try{
            lastSrrcSetbackContext = await resolveSrrcSetbackContext(geom);
            updateSrrcSetbacksPanel();
          }catch{}
        }else{
          addressText = formatAddressDisplay(addressText);
        }

        setRpt("Rendering base map...", 42);
        const baseShot = await withSatelliteBasemap(view, async()=>geom
          ? await withViewOnGeom(geom, async()=>{ try{selLayer.visible=true;}catch{}; await waitViewIdle(200); return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}); })
          : await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}));

        await settleReportBasemap();
        const overlayBaseShot = geom ? await captureOverlayBaseShot(geom) : baseShot;

        setRpt("Collecting overlays...", 55);
        const cats = geom ? await intersectingNodesByCategory(geom) : {zoning:[],bushfire:[],utilities:[],acid:[],transport:[],air:[],noise:[],others:[]};

        const shots=[];
        const tasks=[
          ["Zoning", async()=>{ if(cats.zoning.length){ const s=await screenshotFor(cats.zoning,"Zoning",geom,true); if(s) shots.push(s); }}],
          ["Bushfire", async()=>{ await addMandatorySection(shots,"Bushfire",collectAllBushfireDisplayNodes,geom,overlayBaseShot,"No bushfire Level"); }],
          ["FFDI", async()=>{ await addMandatorySection(shots,"FFDI",collectAllFFDIDisplayNodes,geom,overlayBaseShot,"No FFDI layer"); }],
          ["Utilities", async()=>{ const allUtils = collectAllUtilitiesNodes(); if(allUtils.length){ const s = await screenshotFor(allUtils, "Utilities", geom, false, {forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); }}],
          ["Acid overlays", async()=>{ if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); }}],
          ["Transport", async()=>{ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); }}],
          ["Air quality", async()=>{ if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); }}],
          ["Transport Noise Corridor", async()=>{ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,overlayBaseShot,"No Transport Noise Level"); }],
          ["Noise / Acoustic", async()=>{ if(cats.noise.length){ const s=await screenshotFor(cats.noise,"Noise / Acoustic",geom); if(s) shots.push(s); }}],
          ["Other overlays", async()=>{ for(const n of cats.others){ const s=await screenshotFor([n],n.title||"Overlay",geom); if(s) shots.push(s); } }]
        ];
        for(let i=0;i<tasks.length;i++){
          const [name,fn]=tasks[i];
          setRpt(`Rendering ${name}...`, 55 + Math.round(((i+1)/tasks.length)*30));
          await fn();
        }
        dedupeShotsByTitle(shots,"Transport Noise Corridor");
        setRpt("Overlays rendered", 87, "rptS3");
        let qscfData=null;
        if(geom){
          setRpt("Checking Queensland parcel information", 90);
          try{ qscfData=await queryQueenslandCadastralData({lotPlan:lotText,geometry:geom}); }
          catch(error){ console.warn("QSCF cadastral/easement lookup failed",error); }
        }

        setRpt("Composing document...", 93);
        const landscapeBaseName=(addressText&&addressText!=="--")
          ? addressText
          : ((lotText&&lotText!=="--")?`Lot ${lotText}, ${councilText}`:"Property Report");
        const landscapeReportTitle=String(`${landscapeBaseName} - Property Report`)
          .replace(/[\/\\:*?"<>|]+/g," ")
          .replace(/\s{2,}/g," ")
          .trim();
        const landscapeHTML=composeLandscapePropertyReport({
          title:landscapeReportTitle,
          address:addressText,
          lot:lotText,
          area:areaText,
          propertyClass:classText,
          council:councilText,
          generatedAt:new Date(),
          baseShot,
          shots,
          qscfData,
          hasFlood:false,
          floodUrl:null,
          floodAuthority:councilText,
          renderScale:reportScaleHTML,
          planningLink:typeof buildPlanningSchemeLink==="function"?buildPlanningSchemeLink:undefined
        });
        return {html:landscapeHTML,title:landscapeReportTitle};
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
    /* Tabs & Home */
    [["summary"],["setbacks"],["proposal"],["yield"]].forEach(([name])=>{
      const t=$("tab-"+name), p=$("panel-"+name);
      if(!t||!p) return;
      t.addEventListener("click",()=>{
        document.querySelectorAll(".tab").forEach(el=> el.setAttribute("aria-selected","false"));
        document.querySelectorAll(".panel").forEach(el=> el.classList.remove("active"));
        t.setAttribute("aria-selected","true"); p.classList.add("active");
      });
    });
    $("btnHome").addEventListener("click",event=>{
      event.preventDefault();
      window.location.assign(new URL("Index.html",window.location.href).href);
    });
