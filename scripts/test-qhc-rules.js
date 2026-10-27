"use strict";

const assert = require("assert");
const rules = require("../public/qhc-rules.js");

function confirmed(overrides) {
  return Object.assign({
    lotWidth: 12.5,
    lotDepth: 32,
    slope: 2,
    frontageType: "road",
    proposalType: "primary",
    buildingWidth: 9,
    buildingDepth: 18,
    height: 7.5,
    storeys: 2,
    frontSetback: 3,
    leftSetback: 1.5,
    otherSiteCover: 0,
    parkingSpaces: 2,
    coveredParkingSpaces: 1,
    parkingDimensions: "yes",
    garageAccessWidth: 4.8,
    posWidth: 3,
    posDepth: 5,
    posOpenSkyArea: 7.5,
    posSlope: 2,
    privacyTrigger: "no",
    maintenanceFree: "yes",
    visibleEntry: "yes",
    councilAdoption: "yes",
    dwellingPermitted: "yes",
    priorityDevelopmentArea: "no",
    overlayChecked: "yes",
    planOfDevelopmentChecked: "yes"
  }, overrides || {});
}

function get(assessment, id) {
  const check = assessment.checks.find(item => item.id === id);
  assert(check, `Missing check ${id}`);
  return check;
}

const passing = rules.assessment(confirmed());
assert.strictEqual(passing.status, "pass", "Confirmed sample should pass");
assert.strictEqual(passing.chapter, 1);
assert.strictEqual(passing.metrics.lotArea, 400);
assert.strictEqual(passing.metrics.setbacks.right, 2);
assert.strictEqual(passing.metrics.setbacks.rear, 11);

const heightFailure = rules.assessment(confirmed({ height: 9 }));
assert.strictEqual(get(heightFailure, "height").status, "fail");
assert.strictEqual(heightFailure.status, "fail");

assert.strictEqual(rules.chapterForArea(449.99), 1);
assert.strictEqual(rules.chapterForArea(450), 2);

const largeLot = rules.assessment(confirmed({
  lotWidth: 15,
  lotDepth: 40,
  buildingWidth: 10,
  buildingDepth: 20,
  frontSetback: 5,
  leftSetback: 1.5,
  posWidth: 4,
  posDepth: 5,
  posOpenSkyArea: 10,
  garageAccessWidth: 6
}));
assert.strictEqual(largeLot.chapter, 2);
assert.strictEqual(largeLot.metrics.requiredSetbacks.front, 5);
assert.strictEqual(largeLot.metrics.requiredSetbacks.left, 1.5);
assert.strictEqual(largeLot.metrics.requiredSetbacks.rear, 3);
assert.strictEqual(largeLot.metrics.maxSiteCover, 50);

const coverFailure = rules.assessment(confirmed({ buildingWidth: 12, buildingDepth: 24 }));
assert.strictEqual(get(coverFailure, "site-cover").status, "fail");

const boundaryLengthFailure = rules.assessment(confirmed({
  proposalType: "class10a",
  class10Subtype: "garage",
  buildingWidth: 6,
  buildingDepth: 10,
  height: 4.5,
  frontSetback: 5,
  leftSetback: 0,
  otherSiteCover: 100,
  garageAccessWidth: 3.3
}));
assert.strictEqual(get(boundaryLengthFailure, "btb-length").status, "fail");

const pendingScope = rules.assessment(confirmed({ councilAdoption: "unknown" }));
assert.strictEqual(get(pendingScope, "scope-adoption").status, "review");
assert.strictEqual(pendingScope.status, "review");

const pda = rules.assessment(confirmed({ priorityDevelopmentArea: "yes" }));
assert.strictEqual(get(pda, "scope-pda").status, "review");
assert.strictEqual(pda.status, "review");

console.log(`QHC rule tests passed (${passing.checks.length} checks in the confirmed sample).`);
