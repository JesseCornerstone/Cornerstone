const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const origin = process.env.MEASUREMENT_TEST_ORIGIN || 'http://127.0.0.1:4173';
const assetVersion = '20261113-live-measurement';
const expectedCouncilFiles = [
  'BCC.js',
  'FCRC.js',
  'GCCC2.js',
  'GRC.js',
  'ICC2.js',
  'LCC.js',
  'MBRC.js',
  'NSC.js',
  'RCC.js',
  'SCRC.js',
  'SDRC.js',
  'SRRC.js',
  'TRC.js'
];

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertIntegrationWiring();
  const browser = await puppeteer.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });

  try {
    const livePage = await openMap(browser, '/MBRC.html');
    try {
      await livePage.waitForFunction(findMeasurementExpand, { timeout: 30000 });
    } catch (error) {
      const state = await livePage.evaluate(() => ({
        href: window.location.href,
        readyState: document.readyState,
        fileMode: Boolean(window.__LOT_WISE_FILE_MODE__),
        reportAutomation: Boolean(window.__LOT_WISE_VA_AUTOMATION__),
        moduleError: document.getElementById('lot-wise-module-load-error')?.textContent || '',
        topRightHtml: document.querySelector('.esri-ui-top-right')?.innerHTML.slice(0, 3000) || '',
        topLeftHtml: document.querySelector('.esri-ui-top-left')?.innerHTML.slice(0, 1000) || '',
        expandLabels: Array.from(document.querySelectorAll('.esri-expand button'))
          .map(button => button.getAttribute('aria-label') || button.title || ''),
        widgetIds: Array.from(document.querySelectorAll('#viewDiv [id]'))
          .map(element => element.id)
          .filter(id => /measure|expand/i.test(id))
      }));
      console.error('Measurement browser state:', state);
      console.error('Measurement browser diagnostics:', livePage.measurementDiagnostics);
      throw error;
    }

    const liveResult = await livePage.evaluate(() => {
      const expand = document.getElementById('lot-wise-live-measurement')
        || Array.from(document.querySelectorAll('.esri-expand')).find(element => {
          const control = element.querySelector('button, calcite-action');
          const label = control?.getAttribute('aria-label') || control?.title || '';
          return element.querySelector('.esri-icon-measure, calcite-icon[icon="measure"]')
            || /measure/i.test(label);
        });
      const button = expand?.querySelector('button, calcite-action');
      return {
        found: Boolean(expand),
        label: button?.getAttribute('aria-label') || button?.title || ''
      };
    });

    assert.equal(liveResult.found, true);
    assert.match(liveResult.label, /measure/i);
    await livePage.click('.esri-expand calcite-action[title="Measure distance or area"]');
    await livePage.waitForSelector('.lot-wise-measurement-panel', { timeout: 30000 });
    const measurementControls = await livePage.$eval('.lot-wise-measurement-panel', element => {
      return Array.from(element.querySelectorAll('button'))
        .map(control => [control.textContent, control.title, control.getAttribute('aria-label')].join(' '))
        .join(' ');
    });
    assert.match(measurementControls, /distance/i);
    assert.match(measurementControls, /area/i);

    await livePage.$eval('.lot-wise-measurement-panel', panel => {
      const distance = Array.from(panel.querySelectorAll('button'))
        .find(button => button.textContent.trim() === 'Distance');
      distance.click();
    });
    await livePage.waitForFunction(() => {
      const distance = Array.from(document.querySelectorAll('.lot-wise-measurement-panel button'))
        .find(button => button.textContent.trim() === 'Distance');
      return distance?.getAttribute('aria-pressed') === 'true';
    });
    await livePage.waitForFunction(async version => {
      const view = window.__LOT_WISE_REPORT_AUTOMATION__?.getView?.();
      if (!view) return false;
      const hub = await import(`/Js/council-hub.js?v=${version}`);
      const status = hub.getLiveMeasurementSnappingStatus(view);
      return status.configured && status.enabled && status.featureEnabled && status.sourceCount === 1;
    }, {}, assetVersion);
    await livePage.waitForFunction(() => {
      return Boolean(window.__LOT_WISE_REPORT_AUTOMATION__?.getSelectionLayer?.());
    });
    const selectionCountBefore = await livePage.evaluate(() => {
      return window.__LOT_WISE_REPORT_AUTOMATION__.getSelectionLayer().graphics.length;
    });
    const mapBox = await livePage.$eval('#viewDiv', element => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
    });
    await livePage.mouse.click(
      mapBox.x + mapBox.width * 0.55,
      mapBox.y + mapBox.height * 0.55
    );
    await new Promise(resolve => setTimeout(resolve, 2500));
    const selectionCountDuringMeasurement = await livePage.evaluate(() => {
      return window.__LOT_WISE_REPORT_AUTOMATION__.getSelectionLayer().graphics.length;
    });
    assert.equal(
      selectionCountDuringMeasurement,
      selectionCountBefore,
      'A measurement click must not select a parcel.'
    );
    await livePage.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await livePage.waitForFunction(() => {
      const distance = Array.from(document.querySelectorAll('.lot-wise-measurement-panel button'))
        .find(button => button.textContent.trim() === 'Distance');
      return distance?.getAttribute('aria-pressed') === 'false';
    });

    const reportPage = await openMap(browser, '/MBRC.html', true);
    await waitForSkippedMeasurement(reportPage);
    assert.equal(await reportPage.evaluate(findMeasurementExpand), false);

    const embeddedMapPage = await openMap(browser, '/MBRC.html?mapOnly=1');
    await waitForSkippedMeasurement(embeddedMapPage);
    assert.equal(await embeddedMapPage.evaluate(findMeasurementExpand), false);
  } finally {
    await browser.close();
  }

  console.log('Live measurement browser test passed.');
}

