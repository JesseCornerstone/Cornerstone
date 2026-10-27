const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const origin = process.env.MBRC_TEST_ORIGIN || 'http://127.0.0.1:4173';

async function selectSearch(page, value) {
  const input = await page.waitForSelector('pierce/input[aria-label="Search"]', { timeout: 90000 });
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await input.type(value);
  await page.keyboard.press('Enter');
}

async function waitForSummary(page, expectedAddress, expectedLot) {
  await page.waitForFunction(
    (addressPart, lotPart) => {
      const address = document.getElementById('sumAddress')?.textContent || '';
      const lot = document.getElementById('sumLot')?.textContent || '';
      return address.toUpperCase().includes(addressPart) && lot.toUpperCase().includes(lotPart);
    },
    { timeout: 45000 },
    expectedAddress.toUpperCase(),
    expectedLot.toUpperCase()
  );
}

async function waitForPropertyPopup(page, expectedAddress, expectedLot) {
  await page.waitForFunction(
    (addressPart, lotPart) => {
      const popupText = [...document.querySelectorAll('.esri-popup, arcgis-popup')]
        .map(node => node.textContent || '')
        .join(' ')
        .toUpperCase();
      return popupText.includes(addressPart) && popupText.includes(lotPart);
    },
    { timeout: 15000 },
    expectedAddress.toUpperCase(),
    expectedLot.toUpperCase()
  );
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    const browserErrors = [];
    const searchRequests = [];
    page.on('pageerror', error => browserErrors.push(error?.stack || error?.message || String(error)));
    page.on('console', message => {
      if(message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('request', request => {
      const decodedUrl = decodeURIComponent(request.url());
      if(/MBRC_Property_Boundaries/i.test(decodedUrl) && !/[?&]where=1=1(?:&|$)/i.test(decodedUrl)){
        searchRequests.push(`${request.method()} ${request.url()} ${request.postData() || ''}`);
      }
    });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${origin}/MBRC.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });

    try {
      await selectSearch(page, '5 Botany Cres, Banksia Beach QLD 4507');
    } catch (error) {
      const pageState = await page.evaluate(() => ({
        title: document.title,
        body: document.body?.innerText?.slice(0, 2000) || '',
        moduleError: document.getElementById('lot-wise-module-load-error')?.innerText || ''
      }));
      const client = await page.createCDPSession();
      await client.send('DOM.enable');
      const flattened = await client.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
      pageState.controls = flattened.nodes
        .filter(node => ['INPUT', 'BUTTON', 'CALCITE-INPUT'].includes(node.nodeName))
        .map(node => ({ nodeName: node.nodeName, attributes: node.attributes }))
        .filter(node => /search/i.test(JSON.stringify(node)))
        .slice(0, 20);
      throw new Error(`${error.message}\n${JSON.stringify(pageState, null, 2)}\n${browserErrors.join('\n')}`);
    }
    try {
      await waitForSummary(page, '5 Botany', '0/BUP10008');
    } catch (error) {
      const searchState = await page.evaluate(() => ({
        summaryAddress: document.getElementById('sumAddress')?.textContent || '',
        summaryLot: document.getElementById('sumLot')?.textContent || '',
        pageText: document.body?.innerText?.slice(-2500) || ''
      }));
      const client = await page.createCDPSession();
      await client.send('DOM.enable');
      const flattened = await client.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
      searchState.searchInputs = flattened.nodes
        .filter(node => node.nodeName === 'INPUT' && /search/i.test(JSON.stringify(node.attributes)))
        .map(node => node.attributes);
      throw new Error(`${error.message}\n${JSON.stringify(searchState, null, 2)}\n${searchRequests.slice(-10).join('\n')}\n${browserErrors.join('\n')}`);
    }

    await selectSearch(page, '0/BUP10008');
    await waitForSummary(page, '5 Botany', '0/BUP10008');
    await waitForPropertyPopup(page, '5 Botany', '0/BUP10008');

    const summary = await page.evaluate(() => ({
      address: document.getElementById('sumAddress')?.textContent || '',
      lot: document.getElementById('sumLot')?.textContent || ''
    }));
    assert.match(summary.address, /5 Botany/i);
    assert.match(summary.lot, /0\/BUP10008/i);
  } finally {
    await browser.close();
  }
  console.log('MBRC live search and shared property-popup checks passed.');
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
  if (!executable) throw new Error('Chrome or Edge is required for the MBRC search test.');
  return executable;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
