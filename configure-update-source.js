const fs = require('fs');
const path = require('path');
const readline = require('readline');

const configPath = path.join(__dirname, 'mapping-app.config.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

question(
  'Paste the master Lot Companion program folder path for automatic updates, or press Enter to disable updates: '
)
  .then(answer => {
    const source = stripQuotes(answer.trim());
    const config = readConfig();

    if (!source) {
      config.autoUpdate = false;
      config.updateSource = '';
      writeConfig(config);
      console.log('Auto-update disabled.');
      return;
    }

    const sourceDir = path.resolve(source);
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      console.error(`Folder not found: ${sourceDir}`);
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(path.join(sourceDir, 'local-static-server.js'))) {
      console.error('That folder does not look like the Lot Companion program folder.');
      process.exitCode = 1;
      return;
    }

    config.autoUpdate = true;
    config.updateSource = sourceDir;
    writeConfig(config);
    console.log(`Auto-update enabled from: ${sourceDir}`);
  })
  .finally(() => rl.close());

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function readConfig() {
  const defaults = {
    autoUpdate: false,
    updateSource: '',
    browser: 'chrome',
    browserMode: 'window',
    portMode: 'auto',
    reuseExistingServer: true,
    defaultPage: 'Index.html'
  };

  try {
    if (!fs.existsSync(configPath)) return defaults;
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch {
    return defaults;
  }
}

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, '');
}
