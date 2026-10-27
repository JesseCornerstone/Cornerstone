const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

async function main() {
  global.document = {
    getElementById: () => null,
    visibilityState: 'visible'
  };
  global.window = {};
  global.requestAnimationFrame = callback => callback();

  const hubPath = path.join(__dirname, '..', 'public', 'Js', 'council-hub.js');
  const hubSource = fs.readFileSync(hubPath, 'utf8');
  const hub = await import(`data:text/javascript;base64,${Buffer.from(hubSource).toString('base64')}`);

  assert.equal(
    hub.parseReportAddress({ FULL_ADDRESS: '266 George Street, Brisbane QLD 4000' }),
    '266 George St, Brisbane QLD 4000'
  );
  assert.equal(
    hub.parseReportAddress({
      house_no: '12',
      street_name: 'Queen',
      street_type: 'Road',
      suburb: 'Gympie',
      postcode: '4570'
    }),
    '12 Queen Rd, Gympie QLD 4570'
  );
  assert.equal(
    hub.parseReportAddress({
      house_no: '71',
      street_name: 'FRENCHS',
      street_type: 'ROAD',
      suburb: 'PETRIE',
      postcode: '4502'
    }),
    '71 Frenchs Rd, Petrie QLD 4502'
  );
  assert.equal(
    hub.formatReportAddress('71 FRENCHS ROAD PETRIE QUEENSLAND 4502, AUSTRALIA'),
    '71 Frenchs Rd, Petrie QLD 4502'
  );
  assert.equal(
    hub.formatReportAddress('71 FRENCHS Rd, PETRIE, QLD, 4502, AUS'),
    '71 Frenchs Rd, Petrie QLD 4502'
  );
  assert.equal(
    hub.formatReportAddress('5 SAMPLE CCT NORTH LAKES QLD 4509'),
    '5 Sample Cct, North Lakes QLD 4509'
  );
  assert.equal(
    hub.ensureReportAddressLocality(
      '12 Queen Road QLD 4570',
      { SUBURB: 'Gympie', STATE: 'QLD', POSTCODE: '4570' }
    ),
    '12 Queen Rd, Gympie QLD 4570'
  );
  assert.equal(hub.formatReportAddress('Lot 1 on RP12345'), null);

  const hintedAddress = await hub.resolvePropertyReportAddress({
    parcelFeature: {
      attributes: { LOT_PLAN: '1/RP12345', SUBURB: 'Brisbane', POSTCODE: '4000' }
    },
    hintAddress: '266 George Street, Brisbane QLD 4000',
    fetchImpl: async () => {
      throw new Error('A valid selected address must take priority over lot/plan lookup.');
    }
  });
  assert.equal(hintedAddress, '266 George St, Brisbane QLD 4000');

  const layerAddress = await hub.resolvePropertyReportAddress({
    geometry: { centroid: { x: 1, y: 2 } },
    parcelFeature: {
      attributes: { LOT_PLAN: '1/RP12345', SUBURB: 'Toowoomba', POSTCODE: '4350' }
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ features: [] }) }),
    scanAddressLayers: async () => '8 Ruthven Street',
    reverseGeocode: async () => {
      throw new Error('A valid council-layer address must take priority over reverse geocoding.');
    }
  });
  assert.equal(layerAddress, '8 Ruthven St, Toowoomba QLD 4350');

  const lotPlanAddress = await hub.queryReportAddressByLotPlan(
    { attributes: { LOT_PLAN: '2/SP123456' } },
    {
      fetchImpl: async (_url, options) => {
        assert.match(String(options.body), /lotplan%3D/);
        return {
          ok: true,
          json: async () => ({
            features: [{ attributes: { ADDRESS: '4 Example Avenue, Ipswich QLD 4305' } }]
          })
        };
      }
    }
  );
  assert.equal(lotPlanAddress, '4 Example Ave, Ipswich QLD 4305');

  console.log('Shared report-address tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
