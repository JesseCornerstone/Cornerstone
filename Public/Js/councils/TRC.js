// Extracted from TRC.html. Keep this file as the independent page brain for TRC.
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

    /* ---------------- Tunables ---------------- */
    const TOUCH_BUFFER_M = 6;
    const SWATCH_PX = 16;
    const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
    const BRISBANE=[151.93952197403942,-27.557372369849027]; // Toowoomba center per your snippet
    const M2="m²";

    // “3 houses out”
    const HOUSES_OUT = 3;
    const HOUSE_LOT_METERS = 25;
    const SCREEN_BUFFER_METERS = HOUSES_OUT * HOUSE_LOT_METERS;
    const SHOT_SIZE = { width: 1280, height: 900 };

    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async(extra=240)=>{try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{} await raf(); await sleep(extra);};

    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null
    };

    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/dRm8wPcay9ER5TteUN7ss0w";


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
        const returnPath = "TRC.html";
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
    function framedExtent(geom){
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

    /* ---------------- Map & rules ---------------- */
    const portal=new Portal({url:"https://cornerstonebc.maps.arcgis.com"});
    let webmap=new WebMap({portalItem:{id:"d871a5090a7641a6826c10a558cf2da9",portal}});
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
    webmap.add(sppBushfireLayer); const sppBushfireDrawLayer=new GraphicsLayer({listMode:"hide",visible:false}); webmap.add(sppBushfireDrawLayer); try{ sppBushfireLayer.when(()=>console.info("SPP bushfire layer loaded"),err=>console.warn("SPP bushfire layer failed",err)); }catch{}
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
        if(underDNT||!("visible" in n)) return;
        const t=n.title||"", p=nodePath(n), tg=n.portalItem?.tags||[];
        if(isUtility(t,n.id,tg)||isWaterOrSewer(p)) nodes.push(n);
      });
      return nodes;
    }
    function updateUtilityToggleLabel(){
      const btn=utilToggleBtn||document.getElementById("btnUtilityToggleMap");
      if(!btn) return;
      const on=utilitiesToggleState;
      btn.setAttribute("title",on?"Hide utilities":"Show utilities");
      btn.setAttribute("aria-pressed",String(on));
      btn.classList.toggle("active",on);
    }
    function setUtilitiesVisible(on){
      const nodes=getUtilityNodes();
      if(on){
        utilityVisSnapshot.clear();
        nodes.forEach(n=>{
          if(!utilityVisSnapshot.has(n)) utilityVisSnapshot.set(n,!!n.visible);
          try{ n.visible=true; }catch{}
          try{ n.listMode="show"; }catch{}
          let p=n.parent;
          while(p){ if("visible" in p){ try{ p.visible=true; }catch{} } p=p.parent; }
        });
      }else{
        nodes.forEach(n=>{
          const prev=utilityVisSnapshot.has(n)?utilityVisSnapshot.get(n):false;
          try{ n.visible=prev; }catch{}
        });
      }
      utilitiesToggleState=on;
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
    (async()=>{ showLoading(true); try{ await webmap.loadAll(); ensureSppBushfireLayer(); enforceOverlayRules(); }catch(e){ console.warn("WebMap auth/fail; fallback basemap",e); webmap=new WebMap({basemap:"streets-vector"}); webmap.add(selLayer); webmap.add(sppBushfireLayer); webmap.add(sppBushfireDrawLayer); view.map=webmap; } finally{ showLoading(false);} })();
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
      utilToggleBtn=(()=>{
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
    view.ui.add(new Search({view,includeDefaultSources:true,popupEnabled:true,allPlaceholder:"Search address"}),{position:"top-right",index:0});

    view.watch("extent",()=>{ const c=view.center; setText("statusCoords",`Coords: ${c.longitude.toFixed(5)}, ${c.latitude.toFixed(5)}`); setText("statusZoom",`Zoom: ${view.zoom.toFixed(1)}`); setText("statusScale",`Scale: 1:${Math.round(view.scale)}`); });

    /* ---------------- Parcel selection ---------------- */
    const parseNumberLike=raw=>{ if(raw==null) return null; let s=String(raw).trim(); if(!s) return null; const hasHA=/(^|[^a-z])ha([^a-z]|$)/i.test(s)||/\bhectare(s)?\b/i.test(s); s=s.replace(/,/g,"").replace(/square\s*met(re|er)s?/ig,"").replace(/m2|m\u00B2|sqm|sq\.?m/ig,"").trim(); let n=parseFloat(s); if(isNaN(n)) return null; if(hasHA) n*=10000; return n; };
    function getLotAreaSqm(attrs){ const strong=["LOT_AREA_M2","LOT_SIZE_M2","LOT_SIZE_SQM","LOT_AREA_SQM","AREA_SQM","SITE_AREA_SQM","LAND_AREA_SQM","LOT_AREA","LOT_SIZE","SITE_AREA","LAND_AREA","AREA_M2","AREA (M2)","AREA(M2)","AREA_M^2","AREA_HA","HECTARES"]; for(const k of strong){ const v=k in attrs?parseNumberLike(attrs[k]):null; if(v!=null){ if(v>0&&v<50&&(k==="AREA_HA"||k==="HECTARES")) return v*10000; return v; } } for(const k2 in attrs){ const v2=attrs[k2]; if(/(lot|site|land).*area/i.test(k2)||/area.*(sqm|m2|m\^2|square)/i.test(k2)||(/(lot|site).*size/i.test(k2))){ const val=parseNumberLike(v2); if(val) return val; } } return null; }
    function parseParcelMeta(attrs){ const keys=rx=>Object.keys(attrs).find(k=>rx.test(k)); const lot=attrs["LOT"]??attrs["LOTNO"]??attrs["LOT_NO"]??attrs["LOTNUMBER"]??(keys(/^lot[\w_]*$/i)&&String(attrs[keys(/^lot[\w_]*$/i)])); const plan=attrs["PLAN"]??attrs["PLANNO"]??attrs["PLAN_NO"]??(keys(/^plan[\w_]*$/i)&&String(attrs[keys(/^plan[\w_]*$/i)])); let lotplan=attrs["LOT_PLAN"]??attrs["LOT_PLAN_NO"]??attrs["LOTPLAN"]??attrs["LOTPLAN_NO"]??attrs["LOTPLAN_TXT"]??attrs["LOT_PLAN_TXT"]??attrs["LOT_PLAN_TEXT"]??attrs["LOTPLAN_TEXT"]; if(!lotplan && lot && plan) lotplan=lot+"/"+plan; if(!lotplan){ for(const key in attrs){ const s=String(attrs[key]||"").toUpperCase(); const m=s.match(/\b(\d+)\s*\/\s*([A-Z]{1,4}\s*\d+)\b/); if(m){ lotplan=m[1]+"/"+m[2].replace(/\s+/g,""); break; } } } return {lot,plan,lotplan}; }
    const geomAreaSqmSafe=g=>{ try{ const a=Math.abs(geometryEngine.planarArea(g,"square-meters")||0); return a>0?a:null; }catch{ return null; } };

    function smartJoin(parts){ return parts.filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
    const _get = (o, ks) => { for (const k of ks) if (k in o && String(o[k] ?? "").trim()) return String(o[k]).trim(); return null; };
    function parseAddress(attrs){
      if(!attrs) return null;
      const full=_get(attrs,["FULL_ADDRESS","ADDRESS_FULL","ADDRESS1","SITE_ADDRESS","PROPERTY_ADDRESS","PROP_ADDRESS","PRIMARY_ADDRESS","GNAF_FULL_ADDRESS","GNAF_ADDRESS","ADDR_FULL","ADDR_LABEL","STREET_ADDRESS","POSTAL_ADDRESS","ADDRESSES","LandParcelpropoertyFramework"]);
      if(full) return full;
      const unit=_get(attrs,["UNIT_NO","UNIT_NUMBER","UNIT","APARTMENT","FLAT","SUITE","SUB_UNIT"]);
      const numP=_get(attrs,["HOUSE_PREFIX","NUMBER_PREFIX","ADDR_NUM_PREFIX","NUMBER_PRE"]);
      const num=_get(attrs,["HOUSE_NO","HOUSE_NUMBER","STREET_NO","STREET_NUMBER","PRIMARY_NO","PROPERTY_NO","NUMBER"]);
      const numS=_get(attrs,["HOUSE_SUFFIX","NUMBER_SUFFIX","ADDR_NUM_SUFFIX","NUMBER_SUF"]);
      const stNm=_get(attrs,["STREET_NAME","ST_NAME","ROAD_NAME","RD_NAME","ADD_STREET_NAME","STREET"]);
      const stTp=_get(attrs,["STREET_TYPE","ST_TYPE","ROAD_TYPE","RD_TYPE","ADDR_TYPE"]);
      const stSf=_get(attrs,["STREET_SUFFIX","ST_SUFFIX","ROAD_SUFFIX","RD_SUFFIX"]);
      const suburb=_get(attrs,["SUBURB","SUBURB_NAME","LOCALITY","LOCALITY_NAME","TOWN","CITY","SUB_NAME"]);
      const state=_get(attrs,["STATE","STATE_ABBR","STATE_CODE"])||"QLD";
      const post=_get(attrs,["POSTCODE","POST_CODE","ZIP"]);
      const line1=smartJoin([ unit ? `${unit}/` : null, smartJoin([numP,num,numS]), smartJoin([stNm,stTp,stSf]) ]);
      const line2=smartJoin([ suburb, state, post ]);
      const a=smartJoin([line1,line2]);
      if(a) return a;
      for(const k in attrs){
        const v=String(attrs[k]??"").trim(); if(!v) continue;
        const m=v.match(/\b\d{1,5}\s+[A-Za-z][A-Za-z\s.'-]+(?:\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade)\b)[^,;]*?(?:\,\s*[A-Za-z][A-Za-z\s.'-]+)?(?:\s+(?:QLD|Queensland))?\s*\d{4}\b/i);
        if(m) return m[0].replace(/\s+/g," ").trim();
      }
      return null;
    }
    function parseCouncil(attrs){
      if(!attrs) return null;
      const first=(...keys)=>{ for(const k of keys){ if(k in attrs){ const v=String(attrs[k]??"").trim(); if(v) return v; } } return null; };
      return first("COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY") || "Toowoomba City Council";
    }
    async function reverseGeocodeAddress(urlPoint){
      try{
        const res=await locator.locationToAddress(GEOCODER_URL,{location:urlPoint});
        const a=res?.address || res?.attributes?.Match_addr || res?.attributes?.LongLabel || res?.attributes?.Address;
        return a || null;
      }catch{ return null; }
    }

    function looksLikeAddressLayer(node){
      const t=((node.title||"")+" "+nodePath(node)).toLowerCase();
      return /gnaf|address|property.*address|street\s*address|site\s*address|address\s*points|road\s*centerline|centreline/i.test(t);
    }
    function bestAddressFromAttrs(attrs){ return parseAddress(attrs); }

    function flattenFeatureNodes(){ const out=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) out.push(n); }); return out; }
    const looksLikeParcelLayer=node=>/(cadast|parcel|dcdb|lot|property)/i.test((node.title||"").toLowerCase());

    async function scanAddressLayers(lotGeom){
      const nodes=flattenFeatureNodes().filter(n=>{ try{return looksLikeAddressLayer(n);}catch{return false;} });
      const candidates=[]; const centroid=geometryEngine.centroid(lotGeom);
      for(const n of nodes){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          const res1=await n.queryFeatures({geometry:lotGeom,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],maxRecordCountFactor:3});
          for(const f of (res1.features||[])){ const addr=bestAddressFromAttrs(f.attributes); if(addr) candidates.push({addr,score:3}); }
          const res2=await n.queryFeatures({geometry:centroid,distance:30,units:"meters",spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],maxRecordCountFactor:3});
          for(const f of (res2.features||[])){ const addr=bestAddressFromAttrs(f.attributes); if(addr) candidates.push({addr,score:2}); }
        }catch{}
      }
      candidates.sort((a,b)=> (b.score-a.score) || ((/\d/.test(b.addr)?1:0)-(/\d/.test(a.addr)?1:0)) || (b.addr.length-a.addr.length) );
      return candidates.length ? candidates[0].addr : null;
    }
    async function resolveBestAddress(geom,parcelFeature){
      let addr = parcelFeature ? parseAddress(parcelFeature.attributes||{}) : null;
      const weak = !addr || addr.trim().length<=4 || /^[A-Z]{2,3}$/i.test(addr?.trim()||"");
      if(weak){ try{ const fromLayers=await scanAddressLayers(geom); if(fromLayers) addr=fromLayers; }catch{} }
      if(!addr || addr.trim().length<=4){ try{ const cen=geometryEngine.centroid(geom); const rev=await reverseGeocodeAddress(cen); if(rev) addr=rev; }catch{} }
      return addr || "Address unavailable";
    }

    async function findParcelAtPoint(point){
      const all=flattenFeatureNodes().filter(n=>n.geometryType==="polygon");
      const pref=[],rest=[]; for(const n of all){ try{ await n.load(); }catch{} (looksLikeParcelLayer(n)?pref:rest).push(n); }
      const layers=[...pref,...rest];
      const collect=async(opts)=>{ const out=[]; for(const L of layers){ try{ const r=await L.queryFeatures({...opts,returnGeometry:true,outFields:["*"],maxRecordCountFactor:2}); (r.features||[]).forEach(f=>out.push({layer:L,feature:f})); }catch{} } return out; };
      let cand=await collect({geometry:point,spatialRelationship:"intersects"});
      let contains=cand.filter(({feature})=>{ try{ return geometryEngine.contains(feature.geometry,point); }catch{ return false; } });
      if(contains.length){
        let best=contains[0], bestD=Infinity;
        for(const c of contains){ let d=Infinity; try{ const cen=geometryEngine.centroid(c.feature.geometry); d=geometryEngine.distance(point,cen)||Infinity; }catch{} if(d<bestD){ best=c; bestD=d; } }
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

    let lastParcelInfo={feature:null,lotText:"--",areaText:`-- ${M2}`,classText:"--",addressText:"--",councilText:"Toowoomba City Council"};

    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || `-- ${M2}`);
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Toowoomba City Council");
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
      const address=parseAddress(attrs) || "--";
      const council=parseCouncil(attrs) || "Toowoomba City Council";
      return { lotText:lotplan||"--", areaText:area!=null?(Math.round(area).toLocaleString()+" "+M2):`-- ${M2}`, classText:cls, addressText:address, councilText:council };
    }
    function updateBadgesFromFeature(feat){
      const info=parcelInfoFromFeature(feat);
      const lb=$("lotBadge"), ab=$("areaBadge"), cb=$("classBadge");
      if(lb) lb.textContent="Lot: "+info.lotText;
      if(ab) ab.textContent="Area: "+info.areaText;
      if(cb) cb.textContent="Class: "+info.classText;
      lastParcelInfo={feature:feat,...info};
      updateSummaryPanel();
    }

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
      const ul=$("sumOverlays");
      if(!ul) return;
      ul.innerHTML="<li><i>Scanning???</i></li>";
      sideOverlayIndex.clear();
      let itemIdx=0;
      const items=[];
      const nodes=flattenFeatureNodes().filter(n=>!keepLegacyBushfireHidden(n) && !underDNTChain(n));
      for(const n of nodes){
        try{
          if(isSppBushfireLayer(n)) continue;
          await n.load();
          const cnt=await countFeatures(n,geom);
          if(cnt>0){
            const t=n.title||"Layer";
            const safeTitle=(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
            const key = `ov-${itemIdx++}`;
            sideOverlayIndex.set(key, n);
            const isVisible = isNodeVisible(n);
            const toggleHTML = `<button type="button" class="ov-toggle" data-ov-key="${key}" aria-pressed="${isVisible}" title="${isVisible ? "Hide overlay" : "Show overlay"}">${isVisible ? "Hide" : "Show"}</button>`;
            items.push(`<li><div class="ov-title">${safeTitle} <span style="color:#777">(${cnt})</span>${toggleHTML}</div></li>`);
            if(items.length>=12) break;
          }
        }catch{}
      }
      ul.innerHTML = items.length ? items.join("") : "<li><i>No visible overlays intersect.</i></li>";
    }

    view.on("click", async ev=>{
      try{
        showLoading(true);
        const parcel=await findParcelAtPoint(ev.mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        updateBadgesFromFeature(parcel);
        outlineSelection(parcel.geometry);
        await hideUnusedOverlaysFor(parcel.geometry);
        try{
          const addr=await resolveBestAddress(parcel.geometry, parcel);
          lastParcelInfo.addressText=addr||lastParcelInfo.addressText;
          updateSummaryPanel();
        }catch{}
        updateSideOverlaySummary(parcel.geometry);
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

    /* ---------------- Build report ---------------- */
    let lastReportHTML=null, lastReportTitle="Property Report";

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
        setRpt("Locating parcel...", 12);
        let geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Toowoomba City Council";
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
        }

        setRpt("Rendering base map...", 42);
        const baseShot = geom
          ? await withViewOnGeom(geom, async()=>{ try{selLayer.visible=true;}catch{}; await setScreenshotPropertyBoundary(geom,{keepLabels:true}); await waitViewIdle(200); try{ return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}); } finally { clearScreenshotPropertyBoundary(); } })
          : await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});

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
          ["Bushfire", async()=>{ await addMandatorySection(shots,"Bushfire",collectAllBushfireDisplayNodes,geom,baseShot,"No bushfire Lv"); }],
          ["Utilities", async()=>{ const all=collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=> isUtility(t,id,tg)||isWaterOrSewer(p),{includeDNT:true}); if(all.length){ const s=await screenshotFor(all,"Utilities",geom,false,{forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); } }],
          ["Acid overlays", async()=>{ if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); }}],
          ["Transport", async()=>{ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); }}],
          ["Air quality", async()=>{ if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); }}],
          ["Transport Noise Corridor", async()=>{ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,baseShot,"No noise Lv"); }],
          ["Other overlays", async()=>{ for (const n of cats.others) { const s = await screenshotFor([n], n.title || "Overlay", geom); if (s) shots.push(s); } }]
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

        html.push("<div class='card rpt-footer'><img src='",logoSrc,"' alt='Logo' style='width:18px;height:18px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/> Toowoomba City Council - CornerstonePlus. Indicative only.</div>");
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
