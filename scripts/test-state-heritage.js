const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const origin = process.env.STATE_HERITAGE_TEST_ORIGIN || 'http://127.0.0.1:4173';

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const browser = await puppeteer.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__LOT_WISE_PAYWALL_ENABLED__ = false;
    });
    await page.goto(`${origin}/MBRC.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForFunction(
      () => window.__LOT_WISE_REPORT_AUTOMATION__?.getView?.()?.map,
      { timeout: 120000 }
    );

    const result = await page.evaluate(async () => {
      const hub = await import('/Js/council-hub.js?v=20261103-state-heritage-browser-test');
      const { default: FeatureLayer } = await import(
        'https://js.arcgis.com/4.30/@arcgis/core/layers/FeatureLayer.js'
      );
      const map = window.__LOT_WISE_REPORT_AUTOMATION__.getView().map;
      let layer = map.layers.toArray().find(candidate => candidate.id === 'lotwise-qld-state-heritage');
      if (!layer) layer = hub.ensureQueenslandStateHeritageLayer(map, FeatureLayer);
      await layer.load();

      const sample = await layer.queryFeatures({
        where: '1=1',
        outFields: ['objectid', 'place_id', 'placename'],
        returnGeometry: true,
        num: 1
      });
      const feature = sample.features[0];
      if (!feature) throw new Error('The Queensland Heritage Register returned no sample feature.');

      const triggeredShots = [];
      const triggered = await hub.addTriggeredStateHeritageReportSection({
        shots: triggeredShots,
        map,
        FeatureLayer,
        geometry: feature.geometry,
        screenshotFor: async (nodes, title) => ({
          title,
          dataUrl: 'data:image/png;base64,AA==',
          count: 0,
          overlayLayers: nodes.map(node => node.title)
        }),
        baseShot: { dataUrl: 'data:image/png;base64,AA==' }
      });

      const omittedShots = [{
        title: hub.QUEENSLAND_STATE_HERITAGE_REPORT_TITLE,
        dataUrl: 'stale-auto-collected-copy'
      }];
      const nonIntersecting = await hub.addTriggeredStateHeritageReportSection({
        shots: omittedShots,
        map,
        FeatureLayer,
        geometry: { type: 'point', x: 0, y: 0, spatialReference: { wkid: 3857 } },
        screenshotFor: async () => ({ dataUrl: 'unexpected' }),
        baseShot: { dataUrl: 'base' }
      });

      return {
        layerId: layer.id,
        layerTitle: layer.title,
        layerVisible: layer.visible,
        layerListMode: layer.listMode,
        samplePlace: feature.attributes.placename,
        triggered,
        triggeredShots: triggeredShots.length,
        triggeredScope: hub.propertyReportMappingScope(triggeredShots[0]),
        nonIntersecting,
        omittedShots: omittedShots.length
      };
    });

    assert.equal(result.layerId, 'lotwise-qld-state-heritage');
    assert.equal(result.layerTitle, 'State Heritage - Queensland State Mapping');
    assert.equal(result.layerVisible, false);
    assert.equal(result.layerListMode, 'show');
    assert.ok(result.samplePlace);
    assert.equal(result.triggered, true);
    assert.equal(result.triggeredShots, 1);
    assert.equal(result.triggeredScope, 'state');
    assert.equal(result.nonIntersecting, false);
    assert.equal(result.omittedShots, 0);
  } finally {
    await browser.close();
  }

  console.log('State Heritage live overlay and conditional-report checks passed.');
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LocalAppData || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome or Edge is required for the State Heritage browser test.');
  return executable;
}
