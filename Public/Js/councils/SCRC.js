// Extracted from SCRC.html. Keep this file as the independent page brain for SCRC.
import {
  $,
  addCorsHosts,
  attrEsc,
  backgroundFactor,
  checkToken,
  formatRemaining,
  getQueryParam,
  htmlEsc,
  initPodUpload,
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
    import * as symbolJsonUtils from "https://js.arcgis.com/4.30/@arcgis/core/symbols/support/jsonUtils.js";
    import * as locator from "https://js.arcgis.com/4.30/@arcgis/core/rest/locator.js";
    import esriConfig from "https://js.arcgis.com/4.30/@arcgis/core/config.js";
    /* ---------------- Tunables ---------------- */
    const TOUCH_BUFFER_M = 6;
    const SWATCH_PX = 16;
    const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
    const BRISBANE=[153.04928480155365,-26.680697449653717]; // Sunshine Coast center (kept var name)
    const M2="m²";
    // “3 houses out”
    const HOUSES_OUT = 4;
    const HOUSE_LOT_METERS = 25;
    const SCREEN_BUFFER_METERS = HOUSES_OUT * HOUSE_LOT_METERS;
    const SHOT_SIZE = { width: 1280, height: 900 };
    /* ---- CORS allow-list for address queries ---- */
    const CORS_HOSTS = [
      "cornerstonebc.maps.arcgis.com",
      "services.arcgis.com",
      "gisservices.information.qld.gov.au",
      "gis.brisbane.qld.gov.au",
      "maps.moretonbay.qld.gov.au",
      "maps.sunshinecoast.qld.gov.au"
    ];
    addCorsHosts(esriConfig, CORS_HOSTS);
    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async(extra=240)=>{try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{} await raf(); await sleep(extra);};
    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null,
      countdownTimer: null
    };
    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/14AeVdgqO3gt95F13X7ss0r";
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
      const sessionId = getQueryParam("session_id");
      accessState.paymentUrl = await loadPaymentUrl();
      setPaymentLink(accessState.paymentUrl || PAYMENT_FALLBACK_URL);
      const homeBtn = $("accessGateHome");
      if(homeBtn){
        homeBtn.addEventListener("click", ()=>{ window.location.href = "Index.html"; });
      }
      if(!accessState.key && sessionId){
        const returnPath = "SCRC.html";
        window.location.href = `/api/stripe/success?session_id=${encodeURIComponent(sessionId)}&return=${encodeURIComponent(returnPath)}`;
        return;
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
    initAccessGate();    function framedExtent(geom){
      try{
        const b=geometryEngine.buffer(geom,SCREEN_BUFFER_METERS,"meters");
        return (b&&b.extent)?b.extent:(geom&&geom.extent);
      }catch{return geom && geom.extent;}
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
    /* ---------------- Map & rules ---------------- */
    // ★ CHANGED: portal URL kept, WebMap item id updated to your provided item
    const portal=new Portal({url:"https://cornerstonebc.maps.arcgis.com"});
    let webmap=new WebMap({portalItem:{id:"5360524219a54a50855c17881e74e245",portal}});
    const selLayer=new GraphicsLayer({listMode:"hide"}); webmap.add(selLayer);
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
    const sppBushfireLayer=new FeatureLayer({url:SPP_BUSHFIRE_LAYER_URL,title:"Bushfire - State SPP",listMode:"show",visible:false,opacity:0,minScale:0,maxScale:0,outFields:["OBJECTID","CLASS"],objectIdField:"OBJECTID",geometryType:"polygon",spatialReference:{wkid:102100},popupEnabled:false,renderer:sppBushfireRenderer});
    const sppBushfireDrawLayer=new GraphicsLayer({listMode:"hide",visible:false});
    let allowSppBushfireLayer=false;
    try{ sppBushfireLayer.when(()=>console.info("SPP bushfire layer loaded"),err=>console.warn("SPP bushfire layer failed",err)); }catch{}
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
    async function setScreenshotPropertyBoundary(geom,opts){
      opts = opts || {};
      try{
        ensurePropertyBoundaryShotLayer();
        propertyBoundaryShotLayer.removeAll();
        if(opts.keepLabels===false) suppressPropertyBoundaryLabels(view.map);
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
    // ★ CHANGED: start center/scale to your provided values
    const view=new MapView({
      container:"viewDiv",
      map:webmap,
      center:BRISBANE,
      zoom:17,
      constraints:{snapToZoom:false}
    });
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
    function scheduleSppBushfireRefresh(delay=220){
      clearTimeout(sppBushfireRefreshTimer);
      sppBushfireRefreshTimer=setTimeout(()=>{ refreshSppBushfireGraphics(); },delay);
    }
    async function refreshSppBushfireGraphics(){
      const run=++sppBushfireRefreshRun;
      try{
        const on=!!sppBushfireLayer.visible;
        try{ sppBushfireDrawLayer.visible=on; }catch{}
        if(!on){ try{ sppBushfireDrawLayer.removeAll(); }catch{} return; }
        await sppBushfireLayer.when();
        if(!view?.extent) return;
        const q=sppBushfireLayer.createQuery();
        q.geometry=view.extent.clone ? view.extent.clone() : view.extent;
        q.spatialRelationship="intersects";
        q.returnGeometry=true;
        q.outFields=["CLASS"];
        q.outSpatialReference=view.spatialReference;
        q.num=1800;
        const res=await sppBushfireLayer.queryFeatures(q);
        if(run!==sppBushfireRefreshRun) return;
        sppBushfireDrawLayer.removeAll();
        (res.features||[]).forEach(f=>{
          sppBushfireDrawLayer.add(new Graphic({geometry:f.geometry,attributes:f.attributes,symbol:sppBushfireGraphicSymbol(f.attributes?.CLASS)}));
        });
        console.info("SPP bushfire graphics drawn",(res.features||[]).length);
      }catch(e){
        console.warn("SPP bushfire graphics failed",e);
      }
    }
    try{ sppBushfireLayer.watch("visible",on=>{ if(on) scheduleSppBushfireRefresh(0); else{ sppBushfireDrawLayer.visible=false; sppBushfireDrawLayer.removeAll(); } }); }catch{}
    try{ view.watch("stationary",stationary=>{ if(stationary && sppBushfireLayer.visible) scheduleSppBushfireRefresh(180); }); }catch{}
    const inText=(t,p="")=>String(t||"")+" "+String(p||"");
    const isDNT=(title,id="",tags=[])=>{const t=String(title||""); const i=String(id||""); const tag=(tags||[]).join("|"); return /do[\s-]*not[\s-]*touch/i.test(t)||/do[\s-]*not[\s-]*touch/i.test(i)||/do[\s-]*not[\s-]*touch/i.test(tag);};
    const isUtility=(title,id="",tags=[])=>/\b(utilit(y|ies)|power|electric|telecom|gas|water|sewer|storm[-\s]?water|reticulation|service)\b/i.test(inText(title,id)+" "+(tags||[]).join(" "));
    const isWaterOrSewer=(path)=>/\b(water|sewer|storm[\s-]*water|drainage|watercourse)\b/i.test(String(path||""));
    const isAcid=(t,p="")=>/\bacid\b/i.test(inText(t,p));
    const isTransport=(t,p="")=>/\b(transport|road|rail|corridor|traffic|cycle|bikeway|pedestrian|carpark|parking|transit|bus|ferry)\b/i.test(inText(t,p));
    const isAir=(t,p="")=>/\b(air\s*quality|air-quality|air|pollution)\b/i.test(inText(t,p));
    const isNoise=(t,p="")=>/\b(noise|acoustic|transport.*noise.*corridor|tnc)\b/i.test(inText(t,p));
    const isZoning=(t,p="")=>/\b(zoning|zone|zones)\b/i.test(inText(t,p));
    const isBushfire=(t,p="")=>/\b(bush[-\s]?fire|bushfire|bush\s*fire|wild[-\s]?fire|fire\s*hazard)\b/i.test(inText(t,p));
    const planKey=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
    const zoneBaseKey=s=>planKey(s).replace(/zonecode|zone/g,"");
    const SCRC_ZONE_LINKS=new Map([
      [zoneBaseKey("Low density residential"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407316/File/document"],
      [zoneBaseKey("Medium density residential"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407317/File/document"],
      [zoneBaseKey("High density residential"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407318/File/document"],
      [zoneBaseKey("Tourist accommodation"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407319/File/document"],
      [zoneBaseKey("Principal centre"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407320/File/document"],
      [zoneBaseKey("Major centre"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407322/File/document"],
      [zoneBaseKey("District centre"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407323/File/document"],
      [zoneBaseKey("Local centre"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407324/File/document"],
      [zoneBaseKey("Low impact industry"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407325/File/document"],
      [zoneBaseKey("Medium impact industry"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407326/File/document"],
      [zoneBaseKey("High impact industry"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407327/File/document"],
      [zoneBaseKey("Waterfront and marine industry"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407328/File/document"],
      [zoneBaseKey("Sport and recreation"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407329/File/document"],
      [zoneBaseKey("Open space"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407330/File/document"],
      [zoneBaseKey("Environmental management and conservation"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407331/File/document"],
      [zoneBaseKey("Community facilities"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407332/File/document"],
      [zoneBaseKey("Emerging community"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407333/File/document"],
      [zoneBaseKey("Limited development (landscape residential)"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407334/File/document"],
      [zoneBaseKey("Rural"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407335/File/document"],
      [zoneBaseKey("Rural residential"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407336/File/document"],
      [zoneBaseKey("Specialised centre"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407337/File/document"],
      [zoneBaseKey("Tourism"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407338/File/document"]
    ]);
    const SCRC_CURRENT_SCHEME_URL="https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014";
    const SCRC_DWELLING_HOUSE_CODE_URL="https://assets-us-01.kc-usercontent.com/c631baf8-1b46-001f-580c-d0001b68b4a8/2774d7c3-3241-4e60-8727-1fe874da56e2/782BEBED-7896-4040-9C92-8EC7CF2AB23F";
    const SCRC_CARPORTS_URL="https://www.sunshinecoast.qld.gov.au/development/building/carports";
    const SCRC_SHEDS_URL="https://www.sunshinecoast.qld.gov.au/development/building/sheds";
    const QDC_MP11_URL="https://www.hpw.qld.gov.au/__data/assets/pdf_file/0010/4303/mp1-1.pdf";
    const QDC_MP12_URL="https://www.housing.qld.gov.au/__data/assets/pdf_file/0012/4305/mp1-2.pdf";
    const SCRC_OVERLAY_LINKS=new Map([
      [planKey("Acid sulfate soils overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407371/File/document"],
      [planKey("Airport environs overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407372/File/document"],
      [planKey("Biodiversity, waterways and wetlands overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407373/File/document"],
      [planKey("Bushfire hazard overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407374/File/document"],
      [planKey("Bushfire hazard area buffer"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407374/File/document"],
      [planKey("Bushfire hazard area"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407374/File/document"],
      [planKey("Bushfire"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407374/File/document"],
      [planKey("Coastal protection overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407375/File/document"],
      [planKey("Extractive resources overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407376/File/document"],
      [planKey("Flood hazard overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407377/File/document"],
      [planKey("Height of buildings and structures overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407378/File/document"],
      [planKey("Maximum height of buildings and structures"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407378/File/document"],
      [planKey("Height of buildings and structures"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407378/File/document"],
      [planKey("Heritage and character areas overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407379/File/document"],
      [planKey("Landslide hazard and steep land overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407380/File/document"],
      [planKey("Landslide hazard"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407380/File/document"],
      [planKey("Steep land"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407380/File/document"],
      [planKey("Steep land (slope)"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407380/File/document"],
      [planKey("Regional infrastructure overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407381/File/document"],
      [planKey("Scenic amenity overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407382/File/document"],
      [planKey("Water resource catchments overlay code"),"https://publicdocs.scc.qld.gov.au/hpecmwebdrawer/Record/22407383/File/document"]
    ]);
    const findScrcZoneLink=(title,labels=[])=>{
      const searchTerms=[title, ...labels].filter(Boolean);
      for(const term of searchTerms){
        const base=zoneBaseKey(term);
        if(SCRC_ZONE_LINKS.has(base)) return SCRC_ZONE_LINKS.get(base);
      }
      return null;
    };
    const findScrcOverlayLink=(title,labels=[])=>{
      const searchTerms=[title, ...labels].filter(Boolean);
      for(const term of searchTerms){
        const key=planKey(term);
        for(const [entryKey, url] of SCRC_OVERLAY_LINKS){
          if(key === entryKey || key.includes(entryKey) || entryKey.includes(key)) return url;
        }
      }
      return null;
    };
    const kidsOf=n=>(n.layers?.toArray?.()??n.layers)||(n.sublayers?.toArray?.()??n.sublayers)||[];
        const nodePath=n=>{const bits=[]; let cur=n; while(cur){bits.unshift(cur.title||cur.id||"node"); cur=cur.parent;} return bits.join(" / ");};
    const ALWAYS_ON_IDS=new Set();
    const utilityVisSnapshot=new Map();
    let utilitiesToggleState=false;
    let utilToggleBtn=null;
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
        if(underDNT || !('visible' in n)) return;
        const t=n.title||'', p=nodePath(n), tg=n.portalItem?.tags||[];
        if(isUtility(t,n.id,tg) || isWaterOrSewer(p)) nodes.push(n);
      });
      return nodes;
    }
    function updateUtilityToggleLabel(){
        const btn = utilToggleBtn || document.getElementById('btnUtilityToggleMap');
      if(!btn) return;
      const on = utilitiesToggleState;
      btn.setAttribute('title', on ? 'Hide utilities' : 'Show utilities');
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('active', on);
    }
    function setUtilitiesVisible(on){
      const nodes=getUtilityNodes();
      if(on){
        utilityVisSnapshot.clear();
        nodes.forEach(n=>{
          if(!utilityVisSnapshot.has(n)) utilityVisSnapshot.set(n, !!n.visible);
          try{ n.visible=true; }catch{}
          try{ n.listMode='show'; }catch{}
          let p=n.parent;
          while(p){
            if('visible' in p){ try{p.visible=true;}catch{} }
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
    function enforceOverlayRules(){ walkAny(webmap,(node,underDNT)=>{ if(node.type==="graphics"){try{node.listMode="hide";}catch{} return;} if(!("visible"in node)) return; underDNT?keepOnHidden(node):startHidden(node); }); }
    ;[300,900,1800,3500].forEach(ms=> setTimeout(()=>{ try{ensureSppBushfireLayer(); enforceOverlayRules();}catch{} },ms));
    (async()=>{
      showLoading(true);
      try{
        await webmap.load();
        try{
          await webmap.loadAll();
        }catch(e){
          console.warn("One or more WebMap layers failed to load; keeping the portal WebMap active.", e);
        }
        allowSppBushfireLayer=true;
        ensureSppBushfireLayer();
        enforceOverlayRules();
      }catch(e){
        console.warn("WebMap auth/fail; fallback basemap",e);
        webmap=new WebMap({basemap:"streets-vector"});
        webmap.add(selLayer);
        view.map=webmap;
        allowSppBushfireLayer=true;
        ensureSppBushfireLayer();
      } finally{
        showLoading(false);
      }
    })();
view.ui.add(new Home({view}),"top-left");
    view.ui.add(new ScaleBar({view,unit:"metric"}),"bottom-left");
    const layerList=new LayerList({view,listItemCreatedFunction(e){
      const item=e.item, node=item.sublayer||item.layer;
      if(!node) return;
      if(keepLegacyBushfireHidden(node)){ item.visible=false; item.panel=null; return; }
      if(node.type==="graphics"){ item.visible=false; item.panel=null; try{node.listMode="hide";}catch{} return; }
      let cur=node, inDNT=false;
      while(cur){ const t=cur.title||"", i=cur.id||"", tg=cur.portalItem?.tags||[]; if(isDNT(t,i,tg)){ inDNT=true; break; } cur=cur.parent; }
      if(inDNT||isPropertyBoundaryLayer(node)){ keepOnHidden(node); item.visible=false; item.panel=null; }
      else{ try{node.listMode="show";}catch{} item.panel={content:"legend"}; }
    }});
    view.ui.add(new Expand({view,content:layerList,expandIconClass:"esri-icon-layers",expanded:false}),"top-right");
    view.when(()=>{
      utilToggleBtn = (()=>{
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
      view.ui.add(utilToggleBtn,{position:"top-right",index:2});
    });
    view.ui.add(new Expand({view,content:new Legend({view}),expandIconClass:"esri-icon-legend"}),"top-right");
    view.ui.add(new Expand({view,content:new BasemapGallery({view}),expandIconClass:"esri-icon-basemap"}),"top-right");
    view.ui.add(new Fullscreen({view}),"top-right");
    /* --- Search widget (address + Lot/Plan) --- */
    const search=new Search({
      view,
      includeDefaultSources:false,
      popupEnabled:true,
      suggestionsEnabled:true,
      minSuggestCharacters:1,
      allPlaceholder:"Search address or Lot/Plan (e.g., 12/SP12345)"
    });
    view.ui.add(search,{position:"top-right",index:0});
    /* ---------------- Status ---------------- */
    view.watch("extent",()=>{ const c=view.center; setText("statusCoords",`Coords: ${c.longitude.toFixed(5)}, ${c.latitude.toFixed(5)}`); setText("statusZoom",`Zoom: ${view.zoom.toFixed(1)}`); setText("statusScale",`Scale: 1:${Math.round(view.scale)}`); });
    /* ---------------- Parcel selection ---------------- */
    const parseNumberLike=raw=>{ if(raw==null) return null; let s=String(raw).trim(); if(!s) return null; const hasHA=/(^|[^a-z])ha([^a-z]|$)/i.test(s)||/\bhectare(s)?\b/i.test(s); s=s.replace(/,/g,"").replace(/square\s*met(re|er)s?/ig,"").replace(/m2|m\u00B2|sqm|sq\.?m/ig,"").trim(); let n=parseFloat(s); if(isNaN(n)) return null; if(hasHA) n*=10000; return n; };
    function getLotAreaSqm(attrs){ const strong=["LOT_AREA_M2","LOT_SIZE_M2","LOT_SIZE_SQM","LOT_AREA_SQM","AREA_SQM","SITE_AREA_SQM","LAND_AREA_SQM","LOT_AREA","LOT_SIZE","SITE_AREA","LAND_AREA","AREA_M2","AREA (M2)","AREA(M2)","AREA_M^2","AREA_HA","HECTARES"]; for(const k of strong){ const v=k in attrs?parseNumberLike(attrs[k]):null; if(v!=null){ if(v>0&&v<50&&(k==="AREA_HA"||k==="HECTARES")) return v*10000; return v; } } for(const k2 in attrs){ const v2=attrs[k2]; if(/(lot|site|land).*area/i.test(k2)||/area.*(sqm|m2|m\^2|square)/i.test(k2)||(/(lot|site).*size/i.test(k2))){ const val=parseNumberLike(v2); if(val) return val; } } return null; }
    function parseParcelMeta(attrs){ const keys=rx=>Object.keys(attrs).find(k=>rx.test(k)); const lot=attrs["LOT"]??attrs["LOTNO"]??attrs["LOT_NO"]??attrs["LOTNUMBER"]??(keys(/^lot[\w_]*$/i)&&String(attrs[keys(/^lot[\w_]*$/i)])); const plan=attrs["PLAN"]??attrs["PLANNO"]??attrs["PLAN_NO"]??(keys(/^plan[\w_]*$/i)&&String(attrs[keys(/^plan[\w_]*$/i)])); let lotplan=attrs["LOT_PLAN"]??attrs["LOT_PLAN_NO"]??attrs["LOTPLAN"]??attrs["LOTPLAN_NO"]??attrs["LOTPLAN_TXT"]??attrs["LOT_PLAN_TXT"]??attrs["LOT_PLAN_TEXT"]??attrs["LOTPLAN_TEXT"]; if(!lotplan && lot && plan) lotplan=lot+"/"+plan; if(!lotplan){ for(const key in attrs){ const s=String(attrs[key]||"").toUpperCase(); const m=s.match(/\b(\d+)\s*\/\s*([A-Z]{1,4}\s*\d+)\b/); if(m){ lotplan=m[1]+"/"+m[2].replace(/\s+/g,""); break; } } } return {lot,plan,lotplan}; }
    const geomAreaSqmSafe=g=>{ try{ const a=Math.abs(geometryEngine.planarArea(g,"square-meters")||0); return a>0?a:null; }catch{ return null; } };
    function smartJoin(parts){ return parts.filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
    const _get = (o, ks) => { for (const k of ks) if (k in o && String(o[k] ?? "").trim()) return String(o[k]).trim(); return null; };
    function parseCouncil(attrs){
      if(!attrs) return null;
      const first=(...keys)=>{ for(const k of keys){ if(k in attrs){ const v=String(attrs[k]??"").trim(); if(v) return v; } } return null; };
      return first("COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY") || "Sunshine Coast Council";
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
      "LOT_PLAN","LOT_PLAN_NO","LOTPLAN","LOTPLAN_NO","LOTPLAN_TXT","LOT_PLAN_TXT","LOT_PLAN_TEXT","LOTPLAN_TEXT","LOT/PLAN",
      "LOTPLAN_STATUS","LOT_PLAN_STATUS","LOTPLANSTATUS","LOT_PLAN_STATUS_TXT"
    ];
    function _pick(attrs, keys){
      for(const k of keys){
        if(k in attrs){
          const v = String(attrs[k] ?? "").trim();
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
    function isLikelyStreetAddress(s){
      if(!s) return false;
      const v = String(s).trim();
      if(!v) return false;
      const hasNumberName = /\b\d{1,5}[A-Za-z]?\s+[A-Za-z][A-Za-z\s.'-]{2,}\b/i.test(v);
      const hasRange = /\b\d{1,5}\s*[-–]\s*\d{1,5}\s+[A-Za-z][A-Za-z\s.'-]{2,}\b/i.test(v);
      const hasUnit = /\b(?:Unit|U|Shop|Suite|Level|Lvl|Apt|Apartment|Flat|Lot)\s*\d+[A-Za-z]?\s*\/\s*\d{1,5}/i.test(v);
      const hasType = /\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway)\b/i.test(v);
      if((hasNumberName || hasRange) && hasType) return true;
      if((hasNumberName || hasRange) && /,\s*[A-Za-z][A-Za-z\s.'-]+/.test(v)) return true;
      if(hasUnit && (hasType || hasNumberName || hasRange)) return true;
      if(/\bLot\s+\d+\b/i.test(v) && /Plan/i.test(v)) return true;
      return hasNumberName || hasRange || hasUnit;
    }
    function isAddressLikeLoose(s){
      if(!s) return false;
      const v = String(s).trim();
      if(!v) return false;
      if(!/\d/.test(v)) return false;
      if(/\b\d{4}\b/.test(v)) return true;
      if(/\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway)\b/i.test(v)) return true;
      return false;
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
    // NEW: always ensure suburb (and optionally state/postcode) appears on the address line
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
    async function queryAddressByLotPlan(parcelFeature){
      if(!parcelFeature || !parcelFeature.attributes) return null;
      const attrs = parcelFeature.attributes;
      const meta = parseParcelMeta(attrs);
      const lot = meta && meta.lot ? String(meta.lot).trim() : null;
      const plan = meta && meta.plan ? String(meta.plan).trim() : null;
      const lpRaw = _pick(attrs, LOTPLAN_FIELDS);
      const lpText = lpRaw ? String(lpRaw).trim() : null;
      if(!lot && !plan && !lpText) return null;
      const sqlFieldLocal = name => /[^A-Za-z0-9_]/.test(String(name||"")) ? '"' + String(name||"").replace(/"/g,'""') + '"' : String(name||"");
      const escSQLLocal = s => String(s||"").replace(/'/g,"''");
      const lpFull = lpText || (lot && plan ? (lot + "/" + plan) : null);
      const lpCompact = lpFull ? lpFull.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
      const nodes = flattenFeatureNodes();
      for(const n of nodes){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          if(!looksLikeAddressLayer(n) && !hasAddressFields(n)) continue;
          const flds = n.fields || [];
          const lpField = flds.find(f=>String(f?.name||"").toLowerCase() === "lotplan" || String(f?.name||"").toLowerCase() === "lot_plan" || String(f?.name||"").toLowerCase() === "lot/plan");
          const lotField = flds.find(f=>String(f?.name||"").toLowerCase() === "lot");
          const planField = flds.find(f=>String(f?.name||"").toLowerCase() === "plan");
          const whereParts = [];
          if(lpField && lpFull){
            const fieldExpr = "UPPER(" + sqlFieldLocal(lpField.name) + ")";
            const scrubExpr = "REPLACE(REPLACE(REPLACE(" + fieldExpr + ", ' ', ''), '-', ''), '/', '')";
            const lpU = escSQLLocal(lpFull.toUpperCase());
            if(lpCompact){
              const lpC = escSQLLocal(lpCompact);
              whereParts.push(fieldExpr + "='" + lpU + "'");
              whereParts.push(scrubExpr + "='" + lpC + "'");
              whereParts.push(scrubExpr + " LIKE '%" + lpC + "%'"
              );
            }else{
              whereParts.push(fieldExpr + "='" + lpU + "'");
            }
          }
          if(lotField && planField && lot && plan){
            const lotU = escSQLLocal(lot.toUpperCase());
            const planU = escSQLLocal(plan.toUpperCase());
            const where2 = "UPPER(" + sqlFieldLocal(lotField.name) + ")='" + lotU + "'";
            const where3 = "UPPER(" + sqlFieldLocal(planField.name) + ")='" + planU + "'";
            whereParts.push("(" + where2 + " AND " + where3 + ")");
          }
          if(!whereParts.length) continue;
          const where = whereParts.join(" OR ");
          const r = await n.queryFeatures({where, returnGeometry:false, outFields:["*"], maxRecordCountFactor:5});
          for(const f of (r.features || [])){
            const addr = parseAddress(f.attributes) || buildAddressFromParts(f.attributes);
            if(addr && (isLikelyStreetAddress(addr) || isAddressLikeLoose(addr))) return addr;
          }
        }catch{}
      }
      return null;
    }
function extractBusinessName(attrs){
      if(!attrs) return null;
      const keyHints = /(business|trading|company|owner|occupier|tenant|name|enterprise|store|shop|organisation|organization)/i;
      let best = null;
      let bestScore = -999;
      for(const k of Object.keys(attrs)){
        const v = String(attrs[k] ?? "").trim();
        if(!v) continue;
        if(/sunshine\s*coast/i.test(v)) continue;
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
        if(!addr){
          try{
            const byLotPlan = await queryAddressByLotPlan(parcelFeature);
            if(byLotPlan) addr = byLotPlan;
          }catch(e){
            if(ADDR_DEBUG) console.warn("queryAddressByLotPlan error:", e);
          }
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
      if(ADDR_DEBUG && parcelFeature){
        console.log("Parcel attr keys:", Object.keys(parcelFeature.attributes||{}));
        window.dumpAddressFields = ()=> console.table(
          Object.fromEntries(Object.keys(parcelFeature.attributes||{}).map(k=>[k,parcelFeature.attributes[k]]))
        );
      }
      return addr || "Address unavailable";
    }
    function flattenFeatureNodes(){ const out=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) out.push(n); }); return out; }
    const PARCEL_FIELD_RX=/\b(LOT(?:_?PLAN)?|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM|PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT|LOT\/PLAN|PARCEL|PARCEL_ID|PROP(?:ERTY)?_?ID?)\b/i;
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
      const collect=async(opts)=>{ const out=[]; for(const L of layers){ try{ const r=await L.queryFeatures({...opts,returnGeometry:true,outFields:["*"],maxRecordCountFactor:2}); (r.features||[]).forEach(f=>out.push({layer:L,feature:f})); }catch{} } return out; };
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
    let lastParcelInfo={feature:null,lotText:"--",areaText:"-- "+M2,classText:"--",addressText:"--",councilText:"Sunshine Coast Council"};
    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || ("-- "+M2));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Sunshine Coast Council");
      updateScrcSetbacksPanel();
    }
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
      const council=parseCouncil(attrs) || "Sunshine Coast Council";
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

    let lastScrcSetbackContext={zone:null,localPlan:null,labels:[],hasWaterBoundary:false,source:"pending"};

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

    function currentScrcSetbackWallHeight(){
      return setbackWallHeightFromInput($("scrcSetbackWallHeight")?.value ?? $("scrcSetbackWallHeightTab")?.value);
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

    function normalizeSetbackLabels(ctx){
      const labels=[];
      const add=v=>{
        const s=String(v||"").trim();
        if(s && !labels.some(x=>planKey(x)===planKey(s))) labels.push(s);
      };
      add(ctx?.zone);
      add(ctx?.localPlan);
      (ctx?.labels||[]).forEach(add);
      return labels;
    }

    function classifyScrcSetbackContext(ctx={}){
      const labels = normalizeSetbackLabels(ctx);
      const text = labels.join(" | ");
      const key = planKey(text);
      const has = term => key.includes(planKey(term));
      const hasRuralResidential = has("Rural residential");
      const hasLandscapeResidential = has("Limited development landscape residential") || has("landscape residential");
      const hasRural = !hasRuralResidential && !hasLandscapeResidential && has("Rural");
      const hasResidential = has("Low density residential") || has("Medium density residential") || has("High density residential");
      const hasGloucester = has("Gloucester Road") || (has("Buderim") && (has("BUD LPP 1") || has("LPP 1")));
      const hasCaloundraCoast = has("Moffat Beach") || has("Shelly Beach") || has("Dicky Beach") || (has("Caloundra") && (has("CAL LPP 4") || has("LPP 4")));
      const hasWaterBoundary = !!ctx.hasWaterBoundary || /canal|artificial\s+water|waterbody|water\s*body|lake|kawana/i.test(text);
      let route = "qdc";
      if(hasRural) route = "rural";
      else if(hasRuralResidential || hasLandscapeResidential) route = "rural-residential";
      else if(hasResidential) route = "residential";
      const labelFor = (...terms)=>{
        for(const label of labels){
          const lk=planKey(label);
          if(terms.some(term=>lk.includes(planKey(term)))) return label;
        }
        return "";
      };
      const zoneLabel =
        labelFor("Rural residential","Limited development","Low density residential","Medium density residential","High density residential","Rural") ||
        ctx.zone || "";
      const localPlanLabel =
        labelFor("Gloucester Road","Buderim","Moffat Beach","Shelly Beach","Dicky Beach","Caloundra") ||
        ctx.localPlan || "";
      const contextLabel = [zoneLabel, localPlanLabel].filter(Boolean).join(" - ") || (labels[0] || "No zoning layer resolved");
      return {route,labels,zoneLabel,localPlanLabel,contextLabel,hasGloucester,hasCaloundraCoast,hasWaterBoundary};
    }

    function baseScrcSetbackRows({areaSqm,dimensions,wallHeight,contextLabel}){
      const frontage = dimensions?.frontage ?? dimensions?.width ?? null;
      const depth = dimensions?.depth ?? null;
      return [
        {
          boundary:"Lot metrics",
          value:`${metresText(frontage)} width / ${metresText(depth)} depth`,
          detail:`Area ${formatSetbackArea(areaSqm)}. Width/frontage and depth are estimated from the selected parcel geometry.`
        },
        {
          boundary:"Planning context",
          value:contextLabel || "Resolving",
          detail:`Wall height used for side/rear boundary clearance: ${metresText(wallHeight, 1)}.`
        }
      ];
    }

    function addScrcLocalExceptionRows(rows, context){
      if(context.hasGloucester){
        rows.push({
          boundary:"Buderim local plan",
          value:"10 m",
          detail:"Precinct BUD LPP-1 requires the dwelling house, garage, carport or shed to be set back at least 10 m from Gloucester Road."
        });
      }
      if(context.hasCaloundraCoast){
        rows.push({
          boundary:"Caloundra local plan",
          value:"6 m",
          detail:"Precinct CAL LPP-4 (Moffat Beach/Shelly Beach/Dicky Beach) requires a minimum 6 m setback from the primary street frontage."
        });
      }
    }

    function addScrcWaterRow(rows, context){
      rows.push({
        boundary:context.hasWaterBoundary ? "Canal / waterway" : "Canal / waterway",
        value:context.hasWaterBoundary ? "4.5 m" : "4.5 m if applicable",
        detail:"For buildings or structures over 1 m high, Sunshine Coast AO6 requires 4.5 m from a property boundary adjacent to a canal, artificial waterway or artificial waterbody."
      });
    }

    function calculateScrcSetbacks(feat=lastParcelInfo.feature, opts={}){
      const info = opts.info || lastParcelInfo || {};
      const wallHeight = setbackWallHeightFromInput(opts.wallHeight ?? $("scrcSetbackWallHeight")?.value ?? $("scrcSetbackWallHeightTab")?.value);
      const areaSqm = lotAreaForSetbacks(feat, info);
      const dimensions = estimateLotDimensionsForSetbacks(feat?.geometry, areaSqm);
      const frontage = dimensions?.frontage ?? dimensions?.width ?? null;
      const context = classifyScrcSetbackContext(opts.context || lastScrcSetbackContext || {});

      if(!feat && areaSqm == null){
        return {
          empty:true,
          notes:["Select a parcel to calculate Sunshine Coast setbacks."]
        };
      }

      const classLabel = areaSqm != null && areaSqm < 450 ? "Small lot" : "Standard lot";
      const qdcUrl = areaSqm != null && areaSqm < 450 ? QDC_MP11_URL : QDC_MP12_URL;
      const qdcLabel = areaSqm != null && areaSqm < 450 ? "QDC MP 1.1" : "QDC MP 1.2";
      const sideRear = qdcSideRearSetbackFor(wallHeight, frontage);
      const rows = baseScrcSetbackRows({areaSqm,dimensions,wallHeight,contextLabel:context.contextLabel});
      const notes = [
        "This is an indicative dwelling-house siting check. Approved plans of development, building envelopes, easements, overlays and concurrence agency decisions can override or add requirements.",
        "Lot width/frontage is estimated from the selected parcel geometry. Confirm frontage, depth and road hierarchy against survey/title information and Council mapping."
      ];

      if(context.route === "rural"){
        const largeRural = areaSqm != null && areaSqm > 20000;
        rows.push(
          {
            boundary:"Road frontage",
            value:largeRural ? "40 m / 20 m" : "10 m",
            detail:largeRural
              ? "Rural zone lots over 2 ha: 40 m from a State controlled road or extractive industry transport route, otherwise 20 m from any other road."
              : "Rural zone lots not more than 2 ha: 10 m from any road frontage."
          },
          {
            boundary:"Side and rear",
            value:largeRural ? "10 m" : "3 m",
            detail:largeRural ? "Rural zone lot area over 2 ha." : "Rural zone lot area 2 ha or less."
          }
        );
        addScrcWaterRow(rows, context);
        addScrcLocalExceptionRows(rows, context);
        return {
          regime:"scrc-rural",
          classLabel:`${classLabel} - Rural zone`,
          areaSqm,dimensions,wallHeight,
          sourceLabel:"Sunshine Coast Planning Scheme 2014 - Dwelling house code",
          sourceUrl:SCRC_DWELLING_HOUSE_CODE_URL,
          rows,notes
        };
      }

      if(context.route === "rural-residential"){
        rows.push(
          {boundary:"Road frontage",value:"10 m",detail:"Applies in Rural residential zone and Limited development (landscape residential) zone."},
          {boundary:"Side and rear",value:"3 m",detail:"Applies in Rural residential zone and Limited development (landscape residential) zone."}
        );
        addScrcWaterRow(rows, context);
        addScrcLocalExceptionRows(rows, context);
        return {
          regime:"scrc-rural-residential",
          classLabel:`${classLabel} - Rural residential / landscape residential`,
          areaSqm,dimensions,wallHeight,
          sourceLabel:"Sunshine Coast Planning Scheme 2014 - Dwelling house code",
          sourceUrl:SCRC_DWELLING_HOUSE_CODE_URL,
          rows,notes
        };
      }

      if(context.route === "residential"){
        rows.push(
          {boundary:"Dwelling road frontage",value:"4.5 m / 6 m",detail:"Residential zone dwelling house: 4.5 m for the ground storey and 6 m for levels above ground storey."},
          {boundary:"Garage / carport / shed road frontage",value:"6 m",detail:"Council carport/shed guidance and the Dwelling house code require 6 m from any road frontage for these Class 10a structures in residential zones."},
          {boundary:"Side and rear",value:metresText(sideRear.value),detail:`${qdcLabel} side/rear boundary clearance for wall height ${metresText(wallHeight, 1)}. ${sideRear.basis}.`},
          {boundary:"Narrow frontage",value:frontage != null && frontage <= 15 ? "Table A2 applied" : "Not triggered",detail:frontage != null && frontage <= 15 ? "Estimated frontage is 15 m or less, so the QDC narrow-lot side/rear table is used for heights up to 7.5 m." : "Estimated frontage is over 15 m, so standard QDC side/rear height bands are used."},
          {boundary:"Class 10a side/rear concession",value:"May apply",detail:"A carport/shed may be inside the standard side/rear clearance only where the QDC conditions are met, including height/mean height, total length along the boundary and 1.5 m separation from a required habitable-room window on adjoining land."}
        );
        addScrcWaterRow(rows, context);
        addScrcLocalExceptionRows(rows, context);
        notes.push(`Side and rear boundary clearances use ${qdcLabel}; Sunshine Coast Planning Scheme AO3 provides the residential road-frontage alternative provision to QDC.`);
        return {
          regime:"scrc-residential",
          classLabel:`${classLabel} - Residential zone`,
          areaSqm,dimensions,wallHeight,
          sourceLabel:"Sunshine Coast Planning Scheme 2014 - Dwelling house code",
          sourceUrl:SCRC_DWELLING_HOUSE_CODE_URL,
          rows,notes
        };
      }

      rows.push(
        {boundary:"Road frontage",value:"Check scheme / QDC",detail:"The selected parcel did not resolve to a Sunshine Coast residential, rural, rural residential or landscape residential zone. Confirm the zone and applicable use code before relying on a setback."},
        {boundary:"Side and rear",value:metresText(sideRear.value),detail:`Fallback ${qdcLabel} side/rear boundary clearance for wall height ${metresText(wallHeight, 1)}. ${sideRear.basis}.`}
      );
      addScrcWaterRow(rows, context);
      addScrcLocalExceptionRows(rows, context);
      notes.push("The zoning layer did not resolve to a supported dwelling-house setback path, so QDC side/rear values are shown as a fallback only.");
      return {
        regime:"scrc-qdc-fallback",
        classLabel:`${classLabel} - QDC fallback`,
        areaSqm,dimensions,wallHeight,
        sourceLabel:qdcLabel,
        sourceUrl:qdcUrl,
        rows,notes
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

    function updateScrcSetbacksPanel(){
      const html = setbackInfoToHTML(calculateScrcSetbacks());
      const main = $("scrcSetbacksContent");
      const tab = $("scrcSetbacksTabContent");
      if(main) main.innerHTML = html;
      if(tab) tab.innerHTML = html;
    }

    function resetScrcSetbackContext(){
      lastScrcSetbackContext={zone:null,localPlan:null,labels:[],hasWaterBoundary:false,source:"pending"};
    }

    async function labelsFromLayerForScrcSetbacks(layerNode, geom){
      const labels=[];
      const add=value=>{
        const s=String(value||"").trim();
        if(s && !labels.some(x=>planKey(x)===planKey(s))) labels.push(s);
      };
      try{
        const p=nodePath(layerNode);
        if(isZoning(layerNode.title||"", p)){
          try{
            const {items:keys}=await legendFromRendererUsingFeatures(layerNode, geom);
            keys.forEach(k=>add(k.label));
          }catch{}
        }
        if(/local\s*plan|precinct|lpp|gloucester|moffat|shelly|dicky|caloundra|buderim/i.test(`${layerNode.title||""} ${p}`)){
          add(layerNode.title);
          try{
            const {items:keys}=await legendFromRendererUsingFeatures(layerNode, geom);
            keys.forEach(k=>add(k.label));
          }catch{}
        }
        if(/canal|artificial\s+water|waterbody|water\s*body|lake|kawana/i.test(`${layerNode.title||""} ${p}`)){
          add(layerNode.title);
        }
        if(typeof layerNode.queryFeatures==="function" && (isZoning(layerNode.title||"", p) || /local\s*plan|precinct|lpp|gloucester|moffat|shelly|dicky|caloundra|buderim/i.test(`${layerNode.title||""} ${p}`))){
          try{
            const q=await layerNode.queryFeatures({geometry:geom,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],maxRecordCountFactor:3});
            (q.features||[]).forEach(f=>{
              add(pickZoneLabel(f.attributes));
              add(guessLabelFromAttrs(f.attributes));
            });
          }catch{}
        }
      }catch{}
      return labels;
    }

    async function resolveScrcSetbackContext(geom){
      const labels=[];
      const add=value=>{
        const s=String(value||"").trim();
        if(s && !labels.some(x=>planKey(x)===planKey(s))) labels.push(s);
      };
      let hasWaterBoundary=false;
      if(!geom) return {zone:null,localPlan:null,labels,hasWaterBoundary,source:"none"};
      const nodes=flattenFeatureNodes().filter(n=>!keepLegacyBushfireHidden(n) && !underDNTChain(n));
      const candidates=nodes.filter(n=>{
        try{
          const t=n.title||"", p=nodePath(n), id=n.id||"", tg=n.portalItem?.tags||[];
          if(isUtility(t,id,tg) && !/canal|artificial\s+water|waterbody|water\s*body|lake/i.test(`${t} ${p}`)) return false;
          return isZoning(t,p) || /local\s*plan|precinct|lpp|gloucester|moffat|shelly|dicky|caloundra|buderim|canal|artificial\s+water|waterbody|water\s*body|lake|kawana/i.test(`${t} ${p}`);
        }catch{
          return false;
        }
      });
      for(const n of candidates){
        try{
          await n.load();
          const cnt=await countFeatures(n,geom);
          if(cnt<=0) continue;
          const p=nodePath(n), t=n.title||"";
          if(/canal|artificial\s+water|waterbody|water\s*body|lake|kawana/i.test(`${t} ${p}`)) hasWaterBoundary=true;
          const layerLabels=await labelsFromLayerForScrcSetbacks(n,geom);
          layerLabels.forEach(add);
        }catch{}
      }
      const classified=classifyScrcSetbackContext({labels,hasWaterBoundary,source:"resolved"});
      return {
        zone: classified.zoneLabel || null,
        localPlan: classified.localPlanLabel || null,
        labels,
        hasWaterBoundary,
        source:"resolved"
      };
    }

    async function refreshScrcSetbacksForGeometry(geom){
      try{
        lastScrcSetbackContext = await resolveScrcSetbackContext(geom);
      }catch{
        resetScrcSetbackContext();
      }
      updateScrcSetbacksPanel();
    }

    (function initScrcSetbackHeightInputs(){
      const main=$("scrcSetbackWallHeight");
      const tab=$("scrcSetbackWallHeightTab");
      const sync=(from,to)=>{
        if(from && to && to.value !== from.value) to.value = from.value;
        try{ lastReportHTML = null; lastReportTitle = "Property Report"; }catch{}
        updateScrcSetbacksPanel();
      };
      if(main) main.addEventListener("input",()=>sync(main,tab));
      if(tab) tab.addEventListener("input",()=>sync(tab,main));
    })();

    window.calculateScrcSetbacks = calculateScrcSetbacks;
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
    function setOverlayVisibility(node, on){ if(keepPropertyBoundaryVisible(node)) return;
      if(!node) return;
      if(keepLegacyBushfireHidden(node)) return;
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
      ul.innerHTML = "<li><i>Scanning…</i></li>";
      sideOverlayIndex.clear();
      let itemIdx = 0;
      const items = [];
      const nodes = flattenFeatureNodes().filter(n => !keepLegacyBushfireHidden(n) && !underDNTChain(n));
      for (const n of nodes){
        try{
          const t = n.title || "", id = n.id || "", tg = n.portalItem?.tags || [];
          const p = nodePath(n);
          if (isUtility(t,id,tg) || isWaterOrSewer(p)) continue;
          await n.load();
          const cnt = await countFeatures(n, geom);
          if (cnt <= 0) continue;
          const { items: keys } = await legendFromRendererUsingFeatures(n, geom);
          const keyHTML = keys.length
            ? `<div class="leg" style="margin-top:4px">${keys.map(k =>
                `<div class="row">${k.swatchHTML}${htmlEsc(k.label)}</div>`
              ).join("")}</div>`
            : "";
          const title = htmlEsc(t || "Layer");
          let schemeLink = isZoning(t,p) ? findScrcZoneLink(t, keys.map(k=>k.label)) : null;
          if(!schemeLink){
            schemeLink = findScrcOverlayLink(t, keys.map(k=>k.label));
          }
          const schemeHTML = schemeLink ? `<a href="${schemeLink}" target="_blank" rel="noopener" style="font-size:12px;text-decoration:none;margin-left:6px">Planning scheme</a>` : "";
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
    view.on("click", async ev=>{
      try{
        showLoading(true);
        const parcel=await findParcelAtPoint(ev.mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        resetScrcSetbackContext();
        updateBadgesFromFeature(parcel);
        outlineSelection(parcel.geometry);
        await hideUnusedOverlaysFor(parcel.geometry);
        await refreshScrcSetbacksForGeometry(parcel.geometry);
        try{
          const addr=await resolveBestAddress(parcel.geometry, parcel, lastParcelInfo.addressText);
          lastParcelInfo.addressText=addr||lastParcelInfo.addressText;
          updateSummaryPanel();
        }catch{}
        updateSideOverlaySummary(parcel.geometry);
      } finally { showLoading(false); }
    });
    /* ---------------- Legend helpers ---------------- */
    async function swatchHTML(symbol,fallbackSymbol=null){
      const el=await renderSymbolSwatch(symbol) || await renderSymbolSwatch(fallbackSymbol);
      if(el){
        if(el.tagName?.toLowerCase()==="canvas"){ return `<span class="swbox"><img alt="" src="${el.toDataURL("image/png")}"></span>`; }
        try{ el.setAttribute("width","100%"); el.setAttribute("height","100%"); }catch{}
        return `<span class="swbox">${el.outerHTML}</span>`;
      }
      const colorInfo=extractSymbolColors(normalizeSymbolForColor(symbol) || normalizeSymbolForColor(fallbackSymbol));
      if(colorInfo){
        const parts=[];
        if(colorInfo.fill) parts.push(`background:${colorInfo.fill}`);
        if(colorInfo.outline) parts.push(`border-color:${colorInfo.outline}`);
        return `<span class="swbox" style="${parts.join(";")}"></span>`;
      }
      return `<span class="swbox" style="background:#cfcfcf"></span>`;
    }
    async function renderSymbolSwatch(symbol){
      const hydrated=hydrateSymbol(symbol);
      if(!hydrated) return null;
      try{
        return await symbolUtils.renderPreviewHTML(hydrated,{size:[SWATCH_PX-2,SWATCH_PX-2]});
      }catch{}
      return null;
    }
    function hydrateSymbol(symbol){
      if(!symbol) return null;
      if(typeof symbol.clone==="function" || symbol?.declaredClass) return symbol;
      try{
        return symbolJsonUtils.fromJSON(symbol);
      }catch{
        return null;
      }
    }
    function normalizeSymbolForColor(symbol){
      if(!symbol) return null;
      if(typeof symbol.toJSON==="function"){
        try{ return symbol.toJSON(); }catch{ return null; }
      }
      return symbol;
    }
    const pickFirst=(...vals)=>{ for(const v of vals){ if(v!=null) return v; } return null; };
    function normalizeColor(color){
      if(color==null) return null;
      if(typeof color==="string") return color;
      if(Array.isArray(color)){
        if(!color.length) return null;
        const [r,g,b,a=255]=color;
        return {r,g,b,a};
      }
      if(typeof color==="object"){
        if(typeof color.toHex==="function") return color.toHex();
        if(typeof color.toCss==="function") return color.toCss();
        const r=pickFirst(color.r,color.red,color[0]);
        const g=pickFirst(color.g,color.green,color[1]);
        const b=pickFirst(color.b,color.blue,color[2]);
        let a=pickFirst(color.a,color.alpha,color.opacity,color[3]);
        return {r,g,b,a};
      }
      return null;
    }
    function colorToCss(color){
      if(!color) return null;
      if(typeof color==="string") return color;
      let {r,g,b,a}=color;
      if([r,g,b].some(v=>v==null)) return null;
      r=Math.round(r); g=Math.round(g); b=Math.round(b);
      if(a==null) return `rgb(${r},${g},${b})`;
      let alpha=a;
      if(alpha>1) alpha/=255;
      alpha=Math.max(0,Math.min(1,alpha));
      if(alpha>=0.999) return `rgb(${r},${g},${b})`;
      const str=alpha.toFixed(3).replace(/\.?0+$/,"");
      return `rgba(${r},${g},${b},${str})`;
    }
    function extractSymbolColors(symbol){
      const stack=[symbol];
      const seen=new Set();
      while(stack.length){
        const sym=stack.pop();
        if(!sym || seen.has(sym)) continue;
        seen.add(sym);
        const fill=colorToCss(pickFirst(
          normalizeColor(sym.color),
          normalizeColor(sym.fillColor),
          normalizeColor(sym.background),
          normalizeColor(sym.material?.color),
          normalizeColor(sym.fill?.color)
        ));
        const outline=colorToCss(pickFirst(
          normalizeColor(sym.outline?.color),
          normalizeColor(sym.borderColor),
          normalizeColor(sym.strokeColor),
          normalizeColor(sym.outlineColor),
          normalizeColor(sym.edgeColor)
        ));
        if(fill || outline) return {fill,outline};
        const layers=[];
        if(Array.isArray(sym.symbolLayers)) layers.push(...sym.symbolLayers);
        if(Array.isArray(sym.layers)) layers.push(...sym.layers);
        if(sym.symbol) layers.push(sym.symbol);
        if(sym.fillSymbol) layers.push(sym.fillSymbol);
        layers.forEach(layer=>stack.push(layer));
      }
      return null;
    }
    const guessLabelFromAttrs = attrs => {
      if (!attrs) return null;
      const patt = [
        /zone.*(name|type|desc|label|category|code)?/i,
        /(planning|scheme).*zone/i,
        /(zone|category|type|class|desc|label)/i
      ];
      for (const r of patt) {
        const k = Object.keys(attrs).find(x => r.test(x));
        if (k) {
          const v = String(attrs[k] ?? "").trim();
          if (v) return v;
        }
      }
      return null;
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
    function pickZoneLabel(attrs){
      if(!attrs) return null;
      const code=String(attrs.ZONE_CODE ?? attrs.ZONE ?? "").trim();
      const name=String(attrs.ZONE_NAME ?? attrs.ZONING ?? "").trim();
      if(code && name) return `${code} – ${name}`;
      for(const k of ZONE_KEYS){ const v=attrs[k]; if(v!=null && String(v).trim()) return String(v).trim();
      }
      return null;
    }
    async function legendFromRendererUsingFeatures(layerNode,lotGeom){
      const gt=(layerNode.geometryType||"").toLowerCase();
      const isZone=isZoning(layerNode.title||"",nodePath(layerNode));
      const g=(gt==="point"||gt==="multipoint"||gt==="polyline") ? geometryEngine.buffer(lotGeom,TOUCH_BUFFER_M,"meters") : lotGeom;
      let feats=[];
      try{
        const q=await layerNode.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCountFactor:6});
        feats=q.features||[];
      }catch{}
      if(!feats.length) return {items:[]};
      if(isZone && feats.length > 1 && lotGeom){
        let best = null;
        let bestArea = -1;
        for(const f of feats){
          try{
            const inter = geometryEngine.intersect(lotGeom, f.geometry);
            const area = inter ? Math.abs(geometryEngine.planarArea(inter, "square-meters") || 0) : 0;
            if(area > bestArea){ bestArea = area; best = f; }
          }catch{}
        }
        if(best) feats = [best];
      }
      const itemMap=new Map();
      const renderer=layerNode.renderer;
      for(const f of feats){
        const gph=new Graphic({geometry:f.geometry,attributes:f.attributes,layer:layerNode});
        let label=isZone?pickZoneLabel(f.attributes):null;
        let rendererSymbol=null;
        if(renderer?.type==="unique-value"){
          const info=getUVInfo(renderer,f.attributes);
          if(info){
            if(!label) label=info.label ?? String(info.value ?? (info.values||[]).join(", "));
            rendererSymbol=info.symbol || rendererSymbol;
          }
        }else if(renderer?.type==="class-breaks" && renderer.field){
          const v=Number(f.attributes?.[renderer.field]);
          if(!Number.isNaN(v)){
            const info=(renderer.classBreakInfos||[]).find(b=>{
              const min=(b.minValue==null?-Infinity:b.minValue), max=(b.maxValue==null?Infinity:b.maxValue);
              return v>=min && v<=max;
            });
            if(info){
              if(!label) label=info.label ?? `${info.minValue ?? ""} – ${info.maxValue ?? ""}`;
              rendererSymbol=info.symbol || rendererSymbol;
            }
          }
        }
        if(!label) label=renderer?.label || layerNode.title || guessLabelFromAttrs(f.attributes) || "Class";
        let sym=null;
        try{ sym=await symbolUtils.getDisplayedSymbol(gph,view); }catch{}
        if(!sym){
          sym = rendererSymbol || renderer?.symbol || renderer?.defaultSymbol || f.symbol || null;
        }
        if(!sym) continue;
        const sw=await swatchHTML(sym, rendererSymbol||sym);
        if(!itemMap.has(label)) itemMap.set(label,{label,swatchHTML:sw});
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
        /\bffdi\b/i, /fire\s*danger\s*index/i, /forest\s*fire\s*danger\s*index/i, /fire\s*danger/i, /danger\s*index/i
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
    function collectLeafDisplayNodesByPredicate(pred, {includeDNT=false}={}){
      const out=[], seen=new Set();
      const pushUnique=(node)=>{
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
    function isSppBushfireLayer(node){
      return node===sppBushfireLayer || node===sppBushfireDrawLayer || node?.parent===sppBushfireLayer || /arcgis\.spp-dams\.wspdigitaltesting\.com\/arcgis\/rest\/services\/SPP\/SPP_Data\/MapServer(?:\/77)?\b/i.test(String(node?.url||""));
    }
    function keepLegacyBushfireHidden(node){
      if(!node || isSppBushfireLayer(node)) return false;
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
        if(!allowSppBushfireLayer) return;
        const map=view?.map||webmap;
        if(!map?.layers) return;
        let has=false;
        try{ has=typeof map.layers.includes==="function" ? map.layers.includes(sppBushfireLayer) : false; }catch{}
        if(!has) map.add(sppBushfireLayer);
        let drawHas=false;
        try{ drawHas=typeof map.layers.includes==="function" ? map.layers.includes(sppBushfireDrawLayer) : false; }catch{}
        if(!drawHas) map.add(sppBushfireDrawLayer);
        try{ map.reorder(sppBushfireLayer, Math.max(0, map.layers.length-2)); }catch{}
        try{ map.reorder(sppBushfireDrawLayer, Math.max(0, map.layers.length-1)); }catch{}
        try{ if(typeof map.layers.includes==="function" && map.layers.includes(selLayer)) map.reorder(selLayer, Math.max(0, map.layers.length-1)); }catch{}
      }catch{}
    }
    function collectAllBushfireDisplayNodes(){
      ensureSppBushfireLayer();
      return [getSppBushfireDisplayNode(),sppBushfireDrawLayer];
    }
    function collectAllFFDIDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=>{
        const hay=strHay(n);
        return HARDWIRED.ffdi.some(rx=>rx.test(hay));
      },{includeDNT:true});
    }
    function withoutFFDINodes(nodes){
      const extra = /\bffdi\b|fire\s*danger|danger\s*index|forest\s*fire\s*danger/i;
      return (nodes||[]).filter(n=>{
        if(keepLegacyBushfireHidden(n)) return false;
        const hay = strHay(n);
        return !HARDWIRED.ffdi.some(rx=>rx.test(hay)) && !extra.test(hay);
      });
    }
    function collectAllNoiseDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=>{
        const hay=strHay(n);
        return HARDWIRED.noise.some(rx=>rx.test(hay)) || isNoise(t,p);
      },{includeDNT:true});
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
      if(views.length){ try{await reactiveUtils.whenOnce(()=>views.every(v=>v.updating===false));}catch{} }
      await waitViewIdle(240);
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
      const prevBasemap = view?.map?.basemap;
      try{
        return await withViewOnGeom(lotGeom, async ()=>{
          try{
            if(title && title !== "Map" && view.map && view.map.basemap){
              if(view.map.basemap !== "light-gray-vector") view.map.basemap = "light-gray-vector";
            }
          }catch{}
          walkAny(view.map,(n)=>{
            if(!("visible"in n)) return;
            if(underDNTChain(n)) return;
            if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
          });
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
          const shot=await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});
          let legendGeom=lotGeom;
          if(legendUseExtent && view?.extent){ legendGeom=view.extent; }
          else if(!legendOnLot){ try{ const onScr=geometryEngine.intersect(lotGeom,view.extent); if(onScr) legendGeom=onScr; }catch{} }
          const legendParts=[];
          for(const n of targets){
            if(underDNTChain(n)) continue;
            if(typeof n.queryFeatures!=="function" && typeof n.queryFeatureCount!=="function") continue;
            const res = legendAllRendererItems
              ? await legendFromRendererAllItems(n)
              : await legendFromRendererUsingFeatures(n,legendGeom);
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
        if(prevBasemap && view.map && view.map.basemap !== prevBasemap){
          try{ view.map.basemap = prevBasemap; }catch{}
        }
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
          if(!s){ shots.push({title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote}); }
          else { if((s.count||0)===0) s.note=emptyNote; shots.push(s); }
        }else{
          shots.push({title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote});
        }
      }catch(err){
        console.warn("Mandatory section failed:", title, err);
        shots.push({title,id:"rpt-"+slug(title),dataUrl:baseShot.dataUrl,scaleText:baseShot.scaleText,legendHTML:"",count:0,note:emptyNote+" (layer unavailable)"});
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
      try{
        showLoading(true);
        setRpt("Locating parcel…", 12);
        let geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Sunshine Coast Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry; ({lotText,areaText,classText,addressText,councilText}=lastParcelInfo);
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){ const info=parcelInfoFromFeature(probe); geom=probe.geometry; ({lotText,areaText,classText,addressText,councilText}=info); lastParcelInfo={feature:probe,...info}; }
        }
        setRpt("Parcel located", 18, "rptS1");
        if(geom){
          setRpt("Resolving address…", 25);
          try{ addressText=await resolveBestAddress(geom,lastParcelInfo.feature,lastParcelInfo.addressText); }catch{}
          setRpt("Address resolved", 35, "rptS2");
          lastParcelInfo.addressText = addressText || lastParcelInfo.addressText;
          setRpt("Resolving setback rules...", 38);
          await refreshScrcSetbacksForGeometry(geom);
        }
        setRpt("Rendering base map…", 42);
        const captureBaseShot = async function(opts){
          const satellite = !!opts.satellite;
          const prev = view?.map?.basemap;
          const visSnap = saveVisibility(view.map);
          try{
            try{
              if(satellite && view.map && view.map.basemap){
                view.map.basemap = "satellite";
                await view.map.basemap?.load?.();
              }
            }catch(e){ console.warn("satellite basemap load skipped", e); }
            walkAny(view.map,function(n){
              if(!("visible" in n)) return;
              if(n === selLayer) return;
              if(!isPropertyBoundaryLayer(n)){ try{ n.visible=false; }catch{} }
            });
            if(geom){ try{selLayer.visible=true;}catch{}; await setScreenshotPropertyBoundary(geom,{keepLabels:true}); }
            await waitViewIdle(satellite ? 360 : 220);
            await waitViewIdle(satellite ? 260 : 120);
            return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});
          } finally {
            clearScreenshotPropertyBoundary();
            restoreVisibility(view.map,visSnap); forcePropertyBoundariesVisible(view.map);
            if(prev && view.map && view.map.basemap !== prev){
              try{ view.map.basemap = prev; }catch{}
            }
          }
        };
        const baseShot = geom
          ? await withViewOnGeom(geom, function(){ return captureBaseShot({satellite:true}); })
          : await captureBaseShot({satellite:true});
        const fallbackShot = geom
          ? await withViewOnGeom(geom, function(){ return captureBaseShot({satellite:false}); })
          : await captureBaseShot({satellite:false});
        setRpt("Collecting overlays�", 55);
        const cats = geom ? await (async()=>{
          const out={zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],bushfire:[],ffdi:[],others:[]};
          const arr=[]; walkAny(view.map,(n,underDNT)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function") && !underDNT) arr.push(n); });
          for(const n of arr){
            try{
              if(isSppBushfireLayer(n)) continue;
              await n.load();
              const cnt=await countFeatures(n,geom); if(!cnt) continue;
              const t=n.title||"", p=nodePath(n);
              const hay=strHay(n);
              const isFFDI = HARDWIRED.ffdi.some(rx=>rx.test(hay));
              if(isZoning(t,p)) out.zoning.push(n);
              else if(isUtility(t,n.id,n.portalItem?.tags||[]) || isWaterOrSewer(p)) out.utilities.push(n);
              else if(isAcid(t,p)) out.acid.push(n);
              else if(isNoise(t,p)) out.noise.push(n);
              else if(isTransport(t,p)) out.transport.push(n);
              else if(isAir(t,p)) out.air.push(n);
              else if(isFFDI) out.ffdi.push(n);
              else if(isBushfire(t,p)) continue;
              else out.others.push(n);
            }catch{}
          }
          return out;
        })() : {zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],bushfire:[],ffdi:[],others:[]};
        const shots=[];
        const tasks=[
          ["Zoning", async()=>{ if(cats.zoning.length){ const s=await screenshotFor(cats.zoning,"Zoning",geom,true); if(s) shots.push(s); }}],
          ["Bushfire", async()=>{ await addMandatorySection(shots,"Bushfire", ()=> withoutFFDINodes(collectAllBushfireDisplayNodes()), geom, fallbackShot, "No bushfire Lv"); }],
          ["FFDI", async()=>{ await addMandatorySection(shots,"FFDI",collectAllFFDIDisplayNodes,geom,fallbackShot,"No FFDI layer"); }],
          ["Utilities", async()=>{ const all=collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=> isUtility(t,id,tg)||isWaterOrSewer(p),{includeDNT:true}); if(all.length){ const s=await screenshotFor(all,"Utilities",geom,false,{forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); } }],
          ["Acid overlays", async()=>{ if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); }}],
          ["Transport", async()=>{ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); }}],
          ["Air quality", async()=>{ if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); }}],
          ["Transport Noise Corridor", async()=>{ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,fallbackShot,"No noise Lv"); }],
          ["Other overlays", async()=>{
            for (const n of cats.others) {
              const t = n.title || "", p = nodePath(n);
              const hay = strHay(n);
              const isFFDI = HARDWIRED.ffdi.some(rx=>rx.test(hay));
              if (isBushfire(t,p) || isNoise(t,p) || isFFDI) continue;
              const s = await screenshotFor([n], n.title || "Overlay", geom);
              if (s) shots.push(s);
            }
          }]
        ];
        for(let i=0;i<tasks.length;i++){
          const [name,fn]=tasks[i];
          setRpt(`Rendering ${name}…`, 55 + Math.round(((i+1)/tasks.length)*30));
          await fn();
        }
        dedupeShotsByTitle(shots,"Transport Noise Corridor");
        setRpt("Overlays rendered", 87, "rptS3");
        setRpt("Composing document…", 93);
        const now=new Date();
        const fmt=d=> d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
        const esc=htmlEsc;
        const logoSrc="./images/Flavour icon.png";
        const setbackInfo=calculateScrcSetbacks(lastParcelInfo.feature,{context:lastScrcSetbackContext});
        const toFileSafe = s =>
          String(s)
            .replace(/[<>:"/\\|?*\\x00-\\x1F]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const baseName = (addressText && addressText !== "--")
          ? addressText
          : ((lotText && lotText !== "--") ? ("Lot " + lotText) : "Property");
        const reportDisplayTitle = baseName + " - Property Report";
        const reportFileTitle = toFileSafe(reportDisplayTitle);
        const reportWindowTitle = reportDisplayTitle;
        const html=[];
        html.push("<!doctype html><meta charset='utf-8'><title>", esc(reportWindowTitle), "</title>");
        html.push("<style>",
          ":root{--brand:#a70b13;--brand2:#7f0e15;--bg:#f6f7f9;--ink:#0b0d12;--border:#e1e3e6;--radius:14px;--shadow:0 6px 18px rgba(16,21,28,.08);--panel:#ffffff;--panel-2:#f8f9fb;--muted:#5b6470}",
          "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:18px;color:var(--ink);background:var(--bg);line-height:1.4}",
          ".cover-page{min-height:calc(100vh - 36px);display:flex;flex-direction:column}",
          ".cover-page .rpt-grid{margin-bottom:14px}",
          ".cover-page .disclaimer{margin-top:auto}",
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
          ".setback-panel{font-size:13px;color:var(--ink)}.setback-summary{margin:0 0 8px;font-weight:800}.setback-source{margin:0 0 10px;color:var(--muted)}.setback-source a{color:var(--brand2);font-weight:800;text-decoration:none}.setback-table{width:100%;border-collapse:collapse;margin-top:8px}.setback-table th,.setback-table td{padding:7px 0;border-top:1px solid var(--border);vertical-align:top;text-align:left}.setback-table th{width:34%;color:var(--muted);font-weight:800}.setback-value{display:block;font-weight:800}.setback-detail{display:block;margin-top:2px;color:var(--muted);font-size:12px}.setback-notes{margin:10px 0 0 18px;padding:0;color:var(--muted)}.setback-notes li{margin:4px 0}",
          ".leg{font-size:13px;line-height:1.4;margin-top:8px}.leg .row{display:flex;align-items:center;gap:8px;margin:2px 0}",
          ".leg .swbox{display:inline-flex;align-items:center;justify-content:center;width:16px;height:14px;padding:1px;border:1px solid #9aa0a6;border-radius:4px;overflow:hidden;background:#fff}",
          ".leg .swbox img,.leg .swbox svg,.leg .swbox canvas{width:100%;height:100%;display:block;object-fit:contain}",
          ".map-legend{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;align-items:start}",
          ".map-legend .leg{margin-top:0;background:var(--panel-2);border:1px solid rgba(167,11,19,.18);border-radius:10px;padding:10px}",
          "@media (max-width: 900px){.map-legend{grid-template-columns:1fr}}",
          ".rpt-footer{margin-top:14px;padding-top:8px;border-top:1px dashed var(--border);font-size:12px;color:var(--muted)}",
          ".disclaimer{background:linear-gradient(180deg,#fff7f7 0%, #ffffff 100%);border:1px solid #f2c7c9}",
          ".disclaimer .disclaimer-lead{font-size:14px;color:#7f0e15;font-weight:600}",
          ".disclaimer-list{margin:10px 0 0 18px;color:var(--ink)}",
          ".disclaimer-list li{margin:6px 0}",
          ".disclaimer-foot{margin-top:12px;padding-top:10px;border-top:1px dashed #e6b9bc;color:#6b7280;font-size:12px}",
          "@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.cover-page{min-height:calc(100vh - 36px);break-after:page;page-break-after:always}.cover-page .card,.card{page-break-inside:avoid}}",
          "</style>");
        html.push("<body><section class='cover-page'>");
        html.push("<div class='card brandbar'><img src='",logoSrc,"' alt='Logo'><h1>", esc(reportDisplayTitle), "</h1><div class='muted'>",fmt(now),"</div></div>");
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
                          "<div id='setbacks' style='margin-top:14px'>",
                            "<h2 class='section-title' style='margin-top:0'>Setbacks</h2>",
                            setbackInfoToHTML(setbackInfo),
                          "</div>",
                          "<div id='summary' style='margin-top:14px'>",
                            "<h2 class='section-title' style='margin-top:0'>Summary</h2>");
                            if(shots.length){
                              html.push("<ul class='sumlist'>");
                              for(const s of shots){
                                const ct=(s.count!=null)?(" ("+s.count+" feature"+(s.count===1?"":"s")+")"):"";
                                html.push("<li><a class='sum-link' style='color:#7a0f16;font-weight:700;text-decoration:none' href='#",s.id,"'>",esc(s.title),"</a>",ct,(s.note?(" - "+esc(s.note)):""),"</li>");
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
        html.push(
          "<div class='card disclaimer'>",
            "<h2 class='section-title' style='margin-top:0'>Disclaimer</h2>",
            "<p class='disclaimer-lead'>This report is a high-level snapshot only and must be verified against authoritative sources.</p>",
            "<ul class='disclaimer-list'>",
              "<li>Data sources are indicative and may not reflect the most current planning scheme updates.</li>",
              "<li>Overlay mapping may vary by scale; always confirm with the Sunshine Coast Council planning scheme.</li>",
              "<li>Property boundaries, zoning and overlays should be verified with the authoritative datasets before decision-making.</li>",
              "<li>CornerstonePlus is not responsible for errors or omissions in third-party data sources.</li>",
            "</ul>",
            "<div class='disclaimer-foot'><strong>Terms of Use &amp; Privacy Policy:</strong> Refer to the CornerstonePlus Terms &amp; Privacy page for full details.</div>",
          "</div>",
          "</section>"
        );
        for(const s of shots){
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
        html.push("<div class='card rpt-footer'><img src='",logoSrc,"' alt='Logo' style='width:18px;height:18px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/> Sunshine Coast Council - CornerstonePlus. Indicative only.</div>");
        html.push("</body>");
        const htmlOut = html.join("");
        return {html: htmlOut, title: reportWindowTitle};
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
    /* ============================================================
       === Lot/Plan Search source (QLD) ============================
       ============================================================ */
    function normalizePlanText(p){ return String(p||"").toUpperCase().replace(/\s+/g,""); }
    function parseLotPlan(text){
      if(!text) return null;
      let s=String(text).toUpperCase();
      s=s.replace(/[,]+/g," ").replace(/\bon\b/ig," ").replace(/\blot\b/ig," ").replace(/\s+/g," ").trim();
      s=s.replace(/^\s*D(?=\s*\d)/, "");
      s=s.replace(/^\s*D\s+/, "");
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
      return /[^A-Za-z0-9_]/.test(n) ? "\"" + n.replace(/\"/g,'""') + "\"" : n;
    }
    const normalizePlanCode=function(p){
      var s=String(p||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
      s=s.replace(/^([A-Z]+)0+/, "$1");
      return s;
    };
    const normalizeLotPlanVal=function(s){
      return String(s||"").replace(/[^0-9]/g,"").replace(/^0+/,"");
    };
    function splitLotPlan(lp){
      const s = String(lp||"").toUpperCase();
      const m = s.match(/(\d+)\s*\/?\s*([A-Z]{1,4}\s*\d{1,8})/);
      if(!m) return null;
      return { lot: normalizeLotPlanVal(m[1]), plan: normalizePlanCode(m[2]) };
    }
    function matchesLotPlan(feature, lot, plan){
      try{
        var meta = parseParcelMeta((feature && feature.attributes) || {});
        var lotN = normalizeLotPlanVal(lot);
        var planN = normalizePlanCode(plan);
        if(lotN && planN){
          if(normalizeLotPlanVal(meta.lot)===lotN && normalizePlanCode(meta.plan)===planN) return true;
        }
        if(lotN && planN && meta.lotplan){
          var sp = splitLotPlan(meta.lotplan);
          if(sp && sp.lot===lotN && sp.plan===planN) return true;
        }
      }catch(e){}
      return false;
    }
    function matchesPlanOnly(feature, plan){
      try{
        var planN = normalizePlanCode(plan);
        if(!planN) return false;
        var meta = parseParcelMeta((feature && feature.attributes) || {});
        var planField = normalizePlanCode(meta.plan);
        if(planField===planN) return true;
        if(meta.lotplan){
          var sp = splitLotPlan(meta.lotplan);
          if(sp && sp.plan===planN) return true;
        }
        return false;
      }catch(e){ return false; }
    }
    function scoreLotPlan(feature, lot, plan){
      try{
        var meta = parseParcelMeta((feature && feature.attributes) || {});
        var lotN = normalizeLotPlanVal(lot);
        var planN = normalizePlanCode(plan);
        var lotField = normalizeLotPlanVal(meta.lot);
        var planField = normalizePlanCode(meta.plan);
        var sp = meta.lotplan ? splitLotPlan(meta.lotplan) : null;
        var planMatch = planN ? (planField===planN || (sp && sp.plan===planN)) : true;
        var lotMatch = lotN ? (lotField===lotN || (sp && sp.lot===lotN)) : true;
        if(!planMatch || !lotMatch) return 0;
        var score = 0;
        if(lotN && lotField===lotN) score += 3;
        if(planN && planField===planN) score += 3;
        if(lotN && planN && sp){
          if(sp.lot===lotN && sp.plan===planN) score += 5;
        }
        return score;
      }catch(e){ return 0; }
    }
    function isExactLotPlan(feature, lot, plan){
      try{
        var meta = parseParcelMeta((feature && feature.attributes) || {});
        var lotN = normalizeLotPlanVal(lot);
        var planN = normalizePlanCode(plan);
        if(!lotN || !planN) return false;
        if(normalizeLotPlanVal(meta.lot)===lotN && normalizePlanCode(meta.plan)===planN) return true;
        if(meta.lotplan){
          var sp = splitLotPlan(meta.lotplan);
          if(sp && sp.lot===lotN && sp.plan===planN) return true;
        }
        return false;
      }catch(e){ return false; }
    }
    function buildLotPlanWhere(layer, lot, plan){
      const flds = Array.isArray(layer.fields)?layer.fields:[];
      const lotFields = flds.filter(function(f){
        const nm = String(f.name||"").toUpperCase();
        if(/LOT_AREA/.test(nm)) return false;
        return /\b(LOT|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM)\b/.test(nm) || /^LOT$/.test(nm);
      });
      if(!lotFields.length && !flds.some(function(f){ return /\b(PLAN|LOTPLAN|LOT_PLAN|LOT\/PLAN)\b/i.test(f.name||""); })){
        const addrFields = flds.filter(function(f){ return /(address|addr|street|road|locality|suburb)/i.test(String(f.name||"")); });
        const term = (lot + " " + plan).trim();
        if(addrFields.length && term){
          const termU = escSQL(term.toUpperCase());
          return addrFields.map(function(f){ return "UPPER(" + sqlField(f.name) + ") LIKE '%" + termU + "%'"; }).join(" OR ");
        }
      }
      const planFields = flds.filter(function(f){
        const nm = String(f.name||"").toUpperCase();
        return /\b(PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT|LOT\/PLAN)\b/.test(nm);
      });
      const lotClauses=[];
      const lotNum = Number(lot);
      for(var i=0;i<lotFields.length;i++){
        var f=lotFields[i];
        if(isIntegerField(f) && !Number.isNaN(lotNum)){
          lotClauses.push(sqlField(f.name) + "=" + lotNum);
        }else if(isTextField(f)){
          const lotU = escSQL(String(lot).toUpperCase());
          lotClauses.push("UPPER(" + sqlField(f.name) + ")='" + lotU + "'");
          lotClauses.push("REPLACE(UPPER(" + sqlField(f.name) + "), ' ', '')='" + lotU + "'");
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
      for(var j=0;j<planFields.length;j++){
        var f2=planFields[j];
        if(isTextField(f2)){
          var fieldExpr = "UPPER(" + sqlField(f2.name) + ")";
          var scrubExpr = "REPLACE(REPLACE(REPLACE(" + fieldExpr + ", ' ', ''), '-', ''), '/', '')";
          planClauses.push(fieldExpr + " LIKE '%" + planU + "%'");
          planClauses.push(scrubExpr + " LIKE '%" + planCompact + "%'");
          if(planLetters && planDigits){
            planClauses.push(fieldExpr + " LIKE '%" + escSQL(planLetters) + "%" + escSQL(planDigits) + "%'");
            planClauses.push(scrubExpr + " LIKE '%" + escSQL(planLetters) + "%" + escSQL(planDigits) + "%'");
          }
          if(/LOT[_ ]?PLAN|LOTPLAN|LOT_PLAN/i.test(f2.name)){
            planClauses.push(fieldExpr + " LIKE '%" + lotPlanFull + "%'");
            planClauses.push(scrubExpr + " LIKE '%" + lotPlanCompact + "%'");
          }
        }
      }
      if(planFields.length){
        for(var k=0;k<planFields.length;k++){
          var f3=planFields[k];
          if(!isTextField(f3)) continue;
          var fieldExpr2 = "UPPER(" + sqlField(f3.name) + ")";
          var scrubExpr2 = "REPLACE(REPLACE(REPLACE(" + fieldExpr2 + ", ' ', ''), '-', ''), '/', '')";
          planClauses.push(fieldExpr2 + " LIKE '%" + lotPlanFull + "%'");
          planClauses.push(scrubExpr2 + " LIKE '%" + lotPlanCompact + "%'");
          if(planLetters && planDigits){
            planClauses.push(scrubExpr2 + " LIKE '%" + escSQL(String(lot).toUpperCase()) + "%" + escSQL(planLetters) + "%" + escSQL(planDigits) + "%'");
          }
        }
      }
      const parts=[];
      if(lotClauses.length) parts.push("("+lotClauses.join(" OR ")+")");
      if(planClauses.length) parts.push("("+planClauses.join(" OR ")+")");
      if(!parts.length) return null;
      const isAddresses = /addresses/i.test(layer && layer.title || "");
      if(isAddresses){
        const lpField = flds.find(function(f){ return String(f && f.name || "").toLowerCase()==="lotplan"; });
        if(lpField && isTextField(lpField)){
          const fieldExpr = "UPPER(" + sqlField(lpField.name) + ")";
          const scrubExpr = "REPLACE(REPLACE(REPLACE(" + fieldExpr + ", ' ', ''), '-', ''), '/', '')";
          return [
            fieldExpr + " LIKE '%" + lotPlanFull + "%'",
            fieldExpr + " LIKE '%" + lotPlanCompact + "%'",
            scrubExpr + " LIKE '%" + lotPlanCompact + "%'",
            "(" + parts.join(" OR ") + ")"
          ].join(" OR ");
        }
        return parts.join(" OR ");
      }
      return parts.join(" AND ");
    }
    async function queryLotPlanAcrossLayers(lot, plan){
      const layers = await getParcelLayers();
      const out=[];
      try{
        const addrLayer = layers.find(function(l){ return /addresses/i.test((l && l.title) || ""); });
        if(addrLayer){
          const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
          const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
          const lpField = (addrLayer.fields||[]).find(function(f){ return String(f && f.name || "").toLowerCase()==="lotplan"; });
          const lotField = (addrLayer.fields||[]).find(function(f){ return String(f && f.name || "").toLowerCase()==="lot"; });
          const planField = (addrLayer.fields||[]).find(function(f){ return String(f && f.name || "").toLowerCase()==="plan"; });
          const whereParts = [];
          if(lpField && isTextField(lpField)){
            const fieldExpr = "UPPER(" + sqlField(lpField.name) + ")";
            const scrubExpr = "REPLACE(REPLACE(REPLACE(" + fieldExpr + ", ' ', ''), '-', ''), '/', '')";
            whereParts.push(
              fieldExpr + "='" + lotPlanFull + "'",
              fieldExpr + "='" + lotPlanCompact + "'",
              scrubExpr + "='" + lotPlanCompact + "'",
              fieldExpr + " LIKE '%" + lotPlanFull + "%'",
              scrubExpr + " LIKE '%" + lotPlanCompact + "%'",
              fieldExpr + " LIKE '%" + escSQL(String(lot).toUpperCase()) + "%" + escSQL(String(plan).toUpperCase()) + "%'",
              scrubExpr + " LIKE '%" + escSQL(String(lot).toUpperCase()) + "%" + escSQL(String(plan).toUpperCase()) + "%'"
            );
          }
          if(lotField && planField){
            const lotU = escSQL(String(lot).toUpperCase());
            const planU = escSQL(String(plan).toUpperCase());
            const where2 = [
              "UPPER(" + sqlField(lotField.name) + ")='" + lotU + "'",
              "REPLACE(UPPER(" + sqlField(lotField.name) + "),' ','')='" + lotU + "'"
            ].join(" OR ");
            const where3 = [
              "UPPER(" + sqlField(planField.name) + ")='" + planU + "'",
              "REPLACE(UPPER(" + sqlField(planField.name) + "),' ','')='" + planU + "'"
            ].join(" OR ");
            whereParts.push("((" + where2 + ") AND (" + where3 + "))");
          }
          if(whereParts.length){
            const where = whereParts.join(" OR ");
            let q = null;
            try{
              q = await addrLayer.queryFeatures({
                where: where,
                outFields:["*"],
                returnGeometry:true,
                maxRecordCountFactor:5
              });
            }catch(err){}
            if(!(q && q.features && q.features.length)){
              try{
                const planRaw = String(plan||"").toUpperCase();
                const parts = planRaw.replace(/[^A-Z0-9]/g,"").match(/^([A-Z]+)0*([0-9]+)$/);
                const planLetters = parts ? parts[1] : planRaw.replace(/[^A-Z]/g,"");
                const planDigits = parts ? parts[2] : planRaw.replace(/[^0-9]/g,"");
                const fieldExprs = [];
                if(lpField) fieldExprs.push("UPPER(" + sqlField(lpField.name) + ")");
                if(planField) fieldExprs.push("UPPER(" + sqlField(planField.name) + ")");
                if(fieldExprs.length && planLetters && planDigits){
                  const likeLetters = escSQL(planLetters);
                  const likeDigits = escSQL(planDigits);
                  const clauses = fieldExprs.map(function(fe){ return "(" + fe + " LIKE '%" + likeLetters + "%' AND " + fe + " LIKE '%" + likeDigits + "%')"; });
                  const whereLoose = clauses.join(" OR ");
                  const q2 = await addrLayer.queryFeatures({
                    where: whereLoose,
                    outFields:["*"],
                    returnGeometry:true,
                    maxRecordCountFactor:5
                  });
                  const feats = (q2 && q2.features) || [];
                  const filtered = feats.filter(function(f){ return matchesLotPlan(f, lot, plan); });
                  for(var fi=0;fi<filtered.length;fi++){
                    out.push({layer:addrLayer, feature:filtered[fi]});
                  }
                }
              }catch(err){}
            }
            if(q && q.features){
              for(var k=0;k<q.features.length;k++){
                const f = q.features[k];
                const attrs = f.attributes || {};
                if(!attrs.lotplan && lotField && planField && attrs[lotField.name]!=null && attrs[planField.name]!=null){
                  attrs.lotplan = String(attrs[lotField.name]).trim() + String(attrs[planField.name]).trim();
                  f.attributes = attrs;
                }
                out.push({layer:addrLayer, feature:f});
              }
            }
          }
        }
      }catch(e){}
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

    const lotPlanSource = {
      name: "Lot/Plan (QLD)",
      placeholder: "12/SP12345 or 'Lot 12 on SP12345'",
      getSuggestions: async (params)=>{
        const raw = (params && (params.suggestTerm || params.searchTerm || params.text)) || (search && search.viewModel && search.viewModel.searchTerm) || "";
        const p = parseLotPlan(raw);
        if(!p) return [];
        return [{
          key: p.lot+"/"+p.plan,
          text: "Lot "+p.lot+" on "+p.plan,
          sourceIndex: 0
        }];
      },
      getResults: async (params)=>{
        let txt = (params && (params.text || params.searchTerm)) || "";
        if(params.suggestResult && params.suggestResult.key) txt = params.suggestResult.key;
        const p = parseLotPlan(txt);
        if(!p) return [];
        const matches = await queryLotPlanAcrossLayers(p.lot, p.plan);
        return matches.map((m,i)=>({
          name: "Lot "+p.lot+" on "+p.plan+" — "+(m.layer.title||"Parcels"),
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
      search.viewModel && search.viewModel.watch && search.viewModel.watch("searchTerm", (term)=>{
        if(parseLotPlan(term)){
          search.activeSourceIndex = 0;
        }else{
          search.activeSourceIndex = 1;
        }
      });
    }catch(e){}
    search.on("select-result", async (e)=>{
      try{
        const feat = e.result && e.result.feature;
        if(feat && feat.geometry){
          let target = feat;
          if(feat.geometry.type==="point" || feat.geometry.type==="multipoint"){
            const p = await findParcelAtPoint(feat.geometry);
            if(p) target = p;
          }
          if(target && target.geometry && target.geometry.type==="polygon"){
            resetScrcSetbackContext();
            updateBadgesFromFeature(target);
            outlineSelection(target.geometry);
            await hideUnusedOverlaysFor(target.geometry);
            await refreshScrcSetbacksForGeometry(target.geometry);
            try{
              const addr=await resolveBestAddress(target.geometry, target, lastParcelInfo.addressText);
              lastParcelInfo.addressText=addr||lastParcelInfo.addressText;
              updateSummaryPanel();
            }catch{}
            updateSideOverlaySummary(target.geometry);
          }
        }
      }catch(err){ console.warn("select-result handler:", err); }
    });
