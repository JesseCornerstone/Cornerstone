const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const councilDir = path.join(root, 'public', 'Js', 'councils');
const hubPath = path.join(root, 'public', 'Js', 'council-hub.js');

class FakeSearch {
  constructor() {
    this.handlers = {};
  }

  on(name, handler) {
    this.handlers[name] = handler;
    return { remove: () => delete this.handlers[name] };
  }

  emit(name, event) {
    return this.handlers[name](event);
  }
}

const point = (x, y) => ({
  type: 'point',
  x,
  y,
  spatialReference: { wkid: 4326 }
});

async function loadHub() {
  global.document = { getElementById: () => null };
  const source = fs.readFileSync(hubPath, 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

async function testSearchEvents(hub) {
  const address = { name: 'Address', feature: { geometry: point(153.1, -27.1) } };
  const lot = {
    name: 'Lot 1 on SP1',
    feature: { geometry: { type: 'polygon', centroid: point(153.2, -27.2) } }
  };
  const search = new FakeSearch();
  const calls = [];

  hub.wireSearchResultSelection(search, async (mapPoint, { searchResult }) => {
    calls.push([mapPoint.x, searchResult.name]);
  });

  await search.emit('search-complete', {
    results: [
      { source: { name: 'Address' }, results: [address] },
      { source: { name: 'Lot/Plan (QLD)' }, results: [lot] }
    ]
  });
  await search.emit('select-result', { result: lot });

  assert.deepEqual(calls, [[153.2, 'Lot 1 on SP1']], 'duplicate search events must select once');

  const otherLot = { name: 'Lot 2 on SP1', feature: { geometry: point(153.20001, -27.2) } };
  await search.emit('select-result', { result: otherLot });
  assert.equal(calls.length, 2, 'a different result must still select');
}

function testStrictPropertyMatching(hub) {
  const mbrcParcel = { attributes: { LOT: '12', PLAN_: 'SP12345' } };
  assert.equal(hub.isExactCadastralLotPlan(mbrcParcel, '12', 'SP12345'), true);
  assert.equal(hub.isExactCadastralLotPlan(mbrcParcel, '012', 'SP012345'), true);
  assert.equal(hub.isExactCadastralLotPlan(mbrcParcel, '112', 'SP12345'), false);
  assert.equal(hub.isExactCadastralLotPlan(mbrcParcel, '12', 'SP123456'), false);
  assert.equal(
    hub.isExactCadastralLotPlan({ LOTPLAN: '12/SP12345' }, '12', 'SP12345'),
    true
  );

  assert.ok(
    hub.scorePropertyAddressMatch(
      '12 King St, Caboolture QLD 4510',
      '12 KING STREET CABOOLTURE'
    ) > 0,
    'street abbreviations and QLD postcode text should normalize'
  );
  assert.equal(
    hub.scorePropertyAddressMatch('12 King Street Caboolture', '112 KING STREET CABOOLTURE'),
    0,
    'a house number must match as a whole token'
  );
  assert.equal(
    hub.scorePropertyAddressMatch('12 King Street Caboolture', '12 KINGFISHER STREET CABOOLTURE'),
    0,
    'a full street name must not match inside another street name'
  );
  assert.equal(
    hub.scorePropertyAddressMatch('1/12 King Street', '12 KING STREET CABOOLTURE'),
    0,
    'a requested unit number must not silently select the parent address'
  );
  assert.ok(
    hub.scorePropertyAddressMatch('12 Bot', '12 BOTANY CRESCENT BANKSIA BEACH', {
      allowLastTokenPrefix: true
    }) > 0,
    'the final suggestion token may remain a text prefix'
  );
}

function testCouncilWiring() {
  const files = fs.readdirSync(councilDir).filter(file => file.endsWith('.js')).sort();
  assert.equal(files.length, 14, 'expected every council module');

  for (const file of files) {
    const source = fs.readFileSync(path.join(councilDir, file), 'utf8');
    assert.match(source, /async function selectParcelAtPoint\s*\(/, `${file} needs the shared click selector`);
    assert.match(source, /view\.on\("click",[\s\S]*?selectParcelAtPoint\(ev\.mapPoint\)/, `${file} map clicks must use the selector`);
    assert.match(source, /wireSearchResultSelection\(search,/, `${file} searches must use the selector`);
  }
}

async function main() {
  const hub = await loadHub();
  await testSearchEvents(hub);
  testStrictPropertyMatching(hub);
  testCouncilWiring();
  console.log('Search selection checks passed for all 14 council pages.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