function assertIntegrationWiring() {
  const projectRoot = path.resolve(__dirname, '..');
  const councilDir = path.join(projectRoot, 'public', 'Js', 'councils');
  const liveCouncilSources = fs.readdirSync(councilDir)
    .filter(file => file.endsWith('.js'))
    .map(file => ({ file, source: fs.readFileSync(path.join(councilDir, file), 'utf8') }))
    .filter(entry => entry.source.includes('installLiveMeasurementTool(view'))
    .sort((a, b) => a.file.localeCompare(b.file));

  assert.deepEqual(
    liveCouncilSources.map(entry => entry.file),
    [...expectedCouncilFiles].sort(),
    'The measurement tool must remain installed on every supported live council map.'
  );

  liveCouncilSources.forEach(({ file, source }) => {
    assert.match(
      source,
      /view\.on\(["']click["'],[\s\S]{0,100}if\(isLiveMeasurementActive\(view\)\) return;/,
      `${file} must ignore parcel clicks while measuring.`
    );
    assert.match(
      source,
      new RegExp(`council-hub\\.js\\?v=${assetVersion}`),
      `${file} must request the current shared measurement module.`
    );

    const html = fs.readFileSync(
      path.join(projectRoot, 'public', file.replace(/\.js$/, '.html')),
      'utf8'
    );
    assert.match(
      html,
      new RegExp(`data-module="\\./Js/councils/${file.replace('.', '\\.')}\\?v=${assetVersion}"`),
      `${file} must be cache-busted from its live HTML page.`
    );
    assert.match(
      html,
      new RegExp(`map-theme\\.css\\?v=${assetVersion}`),
      `${file} must load the measurement styles with the current cache key.`
    );
  });

  const css = fs.readFileSync(path.join(projectRoot, 'public', 'map-theme.css'), 'utf8');
  assert.match(css, /\.lot-wise-measurement-panel/);
  assert.doesNotMatch(css, /-webkit--webkit-/);
}

async function openMap(browser, pathname, reportAutomation = false) {
  const page = await browser.newPage();
  page.measurementDiagnostics = [];
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      page.measurementDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => {
    page.measurementDiagnostics.push(`page: ${error.message}`);
  });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(isReport => {
    window.__LOT_WISE_PAYWALL_ENABLED__ = false;
    if (isReport) window.__LOT_WISE_VA_AUTOMATION__ = true;
  }, reportAutomation);
  await page.goto(`${origin}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#viewDiv .esri-view-root', { timeout: 120000 });
  return page;
}

async function waitForSkippedMeasurement(page) {
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 120000 });
  await new Promise(resolve => setTimeout(resolve, 1500));
}

function findMeasurementExpand() {
  return Boolean(document.getElementById('lot-wise-live-measurement'))
    || Array.from(document.querySelectorAll('.esri-expand')).some(element => {
      const control = element.querySelector('button, calcite-action');
      const label = control?.getAttribute('aria-label') || control?.title || '';
      return element.querySelector('.esri-icon-measure, calcite-icon[icon="measure"]')
        || /measure/i.test(label);
    });
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
  if (!executable) throw new Error('Chrome or Edge is required for the live measurement test.');
  return executable;
}
