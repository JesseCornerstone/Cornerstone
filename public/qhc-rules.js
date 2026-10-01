(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QHCRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = {
    label: "Queensland Housing Code — pending publication version",
    published: "3 August 2026",
    proposedCommencement: "1 September 2026",
    sourceUrl: "https://www.housing.qld.gov.au/__data/assets/pdf_file/0028/92179/queensland-housing-code-pending-publication-version-082026.pdf"
  };

  const STATUS = Object.freeze({ PASS: "pass", FAIL: "fail", REVIEW: "review", NA: "na" });

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function yesNoUnknown(value) {
    return value === "yes" || value === true ? "yes" : value === "no" || value === false ? "no" : "unknown";
  }

  function result(id, group, title, status, measured, required, detail, clause, visual) {
    return { id, group, title, status, measured, required, detail, clause, visual: visual || null };
  }

  function chapterForArea(area) {
    return number(area, 0) < 450 ? 1 : 2;
  }

  function primaryFrontSetback(chapter, frontageType) {
    if (frontageType === "laneway" || frontageType === "parkway") return 2;
    return chapter === 1 ? 3 : 5;
  }

  function commonBoundarySetbacks(chapter, proposalType, height, lotWidth) {
    const h = number(height, 0);
    if (proposalType === "secondary" && h <= 4.5) {
      return chapter === 1 ? { side: 1, rear: 1.5 } : { side: 1.5, rear: 2 };
    }
    if (proposalType === "class10a" && h <= 4.5) return { side: 0, rear: 0, builtToBoundary: true };
    if (chapter === 1) {
      if (h <= 4.5) return { side: 1, rear: 3 };
      if (h <= 8.5) return { side: 1, rear: 2.5 };
      return { side: number(lotWidth, 0) <= 12.5 ? 2 : 2.5, rear: 2.5 };
    }
    if (h <= 4.5) return { side: 1.5, rear: 4 };
    if (h <= 8.5) return { side: 1.5, rear: 3 };
    return { side: 2.5, rear: 3 };
  }

  function frontSetback(chapter, proposalType, subtype, frontageType, height, meanHeight) {
    if (proposalType !== "class10a") return primaryFrontSetback(chapter, frontageType);
    if (subtype === "carport" && number(height, 0) <= 4.5 && number(meanHeight, 0) <= 3.5) return 0;
    if (chapter === 1) return subtype === "shed" ? 5.4 : 5;
    return subtype === "shed" ? 6 : 5.6;
  }

  function maxGarageAccess(lotWidth, storeys, overhangsGarage, secondaryFrontage) {
    if (secondaryFrontage) return 6;
    const width = number(lotWidth, 0);
    if (width > 12.5) return 6;
    if (width > 10) return number(storeys, 1) >= 2 && overhangsGarage ? 6 : 4.8;
    return number(storeys, 1) >= 2 && overhangsGarage ? 4.8 : 3.3;
  }

  function assessment(input) {
    const i = Object.assign({
      lotWidth: 12.5,
      lotDepth: 32,
      slope: 0,
      frontageType: "road",
      proposalType: "primary",
      class10Subtype: "garage",
      buildingWidth: 9,
      buildingDepth: 18,
      height: 7.5,
      meanHeight: 3.5,
      storeys: 2,
      frontSetback: 5,
      leftSetback: 1.5,
      otherSiteCover: 0,
      hasSecondaryDwelling: false,
      parkingSpaces: 2,
      coveredParkingSpaces: 1,
      parkingDimensions: "unknown",
      garageAccessWidth: 4.8,
      garageOverhang: false,
      garageFacesSecondaryFrontage: false,
      posWidth: 4,
      posDepth: 5,
      posOpenSkyArea: 10,
      posSlope: 2,
      privacyTrigger: "unknown",
      privacySolution: "unknown",
      maintenanceFree: "unknown",
      visibleEntry: "unknown",
      councilAdoption: "unknown",
      dwellingPermitted: "unknown",
      priorityDevelopmentArea: "no",
      overlayChecked: "unknown",
      planOfDevelopmentChecked: "unknown"
    }, input || {});

    const lotWidth = Math.max(0, number(i.lotWidth, 0));
    const lotDepth = Math.max(0, number(i.lotDepth, 0));
    const lotArea = lotWidth * lotDepth;
    const buildingWidth = Math.max(0, number(i.buildingWidth, 0));
    const buildingDepth = Math.max(0, number(i.buildingDepth, 0));
    const footprint = buildingWidth * buildingDepth;
    const height = Math.max(0, number(i.height, 0));
    const front = number(i.frontSetback, 0);
    const left = number(i.leftSetback, 0);
    const right = lotWidth - left - buildingWidth;
    const rear = lotDepth - front - buildingDepth;
    const chapter = chapterForArea(lotArea);
    const common = commonBoundarySetbacks(chapter, i.proposalType, height, lotWidth);
    const requiredFront = frontSetback(chapter, i.proposalType, i.class10Subtype, i.frontageType, height, i.meanHeight);
    const maxHeight = (i.proposalType === "class10a" ? 4.5 : 8.5) + (number(i.slope, 0) > 15 ? 1.5 : 0);
    const maxSiteCover = chapter === 1 ? (lotArea <= 250 ? 65 : 60) : 50;
    const totalCoveredArea = footprint + Math.max(0, number(i.otherSiteCover, 0));
    const siteCover = lotArea > 0 ? totalCoveredArea / lotArea * 100 : Infinity;
    const checks = [];

    function thresholdCheck(id, group, title, actual, required, operator, clause, detail, visual) {
      const ok = operator === "max" ? actual <= required + 1e-7 : actual + 1e-7 >= required;
      checks.push(result(id, group, title, ok ? STATUS.PASS : STATUS.FAIL,
        Number.isFinite(actual) ? actual : null, required, detail, clause, visual));
    }

    const pda = yesNoUnknown(i.priorityDevelopmentArea);
    checks.push(result("scope-pda", "Scope", "Priority development area", pda === "no" ? STATUS.PASS : STATUS.REVIEW,
      pda, "The QHC does not apply in a PDA", pda === "yes" ? "Use the applicable EDQ land use plan and guidelines." : "Confirm the site is not in a priority development area.", "Preliminary 4(4)(e)"));

    const permitted = yesNoUnknown(i.dwellingPermitted);
    checks.push(result("scope-zone", "Scope", "Dwelling is a permitted use", permitted === "yes" ? STATUS.PASS : permitted === "no" ? STATUS.FAIL : STATUS.REVIEW,
      permitted, "Dwelling must be a permitted use in the zone", "Confirm the planning scheme category for a dwelling house.", "Preliminary 4(2)"));

    const adoption = yesNoUnknown(i.councilAdoption);
    checks.push(result("scope-adoption", "Scope", "Council adoption / applicable provisions", adoption === "yes" ? STATUS.PASS : adoption === "no" ? STATUS.REVIEW : STATUS.REVIEW,
      adoption, "Confirm during the three-year transition", "The pending QHC may not yet be the applicable siting code for this council.", "QHC transition arrangements"));

    const overlay = yesNoUnknown(i.overlayChecked);
    checks.push(result("scope-overlay", "Scope", "Relevant overlays reviewed", overlay === "yes" ? STATUS.PASS : overlay === "no" ? STATUS.FAIL : STATUS.REVIEW,
      overlay, "Overlay variations must be applied", "A relevant overlay can vary QHC requirements to the extent stated.", "Preliminary 4(7)"));

    const pod = yesNoUnknown(i.planOfDevelopmentChecked);
    checks.push(result("scope-pod", "Scope", "Plan of development reviewed", pod === "yes" ? STATUS.PASS : pod === "no" ? STATUS.REVIEW : STATUS.REVIEW,
      pod, "Approved PoD may be an acceptable solution", "Check whether an approved plan of development controls the lot.", "Preliminary 7(3)(a)"));

    thresholdCheck("height", "Built form", "Building height", height, maxHeight, "max", "A1.1", `Maximum ${maxHeight.toFixed(1)}m${number(i.slope, 0) > 15 ? " including the steep-lot increase" : ""}.`, "height");
    thresholdCheck("front", "Setbacks", "Primary frontage setback", front, requiredFront, "min", "A2.1 Table 1", `External wall setback for the selected building and frontage type.`, "front");
    thresholdCheck("left", "Setbacks", "Left side setback", left, common.side, "min", "A3.1 Table 3", `Minimum side setback ${common.side.toFixed(1)}m.`, "left");
    thresholdCheck("right", "Setbacks", "Right side setback", right, common.side, "min", "A3.1 Table 3", `Derived from lot width, building width and left setback.`, "right");
    thresholdCheck("rear", "Setbacks", "Rear setback", rear, common.rear, "min", "A3.1 Table 3", `Derived from lot depth, building depth and frontage setback.`, "rear");

    if (i.proposalType === "class10a" && common.builtToBoundary) {
      const sideBoundaryLength = buildingDepth;
      const rearBoundaryLength = buildingWidth;
      const leftBTB = left < 0.75;
      const rightBTB = right < 0.75;
      const rearBTB = rear < 0.75;
      const longest = Math.max(leftBTB || rightBTB ? sideBoundaryLength : 0, rearBTB ? rearBoundaryLength : 0);
      thresholdCheck("btb-length", "Setbacks", "Built-to-boundary length", longest, 9, "max", "A3.1 Table 3", "Garage, carport, laundry or shed: maximum 9m combined length along each common boundary.", "boundary");
    }

    thresholdCheck("site-cover", "Site planning", "Site cover", siteCover, maxSiteCover, "max", "A4.1", `${totalCoveredArea.toFixed(1)}m² of ${lotArea.toFixed(1)}m² assessable lot area.`, "cover");

    if (i.proposalType === "secondary") {
      const maxIfa = chapter === 1 || lotArea < 1000 ? 50 : 60;
      const ifa = footprint * Math.max(1, number(i.storeys, 1));
      thresholdCheck("secondary-ifa", "Site planning", "Secondary dwelling internal floor area", ifa, maxIfa, "max", "A4.2", "Vehicle parking area is not included in IFA.", "cover");
    }

    if (i.proposalType !== "class10a") {
      const requiredSpaces = i.hasSecondaryDwelling || i.proposalType === "secondary" ? 3 : 2;
      thresholdCheck("parking-count", "Access & amenity", "Vehicle parking spaces", number(i.parkingSpaces, 0), requiredSpaces, "min", "A8.1", "At least one space must be in a garage or carport.", "parking");
      thresholdCheck("parking-covered", "Access & amenity", "Covered parking spaces", number(i.coveredParkingSpaces, 0), 1, "min", "A8.1", "At least one covered space is required.", "parking");
      const sized = yesNoUnknown(i.parkingDimensions);
      checks.push(result("parking-size", "Access & amenity", "Parking-space dimensions", sized === "yes" ? STATUS.PASS : sized === "no" ? STATUS.FAIL : STATUS.REVIEW,
        sized, "AS 2890.1:2004 or QHC Table 5", "Confirm the clear width and depth of every parking space.", "A8.2", "parking"));
    }

    if (number(i.garageAccessWidth, 0) > 0 && i.frontageType !== "laneway") {
      const maxAccess = maxGarageAccess(lotWidth, i.storeys, !!i.garageOverhang, !!i.garageFacesSecondaryFrontage);
      thresholdCheck("garage-access", "Access & amenity", "Garage / carport access width", number(i.garageAccessWidth, 0), maxAccess, "max", "A9.1 Table 6", "The separate wide-lot additional-opening exception is not modelled.", "garage");
    }

    if (i.proposalType !== "class10a" && lotArea < 2000) {
      const minPosWidth = chapter === 1 ? 3 : 4;
      const minPosArea = chapter === 1 ? 15 : 20;
      const minOpenSky = chapter === 1 ? 7.5 : 10;
      const posArea = Math.max(0, number(i.posWidth, 0)) * Math.max(0, number(i.posDepth, 0));
      thresholdCheck("pos-width", "Access & amenity", "Private open-space minimum dimension", Math.min(number(i.posWidth, 0), number(i.posDepth, 0)), minPosWidth, "min", "A11.1 Table 7", "For private open space located 2m or less above ground level.", "pos");
      thresholdCheck("pos-area", "Access & amenity", "Private open-space area", posArea, minPosArea, "min", "A11.1 Table 7", "Must be directly accessible from a habitable room other than a bedroom.", "pos");
      thresholdCheck("pos-sky", "Access & amenity", "Private open space open to sky", number(i.posOpenSkyArea, 0), minOpenSky, "min", "A11.1 Table 7", "Minimum portion open to the sky.", "pos");
      thresholdCheck("pos-slope", "Access & amenity", "Private open-space slope", number(i.posSlope, 0), 5, "max", "A11.1 Table 7", "Maximum 5% slope for ground-level private open space.", "pos");
    }

    const privacyTrigger = yesNoUnknown(i.privacyTrigger);
    const privacySolution = yesNoUnknown(i.privacySolution);
    let privacyStatus = STATUS.REVIEW;
    if (privacyTrigger === "no") privacyStatus = STATUS.PASS;
    if (privacyTrigger === "yes") privacyStatus = privacySolution === "yes" ? STATUS.PASS : privacySolution === "no" ? STATUS.FAIL : STATUS.REVIEW;
    checks.push(result("privacy", "Manual review", "Visual privacy", privacyStatus, privacyTrigger,
      "Triggered windows/decks require a listed privacy measure", "Review windows within 1–1.5m and elevated outdoor areas within 2m of common boundaries.", "A5", "privacy"));

    const nearBoundary = Math.min(left, right, rear) < 0.75;
    const maintenance = yesNoUnknown(i.maintenanceFree);
    const maintenanceStatus = !nearBoundary ? STATUS.NA : maintenance === "yes" ? STATUS.PASS : maintenance === "no" ? STATUS.FAIL : STATUS.REVIEW;
    checks.push(result("maintenance", "Manual review", "Maintenance-free inaccessible walls", maintenanceStatus, maintenance,
      "Walls within 750mm must be maintenance free", nearBoundary ? "At least one wall is within 750mm of a common boundary." : "No modelled wall is within 750mm of a common boundary.", "A6.1", "boundary"));

    if (i.proposalType === "primary" && lotArea < 2000) {
      const visible = yesNoUnknown(i.visibleEntry);
      checks.push(result("entry", "Manual review", "Identifiable dwelling entry", visible === "yes" ? STATUS.PASS : visible === "no" ? STATUS.FAIL : STATUS.REVIEW,
        visible, "Visible door/path or numbered gate/entry structure", "Battle axe lots are exempt.", "A7.1", "entry"));
    }

    const failCount = checks.filter(c => c.status === STATUS.FAIL).length;
    const reviewCount = checks.filter(c => c.status === STATUS.REVIEW).length;
    const passCount = checks.filter(c => c.status === STATUS.PASS).length;
    const applicableCount = checks.filter(c => c.status !== STATUS.NA).length;
    const outcome = failCount ? STATUS.FAIL : reviewCount ? STATUS.REVIEW : STATUS.PASS;

    return {
      version: VERSION,
      status: outcome,
      chapter,
      chapterLabel: chapter === 1 ? "QDC Part 1.1 · lot under 450m²" : "QDC Part 1.2 · lot 450m² and over",
      checks,
      counts: { pass: passCount, fail: failCount, review: reviewCount, applicable: applicableCount },
      metrics: {
        lotArea, lotWidth, lotDepth, footprint, totalCoveredArea, siteCover,
        setbacks: { front, left, right, rear },
        requiredSetbacks: { front: requiredFront, left: common.side, right: common.side, rear: common.rear },
        maxHeight, maxSiteCover
      }
    };
  }

  return {
    VERSION,
    STATUS,
    assessment,
    chapterForArea,
    commonBoundarySetbacks,
    frontSetback,
    maxGarageAccess
  };
});
