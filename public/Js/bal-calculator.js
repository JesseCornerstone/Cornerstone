// Shared preliminary Bushfire Attack Level calculator for every council map.
//
// The calculation follows the AS 3959:2018 Appendix B radiant-heat sequence.
// It is deliberately transparent about its inputs: mapping can identify a
// potentially affected parcel, but vegetation, slope and separation still need
// to be measured and confirmed for the proposed building location.

export const BAL_VEGETATION_CLASSES = Object.freeze({
  forest: Object.freeze({
    label: 'Forest',
    model: 'forest',
    surfaceFuelLoad: 25,
    totalFuelLoad: 35,
    vegetationHeight: null
  }),
  woodland: Object.freeze({
    label: 'Woodland',
    model: 'forest',
    surfaceFuelLoad: 15,
    totalFuelLoad: 25,
    vegetationHeight: null
  }),
  shrubland: Object.freeze({
    label: 'Shrubland',
    model: 'shrub',
    surfaceFuelLoad: 15,
    totalFuelLoad: 15,
    vegetationHeight: 1.5
  }),
  scrub: Object.freeze({
    label: 'Scrub',
    model: 'shrub',
    surfaceFuelLoad: 25,
    totalFuelLoad: 25,
    vegetationHeight: 3
  }),
  mallee: Object.freeze({
    label: 'Mallee / mulga',
    model: 'shrub',
    surfaceFuelLoad: 8,
    totalFuelLoad: 8,
    vegetationHeight: 3
  }),
  rainforest: Object.freeze({
    label: 'Rainforest',
    model: 'forest',
    surfaceFuelLoad: 10,
    totalFuelLoad: 12,
    vegetationHeight: null
  }),
  tussock: Object.freeze({
    label: 'Tussock moorland',
    model: 'tussock',
    surfaceFuelLoad: 17,
    totalFuelLoad: 17,
    vegetationHeight: null
  }),
  grassland: Object.freeze({
    label: 'Grassland',
    model: 'grass',
    surfaceFuelLoad: 4.5,
    totalFuelLoad: 4.5,
    vegetationHeight: null
  })
});

const BAL_LEVEL_RANK = Object.freeze({
  'BAL-Low': 0,
  'BAL-12.5': 1,
  'BAL-19': 2,
  'BAL-29': 3,
  'BAL-40': 4,
  'BAL-FZ': 5
});

const BAL_SIGMA_KW = 5.67e-11;
const BAL_HEAT_OF_COMBUSTION = 18600;
const BAL_DEFAULT_FLAME_TEMPERATURE = 1090;
const BAL_DEFAULT_AMBIENT_TEMPERATURE = 308;
const BAL_DEFAULT_RELATIVE_HUMIDITY = 0.25;
const BAL_DEFAULT_EMISSIVITY = 0.95;
const BAL_DEFAULT_FLAME_WIDTH = 100;
const BAL_DEFAULT_WIND_SPEED = 45;

