// Extracted from GRC.html. Keep this file as the independent page brain for GRC.
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
    const GYMPIE=[152.66363221637457,-26.186778270850905]; // Gympie center
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
      "gisservices.information.qld.gov.au",
      "spatial-gis.information.qld.gov.au",
      "gis.brisbane.qld.gov.au",
      "maps.moretonbay.qld.gov.au"
    ];
    addCorsHosts(esriConfig, CORS_HOSTS);

    /* ---------------- Small helpers ---------------- */
    const waitViewIdle=async(extra=240)=>{try{await reactiveUtils.whenOnce(()=>!view.updating);}catch{} await raf(); await sleep(extra);};

    /* ---------------- Payment access gate ---------------- */
    const accessState = {
      key: null,
      expiresAt: null,
      active: false,
      paymentUrl: null
    };
    const PAYMENT_FALLBACK_URL = "https://buy.stripe.com/28EaEX5Ma2cpdlV6oh7ss0L";

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
        const returnPath = "GRC.html";
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

    let lastParcelInfo={feature:null,lotText:"--",areaText:"-- "+M2,classText:"--",addressText:"--",councilText:"Gympie Regional Council"};

    function updateSummaryPanel(){
      setText("sumLot", lastParcelInfo.lotText || "--");
      setText("sumArea", lastParcelInfo.areaText || ("-- "+M2));
      setText("sumClass", lastParcelInfo.classText || "--");
      setText("sumAddress", lastParcelInfo.addressText || "--");
      setText("sumCouncil", lastParcelInfo.councilText || "Gympie Regional Council");
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
      const council=parseCouncil(attrs) || "Gympie Regional Council";
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
        setRpt("Locating parcel…", 12);
        let geom=null, lotText="--", areaText="-- "+M2, classText="--", addressText="--", councilText="Gympie Regional Council";
        if(lastParcelInfo.feature){
          geom=lastParcelInfo.feature.geometry; ({lotText,areaText,classText,addressText,councilText}=lastParcelInfo);
        }else{
          const probe=await findParcelAtPoint(view.center);
          if(probe){ const info=parcelInfoFromFeature(probe); geom=probe.geometry; ({lotText,areaText,classText,addressText,councilText}=info); lastParcelInfo={feature:probe,...info}; }
        }
        setRpt("Parcel located", 18, "rptS1");

        if(geom){
          setRpt("Resolving address…", 25);
          try{ addressText=await resolveBestAddress(geom,lastParcelInfo.feature); }catch{}
          setRpt("Address resolved", 35, "rptS2");
          lastParcelInfo.addressText = addressText || lastParcelInfo.addressText;
        }

        setRpt("Rendering base map…", 42);
        const baseShot = geom
          ? await withViewOnGeom(geom, async()=>{ try{selLayer.visible=true;}catch{}; await setScreenshotPropertyBoundary(geom,{keepLabels:true}); await waitViewIdle(200); try{ return await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height}); } finally { clearScreenshotPropertyBoundary(); } })
          : await takeReportScreenshot({format:"png",quality:95,width:SHOT_SIZE.width,height:SHOT_SIZE.height});

        setRpt("Collecting overlays…", 55);
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
          ["Other overlays", async()=>{
            for (const n of cats.others) {
              const t = n.title || "", p = nodePath(n);
              if (isBushfire(t,p) || isNoise(t,p)) continue;
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
        const logoSrc="./images/lot-wise-icon.png";

        var toFileSafe = function (s) {
          return String(s)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        };
        var baseName = (addressText && addressText !== "--")
          ? addressText
          : ((lotText && lotText !== "--") ? ("Lot " + lotText) : "Property");
        var reportDisplayTitle = baseName + " - Property Report";
        var reportFileTitle    = toFileSafe(reportDisplayTitle);

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
                      "<div class='rpt-footer'>Generated by Lot Wise. Confirm against the current planning scheme and authoritative datasets before relying on this report.</div>",
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

        html.push("<div class='card rpt-footer'><img src='",logoSrc,"' alt='Lot Wise' style='width:18px;height:18px;vertical-align:-3px;border-radius:3px;border:1px solid #ddd;background:#fff;margin-right:6px'/> Gympie Regional Council - Lot Wise. Indicative only.</div>");
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

    (function wireReportViewer(){
      const closeBtn = $("closeReportBtn");
      if(closeBtn){
        closeBtn.addEventListener("click", ()=>{
          setReportViewerVisible(false);
          setReportFrameHTML("");
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

    search.on("select-result", async (e)=>{
      try{
        const feat = e.result && e.result.feature;
        if(feat && feat.geometry && feat.geometry.type==="polygon"){
          updateBadgesFromFeature(feat);
          outlineSelection(feat.geometry);
          await hideUnusedOverlaysFor(feat.geometry);
          try{
            const addr=await resolveBestAddress(feat.geometry, feat);
            lastParcelInfo.addressText=addr||lastParcelInfo.addressText;
            updateSummaryPanel();
          }catch{}
          updateSideOverlaySummary(feat.geometry);
        }
      }catch(err){ console.warn("select-result handler:", err); }
    });
