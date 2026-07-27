// Extracted from RCC.html. Keep this file as the independent page brain for RCC.
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
    import * as locator from "https://js.arcgis.com/4.30/@arcgis/core/rest/locator.js";
    import esriConfig from "https://js.arcgis.com/4.30/@arcgis/core/config.js";

    /* ---------------- Tunables ---------------- */
    const TOUCH_BUFFER_M = 6;
    const SWATCH_PX = 16;
    const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
    const REDLAND_MAP_CENTER=[153.1951125358597,-27.53388702154222];
    const REDLAND_MAP_SCALE=2256.9943525;
    const M2="m²";

    // “3 houses out”
    const HOUSES_OUT = 3;
    const HOUSE_LOT_METERS = 25;
    const SCREEN_BUFFER_METERS = HOUSES_OUT * HOUSE_LOT_METERS;
    const SHOT_SIZE = { width: 1280, height: 900 };
    const QUERY_TIMEOUT_MS = 3000;
    const SUMMARY_QUERY_TIMEOUT_MS = 8000;

    /* ---- CORS allow-list for address queries ---- */
    const CORS_HOSTS = [
      "cornerstonebc.maps.arcgis.com",
      "services.arcgis.com",
      "gisservices.information.qld.gov.au",
      "gis.brisbane.qld.gov.au",
      "maps.moretonbay.qld.gov.au",
      "gis.redland.qld.gov.au",
      "gisext.qfes.qld.gov.au",
      "arcgis.spp-dams.wspdigitaltesting.com"
    ];
    addCorsHosts(esriConfig, CORS_HOSTS);

    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async(extra=240)=>{try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{} await raf(); await sleep(extra);};
    const withTimeout=(promise,ms,label="operation")=>new Promise((resolve,reject)=>{
      let done=false;
      const timer=setTimeout(()=>{ if(done) return; done=true; reject(new Error(label+" timed out")); },ms);
      Promise.resolve(promise).then(v=>{ if(done) return; done=true; clearTimeout(timer); resolve(v); },err=>{ if(done) return; done=true; clearTimeout(timer); reject(err); });
    });

    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null
    };

    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/9B64gza2qbMZ95F8wp7ss0u";


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
        const returnPath = "RCC.html";
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
      if(window.__CORNERSTONE_FILE_MODE__) return false;
      if(!accessState.active || !accessState.expiresAt) return false;
      return new Date(accessState.expiresAt) > new Date();
    };

    const finalizeTokenAndLock = async()=>{
      if(window.__CORNERSTONE_FILE_MODE__) return;
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
    function normalizeToWebMercator(geom){
      try{
        if(!geom) return geom;
        const sr = geom.spatialReference?.wkid || geom.spatialReference?.latestWkid;
        if(sr===102100 || sr===3857) return geom;
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
        const projected = geometryEngine.project(geom, {wkid:102100});
        return projected || geom;
      }catch{ return geom; }
    }

    /* ---------------- Map & rules ---------------- */
    const portal=new Portal({url:"https://cornerstonebc.maps.arcgis.com"});
    let webmap=new WebMap({portalItem:{id:"a34ea1bbda7040968f7db02d1ed2d68f",portal}});
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
    const sppBushfireLayer=new FeatureLayer({url:SPP_BUSHFIRE_LAYER_URL,title:"Bushfire - State SPP",listMode:"hide",visible:false,opacity:0,minScale:0,maxScale:0,outFields:["OBJECTID","CLASS"],objectIdField:"OBJECTID",geometryType:"polygon",spatialReference:{wkid:102100},popupEnabled:false,renderer:sppBushfireRenderer});
    const sppBushfireDrawLayer=new GraphicsLayer({listMode:"hide",visible:false});
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

    const view=new MapView({container:"viewDiv",map:webmap,center:REDLAND_MAP_CENTER,scale:REDLAND_MAP_SCALE,constraints:{snapToZoom:false}});
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
    const RCC_SETBACK_SOURCES={
      redlandFactSheet:"https://www.redland.qld.gov.au/files/assets/public/v/1/planning-and-development/documents/redland-city-plan-documents/fact-sheets-for-redland-city-plan/fact_sheet_-_qdc_dwelling_house_domestic_outbuildings_domestic_addition_and_dual_occupancies.pdf",
      cityPlan:"https://www.redland.qld.gov.au/info/20218/redland_city_plan/981/redland_city_plan_documents",
      qdc:"https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code"
    };
    const RCC_SETBACK_ROUTE_CONFIG={
      ldr2:{name:"Low density residential - LDR2 Park residential precinct",road:10,sideRear:10,source:RCC_SETBACK_SOURCES.cityPlan},
      ldr4:{name:"Low density residential - LDR4 Kinross Road Estate precinct",road:"QDC / 5 m where Milner Place boundary applies",sideRear:"QDC / 5 m where Milner Place boundary applies",source:RCC_SETBACK_SOURCES.cityPlan},
      ldr5:{name:"Low density residential - LDR5 Revetment wall precinct",road:"QDC",sideRear:"QDC; 9 m from revetment wall where applicable",source:RCC_SETBACK_SOURCES.cityPlan},
      default:{name:"Redland City Plan / QDC",road:"QDC",sideRear:"QDC",source:RCC_SETBACK_SOURCES.redlandFactSheet}
    };

    const kidsOf=n=>(n.layers?.toArray?.()??n.layers)||(n.sublayers?.toArray?.()??n.sublayers)||[];
    const featureLayerCache=new WeakMap();
    async function featureLayerFor(node){
      if(!node || typeof node.createFeatureLayer!=="function") return null;
      if(featureLayerCache.has(node)) return featureLayerCache.get(node);
      try{
        const fl=await node.createFeatureLayer();
        await fl?.load?.();
        featureLayerCache.set(node,fl);
        return fl;
      }catch{
        featureLayerCache.set(node,null);
        return null;
      }
    }
        const nodePath=n=>{const bits=[]; let cur=n; while(cur){bits.unshift(cur.title||cur.id||"node"); cur=cur.parent;} return bits.join(" / ");};
    const ALWAYS_ON_IDS=new Set();
    const utilityVisSnapshot = new Map();
    let utilitiesToggleState = false;
    let utilToggleBtn = null;

    function redlandCityPlanLayerId(node){
      const direct=String(node?.url||"").match(/planning\/city_plan\/MapServer\/(\d+)\b/i);
      if(direct) return Number(direct[1]);
      let cur=node;
      while(cur){
        if(/planning\/city_plan\/MapServer\b/i.test(String(cur.url||""))){
          const id=Number(node?.id);
          return Number.isFinite(id) ? id : null;
        }
        cur=cur.parent;
      }
      return null;
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
    ;[300,900,1800,3500].forEach(ms=> setTimeout(()=>{ try{enforceOverlayRules();}catch{} },ms));
    async function initialiseWebMap(){
      showLoading(true);
      try{
        await webmap.load();
        enforceOverlayRules();
        try{ await view.when(); }catch{}
      }catch(e){
        console.warn("WebMap auth/fail; fallback basemap",e);
        webmap=new WebMap({basemap:"streets-vector"});
        webmap.add(selLayer);
        view.map=webmap;
      } finally {
        showLoading(false);
      }
    }
    const mapStartupReady = initialiseWebMap();
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
      includeDefaultSources:true,
      popupEnabled:true,
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
      return first("COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY") || "Redland City Council";
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
      "LOT_PLAN","LOT_PLAN_NO","LOTPLAN","LOTPLAN_NO","LOTPLAN_TXT","LOT_PLAN_TXT","LOT_PLAN_TEXT","LOTPLAN_TEXT"
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

    function parseAddress(attrs){
      if(!attrs) return null;
      for(const f of FULL_ADDR_FIELDS){
        const v = attrs[f];
        if(v!=null){
          const s = String(v).trim();
          if(s && s.toUpperCase()!=="NULL") return s;
        }
      }
      for(const f of LOTPLAN_FIELDS){
        const s = String(attrs[f] ?? "").trim();
        if(/\d{1,5}\s+[A-Za-z].*\d{4}\b/.test(s)) return s;
      }
      const built = buildAddressFromParts(attrs);
      if(built) return built;
      for(const k in attrs){
        const v = String(attrs[k]??"").trim();
        if(!v) continue;
        const m=v.match(/\b\d{1,5}\s+[A-Za-z][A-Za-z\s.'-]+(?:\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade)\b)[^,;]*?(?:,\s*[A-Za-z][A-Za-z\s.'-]+)?(?:\s+(?:QLD|Queensland))?\s*\d{4}\b/i);
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
      const hay = ((node.title||"")+ " "+nodePath(node)).toLowerCase();
      return /\b(gnaf|address|addr|property\s*address|site\s*address|street\s*address|address\s*points|locality|suburb|road\s*centerline|road\s*centreline)\b/.test(hay);
    }

    async function scanAddressLayers(lotGeom){
      const nodes = flattenFeatureNodes().filter(n=>{
        if(keepLegacyBushfireHidden(n)) return false;
        try{ return looksLikeAddressLayer(n); }catch{return false;}
      });
      const centroid = centroidOf(lotGeom);
      const candidates = [];

      for(const n of nodes){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          const outFields = ["*"];

          const r1 = await n.queryFeatures({
            geometry: lotGeom, spatialRelationship: "intersects",
            returnGeometry: false, outFields, maxRecordCountFactor: 3
          });
          (r1.features||[]).forEach(f=>{
            const addr = parseAddress(f.attributes);
            if(addr) candidates.push({addr, score: 3, layer:n});
          });

          if(centroid){
            const r2 = await n.queryFeatures({
              geometry: centroid, distance: 40, units: "meters",
              spatialRelationship: "intersects", returnGeometry: false,
              outFields, maxRecordCountFactor: 3
            });
            (r2.features||[]).forEach(f=>{
              const addr = parseAddress(f.attributes);
              if(addr) candidates.push({addr, score: 2, layer:n});
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

    async function resolveBestAddress(geom, parcelFeature){
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
          const cen = centroidOf(geom);
          if(cen){
            const res = await locator.locationToAddress(GEOCODER_URL,{location:cen});
            addr = res?.address || res?.attributes?.Match_addr || res?.attributes?.LongLabel || res?.attributes?.Address || addr;
          }
        }catch(e){
          if(ADDR_DEBUG) console.warn("reverse geocode failed:", e);
        }
      }

      // Ensure suburb is included using the parcel's attributes when available
      addr = ensureSuburbInAddress(addr, parcelFeature?.attributes || {});

      if(ADDR_DEBUG && parcelFeature){
        console.log("Parcel attr keys:", Object.keys(parcelFeature.attributes||{}));
        window.dumpAddressFields = ()=> console.table(
          Object.fromEntries(Object.keys(parcelFeature.attributes||{}).map(k=>[k,parcelFeature.attributes[k]]))
        );
      }
      return addr || "Address unavailable";
    }

    function flattenFeatureNodes(){
      const out=[];
      walkAny(view.map,(n)=>{
        if(!n) return;
        if((n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) out.push(n);
      });
      return out;
    }
    const PARCEL_FIELD_RX=/\b(LOT(?:_?PLAN)?|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM|PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT|PARCEL|PARCEL_ID|PROP(?:ERTY)?_?ID?)\b/i;
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

    let lastParcelInfo={feature:null,lotText:"--",areaText:"-- "+M2,classText:"--",addressText:"--",councilText:"Redland City Council"};

    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || ("-- "+M2));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Redland City Council");
      updateRccSetbacksPanel();
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
      const council=parseCouncil(attrs) || "Redland City Council";
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

    let lastRccSetbackContext={route:null,zoneLabel:"Not resolved",labels:[],source:"pending"};

    function setbackWallHeightFromInput(raw){
      const vals=[raw,$("rccSetbackWallHeight")?.value,$("rccSetbackWallHeightTab")?.value]
        .filter(v=>v!==undefined && v!==null && String(v).trim()!=="");
      const n=Number(vals[0]);
      return Number.isFinite(n) && n>0 ? n : 4.5;
    }
    function metresText(v,digits=1){
      if(v==null) return "--";
      if(typeof v==="string") return v;
      const n=Number(v);
      if(!Number.isFinite(n)) return "--";
      return n.toLocaleString(undefined,{maximumFractionDigits:digits})+" m";
    }
    function formatSetbackArea(areaSqm){
      if(!Number.isFinite(areaSqm)) return "-- "+M2;
      return Math.round(areaSqm).toLocaleString()+" "+M2;
    }
    function lotAreaForSetbacks(feat,info=lastParcelInfo){
      const attrs=feat?.attributes||{};
      return getLotAreaSqm(attrs) ?? geomAreaSqmSafe(feat?.geometry) ?? parseNumberLike(info?.areaText) ?? null;
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
    function orientedLotMetricsForSetbacks(points){
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
      const oriented=orientedLotMetricsForSetbacks(pts);
      if(oriented && Number.isFinite(oriented.width) && Number.isFinite(oriented.depth)){
        return {width:oriented.width,frontage:oriented.width,depth:oriented.depth,source:"estimated from selected lot geometry"};
      }
      if(Number.isFinite(areaSqm) && areaSqm>0){
        const side=Math.sqrt(areaSqm);
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
      return QDC_NARROW_FRONTAGE_TABLE.find(r=>frontage>r.min && frontage<=r.max) || QDC_NARROW_FRONTAGE_TABLE[QDC_NARROW_FRONTAGE_TABLE.length-1];
    }
    function qdcSideRearSetbackFor(height,frontage){
      const h=Math.max(0,Number(height)||0);
      const narrow=qdcNarrowFrontageRow(frontage);
      if(h<=4.5) return {value:narrow?narrow.low:1.5,basis:narrow?`QDC Table A2 narrow frontage band ${narrow.label}`:"QDC MP 1.2 side/rear height band up to 4.5 m"};
      if(h<=7.5) return {value:narrow?narrow.mid:2,basis:narrow?`QDC Table A2 narrow frontage band ${narrow.label}`:"QDC MP 1.2 side/rear height band over 4.5 m and up to 7.5 m"};
      return {value:2+(0.5*Math.ceil((h-7.5)/3)),basis:"QDC MP 1.2 2 m plus 0.5 m for every 3 m, or part, over 7.5 m"};
    }
    function classifyRccSetbackRoute(label){
      const k=planKey(label);
      if(!k) return null;
      if(k.includes("ldr2") || k.includes("parkresidential")) return "ldr2";
      if(k.includes("ldr4") || k.includes("kinross") || k.includes("milnerplace")) return "ldr4";
      if(k.includes("ldr5") || k.includes("revetment")) return "ldr5";
      if(k.includes("lowdensityresidential") || k.includes("dwellinghouse")) return "default";
      return null;
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
    async function labelsFromLayerForRccSetbacks(layerNode,geom){
      const labels=[];
      const title=layerNode?.title||nodePath(layerNode);
      if(classifyRccSetbackRoute(title)) labels.push(title);
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
    async function resolveRccSetbackContext(geom){
      if(!geom) return {route:null,zoneLabel:"No parcel selected",labels:[],source:"none"};
      const nodes=flattenFeatureNodes().filter(n=>{
        const t=n?.title||"", p=nodePath(n);
        return !keepLegacyBushfireHidden(n) && !underDNTChain(n) && (isZoning(t,p) || !!classifyRccSetbackRoute(t+" "+p));
      });
      const allLabels=[];
      for(const n of nodes){
        try{
          await n.load();
          const cnt=await countFeatures(n,geom);
          if(cnt<=0) continue;
          const labels=await labelsFromLayerForRccSetbacks(n,geom);
          allLabels.push(...labels);
          for(const label of labels){
            const route=classifyRccSetbackRoute(label);
            if(route) return {route,zoneLabel:label,labels:uniqueSetbackLabels(allLabels),source:n.title||nodePath(n)};
          }
        }catch{}
      }
      const labels=uniqueSetbackLabels(allLabels);
      const route=labels.map(classifyRccSetbackRoute).find(Boolean)||"default";
      return {route,zoneLabel:labels.find(l=>classifyRccSetbackRoute(l)===route)||RCC_SETBACK_ROUTE_CONFIG[route].name,labels,source:"zoning scan"};
    }
    function calculateRccSetbacks(feat=lastParcelInfo.feature,opts={}){
      if(!feat?.geometry) return {empty:true,notes:["Select a Redland parcel first."]};
      const info=opts.info || lastParcelInfo || {};
      const wallHeight=setbackWallHeightFromInput(opts.wallHeight);
      const areaSqm=lotAreaForSetbacks(feat,info);
      const dimensions=estimateLotDimensionsForSetbacks(feat.geometry,areaSqm);
      const context=opts.context || lastRccSetbackContext || {};
      const route=context.route || "default";
      const cfg=RCC_SETBACK_ROUTE_CONFIG[route] || RCC_SETBACK_ROUTE_CONFIG.default;
      const rows=[];
      const notes=[];
      const sources=[
        {label:"Redland City Plan/QDC dwelling house fact sheet",url:RCC_SETBACK_SOURCES.redlandFactSheet},
        {label:"Redland City Plan documents",url:RCC_SETBACK_SOURCES.cityPlan},
        {label:"Queensland Development Code",url:RCC_SETBACK_SOURCES.qdc}
      ];
      rows.push({boundary:"Lot metrics",value:`${metresText(dimensions.frontage)} frontage / ${metresText(dimensions.depth)} depth`,detail:`Area ${formatSetbackArea(areaSqm)}. Width/frontage and depth are ${dimensions.source}.`});
      rows.push({boundary:"Planning context",value:cfg.name,detail:context.zoneLabel && context.zoneLabel!==cfg.name ? context.zoneLabel : (context.source||"")});

      if(cfg.road==="QDC"){
        rows.push({boundary:"Road boundary",value:"QDC MP 1.1 / MP 1.2",detail:"Redland fact sheet path: QDC MP 1.1 for lots under 450 m2 and QDC MP 1.2 for lots 450 m2 or greater, unless a Redland City Plan precinct override applies."});
      }else if(typeof cfg.road==="number"){
        rows.push({boundary:"Road boundary",value:metresText(cfg.road),detail:"Redland City Plan precinct-specific road-boundary setback."});
      }else{
        rows.push({boundary:"Road boundary",value:cfg.road,detail:"Confirm whether the special precinct boundary condition applies to the selected lot."});
      }

      if(cfg.sideRear==="QDC"){
        const qdc=qdcSideRearSetbackFor(wallHeight,dimensions.frontage);
        rows.push({boundary:"Side and rear",value:metresText(qdc.value),detail:`For wall height ${metresText(wallHeight)}. ${qdc.basis}.`});
      }else if(typeof cfg.sideRear==="number"){
        rows.push({boundary:"Side and rear",value:metresText(cfg.sideRear),detail:"Redland City Plan precinct-specific side/rear boundary setback."});
      }else{
        rows.push({boundary:"Side and rear",value:cfg.sideRear,detail:"Confirm whether the special precinct boundary condition applies to the selected lot."});
        const qdc=qdcSideRearSetbackFor(wallHeight,dimensions.frontage);
        rows.push({boundary:"QDC side/rear baseline",value:metresText(qdc.value),detail:`For wall height ${metresText(wallHeight)}. ${qdc.basis}.`});
      }

      if(route==="ldr4") notes.push("LDR4 Kinross Road Estate has a 5 m setback only for the boundary shared with lots accessed from Milner Place. Use QDC/other applicable outcomes for other boundaries unless the approved plan of development says otherwise.");
      if(route==="ldr5") notes.push("LDR5 Revetment wall precinct includes a 9 m setback from the revetment wall where that condition applies.");
      notes.push("Redland City Plan precincts, overlays, approved building envelopes, easements, covenants, referrals and development approvals can override or add to these minimum setbacks.");
      return {regime:`rcc-${route}`,classLabel:cfg.name,areaSqm,dimensions,wallHeight,sourceLabel:sources[0].label,sourceUrl:sources[0].url,rows,notes,sources,context};
    }
    function setbackInfoToHTML(info){
      if(!info || info.empty){
        const msg=info?.notes?.[0] || "Select a parcel.";
        return `<p class="setback-muted">${htmlEsc(msg)}</p>`;
      }
      const sources=(info.sources||[]).map(s=>`<a href="${htmlEsc(s.url)}" target="_blank" rel="noopener">${htmlEsc(s.label)}</a>`).join(" | ");
      const dimParts=[
        info.wallHeight!=null ? `Wall height: ${metresText(info.wallHeight)}` : null,
        info.dimensions?.frontage!=null ? `Width/frontage: ${metresText(info.dimensions.frontage)}` : null,
        info.dimensions?.depth!=null ? `Depth: ${metresText(info.dimensions.depth)}` : null
      ].filter(Boolean).join(". ");
      const dimText=dimParts ? `. ${dimParts}.` : "";
      const rows=(info.rows||[]).map(row=>(
        `<tr><th>${htmlEsc(row.boundary)}</th><td><span class="setback-value">${htmlEsc(row.value)}</span><span class="setback-detail">${htmlEsc(row.detail)}</span></td></tr>`
      )).join("");
      const notes=(info.notes||[]).length ? `<ul class="setback-notes">${info.notes.map(n=>`<li>${htmlEsc(n)}</li>`).join("")}</ul>` : "";
      return [
        `<p class="setback-summary">${htmlEsc(info.classLabel)} - ${htmlEsc(formatSetbackArea(info.areaSqm))}${htmlEsc(dimText)}</p>`,
        `<p class="setback-source">Source: ${sources}</p>`,
        `<table class="setback-table"><tbody>${rows}</tbody></table>`,
        notes
      ].join("");
    }
    function setRccSetbacksHTML(html){
      if($("rccSetbacksContent")) $("rccSetbacksContent").innerHTML=html;
      if($("rccSetbacksTabContent")) $("rccSetbacksTabContent").innerHTML=html;
    }
    function updateRccSetbacksPanel(){
      setRccSetbacksHTML(setbackInfoToHTML(calculateRccSetbacks()));
    }
    function resetRccSetbackContext(){
      lastRccSetbackContext={route:null,zoneLabel:"Resolving zoning",labels:[],source:"pending"};
    }
    async function refreshRccSetbacksForGeometry(geom){
      if(!geom){ updateRccSetbacksPanel(); return lastRccSetbackContext; }
      setRccSetbacksHTML(`<p class="setback-muted">Resolving Redland zoning...</p>`);
      lastRccSetbackContext=await resolveRccSetbackContext(geom);
      updateRccSetbacksPanel();
      return lastRccSetbackContext;
    }
    (function initRccSetbackInputs(){
      const ids=["rccSetbackWallHeight","rccSetbackWallHeightTab"];
      const sync=source=>{
        for(const id of ids){
          const input=$(id);
          if(input && input!==source) input.value=source.value;
        }
        try{ lastReportHTML=null; lastReportTitle="Property Report"; }catch{}
        updateRccSetbacksPanel();
      };
      for(const id of ids){
        const input=$(id);
        if(!input) continue;
        input.addEventListener("input",()=>sync(input));
        input.addEventListener("change",()=>sync(input));
      }
    })();
    window.calculateRccSetbacks=calculateRccSetbacks;

    const bufferedAOIFor=(node,geom)=>{ try{ const gt=(node.geometryType||"").toLowerCase(); if(gt==="point"||gt==="multipoint"||gt==="polyline") return geometryEngine.buffer(geom,TOUCH_BUFFER_M,"meters"); }catch{} return geom; };
    async function countFeatures(node,geom){
      if(!node) return 0;
      const tryCount=async target=>{
        if(!target) return 0;
        const g=bufferedAOIFor(target,geom);
        try{
          if(typeof target.queryFeatureCount==="function"){
            const c=await withTimeout(target.queryFeatureCount({geometry:g,spatialRelationship:"intersects"}), QUERY_TIMEOUT_MS, "countFeatures");
            const num=Number(c)||0;
            if(num) return num;
          }
        }catch{}
        try{
          if(typeof target.queryFeatures==="function"){
            const q=await withTimeout(target.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:1}), QUERY_TIMEOUT_MS, "countFeatures");
            if(q.features?.length) return q.features.length;
          }
        }catch{}
        return 0;
      };
      let cnt=await tryCount(node);
      if(cnt>0) return cnt;
      const fl=await featureLayerFor(node);
      if(!fl) return cnt;
      return await tryCount(fl);
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

          let cnt = 0;
          try{
            cnt = await withTimeout(countFeatures(n, geom), SUMMARY_QUERY_TIMEOUT_MS, "summary overlay count");
          }catch{}
          if (cnt <= 0) continue;

          let keys=[];
          try{ ({ items: keys } = await withTimeout(legendFromRendererUsingFeatures(n, geom), QUERY_TIMEOUT_MS, "summary legend")); }catch{ keys=[]; }
          const keyHTML = keys.length
            ? `<div class="leg" style="margin-top:4px">${keys.map(k =>
                `<div class="row">${k.swatchHTML}${htmlEsc(k.label)}</div>`
              ).join("")}</div>`
            : "";

          const title = htmlEsc(t || "Layer");
          const key = `ov-${itemIdx++}`;
          sideOverlayIndex.set(key, n);
          const isVisible = isNodeVisible(n);
          const toggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${key}" aria-pressed="${isVisible}" title="${isVisible ? "Hide overlay" : "Show overlay"}">${isVisible ? "Hide" : "Show"}</button>`;
          items.push(
            `<li>
               <div class="ov-title">${title} <span style="color:#777">(${cnt})</span>${toggleHTML}</div>
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

    async function focusOnParcelFeature(feat,{shouldZoom=false}={}){
      if(!feat || !feat.geometry) return;
      await mapStartupReady;
      const focusJob = ++parcelFocusJobId;
      const geom = normalizeToWebMercator(projectToViewSR(feat.geometry));
      feat.geometry = geom;
      resetRccSetbackContext();
      updateBadgesFromFeature(feat);
      outlineSelection(geom);
      setRccSetbacksHTML(`<p class="setback-muted">Resolving Redland zoning...</p>`);
      if(shouldZoom){
        try{
          const target = geom.extent ? geom.extent.expand(1.2) : geom;
          await view.goTo({target, animate:true});
        }catch(err){
          console.warn("goTo failed", err);
        }
      }
      const overlayList = $("sumOverlays");
      if(overlayList) overlayList.innerHTML = "<li><i>Scanning...</i></li>";
      setTimeout(()=>{
        const stillCurrent = ()=> focusJob === parcelFocusJobId && !reportInProgress;
        (async()=>{
          try{
            const addr=await resolveBestAddress(geom, feat);
            if(focusJob !== parcelFocusJobId) return;
            lastParcelInfo.addressText=addr||lastParcelInfo.addressText;
            updateSummaryPanel();
          }catch{}
        })();
        (async()=>{
          try{
            if(!stillCurrent()) return;
            await refreshRccSetbacksForGeometry(geom);
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
      },80);
    }

    view.on("click", async ev=>{
      try{
        showLoading(true);
        await mapStartupReady;
        const parcel=await findParcelAtPoint(ev.mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        await focusOnParcelFeature(parcel);
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
      for(const k of ZONE_KEYS){ const v=attrs[k]; if(v!=null && String(v).trim()) return String(v).trim(); }
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

      const itemMap=new Map();
      for(const f of feats){
        const gph=new Graphic({geometry:f.geometry,attributes:f.attributes,layer:layerNode});
        let sym=null;
        try{ sym=await symbolUtils.getDisplayedSymbol(gph,view); }catch{}
        if(!sym){
          const r=layerNode.renderer; sym = r?.symbol || r?.defaultSymbol || f.symbol || null;
        }
        if(!sym) continue;

        let label=isZone?pickZoneLabel(f.attributes):null;
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
    function isRedlandPlanningBushfireLayer(node){
      return redlandCityPlanLayerId(node)===3;
    }
    function keepLegacyBushfireHidden(node){
      if(!node || isSppBushfireLayer(node) || isRedlandPlanningBushfireLayer(node)) return false;
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
      return collectLeafDisplayNodesByPredicate((n)=>isRedlandPlanningBushfireLayer(n),{includeDNT:true});
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

      try{
        return await withViewOnGeom(lotGeom, async ()=>{
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
      reportInProgress = true;
      parcelFocusJobId++;
      try{
        await mapStartupReady;
        showLoading(true);
        setRpt("Locating parcel...", 12);
        let geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Redland City Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry; ({lotText,areaText,classText,addressText,councilText}=lastParcelInfo);
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){ const info=parcelInfoFromFeature(probe); geom=probe.geometry; ({lotText,areaText,classText,addressText,councilText}=info); lastParcelInfo={feature:probe,...info}; }
        }
        setRpt("Parcel located", 18, "rptS1");

        if(geom){
          setRpt("Resolving address...", 25);
          try{ addressText=await resolveBestAddress(geom,lastParcelInfo.feature); }catch{}
          setRpt("Address resolved", 35, "rptS2");
          lastParcelInfo.addressText = addressText || lastParcelInfo.addressText;
          setRpt("Resolving setback rules...", 38);
          try{
            lastRccSetbackContext = await resolveRccSetbackContext(geom);
            updateRccSetbacksPanel();
          }catch{}
        }

        setRpt("Rendering base map...", 42);
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
            try{ selLayer.visible=true; }catch{}
            await setScreenshotPropertyBoundary(geom,{keepLabels:true});
            await waitViewIdle(360);
            return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});
          } finally {
            clearScreenshotPropertyBoundary();
            restoreVisibility(view.map,visSnap); forcePropertyBoundariesVisible(view.map);
            try{
              if(baseBasemap) view.map.basemap = baseBasemap;
            }catch{}
          }
        };
        const baseShot = geom
          ? await withViewOnGeom(geom, captureBaseShot)
          : await captureBaseShot();

        setRpt("Collecting overlays...", 55);
        const cats = geom ? await (async()=>{
          const out={zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],bushfire:[],others:[]};
          const arr=[]; walkAny(view.map,(n,underDNT)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function") && !underDNT) arr.push(n); });
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
          return out;
        })() : {zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],others:[]};

        const shots=[];
        const tasks=[
          ["Zoning", async()=>{ if(cats.zoning.length){ const s=await screenshotFor(cats.zoning,"Zoning",geom,true); if(s) shots.push(s); }}],
          ["Bushfire Hazard", async()=>{ await addMandatorySection(shots,"Bushfire Hazard",collectAllBushfireDisplayNodes,geom,baseShot,"No bushfire hazard layer"); }],
          ["FFDI", async()=>{ await addMandatorySection(shots,"FFDI",collectAllFFDIDisplayNodes,geom,baseShot,"No FFDI layer"); }],
          ["Utilities", async()=>{ const all=collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=> isUtility(t,id,tg)||isWaterOrSewer(p),{includeDNT:true}); if(all.length){ const s=await screenshotFor(all,"Utilities",geom,false,{forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); } }],
          ["Acid overlays", async()=>{ if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); }}],
          ["Transport", async()=>{ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); }}],
          ["Air quality", async()=>{ if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); }}],
          ["Transport Noise Corridor", async()=>{ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,baseShot,"No noise Lv"); }],
          ["Other overlays", async()=>{ for (const n of cats.others) { const hay=strHay(n); if(HARDWIRED.ffdi.some(rx=>rx.test(hay))) continue; const s = await screenshotFor([n], n.title || "Overlay", geom); if (s) shots.push(s); } }]
        ];
        for(let i=0;i<tasks.length;i++){
          const [name,fn]=tasks[i];
          setRpt(`Rendering ${name}...`, 55 + Math.round(((i+1)/tasks.length)*30));
          await fn();
        }
        dedupeShotsByTitle(shots,"Transport Noise Corridor");
        setRpt("Overlays rendered", 87, "rptS3");

        setRpt("Composing document...", 93);
        const now=new Date();
        const fmt=d=> d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
        const esc=htmlEsc;
        const logoSrc="./images/Flavour icon.png";

        const toFileSafe = s =>
          String(s)
            .replace(/[<>:"/\|?*\x00-\x1F]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const baseName = (addressText && addressText !== "--")
          ? addressText
          : ((lotText && lotText !== "--") ? ("Lot " + lotText) : "Property");
        const reportDisplayTitle = baseName + " - Property Report";
        const reportFileTitle = toFileSafe(reportDisplayTitle);

        const html=[];
        html.push("<!doctype html><meta charset='utf-8'><title>",esc(reportFileTitle),"</title>");
        html.push("<style>",
          ":root{--brand:#a70b13;--brand2:#7f0e15;--bg:#f6f7f9;--ink:#0b0d12;--border:#e1e3e6;--radius:14px;--shadow:0 6px 18px rgba(16,21,28,.08);--panel:#ffffff;--panel-2:#f8f9fb;--muted:#5b6470}",
          "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:18px;color:var(--ink);background:var(--bg);line-height:1.4}",
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
        html.push("<div class='card brandbar'><img src='",logoSrc,"' alt='Logo'><h1>",esc(reportDisplayTitle),"</h1><div class='muted'>",fmt(now),"</div></div>");

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

        html.push("<div class='card rpt-footer'><img src='",logoSrc,"' alt='Logo' style='width:18px;height:18px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/> Redland City Council - CornerstonePlus. Indicative only.</div>");
        html.push("</body>");

        const htmlOut = html.join("");
        return {html: htmlOut, title: reportFileTitle};
      }catch(e){ console.error(e); alert("Could not create report."); }
      finally{ reportInProgress = false; showLoading(false); }
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

    function normalizePlanText(p){
      return String(p||"").toUpperCase().replace(/\s+/g,"");
    }
    function parseLotPlan(text){
      if(!text) return null;
      let s=String(text).toUpperCase();
      s=s.replace(/[,]+/g," ").replace(/\bon\b/ig," ").replace(/\blot\b/ig," ").replace(/\s+/g," ").trim();
      let m = s.match(/^\s*(\d+)\s*\/\s*([A-Z]{1,4}\s*\d{1,8})\s*$/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      m = s.match(/^\s*(\d+)\s+([A-Z]{1,4}\s*\d{1,8})\s*$/);
      if(m) return {lot:m[1], plan:normalizePlanText(m[2])};
      m = s.match(/^\s*([A-Z]{1,4}\s*\d{1,8})\s+(\d+)\s*$/);
      if(m) return {lot:m[2], plan:normalizePlanText(m[1])};
      return null;
    }

    let _parcelLayerCache=null;
    async function getParcelLayers(){
      await mapStartupReady;
      if(_parcelLayerCache) return _parcelLayerCache;
      const candidates=flattenFeatureNodes();
      const polys=[];
      for(const n of candidates){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          if(n.geometryType==="polygon" && (looksLikeParcelLayer(n) || hasParcelFields(n))){
            polys.push(n);
          }
        }catch{}
      }
      _parcelLayerCache=polys;
      return polys;
    }

    function escSQL(s){ return String(s).replace(/'/g,"''"); }
    function isIntegerField(f){ const t=String(f.type||"").toLowerCase(); return t.indexOf("integer")!==-1; }
    function isTextField(f){ const t=String(f.type||"").toLowerCase(); return t.indexOf("string")!==-1; }

    function buildLotPlanWhere(layer, lot, plan){
      const flds = Array.isArray(layer.fields)?layer.fields:[];
      const lotFields = flds.filter(f=>{
        const nm = (f.name||"").toUpperCase();
        if(/LOT_AREA/.test(nm)) return false;
        return /\b(LOT|LOTNO|LOT_NO|LOTNUMBER|LOT_NUM|LOTNUM)\b/.test(nm) || /^LOT$/.test(nm);
      });
      const planFields = flds.filter(f=>{
        const nm = (f.name||"").toUpperCase();
        return /\b(PLAN|PLAN_NO|PLANNO|LOT_PLAN|LOTPLAN|LOT_PLAN_TXT|LOTPLAN_TXT)\b/.test(nm);
      });

      const lotClauses=[];
      const lotNum = Number(lot);
      for(const f of lotFields){
        if(isIntegerField(f) && !Number.isNaN(lotNum)){
          lotClauses.push(`${f.name}=${lotNum}`);
        }else if(isTextField(f)){
          lotClauses.push(`UPPER(${f.name}) LIKE '%${escSQL(String(lot).toUpperCase())}%'`);
        }
      }

      const planClauses=[];
      const planU = escSQL(plan.toUpperCase());
      const planCompact = escSQL(plan.toUpperCase().replace(/[^A-Z0-9]/g,""));
      const lotPlanFull = escSQL((String(lot)+"/"+plan).toUpperCase());
      const lotPlanCompact = escSQL((String(lot)+plan).toUpperCase().replace(/[^A-Z0-9]/g,""));
      for(const f of planFields){
        if(isTextField(f)){
          const fieldExpr = `UPPER(${f.name})`;
          const scrubExpr = `REPLACE(REPLACE(REPLACE(${fieldExpr},' ',''),'-',''),'/','')`;
          planClauses.push(`${fieldExpr} LIKE '%${planU}%'`);
          planClauses.push(`${scrubExpr} LIKE '%${planCompact}%'`);
          if(/LOT[_ ]?PLAN|LOTPLAN|LOT_PLAN/i.test(f.name)){
            planClauses.push(`${fieldExpr} LIKE '%${lotPlanFull}%'`);
            planClauses.push(`${scrubExpr} LIKE '%${lotPlanCompact}%'`);
          }
        }
      }

      const parts=[];
      if(lotClauses.length) parts.push("("+lotClauses.join(" OR ")+")");
      if(planClauses.length) parts.push("("+planClauses.join(" OR ")+")");
      if(!parts.length) return null;
      return parts.join(" AND ");
    }

    async function queryLotPlanAcrossLayers(lot, plan){
      const layers = await getParcelLayers();
      const out=[];
      for(const L of layers){
        try{
          const where = buildLotPlanWhere(L, lot, plan);
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
        const p = parseLotPlan(params.text);
        if(!p) return [];
        return [{
          key: p.lot+"/"+p.plan,
          text: "Lot "+p.lot+" on "+p.plan,
          sourceIndex: 0
        }];
      },
      getResults: async (params)=>{
        let txt = params.text || "";
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

    search.sources.add(lotPlanSource);

    search.on("select-result", async (e)=>{
      try{
        await mapStartupReady;
        const feat = e.result && e.result.feature;
        if(feat && feat.geometry && feat.geometry.type==="polygon"){
          await focusOnParcelFeature(feat,{shouldZoom:true});
        }
      }catch(err){ console.warn("select-result handler:", err); }
    });
