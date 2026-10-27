const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const origin = process.env.INTERACTIVE_REPORT_TEST_ORIGIN || 'http://127.0.0.1:4173';

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
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      window.__LOT_WISE_PAYWALL_ENABLED__ = false;
    });
    await page.goto(`${origin}/Index.html`, { waitUntil: 'domcontentloaded' });
    const overlayFilterResult = await page.evaluate(async testOrigin => {
      const hub = await import('/Js/council-hub.js?v=interactive-report-browser-test');
      const collection = items => ({ toArray: () => items });
      const selectionLayer = { title: 'Selected parcel', visible: false, minScale: 5000, maxScale: 50 };
      const zoningLayer = { title: 'MBRC Zoning Test', visible: false, minScale: 5000, maxScale: 50 };
      const floodLayer = { title: 'Flood overlay', visible: true, minScale: 5000, maxScale: 50 };
      const planningGroup = {
        title: 'Planning overlays',
        visible: false,
        layers: collection([zoningLayer, floodLayer])
      };
      const fakeView = {
        map: { layers: collection([planningGroup, selectionLayer]) },
        requestUpdate: () => {}
      };
      const selection = hub.applyInteractiveReportOverlay(fakeView, {
        overlayTitle: 'Zoning',
        layerTitles: ['MBRC Zoning Test'],
        selectionLayer
      });
      const interactiveMapUrl = `${testOrigin}/MBRC.html?interactiveMap=1&lot=636&plan=SP350483`;
      const html = hub.composeLandscapePropertyReport({
        title: 'Interactive Property Report Test',
        address: '1 Romach Street, Morayfield QLD 4506',
        lot: '636SP350483',
        area: '800 m2',
        propertyClass: 'Freehold',
        council: 'City of Moreton Bay',
        generatedAt: new Date(),
        baseShot: {
          dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          scaleText: '1:1000'
        },
        shots: [{
          id: 'rpt-zoning',
          title: 'Zoning',
          dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          scaleText: '1:1000',
          overlayLayers: ['MBRC Zoning Test'],
          legendHTML: '<div class="row">Test zone</div>'
        }],
        detailPages: [],
        interactiveMapUrl
      });
      document.open();
      document.write(html);
      document.close();
      return {
        matched: selection.matched,
        groupVisible: planningGroup.visible,
        zoningVisible: zoningLayer.visible,
        floodVisible: floodLayer.visible,
        selectionVisible: selectionLayer.visible,
        selectedMinScale: zoningLayer.minScale,
        selectedMaxScale: zoningLayer.maxScale
      };
    }, origin);
    assert.deepEqual(overlayFilterResult, {
      matched: 1,
      groupVisible: true,
      zoningVisible: true,
      floodVisible: false,
      selectionVisible: true,
      selectedMinScale: 0,
      selectedMaxScale: 0
    });

    await page.waitForSelector('#interactivePropertyMapFrame');
    await page.waitForSelector('#interactivePropertyMapShell.interactive-ready', { timeout: 120000 });
    await page.waitForFunction(() => {
      const frame = document.getElementById('interactivePropertyMapFrame');
      return frame?.contentDocument?.documentElement.classList.contains('lot-wise-map-only');
    }, { timeout: 120000 });
    const screenResult = await page.evaluate(() => {
      const shell = document.getElementById('interactivePropertyMapShell');
      const frame = document.getElementById('interactivePropertyMapFrame');
      const childDocument = frame.contentDocument;
      const childAutomation = frame.contentWindow?.__LOT_WISE_REPORT_AUTOMATION__;
      const childView = childAutomation?.getView?.();
      const childSelectionLayer = childAutomation?.getSelectionLayer?.();
      const visibleNonSelectionLayers = childView?.map?.layers?.toArray?.()
        .filter(layer => layer.visible && layer !== childSelectionLayer).length;
      return {
        ready: shell.classList.contains('interactive-ready'),
        frameHref: frame?.src || '',
        singleLotButtonCount: document.querySelectorAll('.interactive-report-button, .property-meta .badge-link').length,
        overlayLiveMapButtonCount: document.querySelectorAll('.overlay-actions .badge-link').length,
        hasMapRoot: Boolean(childDocument?.querySelector('#viewDiv .esri-view-root')),
        childMapOnly: childDocument?.documentElement.classList.contains('lot-wise-map-only'),
        visibleNonSelectionLayers,
        mapWidgetDisplay: childDocument?.querySelector('#viewDiv .esri-ui-top-left')
          ? frame.contentWindow.getComputedStyle(childDocument.querySelector('#viewDiv .esri-ui-top-left')).display
          : null,
        childHeaderDisplay: childDocument?.querySelector('body > header')?.style.display || '',
        frameDisplay: getComputedStyle(frame).display,
        staticDisplay: getComputedStyle(document.querySelector('.property-map-static')).display,
        exportBarDisplay: getComputedStyle(document.querySelector('.report-export-bar')).display
      };
    });
    assert.equal(screenResult.ready, true);
    assert.equal(screenResult.singleLotButtonCount, 0);
    const frameTarget = new URL(screenResult.frameHref);
    assert.equal(frameTarget.pathname, '/MBRC.html');
    assert.equal(frameTarget.searchParams.get('interactiveMap'), '1');
    assert.equal(frameTarget.searchParams.get('mapOnly'), '1');
    assert.equal(frameTarget.searchParams.get('lot'), '636');
    assert.equal(frameTarget.searchParams.get('plan'), 'SP350483');
    assert.equal(frameTarget.searchParams.get('overlay'), 'Report overlays');
    assert.deepEqual(frameTarget.searchParams.getAll('layer'), ['MBRC Zoning Test']);
    assert.equal(screenResult.overlayLiveMapButtonCount, 0);
    assert.equal(screenResult.hasMapRoot, true);
    assert.equal(screenResult.childMapOnly, true);
    assert.equal(screenResult.visibleNonSelectionLayers, 0);
    assert.ok(screenResult.mapWidgetDisplay === null || screenResult.mapWidgetDisplay === 'none');
    assert.equal(screenResult.childHeaderDisplay, 'none');
    assert.notEqual(screenResult.frameDisplay, 'none');
    assert.equal(screenResult.staticDisplay, 'block');
    assert.notEqual(screenResult.exportBarDisplay, 'none');

    const panzoom = await page.$('.report-panzoom');
    await panzoom.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const panzoomBox = await panzoom.boundingBox();
    assert.ok(panzoomBox && panzoomBox.width > 0 && panzoomBox.height > 0);
    const centerX = panzoomBox.x + panzoomBox.width / 2;
    const centerY = panzoomBox.y + panzoomBox.height / 2;
    await panzoom.evaluate(element => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -500,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
    });
    await page.waitForFunction(() => Number(document.querySelector('.report-panzoom')?.dataset.zoom || 1) > 1);
    const zoomedState = await panzoom.evaluate(element => ({
      zoom: Number(element.dataset.zoom),
      level: element.querySelector('.panzoom-level')?.textContent,
      transform: getComputedStyle(element.querySelector('.report-panzoom-image')).transform
    }));
    assert.ok(zoomedState.zoom > 1);
    assert.notEqual(zoomedState.level, '100%');
    assert.notEqual(zoomedState.transform, 'none');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 35, centerY + 25, { steps: 4 });
    await page.mouse.up();
    const draggedTransform = await panzoom.$eval('.report-panzoom-image', image => getComputedStyle(image).transform);
    assert.notEqual(draggedTransform, zoomedState.transform);
    await panzoom.$eval('[data-panzoom-action="reset"]', button => button.click());
    assert.equal(await panzoom.evaluate(element => element.querySelector('.panzoom-level')?.textContent), '100%');

    const printTriggered = await page.evaluate(() => {
      window.__printTriggered = false;
      window.print = () => { window.__printTriggered = true; };
      document.getElementById('printStaticReport').click();
      return window.__printTriggered;
    });
    assert.equal(printTriggered, true);

    await page.emulateMediaType('print');
    const printResult = await page.evaluate(() => ({
      frameDisplay: getComputedStyle(document.getElementById('interactivePropertyMapFrame')).display,
      staticDisplay: getComputedStyle(document.querySelector('.property-map-static')).display,
      staticOpacity: getComputedStyle(document.querySelector('.property-map-static')).opacity,
      panzoomControlsDisplay: getComputedStyle(document.querySelector('.panzoom-controls')).display,
      panzoomTransform: getComputedStyle(document.querySelector('.report-panzoom-image')).transform,
      exportBarDisplay: getComputedStyle(document.querySelector('.report-export-bar')).display,
      pdfHintDisplay: getComputedStyle(document.querySelector('.pdf-map-hint')).display,
      singleLotButtonCount: document.querySelectorAll('.interactive-report-button, .property-meta .badge-link').length
    }));
    assert.equal(printResult.frameDisplay, 'none');
    assert.equal(printResult.staticDisplay, 'block');
    assert.equal(printResult.staticOpacity, '1');
    assert.equal(printResult.panzoomControlsDisplay, 'none');
    assert.equal(printResult.panzoomTransform, 'none');
    assert.equal(printResult.exportBarDisplay, 'none');
    assert.equal(printResult.pdfHintDisplay, 'block');
    assert.equal(printResult.singleLotButtonCount, 0);
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    assert.ok(pdf.length > 1000);
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString('ascii'), '%PDF-');
    PDFJS.disableWorker = true;
    const pdfDocument = await PDFJS.getDocument(Buffer.from(pdf));
    const pdfLinks = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const pdfPage = await pdfDocument.getPage(pageNumber);
      const annotations = await pdfPage.getAnnotations();
      annotations.forEach(annotation => {
        if (annotation.url) pdfLinks.push(annotation.url);
      });
    }
    await pdfDocument.destroy();
    const parsedPdfLinks = pdfLinks.map(url => new URL(url));
    assert.equal(parsedPdfLinks.some(url =>
      url.pathname.endsWith('/MBRC.html') &&
      url.searchParams.get('mapOnly') === '1' &&
      url.searchParams.get('lot') === '636' &&
      url.searchParams.get('plan') === 'SP350483' &&
      url.searchParams.get('overlay') === 'Report overlays' &&
      url.searchParams.getAll('layer').includes('MBRC Zoning Test')
    ), false, 'The saved PDF should not contain the removed single-lot map link.');
    assert.equal(parsedPdfLinks.some(url =>
      url.searchParams.get('overlay') === 'Zoning' &&
      url.searchParams.getAll('layer').includes('MBRC Zoning Test')
    ), false, 'The saved PDF should not contain an overlay live-map link.');
  } finally {
    await browser.close();
  }

  console.log('Interactive report-map browser test passed.');
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
  if(!executable) throw new Error('Chrome or Edge is required for the interactive report-map test.');
  return executable;
}
