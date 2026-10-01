// Extracted from FCRC.html. Keep this file as the independent page brain for FCRC.
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
  isNativeParcelReferenceLayer,
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
    /* ---------------- ArcGIS imports ---------------- */
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

    /* ---------------- Tunables ---------------- */
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
    const FRASER_COAST=[152.77885252977663,-25.32005023546931];
    const INITIAL_SCALE=72223.819286;
    const M2="m²";

    // “3 houses out”
    const HOUSES_OUT = 3;
    const HOUSE_LOT_METERS = 25;
    const SCREEN_BUFFER_METERS = HOUSES_OUT * HOUSE_LOT_METERS;
    const SHOT_SIZE = { width: 1280, height: 900 };

    /* ---- CORS allow-list for address queries ---- */
    const CORS_HOSTS = [
      "www.arcgis.com",
      "services.arcgis.com",
      "geocode.arcgis.com",
      "gisservices.information.qld.gov.au",
      "gis.brisbane.qld.gov.au",
      "maps.moretonbay.qld.gov.au"
      // If Fraser Coast hosts any API endpoints, add them here as needed.
    ];
    addCorsHosts(esriConfig, CORS_HOSTS);

    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async(extra=240)=>{try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{} await raf(); await sleep(extra);};
    async function withViewOnGeom(geom,fn){
      const vp=view.viewpoint?.clone?.();
      try{
        await applyReportMapScale(view,geom,waitViewIdle);
        return await fn();
      } finally {
        if(vp){ try{ await view.goTo(vp,{animate:false}); await waitViewIdle(160); }catch{} }
      }
    }

    /* ---------------- Access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null
    };

    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/dRmaEX8Ym2cpepZ4g97ss0J";


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
        const returnPath = "FCRC.html";
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

    const centroidOf = geom=>{
      try{
        if(geom?.centroid) return geom.centroid;
        if(geom?.extent?.center) return geom.extent.center;
      }catch{}
      return null;
    };

    /* ---------------- Map & rules ---------------- */
    const portal=new Portal({url:"https://www.arcgis.com"});
    // Cornerstone's public Fraser Coast planning/overlay web map.
    const FCRC_WEBMAP_ID="481d05e2c29044c09d70352961f769ed";
    let webmap=new WebMap({portalItem:{id:FCRC_WEBMAP_ID,portal}});
    const FCRC_PARCEL_SERVICE_URL="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/QSCF_LandParcelPropertyFramework/MapServer";
    const fcrcPropertyBoundaryLayer=new FeatureLayer({
      id:"fcrc-single-property-boundaries",
      url:`${FCRC_PARCEL_SERVICE_URL}/120`,
      title:"QSCF lot parcels",
      listMode:"hide",
      visible:true,
      outFields:["*"],
      popupEnabled:false
    });
    const fcrcNaturalBoundaryLayer=new FeatureLayer({
      id:"fcrc-cadastral-natural-boundaries",
      url:`${FCRC_PARCEL_SERVICE_URL}/105`,
      title:"QSCF cadastral water parcel boundaries",
      listMode:"hide",
      visible:true,
      outFields:["*"],
      popupEnabled:false
    });
    const fcrcParcelAddressLayer=new FeatureLayer({
      id:"fcrc-parcel-address-numbers",
      url:`${FCRC_PARCEL_SERVICE_URL}/0`,
      title:"Lot numbers and addresses",
      listMode:"hide",
      visible:true,
      labelsVisible:true,
      outFields:["*"],
      popupEnabled:false
    });
    const selLayer=new GraphicsLayer({listMode:"hide"});
    webmap.addMany([fcrcPropertyBoundaryLayer,fcrcNaturalBoundaryLayer,fcrcParcelAddressLayer,selLayer]);

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
    const sppBushfireLayer=new FeatureLayer({
      url:SPP_BUSHFIRE_LAYER_URL,
      title:"Bushfire - State SPP",
      listMode:"show",
      visible:false,
      opacity:0,
      minScale:0,
      maxScale:0,
      outFields:["OBJECTID","CLASS"],
      objectIdField:"OBJECTID",
      geometryType:"polygon",
      spatialReference:{wkid:102100},
      popupEnabled:false,
      renderer:sppBushfireRenderer
    });
    const sppBushfireDrawLayer=new GraphicsLayer({listMode:"hide",visible:false});
    webmap.addMany([sppBushfireLayer,sppBushfireDrawLayer]);

    const view=new MapView({
      container:"viewDiv",
      map:webmap,
      center:FRASER_COAST,
      scale:INITIAL_SCALE,
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
      sppBushfireRefreshTimer=setTimeout(()=>refreshSppBushfireGraphics(),delay);
    }
    async function refreshSppBushfireGraphics(){
      const run=++sppBushfireRefreshRun;
      try{
        const on=!!sppBushfireLayer.visible;
        sppBushfireDrawLayer.visible=on;
        if(!on){ sppBushfireDrawLayer.removeAll(); return; }
        await sppBushfireLayer.when();
        if(!view.extent) return;
        const q=sppBushfireLayer.createQuery();
        q.geometry=view.extent.clone?.() || view.extent;
        q.spatialRelationship="intersects";
        q.returnGeometry=true;
        q.outFields=["CLASS"];
        q.outSpatialReference=view.spatialReference;
        q.num=1800;
        const res=await sppBushfireLayer.queryFeatures(q);
        if(run!==sppBushfireRefreshRun) return;
        sppBushfireDrawLayer.removeAll();
        (res.features||[]).forEach(feature=>{
          sppBushfireDrawLayer.add(new Graphic({
            geometry:feature.geometry,
            attributes:feature.attributes,
            symbol:sppBushfireGraphicSymbol(feature.attributes?.CLASS)
          }));
        });
      }catch(error){
        console.warn("SPP bushfire graphics failed",error);
      }
    }
    sppBushfireLayer.watch("visible",on=>{
      if(on) scheduleSppBushfireRefresh(0);
      else{ sppBushfireDrawLayer.visible=false; sppBushfireDrawLayer.removeAll(); }
    });
    view.watch("stationary",stationary=>{
      if(stationary && sppBushfireLayer.visible) scheduleSppBushfireRefresh(180);
    });

    const inText=(title,path="")=>`${String(title||"")} ${String(path||"")}`;
    const isDNT=(title,id="",tags=[])=>{
      const hay=`${String(title||"")} ${String(id||"")} ${(tags||[]).join(" ")}`;
      return /do[\s-]*not[\s-]*touch/i.test(hay);
    };
    const isUtility=(title,id="",tags=[])=>/\b(utilit(y|ies)|power|electric|telecom|gas|water|sewer|storm[-\s]?water|reticulation|service)\b/i.test(`${inText(title,id)} ${(tags||[]).join(" ")}`);
    const isWaterOrSewer=path=>/\b(water|sewer|storm[\s-]*water|drainage|watercourse)\b/i.test(String(path||""));
    const isAcid=(title,path="")=>/\bacid\b/i.test(inText(title,path));
    const isTransport=(title,path="")=>/\b(transport|road|rail|corridor|traffic|cycle|bikeway|pedestrian|carpark|parking|transit|bus|ferry)\b/i.test(inText(title,path));
    const isAir=(title,path="")=>/\b(air\s*quality|air-quality|air|pollution)\b/i.test(inText(title,path));
    const isNoise=(title,path="")=>/\b(noise|acoustic|transport.*noise.*corridor|tnc)\b/i.test(inText(title,path));
    const isZoning=(title,path="")=>/\b(zoning|zone|zones)\b/i.test(inText(title,path));
    const isBushfire=(title,path="")=>/\b(bush[-\s]?fire|bushfire|bush\s*fire|wild[-\s]?fire|fire\s*hazard)\b/i.test(inText(title,path));
    const kidsOf=node=>(node.layers?.toArray?.()??node.layers)||(node.sublayers?.toArray?.()??node.sublayers)||[];
    const nodePath=node=>{
      const parts=[];
      let current=node;
      while(current){ parts.unshift(current.title||current.id||"node"); current=current.parent; }
      return parts.join(" / ");
    };
    function walkAny(node,callback,inheritedDNT=false){
      if(!node) return;
      const underDNT=inheritedDNT || isDNT(node.title||node.id||"",node.id||"",node.portalItem?.tags||[]);
      callback(node,underDNT);
      (kidsOf(node)||[]).forEach(child=>walkAny(child,callback,underDNT));
    }

    const utilityVisSnapshot=new Map();
    let utilitiesToggleState=false;
    let utilToggleBtn=null;
    function getUtilityNodes(){
      const nodes=[];
      walkAny(view.map,(node,underDNT)=>{
        if(underDNT || !("visible" in node)) return;
        if(isUtility(node.title||"",node.id||"",node.portalItem?.tags||[]) || isWaterOrSewer(nodePath(node))) nodes.push(node);
      });
      return nodes;
    }
    function updateUtilityToggleLabel(){
      const btn=utilToggleBtn||document.getElementById("btnUtilityToggleMap");
      if(!btn) return;
      btn.setAttribute("title",utilitiesToggleState?"Hide utilities":"Show utilities");
      btn.setAttribute("aria-pressed",String(utilitiesToggleState));
      btn.classList.toggle("active",utilitiesToggleState);
    }
    function setUtilitiesVisible(on){
      const nodes=getUtilityNodes();
      if(on){
        utilityVisSnapshot.clear();
        nodes.forEach(node=>{
          utilityVisSnapshot.set(node,!!node.visible);
          node.visible=true;
          node.listMode="show";
          let parent=node.parent;
          while(parent){ if("visible" in parent) parent.visible=true; parent=parent.parent; }
        });
      }else{
        nodes.forEach(node=>{ node.visible=utilityVisSnapshot.get(node)??false; });
      }
      utilitiesToggleState=on;
      updateUtilityToggleLabel();
      try{ layerList.refresh(); }catch{}
    }
    function isPropertyBoundaryLayer(node){
      if(!node) return false;
      const tags=node.portalItem?.tags || node.tags || [];
      const hay=[node.title,node.id,node.url,node.portalItem?.url,Array.isArray(tags)?tags.join(" "):tags,nodePath(node)].join(" ").toLowerCase();
      return /\b(property[\s_-]*boundar(?:y|ies)|parcel[\s_-]*boundar(?:y|ies)|boundaries[\s_-]*[-\s]*parcel|land[\s_-]*parcel[\s_-]*property[\s_-]*framework|dcdb|cadast|cadastral|property_boundaries_(?:parcel|holding))\b/i.test(hay);
    }
    function isFcrcStandaloneParcelInfoLayer(node){
      return /^(?:fcrc-single-property-boundaries|fcrc-cadastral-natural-boundaries|fcrc-parcel-address-numbers)$/.test(String(node?.id||""));
    }
    function isFcrcNativeParcelBoundaryLayer(node){
      if(isFcrcStandaloneParcelInfoLayer(node)) return false;
      let current=node;
      while(current){
        const title=String(current?.title||current?.name||"").trim();
        const ownText=`${title} ${current?.url||""}`;
        if(/land\s*parcel\s*property\s*framework/i.test(ownText)
          || /LandParcelPropertyFramework/i.test(ownText)
          || /^(?:land\s+parcels|cadastral\s+natural\s+boundaries|cadastral\s+parcels)$/i.test(title)) return true;
        current=current.parent;
      }
      return false;
    }
    function hideFcrcNativeParcelBoundaryLayer(node){
      if(!isFcrcNativeParcelBoundaryLayer(node)) return false;
      if("visible" in node){ try{ node.visible=false; }catch{} }
      if("labelsVisible" in node){ try{ node.labelsVisible=false; }catch{} }
      if("listMode" in node){ try{ node.listMode="hide"; }catch{} }
      if(node?.type==="sublayer"){
        try{ node.updateFromJSON({visible:false}); }catch{}
      }
      return true;
    }
    function suppressFcrcNativeParcelBoundaries(root=view?.map){
      walkAny(root,node=>{ hideFcrcNativeParcelBoundaryLayer(node); });
    }
    function keepPropertyBoundaryVisible(node){
      if(hideFcrcNativeParcelBoundaryLayer(node)) return true;
      if(!isPropertyBoundaryLayer(node) && !isFcrcStandaloneParcelInfoLayer(node)) return false;
      if("visible" in node) node.visible=true;
      if("labelsVisible" in node) node.labelsVisible=true;
      if("listMode" in node) node.listMode="hide";
      try{ node.minScale=0; node.maxScale=0; }catch{}
      let parent=node.parent;
      while(parent){ if("visible" in parent) parent.visible=true; parent=parent.parent; }
      return true;
    }
    function keepOnHidden(node){
      if(hideFcrcNativeParcelBoundaryLayer(node)) return;
      if(keepLegacyBushfireHidden(node)) return;
      if("visible" in node) node.visible=true;
      if("listMode" in node) node.listMode="hide";
      let parent=node.parent;
      while(parent){ if("visible" in parent) parent.visible=true; parent=parent.parent; }
    }
    function startHidden(node){
      if(keepLegacyBushfireHidden(node) || isSppBushfireLayer(node) || keepPropertyBoundaryVisible(node)) return;
      if("visible" in node) node.visible=false;
      if("listMode" in node) node.listMode="show";
    }
    function enforceOverlayRules(){
      walkAny(webmap,(node,underDNT)=>{
        if(node.type==="graphics"){ try{ node.listMode="hide"; }catch{} return; }
        if(!("visible" in node)) return;
        if(underDNT) keepOnHidden(node); else startHidden(node);
      });
      suppressFcrcNativeParcelBoundaries(webmap);
    }
    async function initialiseWebMap(){
      showLoading(true);
      try{
        await webmap.load();
        ensureQueenslandFfdiLayer(webmap,FeatureLayer,esriConfig);
        ensureSppBushfireLayer();
        enforceOverlayRules();
        try{ await view.when(); }catch{}
      }catch(error){
        console.warn("Fraser Coast web map failed to load; using fallback basemap",error);
        webmap=new WebMap({basemap:"streets-vector"});
        webmap.addMany([fcrcPropertyBoundaryLayer,fcrcNaturalBoundaryLayer,fcrcParcelAddressLayer,selLayer,sppBushfireLayer,sppBushfireDrawLayer]);
        ensureQueenslandFfdiLayer(webmap,FeatureLayer,esriConfig);
        view.map=webmap;
      }finally{
        showLoading(false);
      }
    }
    const mapStartupReady=initialiseWebMap();
    [300,900,1800,3500].forEach(delay=>setTimeout(()=>{
      try{ ensureSppBushfireLayer(); enforceOverlayRules(); }catch{}
    },delay));

    view.ui.add(new Home({view}),"top-left");
    view.ui.add(new ScaleBar({view,unit:"metric"}),"bottom-left");
    const layerList=new LayerList({view,listItemCreatedFunction(event){
      const item=event.item;
      const node=item.sublayer||item.layer;
      if(!node) return;
      if(keepLegacyBushfireHidden(node)){ item.visible=false; item.panel=null; return; }
      if(node.type==="graphics"){ item.visible=false; item.panel=null; try{ node.listMode="hide"; }catch{} return; }
      let current=node;
      let underDNT=false;
      while(current){
        if(isDNT(current.title||"",current.id||"",current.portalItem?.tags||[])){ underDNT=true; break; }
        current=current.parent;
      }
      if(underDNT || isPropertyBoundaryLayer(node)){ keepOnHidden(node); item.visible=false; item.panel=null; }
      else{ try{ node.listMode="show"; }catch{} item.panel={content:"legend"}; }
    }});
    view.ui.add(new Expand({view,content:layerList,expandIconClass:"esri-icon-layers",expanded:false}),"top-right");
    const refreshPlanningSchemeLayerList=()=>{
      try{
        organizePlanningSchemeLayers(view?.map||webmap,GroupLayer);
        layerList.refresh();
      }catch{}
    };
    [500,1500,3500,7000,12000].forEach(delay=>setTimeout(refreshPlanningSchemeLayerList,delay));
    view.when(()=>{
      utilToggleBtn=document.createElement("button");
      utilToggleBtn.id="btnUtilityToggleMap";
      utilToggleBtn.type="button";
      utilToggleBtn.className="esri-widget esri-widget--button util-toggle-btn";
      utilToggleBtn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5c-3.2 4-5.5 7.2-5.5 9.7A5.5 5.5 0 0 0 12 18.7a5.5 5.5 0 0 0 5.5-5.5c0-2.5-2.3-5.7-5.5-9.7z"></path></svg>`;
      utilToggleBtn.addEventListener("click",()=>setUtilitiesVisible(!utilitiesToggleState));
      updateUtilityToggleLabel();
      view.ui.add(utilToggleBtn,{position:"top-right",index:2});
    });
    view.ui.add(new Expand({view,content:new Legend({view}),expandIconClass:"esri-icon-legend"}),"top-right");
    view.ui.add(new Expand({view,content:new BasemapGallery({view}),expandIconClass:"esri-icon-basemap"}),"top-right");
    view.ui.add(new Fullscreen({view}),"top-right");
    const search=new Search({
      view,
      includeDefaultSources:true,
      popupEnabled:true,
      allPlaceholder:"Search address or Lot/Plan (e.g., 12/SP12345)"
    });
    view.ui.add(search,{position:"top-right",index:0});
    view.watch("extent",()=>{
      const center=view.center;
      setText("statusCoords",`Coords: ${center.longitude.toFixed(5)}, ${center.latitude.toFixed(5)}`);
      setText("statusZoom",`Zoom: ${view.zoom.toFixed(1)}`);
      setText("statusScale",`Scale: 1:${Math.round(view.scale)}`);
    });

    /* ---------------- Parcel and address helpers ---------------- */
    const parseNumberLike=raw=>{
      if(raw==null) return null;
      let text=String(raw).trim();
      if(!text) return null;
      const hectares=/(^|[^a-z])ha([^a-z]|$)/i.test(text)||/\bhectare(s)?\b/i.test(text);
      text=text.replace(/,/g,"").replace(/square\s*met(re|er)s?/ig,"").replace(/m2|m\u00B2|sqm|sq\.?m/ig,"").trim();
      let value=parseFloat(text);
      if(Number.isNaN(value)) return null;
      if(hectares) value*=10000;
      return value;
    };
    function getLotAreaSqm(attrs){
      const strong=["LOT_AREA_M2","LOT_SIZE_M2","LOT_SIZE_SQM","LOT_AREA_SQM","AREA_SQM","SITE_AREA_SQM","LAND_AREA_SQM","LOT_AREA","LOT_SIZE","SITE_AREA","LAND_AREA","AREA_M2","AREA (M2)","AREA(M2)","AREA_M^2","AREA_HA","HECTARES"];
      for(const key of strong){
        const value=key in attrs?parseNumberLike(attrs[key]):null;
        if(value!=null){
          if(value>0&&value<50&&(key==="AREA_HA"||key==="HECTARES")) return value*10000;
          return value;
        }
      }
      for(const key in attrs){
        if(/(lot|site|land).*area/i.test(key)||/area.*(sqm|m2|m\^2|square)/i.test(key)||/(lot|site).*size/i.test(key)){
          const value=parseNumberLike(attrs[key]);
          if(value) return value;
        }
      }
      return null;
    }
    const LOTPLAN_FIELDS=["LOT/PLAN","LOT_PLAN","LOT_PLAN_NO","LOTPLAN","LOTPLAN_NO","LOTPLAN_TXT","LOT_PLAN_TXT","LOT_PLAN_TEXT","LOTPLAN_TEXT"];
    function _pick(attrs,keys){
      if(!attrs) return null;
      const keyMap=Object.fromEntries(Object.keys(attrs).map(key=>[key.toLowerCase(),key]));
      for(const candidate of keys){
        const key=(candidate in attrs)?candidate:keyMap[candidate.toLowerCase()];
        if(!key) continue;
        const value=String(attrs[key]??"").trim();
        if(value && value.toUpperCase()!=="NULL") return value;
      }
      return null;
    }
    function parseParcelMeta(attrs){
      const key=rx=>Object.keys(attrs).find(name=>rx.test(name));
      const lot=attrs.LOT??attrs.LOTNO??attrs.LOT_NO??attrs.LOTNUMBER??(key(/^lot[\w_]*$/i)&&String(attrs[key(/^lot[\w_]*$/i)]));
      const plan=attrs.PLAN??attrs.PLANNO??attrs.PLAN_NO??(key(/^plan[\w_]*$/i)&&String(attrs[key(/^plan[\w_]*$/i)]));
      let lotplan=_pick(attrs,LOTPLAN_FIELDS);
      if(!lotplan && lot && plan) lotplan=`${lot}/${plan}`;
      if(!lotplan){
        for(const name in attrs){
          const match=String(attrs[name]||"").toUpperCase().match(/\b(\d+)\s*\/\s*([A-Z]{1,4}\s*\d+)\b/);
          if(match){ lotplan=`${match[1]}/${match[2].replace(/\s+/g,"")}`; break; }
        }
      }
      return {lot,plan,lotplan};
    }
    const geomAreaSqmSafe=geom=>{
      try{ const area=Math.abs(geometryEngine.planarArea(geom,"square-meters")||0); return area>0?area:null; }
      catch{ return null; }
    };
    const smartJoin=parts=>parts.filter(Boolean).join(" ").replace(/\s+/g," ").trim();
    function parseCouncil(attrs){
      const value=_pick(attrs,["COUNCIL","COUNCIL_NAME","LGA","LGA_NAME","LOCAL_GOVERNMENT_AREA","AUTHORITY","ADMIN_BODY"]);
      return value||"Fraser Coast Regional Council";
    }
    const FULL_ADDR_FIELDS=[
      "FULL_ADDRESS","ADDRESS_FULL","GNAF_FULL_ADDRESS","GNAF_ADDRESS","SITE_ADDRESS","PROPERTY_ADDRESS","PROP_ADDRESS","PRIMARY_ADDRESS",
      "ADDR_FULL","ADDR_LABEL","ADDRESS","STREET_ADDRESS","POSTAL_ADDRESS","FULLADDR","FULL_ADD","FULL_ADDRE","SITE_ADDR","SITE_ADD","PROP_ADD",
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
    function isCadastralAddressLabel(value){
      const text=String(value||"").trim();
      return /\bLOT\s*[A-Z0-9.-]+\s+(?:ON\s+)?[A-Z]{1,4}\s*\d{2,}\b/i.test(text)
        || /\b[A-Z0-9.-]+\s*\/\s*[A-Z]{1,4}\s*\d{2,}\b/i.test(text)
        || /^\s*[A-Z0-9.-]+\s*[A-Z]{1,4}\s*\d{3,}\s*$/i.test(text);
    }
    function isLikelyStreetAddress(value){
      const text=String(value||"").trim();
      if(!text || /^(?:gap|road reserve|address unavailable)$/i.test(text) || isCadastralAddressLabel(text)) return false;
      const numberAndName=/\b\d{1,5}[A-Za-z]?(?:\s*(?:-|\u2013)\s*\d{1,5}[A-Za-z]?)?\s+[A-Za-z][A-Za-z\s.'-]{2,}\b/i.test(text);
      const streetType=/\b(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Crescent|Court|Ct|Lane|Ln|Terrace|Ter|Way|Pde|Parade|Pl|Place|Blvd|Boulevard|Hwy|Highway|Cct|Circuit|Cl|Close)\b/i.test(text);
      return numberAndName && (streetType || /,\s*[A-Za-z]/.test(text));
    }
    function normalizeFullAddress(value){
      return String(value||"")
        .trim()
        .replace(/,\s*(?:AUS|Australia)\s*$/i,"")
        .replace(/\bQueensland\b/gi,"QLD")
        .replace(/,\s*(\d{4})\s*$/," $1")
        .replace(/\s{2,}/g," ");
    }
    function addressQuality(value){
      const text=normalizeFullAddress(value);
      if(!isLikelyStreetAddress(text)) return -Infinity;
      let score=10;
      if(/\bQLD\b/i.test(text)) score+=20;
      if(/\b\d{4}\b/.test(text)) score+=30;
      score+=Math.min((text.match(/,/g)||[]).length,3)*3;
      score+=Math.min(text.length,100)/100;
      return score;
    }
    function bestAddressCandidate(...values){
      return values
        .flat()
        .map(normalizeFullAddress)
        .filter(isLikelyStreetAddress)
        .sort((a,b)=>addressQuality(b)-addressQuality(a) || b.length-a.length)[0] || null;
    }
    const isFullAddress=value=>/\b(?:QLD|Queensland)\b/i.test(String(value||"")) && /\b\d{4}\b/.test(String(value||""));
    function buildAddressFromParts(attrs){
      const unit=_pick(attrs,PART_FIELDS.unit);
      const number=smartJoin([_pick(attrs,PART_FIELDS.numP),_pick(attrs,PART_FIELDS.num),_pick(attrs,PART_FIELDS.numS)]);
      const street=smartJoin([_pick(attrs,PART_FIELDS.stNm),_pick(attrs,PART_FIELDS.stTp),_pick(attrs,PART_FIELDS.stSf)]);
      const locality=smartJoin([_pick(attrs,PART_FIELDS.suburb),_pick(attrs,PART_FIELDS.state)||"QLD",_pick(attrs,PART_FIELDS.post)]);
      return smartJoin([unit?`${unit}/`:null,number,street,locality])||null;
    }
    function parseAddress(attrs){
      if(!attrs) return null;
      const full=_pick(attrs,FULL_ADDR_FIELDS);
      const built=buildAddressFromParts(attrs);
      const candidates=[full,built];
      for(const key in attrs){
        if(/address|addr|street/i.test(key)) candidates.push(attrs[key]);
      }
      return bestAddressCandidate(candidates);
    }
    function ensureSuburbInAddress(address,attrs){
      if(!isLikelyStreetAddress(address)) return address;
      const suburb=_pick(attrs||{},PART_FIELDS.suburb);
      if(!suburb) return address;
      const state=_pick(attrs||{},PART_FIELDS.state)||"QLD";
      const post=_pick(attrs||{},PART_FIELDS.post);
      const normalize=value=>String(value||"").toUpperCase().replace(/[,\s]+/g," ").trim();
      if(normalize(address).includes(normalize(suburb))) return address;
      return `${address.replace(/\s+,/g,",")}, ${suburb} ${state}${post?` ${post}`:""}`;
    }
    function looksLikeAddressLayer(node){
      const hay=`${node.title||""} ${nodePath(node)}`.toLowerCase();
      return /\b(gnaf|address|addr|property\s*address|site\s*address|street\s*address|address\s*points|locality|suburb)\b/.test(hay);
    }
    function hasAddressFields(node){
      try{ return (node.fields||[]).some(field=>/(address|addr|street|road|house|unit|locality|suburb|postcode|post_code)/i.test(field.name||"")); }
      catch{ return false; }
    }
    async function scanAddressLayers(lotGeom){
      const nodes=flattenFeatureNodes().sort((a,b)=>Number(looksLikeAddressLayer(b))-Number(looksLikeAddressLayer(a)));
      const center=centroidOf(lotGeom);
      const candidates=[];
      for(const node of nodes){
        try{
          if(isSppBushfireLayer(node)) continue;
          if(!looksLikeAddressLayer(node)) continue;
          await node.load();
          const addResults=(features,score)=>{
            (features||[]).forEach(feature=>{
              const address=parseAddress(feature.attributes);
              if(address) candidates.push({address,score});
            });
          };
          const inside=await node.queryFeatures({geometry:lotGeom,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],maxRecordCountFactor:3});
          addResults(inside.features,3);
          if(candidates.some(candidate=>candidate.score===3)) break;
          if(center){
            const nearby=await node.queryFeatures({geometry:center,distance:60,units:"meters",spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],maxRecordCountFactor:3});
            addResults(nearby.features,1);
          }
        }catch(error){ console.warn("FCRC address layer query failed",node?.title||node?.id,error); }
      }
      candidates.sort((a,b)=>(b.score-a.score)||(addressQuality(b.address)-addressQuality(a.address))||(b.address.length-a.address.length));
      return candidates[0]?.address||null;
    }
    async function resolveBestAddress(geom,parcelFeature){
      try{ return await resolveUniformReportAddress(geom,parcelFeature); }
      catch(error){ console.warn("Shared report address resolution failed; using FCRC fallback",error); }
      let address=parcelFeature?parseAddress(parcelFeature.attributes||{}):null;
      if(!isFullAddress(address)){
        try{ address=bestAddressCandidate(address,await scanAddressLayers(geom)); }catch{}
      }
      if(!isFullAddress(address)){
        try{
          const center=centroidOf(geom);
          if(center){
            const result=await locator.locationToAddress(GEOCODER_URL,{location:center});
            const choices=[result?.attributes?.Match_addr,result?.attributes?.LongLabel,result?.address,result?.attributes?.ShortLabel,result?.attributes?.Address];
            address=bestAddressCandidate(address,choices);
          }
        }catch(error){ console.warn("FCRC reverse geocode failed",error); }
      }
      if(!address) return "Address unavailable";
      address=ensureSuburbInAddress(String(address).trim(),parcelFeature?.attributes||{});
      address=normalizeFullAddress(address);
      return isLikelyStreetAddress(address)?address:"Address unavailable";
    }
    function flattenFeatureNodes(){
      const nodes=[];
      walkAny(view.map,node=>{
        if(node && (node.type==="feature"||node.type==="sublayer") && (typeof node.queryFeatures==="function"||typeof node.queryFeatureCount==="function")) nodes.push(node);
      });
      return nodes;
    }
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
      const parcelLayers=pref.filter(n=>!isQueenslandFfdiLayer(n));
      const layers=parcelLayers.length?parcelLayers:rest.filter(n=>!isQueenslandFfdiLayer(n));
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

    let lastParcelInfo={feature:null,lotText:"--",areaText:"-- "+M2,classText:"--",addressText:"--",councilText:"Fraser Coast Regional Council"};

    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || ("-- "+M2));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Fraser Coast Regional Council");
      showPropertyInfoPopup(view, lastParcelInfo);
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
      const council=parseCouncil(attrs) || "Fraser Coast Regional Council";
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
      try{ if(typeof node.queryFeatureCount==="function"){ const c=await node.queryFeatureCount({geometry:g,spatialRelationship:"intersects"}); return Number(c)||0; } }catch{}
      try{ if(typeof node.queryFeatures==="function"){ const q=await node.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:false,outFields:["*"],num:1}); return q.features?.length?1:0; } }catch{}
      return 0;
    }
    async function hideUnusedOverlaysFor(geom){
      const nodes=[]; walkAny(view.map,(n)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function")) nodes.push(n); });
      for(const n of nodes){
        const t=n.title||n.id||"", id=n.id||"", tg=n.portalItem?.tags||[];
        if(keepPropertyBoundaryVisible(n)) continue;
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
      const nodes = flattenFeatureNodes().filter(n => !keepLegacyBushfireHidden(n) && !underDNTChain(n) && !isPropertyBoundaryLayer(n) && !isFcrcStandaloneParcelInfoLayer(n));

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

    async function selectParcelAtPoint(mapPoint,{searchResult=null}={}){
      try{
        showLoading(true);
        const searchedFeature=searchResult?.feature;
        const parcel=searchedFeature?.geometry?.type==="polygon" ? searchedFeature : await findParcelAtPoint(mapPoint);
        if(!parcel){ selLayer.removeAll(); return; }
        updateBadgesFromFeature(parcel);
        outlineSelection(parcel.geometry);
        await hideUnusedOverlaysFor(parcel.geometry);

        try{
          const addr=await resolveBestAddress(parcel.geometry, parcel);
          lastParcelInfo.addressText=addr||lastParcelInfo.addressText;
          updateSummaryPanel();
        }catch(error){ console.warn("FCRC parcel address resolution failed",error); }

        updateSideOverlaySummary(parcel.geometry);
      } finally { showLoading(false); }
    }
    view.on("click", async ev=>{
      await selectParcelAtPoint(ev.mapPoint);
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
    async function legendFromRendererUsingFeatures(layerNode,lotGeom,{exact=false,features=null}={}){
      const gt=(layerNode.geometryType||"").toLowerCase();
      const isZone=isZoning(layerNode.title||"",nodePath(layerNode));
      const g=(!exact && (gt==="point"||gt==="multipoint"||gt==="polyline")) ? geometryEngine.buffer(lotGeom,TOUCH_BUFFER_M,"meters") : lotGeom;

      let feats=Array.isArray(features)?features:[];
      if(!Array.isArray(features)){
        try{
          if(exact) feats=(await queryStrictOverlayFeatureHits(layerNode,lotGeom)).features;
          else{
            const q=await layerNode.queryFeatures({geometry:g,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCountFactor:6});
            feats=q.features||[];
          }
        }catch{}
      }
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
        if(!has){
          const planningGroup=organizePlanningSchemeLayers(map,GroupLayer);
          (planningGroup||map).add(sppBushfireLayer);
        }
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
      const map=(typeof view!=="undefined" && view?.map) || (typeof webmap!=="undefined" ? webmap : null);
      return [ensureQueenslandFfdiLayer(map,FeatureLayer,esriConfig)].filter(Boolean);
    }
    [300,1200,3500].forEach(delay=>setTimeout(()=>{ try{ collectAllFFDIDisplayNodes(); }catch{} },delay));
    function collectAllNoiseDisplayNodes(){
      return collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=>{
        const hay=strHay(n);
        return HARDWIRED.noise.some(rx=>rx.test(hay)) || isNoise(t,p);
      },{includeDNT:true});
    }

    async function prepareFcrcNativeParcelReferences(){
      const active=await prepareNativeParcelReferences(view,waitViewIdle);
      suppressFcrcNativeParcelBoundaries(view.map);
      await waitViewIdle(60);
      return active.filter(node=>!isFcrcNativeParcelBoundaryLayer(node));
    }

    /* ---------------- Screenshot plumbing ---------------- */
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
      await prepareFcrcNativeParcelReferences();
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

    async function screenshotFor(nodes,title,lotGeom,legendOnLot=false,{forceAllVisible=false,legendUseExtent=false,legendAllRendererItems=false,legendIncludeHiddenNodes=false,legendStrictLotIntersection=false}={}){
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
            if(!isNativeParcelReferenceLayer(n)){ try{ n.visible=false; }catch{} }
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
          if(targets.some(isSppBushfireLayer)) await refreshSppBushfireGraphics();
          await awaitRenderFor(targets);
          await waitViewIdle(80);

          const shot=await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});

          let legendGeom=lotGeom;


          if(legendUseExtent && view?.extent){ legendGeom=view.extent; }


          else if(!legendOnLot){ try{ const onScr=geometryEngine.intersect(lotGeom,view.extent); if(onScr) legendGeom=onScr; }catch{} }

          const legendParts=[];
          for(const n of targets){
            if(underDNTChain(n) && !legendAllRendererItems && !legendIncludeHiddenNodes) continue;
            if(typeof n.queryFeatures!=="function" && typeof n.queryFeatureCount!=="function") continue;
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

    function setRpt(msg,pct,doneStepId){
      const bar=$("rptBar"), m=$("rptMsg");
      if(m && msg!=null) m.textContent=msg;
      if(bar && pct!=null) bar.style.width=Math.max(0,Math.min(100,pct))+"%";
      if(doneStepId){ const step=$(doneStepId); if(step) step.classList.add("rptDone"); }
    }

    async function addMandatorySection(shots, title, collectorFn, geom, baseShot, emptyNote){
      try{
        const {nodes,captureOptions} = await prepareMandatoryOverlayReportSection(view.map,title,collectorFn);
        if(nodes.length){
          const s = await screenshotFor(nodes, title, geom, false, captureOptions);
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
          setRpt("Report ready", 100, "rptS4");
          const msg=$("rptReadyMsg"); if(msg) msg.textContent="Report ready";
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
        setRpt("Locating parcel...", 12);
        let geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Fraser Coast Regional Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry; ({lotText,areaText,classText,addressText,councilText}=lastParcelInfo);
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){ const info=parcelInfoFromFeature(probe); geom=probe.geometry; ({lotText,areaText,classText,addressText,councilText}=info); lastParcelInfo={feature:probe,...info}; }
        }
        setRpt("Parcel located", 18, "rptS1");

        if(geom){
          setRpt("Resolving address...", 25);
          try{ addressText=await resolveBestAddress(geom,lastParcelInfo.feature); }
          catch(error){ console.warn("FCRC report address resolution failed",error); }
          setRpt("Address resolved", 35, "rptS2");
          lastParcelInfo.addressText = addressText || lastParcelInfo.addressText;
        }

        setRpt("Rendering base map...", 42);
        const baseShot = await withSatelliteBasemap(view, async()=>geom
          ? await withViewOnGeom(geom, async()=>{ try{selLayer.visible=true;}catch{}; await waitViewIdle(200); return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}); })
          : await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}));
        let overlayBaseShot=baseShot;
        try{
          await view.map?.basemap?.load?.();
          await waitViewIdle(300);
          overlayBaseShot=geom
            ? (await screenshotFor([selLayer],"Overlay base",geom,false,{forceAllVisible:true}) || baseShot)
            : await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});
        }catch(error){ console.warn("FCRC overlay base screenshot failed",error); }

        setRpt("Collecting overlays...", 55);
        const cats = geom ? await (async()=>{
          const out={zoning:[],utilities:[],acid:[],transport:[],air:[],noise:[],bushfire:[],others:[]};
          const arr=[]; walkAny(view.map,(n,underDNT)=>{ if(n && (n.type==="feature"||n.type==="sublayer") && (typeof n.queryFeatures==="function" || typeof n.queryFeatureCount==="function") && !underDNT && !isPropertyBoundaryLayer(n) && !isFcrcStandaloneParcelInfoLayer(n)) arr.push(n); });
          for(const n of arr){
            try{
              if(isQueenslandFfdiLayer(n)) continue;
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
          ["Bushfire", async()=>{ await addMandatorySection(shots,"Bushfire",collectAllBushfireDisplayNodes,geom,overlayBaseShot,"No bushfire Level"); }],
          ["FFDI", async()=>{ await addMandatorySection(shots,"FFDI",collectAllFFDIDisplayNodes,geom,overlayBaseShot,"No FFDI layer"); }],
          ["Utilities", async()=>{ const all=collectLeafDisplayNodesByPredicate((n,t,p,id,tg)=> isUtility(t,id,tg)||isWaterOrSewer(p),{includeDNT:true}); if(all.length){ const s=await screenshotFor(all,"Utilities",geom,false,{forceAllVisible:true,legendUseExtent:true,legendAllRendererItems:true}); if(s) shots.push(s); } }],
          ["Acid overlays", async()=>{ if(cats.acid.length){ const s=await screenshotFor(cats.acid,"Acid overlays",geom); if(s) shots.push(s); }}],
          ["Transport", async()=>{ if(cats.transport.length){ const s=await screenshotFor(cats.transport,"Transport",geom); if(s) shots.push(s); }}],
          ["Air quality", async()=>{ if(cats.air.length){ const s=await screenshotFor(cats.air,"Air quality",geom); if(s) shots.push(s); }}],
          ["Transport Noise Corridor", async()=>{ await addMandatorySection(shots,"Transport Noise Corridor",collectAllNoiseDisplayNodes,geom,overlayBaseShot,"No Transport Noise Level"); }],
          ["Other overlays", async()=>{ for (const n of cats.others) { const s = await screenshotFor([n], n.title || "Overlay", geom); if (s) shots.push(s); } }]
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
    $("btnHome").addEventListener("click",event=>{
      event.preventDefault();
      window.location.assign(new URL("Index.html",window.location.href).href);
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

    wireSearchResultSelection(search, selectParcelAtPoint);
