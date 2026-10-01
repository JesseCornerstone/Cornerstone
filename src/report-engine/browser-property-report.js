const fs = require('fs');
const path = require('path');

const DEFAULT_REPORT_TIMEOUT_MS = 5 * 60 * 1000;

async function renderBrowserPropertyReport(job, council, onProgress) {
  const puppeteer = loadPuppeteer();
  const executablePath = findBrowserExecutable();
  const baseUrl = requiredBaseUrl();
  const reportUrl = new URL(
    `/__va-report-ui/${encodeURIComponent(council.page)}`,
    `${baseUrl}/`
  ).toString();
  const timeoutMs = positiveInteger(
    process.env.LOT_WISE_REPORT_TIMEOUT_MS,
    DEFAULT_REPORT_TIMEOUT_MS
  );
  const diagnostics = [];
  let browser = null;

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      timeout: 30000,
      // Parcel discovery is time-bounded below. Once the requested parcel is
      // found, protocol calls remain open until the complete PDF is rendered.
      protocolTimeout: 0,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-default-browser-check',
        '--no-first-run',
        '--window-size=1600,1000'
      ]
    });

    return await withParcelDiscoveryTimeout(async markParcelFound => {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(Math.min(timeoutMs, 90000));
      page.setDefaultTimeout(timeoutMs);
      await page.setViewport({
        width: 1600,
        height: 1000,
        deviceScaleFactor: 1
      });
      await page.evaluateOnNewDocument(() => {
        window.__LOT_WISE_PAYWALL_ENABLED__ = false;
        window.__LOT_WISE_VA_AUTOMATION__ = true;
      });
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      page.on('pageerror', error => rememberDiagnostic(
        diagnostics,
        `page: ${error.message}`
      ));
      page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'warning') {
          rememberDiagnostic(
            diagnostics,
            `${message.type()}: ${message.text()}`
          );
        }
      });

      await page.goto(reportUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => Boolean(window.__LOT_WISE_REPORT_AUTOMATION__),
        { timeout: Math.min(timeoutMs, 90000) }
      );

      const focused = await page.evaluate(async input => {
        const automation = window.__LOT_WISE_REPORT_AUTOMATION__;
        return automation.focusOnLotPlan(input.lot, input.plan);
      }, { lot: job.lot, plan: job.plan });

      if (!focused) {
        throw codedError(
          `The map could not locate Lot ${job.lot} on ${job.plan}.`,
          'parcel_not_found'
        );
      }

      markParcelFound();
      await notifyProgress(onProgress, {
        phase: 'parcel_found',
        parcelFound: true,
        message: `Located Lot ${job.lot} on ${job.plan}; generating the complete report.`
      });

      const result = await page.evaluate(async () => {
        const automation = window.__LOT_WISE_REPORT_AUTOMATION__;
        const report = await automation.buildReport();
        if (!report || !report.html) {
          return {
            ok: false,
            error: 'The council map did not return its report document.'
          };
        }
        return {
          ok: true,
          html: report.html,
          title: report.title || 'Lot Companion Property Report'
        };
      });

      if (!result || !result.ok) {
        throw new Error(result?.error || 'The council map could not build the report.');
      }
      if (!/class=['"]report-page\b/.test(result.html)) {
        throw new Error('The council map returned an invalid report document.');
      }

      await page.setContent(result.html, {
        waitUntil: 'domcontentloaded',
        timeout: 0
      });
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        await Promise.all(
          [...document.images].map(image => {
            if (image.complete) return Promise.resolve();
            return new Promise(resolve => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            });
          })
        );
      });
      await page.emulateMediaType('print');

      const metadata = await page.evaluate(() => ({
        pageCount: document.querySelectorAll('.report-page').length,
        sectionTitles: [...document.querySelectorAll('.page-title')]
          .map(element => element.textContent.trim())
          .filter(Boolean)
      }));
      const pdf = Buffer.from(await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      }));

      if (pdf.length < 1000 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('The headless browser did not produce a valid property report PDF.');
      }

      return {
        buffer: pdf,
        title: result.title,
        pageCount: metadata.pageCount,
        sectionTitles: metadata.sectionTitles,
        diagnostics
      };
    }, timeoutMs, 'Lot Companion could not locate the parcel within the allowed time.');
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);
    }
  }
}

function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch (error) {
    throw new Error(
      'The report renderer is missing. Run npm install in the Lot Companion program folder.'
    );
  }
}

function findBrowserExecutable() {
  const candidates = [
    process.env.LOT_WISE_BROWSER_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env['PROGRAMFILES(X86)'] && path.join(
      process.env['PROGRAMFILES(X86)'],
      'Microsoft', 'Edge', 'Application', 'msedge.exe'
    ),
    process.env.PROGRAMFILES && path.join(
      process.env.PROGRAMFILES,
      'Microsoft', 'Edge', 'Application', 'msedge.exe'
    ),
    process.env.PROGRAMFILES && path.join(
      process.env.PROGRAMFILES,
      'Google', 'Chrome', 'Application', 'chrome.exe'
    ),
    process.env.LOCALAPPDATA && path.join(
      process.env.LOCALAPPDATA,
      'Google', 'Chrome', 'Application', 'chrome.exe'
    ),
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      'Microsoft Edge or Google Chrome is required to render the proper mapping report.'
    );
  }
  return executable;
}

function requiredBaseUrl() {
  const value = String(process.env.APP_BASE_URL || '').trim();
  if (!value) {
    throw new Error('APP_BASE_URL is required for browser report generation.');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('APP_BASE_URL is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
  }
  return value.replace(/\/+$/, '');
}

function rememberDiagnostic(items, message) {
  if (items.length < 20 && message) items.push(String(message).slice(0, 500));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 30000 && parsed <= 10 * 60 * 1000
    ? parsed
    : fallback;
}

async function withParcelDiscoveryTimeout(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      operation(() => {
        if (timer) clearTimeout(timer);
        timer = null;
      }),
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(codedError(message, 'parcel_not_found')),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function notifyProgress(callback, update) {
  if (typeof callback === 'function') await callback(update);
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  findBrowserExecutable,
  renderBrowserPropertyReport
};