const balToNumber = (value, fallback = NaN) => {
  if(value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const balClamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const balRadians = degrees => degrees * Math.PI / 180;

const balRequireRange = (name, value, minimum, maximum, { inclusiveMinimum = true } = {}) => {
  const validMinimum = inclusiveMinimum ? value >= minimum : value > minimum;
  if(!Number.isFinite(value) || !validMinimum || value > maximum){
    const lowerText = inclusiveMinimum ? `${minimum}` : `more than ${minimum}`;
    throw new RangeError(`${name} must be ${lowerText} to ${maximum}.`);
  }
};

/** Convert the AS 3959 deemed FFDI values to GFDI for grassland modelling. */
export function grasslandFdiFor(ffdi) {
  const value = balToNumber(ffdi);
  balRequireRange('FFDI', value, 1, 250);
  const points = [
    [40, 50],
    [50, 70],
    [70, 100],
    [80, 110],
    [100, 130]
  ];

  if(value <= points[0][0]) return points[0][1] * value / points[0][0];
  for(let index = 1; index < points.length; index += 1){
    const lower = points[index - 1];
    const upper = points[index];
    if(value <= upper[0]){
      const fraction = (value - lower[0]) / (upper[0] - lower[0]);
      return lower[1] + fraction * (upper[1] - lower[1]);
    }
  }
  const lower = points[points.length - 2];
  const upper = points[points.length - 1];
  return upper[1] + (value - upper[0]) * (upper[1] - lower[1]) / (upper[0] - lower[0]);
}

/** Assign a BAL from calculated radiant heat. BAL-Low needs a separate exclusion. */
export function classifyBal(radiantHeat, { lowThreat = false, distance = null } = {}) {
  const heat = balToNumber(radiantHeat);
  if(lowThreat || (Number.isFinite(Number(distance)) && Number(distance) > 100)) return 'BAL-Low';
  if(!Number.isFinite(heat) || heat < 0) throw new RangeError('Radiant heat must be zero or greater.');
  if(heat <= 12.5) return 'BAL-12.5';
  if(heat <= 19) return 'BAL-19';
  if(heat <= 29) return 'BAL-29';
  if(heat <= 40) return 'BAL-40';
  return 'BAL-FZ';
}

function balViewFactor({ flameLength, flameWidth, flameAngle, siteSlope, distance, receiverElevation }) {
  if(flameLength < 0.1) return 0;
  const alpha = balRadians(flameAngle);
  const theta = balRadians(siteSlope);
  const halfProjection = 0.5 * flameLength * Math.cos(alpha);
  const separation = distance - halfProjection;
  if(separation <= 0) return 1;

  const tangent = Math.tan(theta);
  const x1 = (
    flameLength * Math.sin(alpha)
    - halfProjection * tangent
    - distance * tangent
    - receiverElevation
  ) / separation;
  const x2 = (receiverElevation + separation * tangent) / separation;
  const y = 0.5 * flameWidth / separation;

  const term = (x, width) => {
    const rootX = Math.sqrt(1 + x * x);
    const rootY = Math.sqrt(1 + width * width);
    return (x / rootX) * Math.atan(width / rootX)
      + (width / rootY) * Math.atan(x / rootY);
  };

  return balClamp((term(x1, y) + term(x2, y)) / Math.PI, 0, 1);
}

function balPeakViewFactor({ flameLength, flameWidth, siteSlope, distance }) {
  let best = {
    viewFactor: 0,
    flameAngle: 90,
    receiverElevation: 0,
    pathLength: distance
  };

  for(let angle = 0; angle <= 90; angle += 0.25){
    const alpha = balRadians(angle);
    const receiverElevation = Math.max(
      0,
      0.5 * flameLength * Math.sin(alpha) - distance * Math.tan(balRadians(siteSlope))
    );
    const viewFactor = balViewFactor({
      flameLength,
      flameWidth,
      flameAngle: angle,
      siteSlope,
      distance,
      receiverElevation
    });
    if(viewFactor > best.viewFactor){
      best = {
        viewFactor,
        flameAngle: angle,
        receiverElevation,
        pathLength: Math.max(0, distance - 0.5 * flameLength * Math.cos(alpha))
      };
    }
  }
  return best;
}

function balAtmosphericTransmissivity(pathLength, {
  ambientTemperature = BAL_DEFAULT_AMBIENT_TEMPERATURE,
  flameTemperature = BAL_DEFAULT_FLAME_TEMPERATURE,
  relativeHumidity = BAL_DEFAULT_RELATIVE_HUMIDITY
} = {}) {
  if(pathLength <= 0) return 1;
  const constants = [
    [1.486, -0.002003, 0.0000468, -0.06052],
    [0.01225, -0.000059, 0.00000166, -0.001759],
    [-0.0001489, 0.0000006893, -0.00000001922, 0.00002092],
    [0.0000008381, -0.000000003823, 0.00000000010511, -0.0000001166],
    [-0.000000001685, 0.000000000007637, -0.0000000000002085, 0.000000000235]
  ];
  const coefficients = constants.map(([c1, c2, c3, c4]) =>
    c1 + c2 * ambientTemperature + c3 * flameTemperature + c4 * relativeHumidity
  );
  const transmissivity = coefficients.reduce(
    (sum, coefficient, power) => sum + coefficient * Math.pow(pathLength, power),
    0
  );
  return balClamp(transmissivity, 0, 1);
}

/**
 * Calculate one vegetation exposure using the AS 3959 Appendix B sequence.
 * The highest exposure from every direction around a building governs the lot.
 */
export function calculateBalMethod2(input = {}) {
  const vegetationKey = String(input.vegetation || 'forest').toLowerCase();
  const profile = BAL_VEGETATION_CLASSES[vegetationKey];
  if(!profile) throw new RangeError('Select a recognised vegetation classification.');

  const lowThreat = input.lowThreat === true;
  const ffdi = balToNumber(input.ffdi, 40);
  const distance = balToNumber(input.distance, 20);
  const effectiveSlope = balToNumber(input.effectiveSlope, 0);
  const siteSlopeMagnitude = balToNumber(input.siteSlope, effectiveSlope);
  const slopeType = String(input.slopeType || 'level').toLowerCase();
  const surfaceFuelLoad = balToNumber(input.surfaceFuelLoad, profile.surfaceFuelLoad);
  const totalFuelLoad = balToNumber(input.totalFuelLoad, profile.totalFuelLoad);
  const vegetationHeight = balToNumber(input.vegetationHeight, profile.vegetationHeight);
  const windSpeed = balToNumber(input.windSpeed, BAL_DEFAULT_WIND_SPEED);
  const grassFdi = balToNumber(input.grassFdi, grasslandFdiFor(ffdi));
  const flameWidth = balToNumber(input.flameWidth, BAL_DEFAULT_FLAME_WIDTH);
  const flameTemperature = balToNumber(input.flameTemperature, BAL_DEFAULT_FLAME_TEMPERATURE);
  const ambientTemperature = balToNumber(input.ambientTemperature, BAL_DEFAULT_AMBIENT_TEMPERATURE);
  const relativeHumidity = balToNumber(input.relativeHumidity, BAL_DEFAULT_RELATIVE_HUMIDITY);
  const emissivity = balToNumber(input.emissivity, BAL_DEFAULT_EMISSIVITY);
  const tussockMoistureFactor = balToNumber(input.tussockMoistureFactor, 5);
  const tussockAge = balToNumber(input.tussockAge, 20);

  if(!['downslope', 'level', 'upslope'].includes(slopeType)){
    throw new RangeError('Slope type must be downslope, level or upslope.');
  }
  balRequireRange('FFDI', ffdi, 1, 250);
  balRequireRange('Distance', distance, 0, 500, { inclusiveMinimum: false });
  balRequireRange('Effective slope', effectiveSlope, 0, slopeType === 'upslope' ? 15 : 20);
  balRequireRange('Site slope', siteSlopeMagnitude, 0, 30);
  balRequireRange('Surface fuel load', surfaceFuelLoad, 0, 100, { inclusiveMinimum: false });
  balRequireRange('Total fuel load', totalFuelLoad, surfaceFuelLoad, 150);
  balRequireRange('Wind speed', windSpeed, 0, 150, { inclusiveMinimum: false });
  balRequireRange('Grassland FDI', grassFdi, 0, 400, { inclusiveMinimum: false });
  balRequireRange('Flame width', flameWidth, 0, 1000, { inclusiveMinimum: false });
  balRequireRange('Flame temperature', flameTemperature, 273, 2000, { inclusiveMinimum: false });
  balRequireRange('Ambient temperature', ambientTemperature, 200, 400);
  balRequireRange('Relative humidity', relativeHumidity, 0, 1);
  balRequireRange('Flame emissivity', emissivity, 0, 1, { inclusiveMinimum: false });
  if(profile.model === 'shrub'){
    balRequireRange('Vegetation height', vegetationHeight, 0, 30, { inclusiveMinimum: false });
  }

  const slopeDirection = slopeType === 'downslope' ? 1 : slopeType === 'upslope' ? -1 : 0;
  const slopeAdjustedDegrees = slopeType === 'upslope' ? Math.min(effectiveSlope, 15) : effectiveSlope;
  const slopeFactor = Math.exp(0.069 * slopeDirection * slopeAdjustedDegrees);
  const siteSlope = slopeDirection * siteSlopeMagnitude;

  let rateOfSpread;
  if(profile.model === 'forest'){
    rateOfSpread = 0.0012 * ffdi * surfaceFuelLoad;
  }else if(profile.model === 'shrub'){
    rateOfSpread = 0.023 * Math.pow(windSpeed, 1.21) * Math.pow(vegetationHeight, 0.54);
  }else if(profile.model === 'tussock'){
    rateOfSpread = 0.024
      * Math.pow(windSpeed, 1.312)
      * Math.exp(-0.0243 * tussockMoistureFactor)
      * (1 - Math.exp(-0.116 * tussockAge));
  }else{
    rateOfSpread = 0.13 * grassFdi;
  }

  const adjustedRateOfSpread = rateOfSpread * slopeFactor;
  const firelineIntensity = BAL_HEAT_OF_COMBUSTION * totalFuelLoad * adjustedRateOfSpread / 36;
  let flameLength;
  if(profile.model === 'forest'){
    flameLength = (13 * adjustedRateOfSpread + 0.24 * totalFuelLoad) / 2;
  }else if(profile.model === 'grass'){
    flameLength = 1.192 * Math.pow(firelineIntensity / 1000, 0.5);
  }else{
    flameLength = 0.0775 * Math.pow(firelineIntensity, 0.46);
  }

  const geometry = balPeakViewFactor({ flameLength, flameWidth, siteSlope, distance });
  const transmissivity = balAtmosphericTransmissivity(geometry.pathLength, {
    ambientTemperature,
    flameTemperature,
    relativeHumidity
  });
  const flameEmissivePower = BAL_SIGMA_KW * emissivity * Math.pow(flameTemperature, 4);
  const radiantHeat = transmissivity * geometry.viewFactor * flameEmissivePower;
  const bal = classifyBal(radiantHeat, { lowThreat, distance });

  const warnings = [];
  if(distance > 100) warnings.push('Classified vegetation beyond 100 m has been treated as BAL-Low.');
  if(lowThreat) warnings.push('BAL-Low relies on the selected low-threat or exclusion condition being verified.');
  if(profile.model === 'grass' && !Number.isFinite(balToNumber(input.grassFdi))){
    warnings.push('GFDI was interpolated from the entered FFDI; confirm the applicable grassland value.');
  }

  return Object.freeze({
    bal,
    radiantHeat,
    vegetation: vegetationKey,
    vegetationLabel: profile.label,
    model: profile.model,
    ffdi,
    grassFdi,
    slopeType,
    effectiveSlope,
    siteSlope,
    distance,
    surfaceFuelLoad,
    totalFuelLoad,
    vegetationHeight,
    rateOfSpread,
    adjustedRateOfSpread,
    firelineIntensity,
    flameLength,
    flameWidth,
    flameAngle: geometry.flameAngle,
    receiverElevation: geometry.receiverElevation,
    pathLength: geometry.pathLength,
    viewFactor: geometry.viewFactor,
    transmissivity,
    flameEmissivePower,
    lowThreat,
    warnings: Object.freeze(warnings)
  });
}

export function worstBal(results = []) {
  return results.reduce((worst, result) => {
    if(!result?.bal) return worst;
    if(!worst || BAL_LEVEL_RANK[result.bal] > BAL_LEVEL_RANK[worst.bal]) return result;
    if(BAL_LEVEL_RANK[result.bal] === BAL_LEVEL_RANK[worst.bal]
      && Number(result.radiantHeat) > Number(worst.radiantHeat)) return result;
    return worst;
  }, null);
}

function balEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function balFormat(value, digits = 1) {
  return Number(value).toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function balInstallStyles() {
  if(document.getElementById('bal-calculator-styles')) return;
  const style = document.createElement('style');
  style.id = 'bal-calculator-styles';
  style.textContent = `
    #balCalculatorCard{color:var(--map-ink,#111)}
    #balCalculatorCard .bal-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;list-style:none}
    #balCalculatorCard .bal-summary::-webkit-details-marker{display:none}
    #balCalculatorCard .bal-summary h2{margin:0}
    #balCalculatorCard .bal-status{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;letter-spacing:.02em;background:var(--map-panel-2,#eef2f7);color:var(--map-muted,#667085)}
    #balCalculatorCard .bal-status.affected{background:#fff1f0;color:#b42318}
    #balCalculatorCard .bal-status.clear{background:#ecfdf3;color:#067647}
    #balCalculatorCard .bal-intro{margin:10px 0 8px;color:var(--map-muted,#667085);font-size:12px;line-height:1.4}
    #balCalculatorCard .bal-warning{border-left:3px solid #f79009;background:rgba(247,144,9,.09);border-radius:6px;padding:8px 10px;margin:8px 0 10px;font-size:11px;line-height:1.4;color:var(--map-ink,#333)}
    #balCalculatorCard .bal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    #balCalculatorCard .bal-field{display:flex;flex-direction:column;gap:4px;min-width:0}
    #balCalculatorCard .bal-field.wide{grid-column:1/-1}
    #balCalculatorCard label{font-size:11px;font-weight:800;color:var(--map-muted,#667085)}
    #balCalculatorCard input,#balCalculatorCard select{box-sizing:border-box;width:100%;min-height:36px;border:1px solid var(--map-border,#d0d4dc);border-radius:8px;padding:7px 8px;background:var(--map-panel,#fff);color:var(--map-ink,#111);font:inherit;font-size:12px}
    #balCalculatorCard input:focus,#balCalculatorCard select:focus{outline:2px solid rgba(32,84,212,.22);border-color:var(--map-accent,#2054d4)}
    #balCalculatorCard .bal-check{display:flex;align-items:flex-start;gap:8px;margin:10px 0;font-size:11px;line-height:1.35;color:var(--map-muted,#667085)}
    #balCalculatorCard .bal-check input{width:auto;min-height:auto;margin-top:2px}
    #balCalculatorCard .bal-advanced{margin:10px 0;border-top:1px solid var(--map-border,#e1e3e6);border-bottom:1px solid var(--map-border,#e1e3e6);padding:8px 0}
    #balCalculatorCard .bal-advanced>summary{cursor:pointer;font-size:11px;font-weight:800;color:var(--map-muted,#667085)}
    #balCalculatorCard .bal-advanced .bal-grid{margin-top:8px}
    #balCalculatorCard .bal-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
    #balCalculatorCard .bal-button{border:0;border-radius:999px;padding:8px 12px;background:var(--map-accent,#2054d4);color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
    #balCalculatorCard .bal-button:disabled{opacity:.45;cursor:not-allowed}
    #balCalculatorCard .bal-button.secondary{border:1px solid var(--map-border,#d0d4dc);background:var(--map-panel-2,#f7f9fc);color:var(--map-ink,#333)}
    #balCalculatorCard .bal-output{margin-top:10px;border:1px solid var(--map-border,#e1e3e6);border-radius:10px;padding:10px;background:var(--map-panel-2,#fafbfc)}
    #balCalculatorCard .bal-output[hidden]{display:none}
    #balCalculatorCard .bal-result-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
    #balCalculatorCard .bal-rating{font-size:22px;font-weight:900;color:var(--map-ink,#111)}
    #balCalculatorCard .bal-heat{font-size:12px;font-weight:800;color:var(--map-muted,#667085)}
    #balCalculatorCard .bal-workings{margin-top:5px;font-size:10px;line-height:1.45;color:var(--map-muted,#667085)}
    #balCalculatorCard .bal-error{color:#b42318;font-size:11px;font-weight:700;margin-top:8px}
    #balCalculatorCard .bal-scenarios{margin-top:12px}
    #balCalculatorCard .bal-scenarios[hidden]{display:none}
    #balCalculatorCard .bal-overall{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:9px;background:rgba(32,84,212,.09);font-size:11px;font-weight:800}
    #balCalculatorCard .bal-overall strong{font-size:17px}
    #balCalculatorCard .bal-aspect-list{list-style:none;padding:0;margin:5px 0 0}
    #balCalculatorCard .bal-aspect-list li{display:grid;grid-template-columns:30px 1fr auto auto;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--map-border,#e1e3e6);font-size:10px}
    #balCalculatorCard .bal-aspect-list button{border:0;background:transparent;color:#b42318;cursor:pointer;font-size:14px;padding:2px 4px}
    #balCalculatorCard .bal-source{margin:10px 0 0;font-size:10px;line-height:1.4;color:var(--map-muted,#667085)}
    #balCalculatorCard .bal-source a{color:var(--map-accent,#2054d4);font-weight:800;text-decoration:none}
    @media(max-width:720px){#balCalculatorCard .bal-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function balCalculatorMarkup() {
  const vegetationOptions = Object.entries(BAL_VEGETATION_CLASSES)
    .map(([key, profile]) => `<option value="${key}">${balEscape(profile.label)}</option>`)
    .join('');
  const aspects = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    .map(value => `<option value="${value}">${value}</option>`)
    .join('');

  return `
    <details id="balCalculatorDetails">
      <summary class="bal-summary">
        <h2 class="section-title">Bushfire Attack Level</h2>
        <span id="balOverlayStatus" class="bal-status">Select a lot</span>
      </summary>
      <p id="balLotContext" class="bal-intro">Select a parcel, then enter site-assessed inputs for each vegetation direction.</p>
      <div class="bal-warning"><strong>Preliminary calculator only.</strong> Overlay mapping does not determine a BAL. Confirm vegetation, slopes, distance, FFDI and exclusions on site; a competent practitioner must verify any approval or construction decision.</div>
      <form id="balCalculatorForm" novalidate>
        <div class="bal-grid">
          <div class="bal-field">
            <label for="balAspect">Exposure direction</label>
            <select id="balAspect">${aspects}</select>
          </div>
          <div class="bal-field">
            <label for="balVegetation">Vegetation class</label>
            <select id="balVegetation">${vegetationOptions}</select>
          </div>
          <div class="bal-field">
            <label for="balFfdi">FFDI</label>
            <input id="balFfdi" type="number" min="1" max="250" step="1" value="40" inputmode="decimal">
          </div>
          <div class="bal-field">
            <label for="balDistance">Horizontal separation (m)</label>
            <input id="balDistance" type="number" min="0.1" max="500" step="0.1" value="20" inputmode="decimal">
          </div>
          <div class="bal-field wide">
            <label for="balSlopeType">Vegetation position relative to building</label>
            <select id="balSlopeType">
              <option value="downslope">Downslope (fire runs uphill to building)</option>
              <option value="level" selected>Level</option>
              <option value="upslope">Upslope (fire runs downhill to building)</option>
            </select>
          </div>
          <div class="bal-field">
            <label for="balEffectiveSlope">Slope under vegetation (°)</label>
            <input id="balEffectiveSlope" type="number" min="0" max="20" step="0.1" value="0" inputmode="decimal">
          </div>
          <div class="bal-field">
            <label for="balSiteSlope">Site-to-vegetation slope (°)</label>
            <input id="balSiteSlope" type="number" min="0" max="30" step="0.1" value="0" inputmode="decimal">
          </div>
        </div>
        <label class="bal-check"><input id="balLowThreat" type="checkbox"> <span>A qualified assessment confirms an AS 3959 low-threat vegetation or other BAL-Low exclusion applies in this direction.</span></label>
        <details class="bal-advanced">
          <summary>Advanced fuel and flame inputs</summary>
          <div class="bal-grid">
            <div class="bal-field">
              <label for="balSurfaceFuel">Surface fuel (t/ha)</label>
              <input id="balSurfaceFuel" type="number" min="0.1" max="100" step="0.1" value="25" inputmode="decimal">
            </div>
            <div class="bal-field">
              <label for="balTotalFuel">Total fuel (t/ha)</label>
              <input id="balTotalFuel" type="number" min="0.1" max="150" step="0.1" value="35" inputmode="decimal">
            </div>
            <div class="bal-field">
              <label for="balVegetationHeight">Vegetation height (m)</label>
              <input id="balVegetationHeight" type="number" min="0.1" max="30" step="0.1" value="" placeholder="Not used" inputmode="decimal">
            </div>
            <div class="bal-field">
              <label for="balWindSpeed">10 m wind speed (km/h)</label>
              <input id="balWindSpeed" type="number" min="1" max="150" step="0.1" value="45" inputmode="decimal">
            </div>
            <div class="bal-field">
              <label for="balGrassFdi">GFDI (grass only)</label>
              <input id="balGrassFdi" type="number" min="1" max="400" step="0.1" value="" placeholder="Derived from FFDI" inputmode="decimal">
            </div>
            <div class="bal-field">
              <label for="balFlameWidth">Flame width (m)</label>
              <input id="balFlameWidth" type="number" min="0.1" max="1000" step="0.1" value="100" inputmode="decimal">
            </div>
          </div>
        </details>
        <div class="bal-actions">
          <button id="balCalculate" class="bal-button" type="submit" disabled>Calculate &amp; save aspect</button>
          <button id="balClearAspects" class="bal-button secondary" type="button">Clear aspects</button>
        </div>
        <div id="balError" class="bal-error" role="alert" hidden></div>
      </form>
      <div id="balOutput" class="bal-output" aria-live="polite" hidden></div>
      <div id="balScenarios" class="bal-scenarios" hidden>
        <div id="balOverall" class="bal-overall"></div>
        <ul id="balAspectList" class="bal-aspect-list"></ul>
      </div>
      <p class="bal-source">Method: AS 3959:2018 Appendix B view-factor radiant heat calculation, including Amendments 1 and 2. Queensland planning assessments may require site-specific VHC fuel and FFDI inputs. <a href="https://www.fire.qld.gov.au/compliance-and-planning/bushfire-planning/brc" target="_blank" rel="noopener">Queensland technical guidance</a>.</p>
    </details>
  `;
}

/** Insert and wire the shared calculator in a council map summary panel. */
export function initBalCalculator() {
  if(typeof document === 'undefined' || document.getElementById('balCalculatorCard')) return null;
  const overlayList = document.getElementById('sumOverlays');
  const summaryPanel = document.getElementById('panel-summary');
  if(!overlayList || !summaryPanel) return null;

  balInstallStyles();
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'balCalculatorCard';
  card.innerHTML = balCalculatorMarkup();
  const overlayCard = overlayList.closest?.('.card');
  if(overlayCard) overlayCard.insertAdjacentElement('afterend', card);
  else summaryPanel.appendChild(card);

  const element = id => document.getElementById(id);
  const form = element('balCalculatorForm');
  const calculateButton = element('balCalculate');
  const details = element('balCalculatorDetails');
  const scenarios = new Map();
  let currentLot = '';
  let openedAffectedLot = '';

  const updateFuelDefaults = () => {
    const profile = BAL_VEGETATION_CLASSES[element('balVegetation').value];
    if(!profile) return;
    element('balSurfaceFuel').value = profile.surfaceFuelLoad;
    element('balTotalFuel').value = profile.totalFuelLoad;
    element('balVegetationHeight').value = profile.vegetationHeight ?? '';
    element('balVegetationHeight').placeholder = profile.model === 'shrub' ? 'Required' : 'Not used';
  };

  const clearScenarios = () => {
    scenarios.clear();
    element('balOutput').hidden = true;
    element('balScenarios').hidden = true;
    element('balError').hidden = true;
    element('balAspectList').innerHTML = '';
  };

  const renderScenarios = () => {
    const values = Array.from(scenarios.values());
    const container = element('balScenarios');
    if(!values.length){
      container.hidden = true;
      return;
    }
    const worst = worstBal(values.map(item => item.result));
    container.hidden = false;
    element('balOverall').innerHTML = `<span>Overall lot result (highest saved aspect)</span><strong>${balEscape(worst.bal)}</strong>`;
    element('balAspectList').innerHTML = values.map(item => `
      <li>
        <strong>${balEscape(item.aspect)}</strong>
        <span>${balEscape(item.result.vegetationLabel)}</span>
        <span>${balEscape(item.result.bal)} · ${balFormat(item.result.radiantHeat)} kW/m²</span>
        <button type="button" data-bal-remove="${balEscape(item.aspect)}" aria-label="Remove ${balEscape(item.aspect)} aspect">×</button>
      </li>
    `).join('');
  };

  const refreshContext = () => {
    const lotText = String(element('sumLot')?.textContent || '').trim();
    const selected = !!lotText && !/^--/.test(lotText) && !/select/i.test(lotText);
    if(selected && currentLot && lotText !== currentLot) clearScenarios();
    currentLot = selected ? lotText : '';
    calculateButton.disabled = !selected;

    const overlayText = String(overlayList.textContent || '').replace(/\s+/g, ' ').trim();
    const affected = selected
      && /bush\s*fire|bushfire/i.test(overlayText)
      && !/no bush\s*fire|no bushfire|not affected by bushfire/i.test(overlayText);
    const status = element('balOverlayStatus');
    status.className = `bal-status${affected ? ' affected' : selected ? ' clear' : ''}`;
    status.textContent = affected ? 'Bushfire mapping found' : selected ? 'Check site inputs' : 'Select a lot';
    element('balLotContext').textContent = selected
      ? `Lot ${lotText}: assess every direction containing classified vegetation; the highest BAL governs.`
      : 'Select a parcel, then enter site-assessed inputs for each vegetation direction.';
    if(affected && openedAffectedLot !== lotText){
      details.open = true;
      openedAffectedLot = lotText;
    }
  };

  element('balVegetation').addEventListener('change', updateFuelDefaults);
  element('balSlopeType').addEventListener('change', () => {
    const type = element('balSlopeType').value;
    const slope = element('balEffectiveSlope');
    slope.max = type === 'upslope' ? '15' : '20';
    if(type === 'level'){
      slope.value = '0';
      element('balSiteSlope').value = '0';
    }
  });
  element('balClearAspects').addEventListener('click', clearScenarios);
  element('balAspectList').addEventListener('click', event => {
    const button = event.target.closest?.('[data-bal-remove]');
    if(!button) return;
    scenarios.delete(button.getAttribute('data-bal-remove'));
    renderScenarios();
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const error = element('balError');
    error.hidden = true;
    try{
      if(!currentLot) throw new Error('Select a parcel before calculating a BAL.');
      const optionalNumber = id => {
        const raw = element(id).value.trim();
        return raw === '' ? undefined : Number(raw);
      };
      const result = calculateBalMethod2({
        vegetation: element('balVegetation').value,
        ffdi: Number(element('balFfdi').value),
        distance: Number(element('balDistance').value),
        slopeType: element('balSlopeType').value,
        effectiveSlope: Number(element('balEffectiveSlope').value),
        siteSlope: Number(element('balSiteSlope').value),
        lowThreat: element('balLowThreat').checked,
        surfaceFuelLoad: optionalNumber('balSurfaceFuel'),
        totalFuelLoad: optionalNumber('balTotalFuel'),
        vegetationHeight: optionalNumber('balVegetationHeight'),
        windSpeed: optionalNumber('balWindSpeed'),
        grassFdi: optionalNumber('balGrassFdi'),
        flameWidth: optionalNumber('balFlameWidth')
      });
      const aspect = element('balAspect').value;
      scenarios.set(aspect, { aspect, result });
      const output = element('balOutput');
      output.hidden = false;
      output.innerHTML = `
        <div class="bal-result-row"><span class="bal-rating">${balEscape(result.bal)}</span><span class="bal-heat">${balFormat(result.radiantHeat)} kW/m²</span></div>
        <div class="bal-workings">${balEscape(aspect)} · ${balEscape(result.vegetationLabel)} · flame ${balFormat(result.flameLength)} m · adjusted spread ${balFormat(result.adjustedRateOfSpread, 2)} km/h · view factor ${balFormat(result.viewFactor, 3)} · transmissivity ${balFormat(result.transmissivity, 3)}${result.warnings.length ? `<br>${result.warnings.map(balEscape).join(' ')}` : ''}</div>
      `;
      renderScenarios();
    }catch(calculationError){
      error.textContent = calculationError?.message || String(calculationError);
      error.hidden = false;
    }
  });

  if(typeof MutationObserver !== 'undefined'){
    const observer = new MutationObserver(refreshContext);
    observer.observe(overlayList, { childList: true, subtree: true, characterData: true });
    const lotElement = element('sumLot');
    if(lotElement) observer.observe(lotElement, { childList: true, subtree: true, characterData: true });
  }
  updateFuelDefaults();
  refreshContext();
  return card;
}

if(typeof window !== 'undefined'){
  window.LotCompanionBAL = Object.freeze({
    vegetationClasses: BAL_VEGETATION_CLASSES,
    calculate: calculateBalMethod2,
    classify: classifyBal,
    worst: worstBal,
    init: initBalCalculator
  });
}

if(typeof document !== 'undefined'){
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initBalCalculator, { once: true });
  }else{
    initBalCalculator();
  }
}
