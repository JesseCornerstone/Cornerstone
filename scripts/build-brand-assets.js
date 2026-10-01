const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const imageDir = path.join(root, 'public', 'images');

const assets = [
  ['lot-companion-icon', 512, 512],
  ['lot-companion-mark-black', 512, 512],
  ['lot-companion-mark-white', 512, 512],
  ['lot-companion-logo-black', 780, 220],
  ['lot-companion-logo-white', 780, 220]
];

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
    for (const [name, width, height] of assets) {
      await renderSvg(browser, name, width, height);
    }

    const icon256 = path.join(imageDir, 'lot-companion-icon-256.png');
    await renderSvg(browser, 'lot-companion-icon', 256, 256, icon256);
    const icon512 = path.join(imageDir, 'lot-companion-icon.png');
    const ico = createIco(fs.readFileSync(icon256));

    fs.copyFileSync(icon512, path.join(root, 'public', 'Favicon.png'));
    fs.copyFileSync(icon512, path.join(imageDir, 'Favicon.png'));
    fs.writeFileSync(path.join(root, 'public', 'Favicon.ico'), ico);
    fs.writeFileSync(path.join(imageDir, 'Favicon.ico'), ico);
    fs.writeFileSync(path.join(imageDir, 'lot-companion-icon.ico'), ico);
  } finally {
    await browser.close();
  }

  console.log('Built Lot Companion SVG, PNG and ICO brand assets.');
}

async function renderSvg(browser, name, width, height, outputPath) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(imageDir, `${name}.svg`)).href, {
      waitUntil: 'load'
    });
    await page.evaluate(({ width: targetWidth, height: targetHeight }) => {
      const svg = document.documentElement;
      svg.setAttribute('width', String(targetWidth));
      svg.setAttribute('height', String(targetHeight));
      svg.style.display = 'block';
    }, { width, height });
    await page.screenshot({
      path: outputPath || path.join(imageDir, `${name}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width, height }
    });
  } finally {
    await page.close();
  }
}

function createIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
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
  if (!executable) {
    throw new Error('Chrome or Edge is required to build the Lot Companion raster assets.');
  }
  return executable;
}
