const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const origin = process.env.BRANDING_TEST_ORIGIN || 'http://127.0.0.1:43217';

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
    await page.goto(`${origin}/Index.html`, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2800));
    const disclaimerButton = await page.$('[data-disclaimer-accept]');
    if (disclaimerButton) {
      await disclaimerButton.click();
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    const result = await page.evaluate(() => {
      const logo = document.querySelector('.brand-logo img');
      return {
        title: document.title,
        bodyText: document.body.innerText,
        logoSrc: logo?.getAttribute('src') || '',
        logoAlt: logo?.getAttribute('alt') || '',
        logoLoaded: Boolean(logo?.complete && logo.naturalWidth > 0)
      };
    });

    assert.equal(result.title, 'Lot Companion');
    assert.equal(result.logoAlt, 'Lot Companion');
    assert.match(result.logoSrc, /lot-companion-logo-white\.png/);
    assert.equal(result.logoLoaded, true);
    assert.equal(result.bodyText.includes(['Lot', 'Wise'].join(' ')), false);

    const outputDir = path.join(root, 'tmp');
    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({
      path: path.join(outputDir, 'lot-companion-home.png'),
      fullPage: false
    });
  } finally {
    await browser.close();
  }

  console.log('Lot Companion branding smoke test passed.');
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
  if (!executable) throw new Error('Chrome or Edge is required for the branding smoke test.');
  return executable;
}
