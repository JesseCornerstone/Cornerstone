const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  global.document = {
    getElementById: () => null,
    visibilityState: 'visible'
  };
  global.window = {};
  global.requestAnimationFrame = callback => callback();

  const hubPath = path.join(rootDir, 'public', 'Js', 'council-hub.js');
  const hubSource = fs.readFileSync(hubPath, 'utf8');
  const hub = await import(`data:text/javascript;base64,${Buffer.from(hubSource).toString('base64')}`);

  assert.doesNotMatch(hubSource, /ensureQueenslandFfdiLayer|Forest Fire Danger Index \(FFDI 5% AEP\)/);

  const legacyFfdiLayer = {
    title: 'Forest Fire Danger Index',
    visible: true,
    listMode: 'show'
  };
  const ordinaryOverlay = { title: 'Ordinary Overlay', visible: true, listMode: 'show' };
  const planningGroup = {
    type: 'group',
    title: 'Planning Scheme',
    layers: [],
    add(layer) { this.layers.push(layer); }
  };
  const organizedMap = {
    layers: [legacyFfdiLayer, planningGroup, ordinaryOverlay],
    remove(layer) { this.layers = this.layers.filter(candidate => candidate !== layer); },
    add(layer) { this.layers.push(layer); }
  };
  hub.organizePlanningSchemeLayers(organizedMap, function GroupLayer() {});
  assert.equal(legacyFfdiLayer.visible, false);
  assert.equal(legacyFfdiLayer.listMode, 'hide');
  assert.ok(!organizedMap.layers.includes(legacyFfdiLayer), 'Legacy FFDI layers must stay out of the site layer list.');

  class MockFeatureLayer {
    constructor(options) {
      Object.assign(this, options);
      this.type = 'feature';
    }
  }
  const stateBushfireMap = {
    layers: [],
    add(layer) { this.layers.push(layer); }
  };
  const stateBushfireLayer = hub.ensureQueenslandStateBushfireLayer(stateBushfireMap, MockFeatureLayer);
  assert.equal(
    hub.QUEENSLAND_STATE_BUSHFIRE_LAYER_URL,
    'https://services1.arcgis.com/vkTwD8kHw2woKBqV/arcgis/rest/services/WOS_PIB/FeatureServer/0'
  );
  assert.equal(stateBushfireLayer.title, 'Bushfire - Queensland State Mapping');
  assert.match(stateBushfireLayer.url, /WOS_PIB\/FeatureServer\/0$/);
  assert.equal(stateBushfireLayer.opacity, 0.62);
  assert.equal(hub.ensureQueenslandStateBushfireLayer(stateBushfireMap, MockFeatureLayer), stateBushfireLayer);
  assert.equal(stateBushfireMap.layers.length, 1);
  const stateLayerPlanningGroup = {
    type: 'group',
    title: 'Planning Scheme',
    layers: [],
    add(layer) { this.layers.push(layer); }
  };
  const stateLayerListMap = {
    layers: [stateBushfireLayer, stateLayerPlanningGroup],
    remove(layer) { this.layers = this.layers.filter(candidate => candidate !== layer); },
    add(layer) { this.layers.push(layer); }
  };
  hub.organizePlanningSchemeLayers(stateLayerListMap, function GroupLayer() {});
  assert.ok(stateLayerListMap.layers.includes(stateBushfireLayer), 'State bushfire must remain a top-level overlay.');
  assert.equal(stateBushfireLayer.listMode, 'show');
  const existingStateBushfireLayer = { title: 'Bushfire - State SPP', visible: false };
  const existingStateBushfireMap = {
    layers: [existingStateBushfireLayer],
    add(layer) { this.layers.push(layer); }
  };
  const replacementStateBushfireLayer = hub.ensureQueenslandStateBushfireLayer(
    existingStateBushfireMap,
    MockFeatureLayer
  );
  assert.notEqual(replacementStateBushfireLayer, existingStateBushfireLayer);
  assert.match(replacementStateBushfireLayer.url, /WOS_PIB\/FeatureServer\/0$/);
  assert.equal(existingStateBushfireMap.layers.length, 2);
  const stateHeritageMap = {
    layers: [],
    add(layer) { this.layers.push(layer); }
  };
  const stateHeritageLayer = hub.ensureQueenslandStateHeritageLayer(stateHeritageMap, MockFeatureLayer);
  assert.equal(
    hub.QUEENSLAND_STATE_HERITAGE_LAYER_URL,
    'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/EnvironmentallySensitiveAreasCategoryB/MapServer/270'
  );
  assert.equal(stateHeritageLayer.title, 'State Heritage - Queensland State Mapping');
  assert.equal(stateHeritageLayer.visible, false);
  assert.equal(stateHeritageLayer.listMode, 'show');
  assert.equal(hub.ensureQueenslandStateHeritageLayer(stateHeritageMap, MockFeatureLayer), stateHeritageLayer);
  assert.equal(stateHeritageMap.layers.length, 1);
  const heritagePlanningGroup = {
    type: 'group',
    title: 'Planning Scheme',
    layers: [],
    add(layer) { this.layers.push(layer); }
  };
  const heritageLayerListMap = {
    layers: [stateHeritageLayer, heritagePlanningGroup],
    remove(layer) { this.layers = this.layers.filter(candidate => candidate !== layer); },
    add(layer) { this.layers.push(layer); }
  };
  hub.organizePlanningSchemeLayers(heritageLayerListMap, function GroupLayer() {});
  assert.ok(heritageLayerListMap.layers.includes(stateHeritageLayer), 'State heritage must remain a top-level overlay.');

  let heritageTriggered = false;
  stateHeritageLayer.objectIdField = 'objectid';
  stateHeritageLayer.fields = [{ name: 'objectid', type: 'oid' }];
  stateHeritageLayer.load = async () => stateHeritageLayer;
  stateHeritageLayer.queryObjectIds = async () => heritageTriggered ? [41] : [];
  stateHeritageLayer.queryFeatures = async () => ({
    features: heritageTriggered
      ? [{ attributes: { objectid: 41, place_id: 600041, placename: 'Test Heritage Place' } }]
      : []
  });
  const heritageShots = [{ title: 'State Heritage - Queensland State Mapping', dataUrl: 'stale' }];
  assert.equal(await hub.addTriggeredStateHeritageReportSection({
    shots: heritageShots,
    map: stateHeritageMap,
    FeatureLayer: MockFeatureLayer,
    geometry: { type: 'polygon' },
    screenshotFor: async () => ({
      title: 'State Heritage - Queensland State Mapping',
      dataUrl: 'heritage-shot',
      count: 0
    }),
    baseShot: { dataUrl: 'base-shot' }
  }), false);
  assert.deepEqual(heritageShots, [], 'State heritage must be omitted when the lot does not intersect it.');
  heritageTriggered = true;
  assert.equal(await hub.addTriggeredStateHeritageReportSection({
    shots: heritageShots,
    map: stateHeritageMap,
    FeatureLayer: MockFeatureLayer,
    geometry: { type: 'polygon' },
    screenshotFor: async (nodes, title, geometry, legendOnLot, options) => {
      assert.deepEqual(nodes, [stateHeritageLayer]);
      assert.equal(title, 'State Heritage - Queensland State Mapping');
      assert.equal(legendOnLot, true);
      assert.equal(options.legendStrictLotIntersection, true);
      return { title, dataUrl: 'heritage-shot', count: 0 };
    },
    baseShot: { dataUrl: 'base-shot' }
  }), true);
  assert.equal(heritageShots.length, 1);
  assert.equal(heritageShots[0].count, 1);
  assert.match(heritageShots[0].note, /Test Heritage Place/);
  assert.equal(hub.propertyReportMappingScope({ title: 'Bushfire - Local Planning Scheme' }), 'local');
  assert.equal(hub.propertyReportMappingScope({ title: 'Bushfire - Queensland State Mapping' }), 'state');
  assert.equal(hub.propertyReportMappingScope({ title: 'State Heritage - Queensland State Mapping' }), 'state');
  assert.equal(hub.propertyReportMappingScope({ title: 'Transport Noise Corridor - Local Mapping' }), 'local');
  assert.equal(hub.propertyReportMappingScope({ title: 'Transport Noise Corridor - Queensland State Mapping' }), 'state');

  assert.deepEqual(hub.parseLotPlanReference('10/RP102525'), { lot: '10', plan: 'RP102525' });
  assert.deepEqual(hub.parseLotPlanReference('Lot 12 on SP123456'), { lot: '12', plan: 'SP123456' });
  assert.equal(hub.parseLotPlanReference('--'), null);
  const interactiveUrl = hub.buildInteractivePropertyMapUrl({
    pageUrl: 'http://127.0.0.1:4010/__va-report-ui/MBRC.html?token=secret#map',
    lotPlan: '10/RP102525'
  });
  const parsedInteractiveUrl = new URL(interactiveUrl);
  assert.equal(parsedInteractiveUrl.pathname, '/MBRC.html');
  assert.equal(parsedInteractiveUrl.searchParams.get('interactiveMap'), '1');
  assert.equal(parsedInteractiveUrl.searchParams.get('lot'), '10');
  assert.equal(parsedInteractiveUrl.searchParams.get('plan'), 'RP102525');
  assert.equal(parsedInteractiveUrl.searchParams.has('token'), false);
  assert.equal(parsedInteractiveUrl.hash, '');

  let scheduledFocus = null;
  let focusedLotPlan = null;
  const interactiveWindow = {
    location: { search: '?interactiveMap=1&lot=10&plan=RP102525' },
    setTimeout(callback) { scheduledFocus = callback; }
  };
  assert.equal(hub.focusInteractivePropertyMapFromQuery(interactiveWindow), true);
  interactiveWindow.__LOT_WISE_REPORT_AUTOMATION__ = {
    focusOnLotPlan(lot, plan) {
      focusedLotPlan = { lot, plan };
      return true;
    }
  };
  scheduledFocus();
  assert.deepEqual(focusedLotPlan, { lot: '10', plan: 'RP102525' });

  const reportOptions = {
    title: 'Test Property Report',
    address: '1 Test Street, Petrie QLD 4502',
    lot: '10/RP102525',
    area: '800 m2',
    propertyClass: 'Freehold',
    council: 'Moreton Bay City Council',
    generatedAt: new Date('2026-10-09T00:00:00Z'),
    baseShot: { dataUrl: 'data:image/png;base64,AA==', scaleText: '1:1000' },
    shots: [{ id: 'rpt-zone', title: 'Zoning', dataUrl: 'data:image/png;base64,AA==', legendHTML: '' }],
    detailPages: [],
    interactiveMapUrl: interactiveUrl
  };
  const interactiveReport = hub.composeLandscapePropertyReport(reportOptions);
  assert.match(interactiveReport, /id='interactivePropertyMapFrame'/);
  assert.doesNotMatch(interactiveReport, /Open single-lot live map/);
  assert.match(interactiveReport, />Open full map</);
  assert.match(interactiveReport, /class='overlay-map report-panzoom'/);
  assert.match(interactiveReport, /data-panzoom-action='in'/);
  assert.match(interactiveReport, /Drag to move &middot; Scroll or pinch to zoom/);
  assert.match(interactiveReport, /id='printStaticReport'/);
  assert.match(interactiveReport, />Print \/ Save PDF</);
  assert.match(interactiveReport, /\.report-export-button\{min-width:170px;min-height:52px/);
  assert.doesNotMatch(interactiveReport, /High-resolution PDF report/);
  assert.doesNotMatch(interactiveReport, /PDF viewer's zoom and hand\/pan controls/);
  assert.match(interactiveReport, /class='pdf-map-hint'/);
  assert.doesNotMatch(interactiveReport, /Download Interactive Report/);
  assert.match(interactiveReport, /@media print[^}]*[\s\S]*interactive-map-frame/);
  assert.match(interactiveReport, /report-panzoom-image\{transform:none!important\}/);
  const reportScripts = [...interactiveReport.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(reportScripts.length >= 2, 'The interactive report should include its map and export scripts.');
  reportScripts.forEach(match => new Function(match[1]));
  global.window.__LOT_WISE_VA_AUTOMATION__ = true;
  const printableReport = hub.composeLandscapePropertyReport(reportOptions);
  delete global.window.__LOT_WISE_VA_AUTOMATION__;
  assert.doesNotMatch(printableReport, /id='interactivePropertyMapFrame'/);
  assert.doesNotMatch(printableReport, /Open single-lot live map/);

  const tncLeaf = {
    title: 'TNC_SM3',
    visible: false,
    renderer: null,
    async load() {
      this.renderer = { type: 'simple', symbol: { type: 'simple-fill' } };
      return this;
    }
  };
  const ordinaryLeaf = { title: 'Council noise overlay', visible: false };
  const map = {
    layers: [],
    async loadAll() {
      this.layers = [{ title: 'Do not touch', visible: false, layers: [tncLeaf] }];
      return this;
    }
  };

  const prepared = await hub.prepareMandatoryOverlayReportSection(
    map,
    'Transport Noise Corridor',
    () => [ordinaryLeaf]
  );
  assert.deepEqual(prepared.nodes, [ordinaryLeaf, tncLeaf]);
  assert.equal(prepared.captureOptions.forceAllVisible, true);
  assert.equal(prepared.captureOptions.legendAllRendererItems, false);
  assert.equal(prepared.captureOptions.legendIncludeHiddenNodes, true);
  assert.equal(prepared.captureOptions.legendStrictLotIntersection, true);
  assert.ok(tncLeaf.renderer, 'TNC renderer should be loaded before its report key is built.');

  const localTncLeaf = { title: 'Transport noise corridor - Local government road', visible: false };
  const stateTncLeaf = { title: 'Transport noise corridor - State-controlled road (mandatory)', visible: false };
  const combinedTncLeaf = { title: 'Transport Noise Corridor', visible: false };
  const splitTncMap = { layers: [localTncLeaf, stateTncLeaf, combinedTncLeaf] };
  assert.deepEqual(
    await hub.collectLocalTransportNoiseCorridorDisplayNodes(splitTncMap),
    [localTncLeaf, combinedTncLeaf]
  );
  assert.deepEqual(
    await hub.collectStateTransportNoiseCorridorDisplayNodes(splitTncMap),
    [stateTncLeaf, combinedTncLeaf]
  );

  const keyedTncNode = {
    title: 'Transport Noise Corridor',
    objectIdField: 'OBJECTID',
    fields: [{ name: 'OBJECTID', type: 'oid' }],
    visible: false,
    definitionExpression: '',
    renderer: {
      type: 'unique-value',
      field: 'TNC_KEY',
      uniqueValueInfos: [
        { value: 'S1', label: 'State designated noise corridor - State-controlled road (mandatory)' },
        { value: 'L1', label: 'Local government road noise category 1' }
      ]
    }
  };
  const stateFeature = { attributes: { OBJECTID: 21, TNC_KEY: 'S1' }, geometry: { type: 'polygon' } };
  const localFeature = { attributes: { OBJECTID: 22, TNC_KEY: 'L1' }, geometry: { type: 'polygon' } };
  const localKeyWithIncidentalStateText = {
    attributes: { OBJECTID: 23, TNC_KEY: 'L1', SOURCE_NAME: 'State source metadata' },
    geometry: { type: 'polygon' }
  };
  keyedTncNode.queryObjectIds = async () => [21, 22];
  keyedTncNode.queryFeatures = async () => ({ features: [stateFeature, localFeature] });
  assert.equal(hub.transportNoiseCorridorFeatureScope(keyedTncNode, stateFeature), 'state');
  assert.equal(hub.transportNoiseCorridorFeatureScope(keyedTncNode, localFeature), 'local');
  assert.equal(hub.transportNoiseCorridorFeatureScope(keyedTncNode, localKeyWithIncidentalStateText), 'local');
  const keyedTncMap = { layers: [keyedTncNode] };
  const localPreparedTnc = await hub.prepareMandatoryOverlayReportSection(
    keyedTncMap,
    'Transport Noise Corridor - Local Mapping',
    () => [],
    { geometry: { type: 'polygon' } }
  );
  assert.deepEqual(localPreparedTnc.nodes, [keyedTncNode]);
  assert.deepEqual(localPreparedTnc.captureOptions.tncObjectIdsByNode.get(keyedTncNode), [22]);
  assert.equal(localPreparedTnc.captureOptions.tncMatchCount, 1);
  const statePreparedTnc = await hub.prepareMandatoryOverlayReportSection(
    keyedTncMap,
    'Transport Noise Corridor - Queensland State Mapping',
    () => [],
    { geometry: { type: 'polygon' } }
  );
  assert.deepEqual(statePreparedTnc.nodes, [keyedTncNode]);
  assert.deepEqual(statePreparedTnc.captureOptions.tncObjectIdsByNode.get(keyedTncNode), [21]);
  assert.equal(statePreparedTnc.captureOptions.tncMatchCount, 1);
  const restoreTncFilter = hub.applyTransportNoiseCorridorFeatureFilter(
    [keyedTncNode],
    new Map([[keyedTncNode, [21]]])
  );
  assert.equal(keyedTncNode.definitionExpression, 'OBJECTID IN (21)');
  restoreTncFilter();
  assert.equal(keyedTncNode.definitionExpression, '');

  const normalSection = await hub.prepareMandatoryOverlayReportSection(
    map,
    'Bushfire',
    async () => [ordinaryLeaf]
  );
  assert.deepEqual(normalSection.nodes, [ordinaryLeaf]);
  assert.equal(normalSection.captureOptions.legendAllRendererItems, false);
  assert.equal(normalSection.captureOptions.legendIncludeHiddenNodes, false);
  assert.equal(normalSection.captureOptions.legendStrictLotIntersection, false);

  const utilitySection = await hub.prepareMandatoryOverlayReportSection(
    map,
    'Utilities',
    () => []
  );
  assert.deepEqual(utilitySection.nodes, []);
  assert.equal(utilitySection.captureOptions.forceAllVisible, true);
  assert.equal(utilitySection.captureOptions.legendAllRendererItems, true);
  assert.equal(utilitySection.captureOptions.legendUseExtent, true);

  const exactFeature = { attributes: { OBJECTID: 7, CATEGORY: 'Rail noise' }, geometry: { type: 'polygon' } };
  const exactQueries = [];
  const exactHits = await hub.queryStrictOverlayFeatureHits({
    objectIdField: 'OBJECTID',
    queryObjectIds: async query => {
      exactQueries.push(query);
      return [7, 7];
    },
    queryFeatures: async query => {
      exactQueries.push(query);
      return { features: [exactFeature] };
    }
  }, { type: 'polygon' });
  assert.deepEqual(exactHits.ids, [7]);
  assert.deepEqual(exactHits.features, [exactFeature]);
  assert.equal(exactQueries[0].spatialRelationship, 'intersects');
  assert.equal(exactQueries[1].where, 'OBJECTID IN (7)');
  assert.equal(exactQueries[1].returnGeometry, true);

  const zoningFeatures = [
    { attributes: { ZONE: 'Neighbouring zone' }, geometry: { type: 'polygon', overlapArea: 12 } },
    { attributes: { ZONE: 'Dominant zone' }, geometry: { type: 'polygon', overlapArea: 58 } },
    { attributes: { ZONE: 'Dominant zone' }, geometry: { type: 'polygon', overlapArea: 21 } }
  ];
  const dominantZoningFeatures = hub.selectDominantPolygonLegendFeatures(
    zoningFeatures,
    { type: 'polygon', id: 'selected-lot' },
    {
      intersect: geometry => ({ type: 'polygon', overlapArea: geometry.overlapArea }),
      geodesicArea: overlap => overlap.overlapArea
    },
    feature => feature.attributes.ZONE
  );
  assert.deepEqual(dominantZoningFeatures, [zoningFeatures[1]]);

  let popupOptions = null;
  const view = {
    popupEnabled: true,
    openPopup(options) {
      popupOptions = options;
    }
  };
  const popupShown = hub.showPropertyInfoPopup(view, {
    feature: { geometry: { centroid: { x: 1, y: 2 } } },
    addressText: '1 Test & Example St',
    lotText: '1/RP12345',
    areaText: '500 m2',
    classText: 'Standard lot',
    councilText: 'Test Council'
  });
  assert.equal(popupShown, true);
  assert.equal(view.popupEnabled, false);
  assert.equal(popupOptions.title, '1 Test & Example St');
  assert.match(popupOptions.content, /1 Test &amp; Example St/);
  assert.match(popupOptions.content, /Lot \/ plan/);

  global.document.getElementById = id => id === 'rptOverlay'
    ? { style: { display: 'grid' }, getAttribute: () => 'false' }
    : null;
  assert.equal(hub.showPropertyInfoPopup(view, {
    feature: { geometry: { centroid: { x: 1, y: 2 } } },
    lotText: '1/RP12345'
  }), false);

  const utilityNode = {
    id: 'test-water-main',
    title: 'Water Main',
    objectIdField: 'OBJECTID',
    fields: [
      { name: 'OBJECTID', alias: 'Object ID', type: 'oid' },
      { name: 'ASSETID', alias: 'Asset ID', type: 'string' },
      { name: 'DIAMETER', alias: 'Diameter', type: 'double' }
    ]
  };
  const utilityGraphic = {
    layer: utilityNode,
    attributes: { OBJECTID: 7, ASSETID: 'WM-7', DIAMETER: 150 }
  };
  let utilityPopupOptions = null;
  let utilityClickStopped = false;
  const utilityView = {
    async hitTest() { return { results: [{ graphic: utilityGraphic }] }; },
    openPopup(options) { utilityPopupOptions = options; }
  };
  const utilityPopupShown = await hub.showUtilityInfoPopup(
    utilityView,
    { mapPoint: { x: 3, y: 4 }, stopPropagation() { utilityClickStopped = true; } },
    { utilityNodes: [utilityNode] }
  );
  assert.equal(utilityPopupShown, true);
  assert.equal(utilityClickStopped, true);
  assert.deepEqual(utilityPopupOptions.location, { x: 3, y: 4 });
  assert.deepEqual(utilityPopupOptions.features, [utilityGraphic]);
  assert.equal(utilityGraphic.popupTemplate.title, 'Water Main');
  assert.deepEqual(
    utilityGraphic.popupTemplate.content[0].fieldInfos.map(field => field.label),
    ['Object ID', 'Asset ID', 'Diameter']
  );

  const councilDir = path.join(rootDir, 'public', 'Js', 'councils');
  const councils = fs.readdirSync(councilDir).filter(file => file.endsWith('.js')).sort();
  assert.equal(councils.length, 14);
  for (const council of councils) {
    const source = fs.readFileSync(path.join(councilDir, council), 'utf8');
    const reportShotSize = source.match(/const SHOT_SIZE = \{ width: (\d+), height: (\d+) \};/);
    assert.ok(reportShotSize, `${council} must define a report screenshot size.`);
    assert.ok(
      Number(reportShotSize[1]) >= 1920 && Number(reportShotSize[2]) >= 1350,
      `${council} must capture high-resolution maps for PDF zooming.`
    );
    assert.match(source, /selectDominantPolygonLegendFeatures,/);
    assert.match(
      source,
      /if\(isZone\) feats=selectDominantPolygonLegendFeatures\(feats,lotGeom,geometryEngine,feature=>pickZoneLabel\(feature\.attributes,layerNode\)\);/,
      `${council} must keep only the zoning class with the greatest selected-lot coverage in report keys.`
    );
    assert.doesNotMatch(
      source,
      /ensureQueenslandFfdiLayer|collectAllFFDIDisplayNodes|["']FFDI["']\s*,\s*async/,
      `${council} must not load or generate an FFDI map/report section.`
    );
    assert.match(
      source,
      /\["Utilities"[\s\S]{0,180}?addMandatorySection\(shots,"Utilities"/,
      `${council} must always add Utilities to the property report.`
    );
    assert.match(source, /No utility overlay triggered for this property\./);
    assert.match(
      source,
      /\["Local TNC"[\s\S]{0,320}?Transport Noise Corridor - Local Mapping[\s\S]{0,160}?collectLocalNoiseDisplayNodes/,
      `${council} must always add local TNC mapping to the property report.`
    );
    assert.match(
      source,
      /\["State TNC"[\s\S]{0,340}?Transport Noise Corridor - Queensland State Mapping[\s\S]{0,180}?collectStateNoiseDisplayNodes/,
      `${council} must always add Queensland state TNC mapping to the property report.`
    );
    assert.match(
      source,
      /function collectLocalBushfireDisplayNodes\(/,
      `${council} must collect local bushfire mapping separately.`
    );
    assert.match(
      source,
      /function collectStateBushfireDisplayNodes\(/,
      `${council} must collect Queensland state bushfire mapping separately.`
    );
    assert.match(
      source,
      /function collectStateBushfireDisplayNodes\(\)\{[\s\S]{0,220}?ensureQueenslandStateBushfireLayer\(view\?\.map\|\|webmap,FeatureLayer\)/,
      `${council} must render the working statewide BPA feature layer.`
    );
    assert.match(
      source,
      /scheduleQueenslandStateBushfireLayer\(\(\)=>/,
      `${council} must add state bushfire mapping before report generation.`
    );
    assert.match(
      source,
      /scheduleQueenslandStateHeritageLayer\(\(\)=>/,
      `${council} must add State Heritage to its overlay list.`
    );
    assert.match(
      source,
      /await addTriggeredStateHeritageReportSection\(\{shots,map:view\?\.map\|\|webmap,FeatureLayer,geometry:geom,screenshotFor,baseShot:/,
      `${council} must add State Heritage to the report only after an exact lot-intersection check.`
    );
    if (/new LayerList\(/.test(source)) {
      assert.match(
        source,
        /if\(isQueenslandStateBushfireLayer\(node\)\)\{[\s\S]{0,140}?node\.listMode="show"/,
        `${council} must keep state bushfire visible in the overlay list.`
      );
    }
    assert.match(source, /\["Local bushfire"[\s\S]{0,260}?collectLocalBushfireDisplayNodes/);
    assert.match(source, /\["State bushfire"[\s\S]{0,260}?collectStateBushfireDisplayNodes/);
    assert.doesNotMatch(source, /function collectAllBushfireDisplayNodes\(/);
    if (council === 'MBRC.js') {
      assert.match(source, /url:QUEENSLAND_STATE_BUSHFIRE_LAYER_URL/);
      assert.doesNotMatch(source, /const SPP_BUSHFIRE_LAYER_URL=/);
      assert.match(source, /const isMbrcNeighbourhoodReportLayer=node=>/);
      assert.match(source, /return i==="mbrc_addresses_live"\s*\|\| u===MBRC_ADDRESS_URL\.toLowerCase\(\)\s*\|\| t==="mbrc property boundaries";/);
      assert.doesNotMatch(source, /property\[\\s_-\]\*address/);
      assert.match(source, /const isDuplicateQSpatialAddressLabelLayer=\(node\)=>/);
      assert.match(source, /const suppressDuplicateQSpatialAddressLabel=\(node\)=>\{[\s\S]{0,260}?node\.visible=false;[\s\S]{0,180}?node\.labelsVisible=false;/);
      assert.match(source, /const suppressLoadedQSpatialAddressLayer=async\(root\)=>\{[\s\S]{0,700}?service\.findSublayerById\?\.\(0\)[\s\S]{0,360}?suppressDuplicateQSpatialAddressLabel\(address\);/);
      assert.match(source, /await webmap\.load\(\);\s*await suppressLoadedQSpatialAddressLayer\(webmap\);/);
      assert.match(source, /async function takeReportScreenshot\(options\)\{[\s\S]{0,220}?await prepareNativeParcelReferences\(view, waitViewIdle\);\s*await suppressLoadedQSpatialAddressLayer\(view\.map\);\s*await waitViewIdle\(120\);/);
      assert.match(source, /function keepPropertyBoundaryVisible\(node\)\{[\s\S]{0,180}?if\(suppressDuplicateQSpatialAddressLabel\(node\)\) return true;/);
      assert.match(source, /suppressDuplicateQSpatialAddressLabel\(node\); let p=node\.parent/);
      assert.match(source, /if\(neighbourhoodMatch\) out\.neighbourhood\.push\(n\);\s*else if\(zoneMatch\) out\.zoning\.push\(n\);/);
      assert.match(
        source,
        /\["Zoning",[\s\S]{0,260}?\(\)=>cats\.zoning[\s\S]{0,260}?\["Neighbourhood",[\s\S]{0,260}?\(\)=>cats\.neighbourhood/,
        'MBRC zoning and neighbourhood must be separate adjacent report sections.'
      );
    }
    assert.match(source, /showPropertyInfoPopup\(view, lastParcelInfo\)/, `${council} must show the shared property popup.`);
    assert.match(source, /showUtilityInfoPopup\(view,ev/, `${council} must give utility features priority through the shared popup handler.`);
    assert.match(source, /prepareMandatoryOverlayReportSection\(view\.map,title,collectorFn,\{geometry:geom\}\)/, `${council} must use shared mandatory overlay handling with the selected lot geometry.`);
    assert.match(source, /applyTransportNoiseCorridorFeatureFilter\(nodes,(?:captureOptions|prepared\.captureOptions)\?\.tncObjectIdsByNode\)/, `${council} must filter combined TNC layers to the matching key items.`);
    assert.doesNotMatch(
      source,
      /if\(underDNTChain\((?:n|ln)\)\) continue/,
      `${council} must not drop a TNC key solely because its source layer is in a hidden system group.`
    );
    assert.match(
      source,
      /legendFromRendererUsingFeatures\((?:n|ln),legendGeom,[\s\S]{0,180}?exact:legendStrictLotIntersection/,
      `${council} must strictly query the selected lot for TNC key items.`
    );
    assert.match(
      source,
      /queryStrictOverlayFeatureHits\(layerNode,lotGeom/,
      `${council} must use the shared reliable exact-intersection query for TNC key items.`
    );
    if (council === 'TRC.js') {
      assert.match(
        source,
        /rendererSymbol \|\| renderer\?\.symbol/,
        'TRC must use its matching CATEGORY renderer symbol when the live displayed symbol is unavailable.'
      );
    }
    if (council === 'BCC.js') {
      assert.match(
        source,
        /queryStrictOverlayFeatureHits\(n,lotGeom/,
        'BCC must query intersecting TNC features for the filtered key.'
      );
      assert.match(source, /features:legendStrictLotIntersection \? \(strictHits\.get\(n\)\?\.features\|\|\[\]\) : null/);
      assert.match(
        source,
        /a\.opacity=Math\.max\(Number\(a\.opacity\)\|\|0,0\.82\)/,
        'BCC must lift the faded Planning Scheme opacity while capturing TNC.'
      );
    }
  }

  console.log('Council base-function tests passed for all council maps.');
}
