const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const skippedDirectories = new Set([
  '.git',
  'branding-source',
  'exports',
  'node_modules',
  'removed-sections',
  'storage',
  'storage-demo',
  'tmp'
]);

const files = collectJavaScript(root);
const failures = [];

for (const file of files) {
  try {
    new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), {
      identifier: path.relative(root, file)
    });
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Syntax OK: ${files.length} JavaScript files`);
}

function collectJavaScript(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectJavaScript(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      found.push(fullPath);
    }
  }
  return found;
}
