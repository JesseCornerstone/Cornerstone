// Shared low-level helpers for the independent council page brains.
// Council-specific map, report, and access-flow decisions stay in Js/councils/*.js.

export const $ = id => document.getElementById(id);

export const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

export const showLoading = on => {
  const mask = $('loadingMask');
  if (mask) mask.style.display = on ? 'flex' : 'none';
};

const firstCompletedSearchResult = event => {
  const groups = Array.isArray(event?.results) ? event.results : [];
  const lotPlanGroup = groups.find(group => /lot\s*\/?\s*plan/i.test(group?.source?.name || ''));
  const lotPlanResult = Array.isArray(lotPlanGroup?.results) ? lotPlanGroup.results[0] : null;
  if(lotPlanResult) return lotPlanResult;
  for (const group of groups) {
    const result = Array.isArray(group?.results) ? group.results[0] : null;
    if (result) return result;
  }
  return null;
};

const searchResultMapPoint = result => {
  const geometry = result?.feature?.geometry;
  if (geometry?.type === 'point') return geometry;
  return geometry?.centroid
    || geometry?.extent?.center
    || result?.extent?.center
    || null;
};

const searchResultSelectionKey = (result, mapPoint) => {
  const spatialReference = mapPoint?.spatialReference;
  const wkid = spatialReference?.latestWkid || spatialReference?.wkid || '';
  const x = Number(mapPoint?.x ?? mapPoint?.longitude);
  const y = Number(mapPoint?.y ?? mapPoint?.latitude);
  const precision = Math.abs(x) <= 180 && Math.abs(y) <= 90 ? 7 : 3;
  const position = Number.isFinite(x) && Number.isFinite(y)
    ? `${x.toFixed(precision)},${y.toFixed(precision)},${wkid}`
    : '';
  return position || String(result?.name || '').trim();
};

/**
 * Make running a Search widget query select the located parcel in the same
 * way as a map click. Search emits both search-complete and select-result for
 * an auto-selected result, so suppress the second copy of the same location.
 */
export function wireSearchResultSelection(search, selectAtMapPoint) {
  if(!search || typeof search.on !== 'function' || typeof selectAtMapPoint !== 'function'){
    return { remove(){} };
  }

  let lastKey = '';
  let lastRunAt = 0;
  let activeSelection = Promise.resolve();

  const activate = result => {
    const mapPoint = searchResultMapPoint(result);
    if(!mapPoint) return activeSelection;

    const key = searchResultSelectionKey(result, mapPoint);
    const now = Date.now();
    if(key && key === lastKey && now - lastRunAt < 1500) return activeSelection;
    lastKey = key;
    lastRunAt = now;

    activeSelection = Promise.resolve(selectAtMapPoint(mapPoint, { searchResult: result })).catch(error => {
      console.warn('Search parcel selection failed', error);
    });
    return activeSelection;
  };

  const handles = [
    search.on('search-complete', event => activate(firstCompletedSearchResult(event))),
    search.on('select-result', event => activate(event?.result))
  ];

  return {
    remove(){
      for(const handle of handles){
        try{ handle?.remove?.(); }catch{}
      }
    }
  };
}

const CADASTRAL_COMBINED_FIELD_KEYS = new Set([
  'LOTPLAN', 'LOTPLANNO', 'LOTPLANTXT', 'LOTPLANTEXT'
]);
const CADASTRAL_LOT_FIELD_KEYS = new Set([
  'LOT', 'LOTNO', 'LOTNUMBER', 'LOTNUM'
]);
const CADASTRAL_PLAN_FIELD_KEYS = new Set([
  'PLAN', 'PLANNO', 'PLANNUMBER', 'PLANNUM'
]);

const cadastralFieldKey = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const normalizeCadastralLot = value => {
  const compact = cadastralFieldKey(value);
  return compact.replace(/^0+(?=\d)/, '');
};

export const normalizeCadastralPlan = value => {
  const compact = cadastralFieldKey(value);
  const parts = compact.match(/^([A-Z]+)(\d+)$/);
  if(!parts) return compact;
  return `${parts[1]}${parts[2].replace(/^0+(?=\d)/, '')}`;
};

/**
 * Compare both parts of a cadastral identifier. Attribute names are matched
 * punctuation-insensitively so council fields such as PLAN_ are recognised.
 */
export function isExactCadastralLotPlan(featureOrAttributes, lot, plan) {
  const attributes = featureOrAttributes?.attributes || featureOrAttributes || {};
  const wantedLot = normalizeCadastralLot(lot);
  const wantedPlan = normalizeCadastralPlan(plan);
  if(!wantedLot || !wantedPlan) return false;

  let foundLot = null;
  let foundPlan = null;
  const wantedCombined = `${wantedLot}${wantedPlan}`;
  const rawWantedCombined = `${cadastralFieldKey(lot)}${cadastralFieldKey(plan)}`;
  for(const [name, rawValue] of Object.entries(attributes)){
    if(rawValue === null || rawValue === undefined || String(rawValue).trim() === '') continue;
    const key = cadastralFieldKey(name);
    if(CADASTRAL_COMBINED_FIELD_KEYS.has(key)){
      const combined = cadastralFieldKey(rawValue);
      if(combined === rawWantedCombined || combined === wantedCombined) return true;
      if(combined.endsWith(wantedPlan)
        && normalizeCadastralLot(combined.slice(0, -wantedPlan.length)) === wantedLot){
        return true;
      }
    }
    if(foundLot === null && CADASTRAL_LOT_FIELD_KEYS.has(key)) foundLot = rawValue;
    if(foundPlan === null && CADASTRAL_PLAN_FIELD_KEYS.has(key)) foundPlan = rawValue;
  }
  return normalizeCadastralLot(foundLot) === wantedLot
    && normalizeCadastralPlan(foundPlan) === wantedPlan;
}

const PROPERTY_SEARCH_TOKEN_ALIASES = Object.freeze({
  AVE: 'AVENUE', BLVD: 'BOULEVARD', BVD: 'BOULEVARD',
  CCT: 'CIRCUIT', CIR: 'CIRCUIT', CL: 'CLOSE',
  CRES: 'CRESCENT', CR: 'CRESCENT', CT: 'COURT',
  DR: 'DRIVE', ESP: 'ESPLANADE', FWY: 'FREEWAY',
  HWY: 'HIGHWAY', LN: 'LANE', PDE: 'PARADE',
  PKWY: 'PARKWAY', PKY: 'PARKWAY', PL: 'PLACE',
  RD: 'ROAD', ST: 'STREET', TCE: 'TERRACE',
  TRK: 'TRACK', TRL: 'TRAIL'
});

/** Normalize an address into whole-word search tokens without state/postcode noise. */
export function propertySearchTokens(value) {
  let text = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  text = text.replace(/\bQUEENSLAND\b/g, ' QLD ').replace(/\bAUSTRALIA\b/g, ' ');
  let tokens = text.match(/[A-Z0-9]+(?:-[A-Z0-9]+)?/g) || [];
  tokens = tokens.filter(token => token !== 'QLD');
  if(tokens.length > 2 && /^\d{4}$/.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.map(token => PROPERTY_SEARCH_TOKEN_ALIASES[token] || token);
}

const addressTokensInOrder = (queryTokens, candidateTokens, allowLastTokenPrefix) => {
  let candidateIndex = 0;
  for(let queryIndex = 0; queryIndex < queryTokens.length; queryIndex += 1){
    const queryToken = queryTokens[queryIndex];
    const allowPrefix = allowLastTokenPrefix
      && queryIndex === queryTokens.length - 1
      && /^[A-Z]{3,}$/.test(queryToken);
    let found = false;
    while(candidateIndex < candidateTokens.length){
      const candidateToken = candidateTokens[candidateIndex];
      candidateIndex += 1;
      if(candidateToken === queryToken || (allowPrefix && candidateToken.startsWith(queryToken))){
        found = true;
        break;
      }
    }
    if(!found) return false;
  }
  return true;
};

/**
 * Rank an address using token boundaries. This prevents house 12 matching 112,
 * while still allowing the final word to be an in-progress suggestion prefix.
 */
export function scorePropertyAddressMatch(query, candidate, { allowLastTokenPrefix = false } = {}) {
  const queryTokens = propertySearchTokens(query);
  const candidateTokens = propertySearchTokens(candidate);
  if(!queryTokens.length || !candidateTokens.length) return 0;
  if(!addressTokensInOrder(queryTokens, candidateTokens, allowLastTokenPrefix)) return 0;

  const queryText = queryTokens.join(' ');
  const candidateText = candidateTokens.join(' ');
  if(queryText === candidateText) return 1000;
  if(candidateText.startsWith(`${queryText} `)) return 850;
  const extraTokens = Math.max(0, candidateTokens.length - queryTokens.length);
  return Math.max(1, 600 - extraTokens * 5);
}

/*
 * Report addresses used to be resolved independently by every council page.
 * Keep the BCC resolution rules here so every report receives the same
 * validation, lot/plan fallback, locality completion, and final formatting.
 */
const REPORT_ADDRESS_LAYER_URL =
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/QSCF_LandParcelPropertyFramework/MapServer/0';

const REPORT_FULL_ADDRESS_FIELDS = [
  'FULL_ADDRESS', 'ADDRESS_FULL', 'GNAF_FULL_ADDRESS', 'GNAF_ADDRESS',
  'SITE_ADDRESS', 'PROPERTY_ADDRESS', 'PROP_ADDRESS', 'PRIMARY_ADDRESS',
  'ADDR_FULL', 'ADDR_LABEL', 'ADDRESS', 'STREET_ADDRESS', 'POSTAL_ADDRESS',
  'FULLADDR', 'FULL_ADD', 'FULL_ADDRE', 'SITE_ADDR', 'SITE_ADD', 'PROP_ADD',
  'PROPERTY_ADDR', 'PROPERTY_ADD', 'ADDRESS1', 'ADDRESS_1', 'ADDR1'
];

const REPORT_ADDRESS_PART_FIELDS = {
  unit: ['UNIT_NO', 'UNIT_NUMBER', 'UNIT', 'APARTMENT', 'FLAT', 'SUITE', 'SUB_UNIT', 'APT', 'FLAT_NO', 'UNITNO', 'UNITNUM'],
  numberPrefix: ['HOUSE_PREFIX', 'NUMBER_PREFIX', 'ADDR_NUM_PREFIX', 'NUMBER_PRE', 'NO_PRE', 'HSE_PRE'],
  number: ['HOUSE_NO', 'HOUSE_NUMBER', 'STREET_NO', 'STREET_NUMBER', 'PRIMARY_NO', 'PROPERTY_NO', 'NUMBER', 'HSE_NO', 'HSE_NUM', 'ADDR_NO'],
  numberSuffix: ['HOUSE_SUFFIX', 'NUMBER_SUFFIX', 'ADDR_NUM_SUFFIX', 'NUMBER_SUF', 'NO_SUF', 'HSE_SUF'],
  streetName: ['STREET_NAME', 'ST_NAME', 'ROAD_NAME', 'RD_NAME', 'ADD_STREET_NAME', 'STREET', 'ST_NAM', 'RD_NAM'],
  streetType: ['STREET_TYPE', 'ST_TYPE', 'ROAD_TYPE', 'RD_TYPE', 'ADDR_TYPE', 'ST_TYP', 'RD_TYP'],
  streetSuffix: ['STREET_SUFFIX', 'ST_SUFFIX', 'ROAD_SUFFIX', 'RD_SUFFIX', 'ST_SUF', 'RD_SUF'],
  suburb: ['SUBURB', 'SUBURB_NAME', 'LOCALITY', 'LOCALITY_NAME', 'TOWN', 'CITY', 'SUB_NAME', 'LOCALITY_N'],
  state: ['STATE', 'STATE_ABBR', 'STATE_CODE'],
  postcode: ['POSTCODE', 'POST_CODE', 'ZIP', 'PSTCODE', 'PST_CD']
};

const REPORT_LOT_PLAN_FIELDS = [
  'LOT/PLAN', 'LOT_PLAN', 'LOT_PLAN_NO', 'LOTPLAN', 'LOTPLAN_NO',
  'LOTPLAN_TXT', 'LOT_PLAN_TXT', 'LOT_PLAN_TEXT', 'LOTPLAN_TEXT'
];
const REPORT_LOT_FIELDS = ['LOT', 'LOT_NO', 'LOTNO', 'LOT_NUMBER', 'LOTNUMBER', 'LOT_NUM', 'LOTNUM'];
const REPORT_PLAN_FIELDS = ['PLAN', 'PLAN_', 'PLAN_NO', 'PLANNO', 'PLAN_NUMBER', 'PLANNUMBER', 'PLAN_NUM', 'PLANNUM'];
const REPORT_STREET_TYPE_RX = /\b(?:Alley|Aly|Approach|App|Arcade|Arc|Avenue|Ave|Boulevard|Blvd|Bypass|Byp|Circuit|Cct|Circus|Close|Cl|Concourse|Court|Ct|Crescent|Cres|Drive|Dr|Esplanade|Esp|Expressway|Expy|Freeway|Fwy|Gardens|Gdns|Glen|Grange|Highway|Hwy|Lane|Ln|Mews|Parade|Pde|Parkway|Pky|Place|Pl|Plaza|Plz|Promenade|Quay|Qy|Rise|Road|Rd|Square|Sq|Street|St|Terrace|Tce|Track|Trk|Trail|Trl|View|Vw|Vista|Walk|Wk|Way)\b/i;
const REPORT_STREET_LOCALITY_RX = new RegExp(
  `^(.*${REPORT_STREET_TYPE_RX.source})[,\\s]+(.+)$`,
  'i'
);
const REPORT_STREET_TYPE_ABBREVIATIONS = {
  avenue: 'Ave',
  boulevard: 'Blvd',
  circuit: 'Cct',
  close: 'Cl',
  court: 'Ct',
  crescent: 'Cres',
  drive: 'Dr',
  esplanade: 'Esp',
  grove: 'Gr',
  highway: 'Hwy',
  lane: 'Ln',
  parade: 'Pde',
  place: 'Pl',
  road: 'Rd',
  square: 'Sq',
  street: 'St',
  terrace: 'Tce',
  track: 'Trk',
  trail: 'Trl'
};
const REPORT_STREET_TYPE_END_RX = new RegExp(
  `\\b(${Object.keys(REPORT_STREET_TYPE_ABBREVIATIONS).join('|')})\\b(?=(?:\\s+(?:North|South|East|West|N|S|E|W|NE|NW|SE|SW))?$)`,
  'i'
);

const reportAddressValue = (attributes, fields) => {
  if (!attributes) return null;
  const keys = Object.keys(attributes);
  const keyMap = new Map(keys.map(key => [String(key).toLowerCase(), key]));
  for (const field of fields) {
    const key = Object.prototype.hasOwnProperty.call(attributes, field)
      ? field
      : keyMap.get(String(field).toLowerCase());
    if (key === undefined) continue;
    const value = String(attributes[key] ?? '').trim();
    if (value && !/^(?:null|undefined|n\/?a)$/i.test(value)) return value;
  }
  return null;
};

const joinReportAddressParts = parts => parts
  .filter(value => value !== null && value !== undefined && String(value).trim())
  .map(value => String(value).trim())
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const cleanReportAddressText = value => String(value || '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/\s+,/g, ',')
  .replace(/,\s*/g, ', ')
  .replace(/\s+/g, ' ')
  .trim();

const reportAddressTitleCase = value => {
  const text = cleanReportAddressText(value);
  return text
    .replace(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g, word => {
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (letters.length < 2 || letters !== letters.toUpperCase()) return word;
      return word
        .toLowerCase()
        .replace(/(^|['\u2019])([a-z])/g, (_match, separator, letter) => `${separator}${letter.toUpperCase()}`);
    })
    .replace(/\b(?:NE|NW|SE|SW|N|S|E|W)\b/gi, direction => direction.toUpperCase());
};

const reportAddressStreetLine = value => reportAddressTitleCase(value).replace(
  REPORT_STREET_TYPE_END_RX,
  streetType => REPORT_STREET_TYPE_ABBREVIATIONS[streetType.toLowerCase()] || streetType
);

export const formatReportAddressText = (value, attributes = {}) => {
  let text = cleanReportAddressText(value)
    .replace(/(?:,\s*)?\b(?:Australia|AUS)\b\s*$/i, '')
    .replace(/\((?:[^)]*\b(?:Regional|City|Shire|Town)\b[^)]*)\)/gi, ' ')
    .replace(/\bQueensland\b/gi, 'QLD');
  text = cleanReportAddressText(text).replace(/(?:,\s*)+$/, '');
  if (!text) return null;

  const attributeSuburb = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.suburb);
  const attributeState = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.state) || (attributeSuburb ? 'QLD' : null);
  const attributePostcode = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.postcode);
  const stateMatch = text.match(/^(.*?)(?:,\s*|\s+)(?:QLD)\s*(?:,\s*|\s+)?(\d{4})?\s*$/i);

  let beforeState = stateMatch ? stateMatch[1].replace(/(?:,\s*)+$/, '').trim() : text;
  let state = stateMatch ? 'QLD' : null;
  let postcode = stateMatch?.[2] || null;
  let streetLine = beforeState;
  let locality = null;

  if (attributeSuburb) {
    const escapedSuburb = attributeSuburb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const suburbMatch = beforeState.match(new RegExp(`^(.*?)(?:,\\s*|\\s+)(${escapedSuburb})$`, 'i'));
    if (suburbMatch) {
      streetLine = suburbMatch[1].replace(/(?:,\s*)+$/, '').trim();
      locality = suburbMatch[2];
    }
  }

  if (!locality) {
    const commaIndex = beforeState.lastIndexOf(',');
    if (commaIndex >= 0) {
      streetLine = beforeState.slice(0, commaIndex).trim();
      locality = beforeState.slice(commaIndex + 1).trim();
    } else if (stateMatch) {
      const streetLocalityMatch = beforeState.match(REPORT_STREET_LOCALITY_RX);
      if (streetLocalityMatch) {
        streetLine = streetLocalityMatch[1].trim();
        locality = streetLocalityMatch[2].trim();
      }
    }
  }

  if (locality && attributeSuburb && locality.toUpperCase() === attributeSuburb.toUpperCase()) {
    locality = attributeSuburb;
  }
  if (locality) {
    state = state || attributeState;
    postcode = postcode || attributePostcode;
  }

  const formattedStreet = reportAddressStreetLine(streetLine);
  const formattedLocality = locality ? reportAddressTitleCase(locality) : null;
  const statePostcode = [state?.toUpperCase(), postcode]
    .filter(Boolean)
    .join(' ');
  const localityTail = [formattedLocality, statePostcode]
    .filter(Boolean)
    .join(' ');
  const separator = formattedLocality ? ', ' : (localityTail ? ' ' : '');
  return cleanReportAddressText(`${formattedStreet}${separator}${localityTail}`) || null;
};

const isCadastralReportAddress = value => {
  const text = cleanReportAddressText(value);
  return /\bLOT\s*[A-Z0-9.-]+\s+(?:ON\s+)?[A-Z]{1,4}\s*\d{2,}\b/i.test(text)
    || /\b[A-Z0-9.-]+\s*\/\s*[A-Z]{1,4}\s*\d{2,}\b/i.test(text)
    || /^\s*[A-Z0-9.-]+\s*[A-Z]{1,4}\s*\d{3,}\s*$/i.test(text);
};

export const isLikelyReportStreetAddress = value => {
  const text = cleanReportAddressText(value);
  if (!text || isCadastralReportAddress(text)) return false;
  const hasNumberAndName = /\b\d{1,5}[A-Za-z]?(?:\s*(?:-|\u2013)\s*\d{1,5}[A-Za-z]?)?\s+[A-Za-z][A-Za-z\s.'-]{1,}/i.test(text);
  const hasUnit = /\b(?:Unit|U|Shop|Suite|Level|Lvl|Apt|Apartment|Flat)\s*\d+[A-Za-z]?\s*\/\s*\d{1,5}/i.test(text);
  const hasLocality = /,\s*[A-Za-z][A-Za-z\s.'-]+(?:\s+(?:QLD|Queensland))?(?:\s+\d{4})?/i.test(text);
  return (hasNumberAndName && (REPORT_STREET_TYPE_RX.test(text) || hasLocality))
    || (hasUnit && (REPORT_STREET_TYPE_RX.test(text) || hasNumberAndName));
};

export const buildReportAddressFromParts = attributes => {
  const unit = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.unit);
  const number = joinReportAddressParts([
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.numberPrefix),
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.number),
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.numberSuffix)
  ]);
  const street = joinReportAddressParts([
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.streetName),
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.streetType),
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.streetSuffix)
  ]);
  const locality = joinReportAddressParts([
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.suburb),
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.state) || 'QLD',
    reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.postcode)
  ]);
  const streetLine = joinReportAddressParts([unit ? `${unit}/` : null, number, street]);
  return formatReportAddressText(`${streetLine}${locality ? `, ${locality}` : ''}`, attributes);
};

export const parseReportAddress = attributes => {
  if (!attributes) return null;
  const fullAddress = reportAddressValue(attributes, REPORT_FULL_ADDRESS_FIELDS);
  if (isLikelyReportStreetAddress(fullAddress)) return formatReportAddressText(fullAddress, attributes);
  const builtAddress = buildReportAddressFromParts(attributes);
  if (isLikelyReportStreetAddress(builtAddress)) return builtAddress;
  for (const value of Object.values(attributes)) {
    if (isLikelyReportStreetAddress(value)) return formatReportAddressText(value, attributes);
  }
  return null;
};

export const ensureReportAddressLocality = (address, attributes = {}) => {
  let cleanAddress = cleanReportAddressText(address);
  if (!cleanAddress) return null;
  const suburb = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.suburb);
  if (!suburb) return cleanAddress;
  const state = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.state) || 'QLD';
  const postcode = reportAddressValue(attributes, REPORT_ADDRESS_PART_FIELDS.postcode);
  const normalise = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (normalise(cleanAddress).includes(normalise(suburb))) return formatReportAddressText(cleanAddress, attributes);
  const escapedPostcode = postcode ? String(postcode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const stateTail = new RegExp(`(?:,\\s*)?(?:QLD|Queensland)\\s*${escapedPostcode ? `\\b${escapedPostcode}\\b` : ''}\\s*$`, 'i');
  const locality = `${suburb} ${state}${postcode ? ` ${postcode}` : ''}`;
  cleanAddress = stateTail.test(cleanAddress)
    ? cleanAddress.replace(stateTail, `, ${locality}`)
    : `${cleanAddress}, ${locality}`;
  return formatReportAddressText(cleanAddress, attributes);
};

export const formatReportAddress = (address, attributes = {}) => {
  const completedAddress = ensureReportAddressLocality(address, attributes);
  const formattedAddress = formatReportAddressText(completedAddress, attributes);
  return isLikelyReportStreetAddress(formattedAddress) ? formattedAddress : null;
};

const reportLotPlan = attributes => {
  const combined = reportAddressValue(attributes, REPORT_LOT_PLAN_FIELDS);
  if (combined) {
    const slashed = combined.match(/^\s*([0-9]+[A-Za-z]?)\s*\/\s*([A-Za-z]{1,4}\s*\d+)\s*$/);
    if (slashed) return { lot: slashed[1], plan: slashed[2].replace(/\s+/g, '') };
    const compact = combined.replace(/[^A-Za-z0-9]/g, '').match(/^([0-9]+[A-Za-z]?)([A-Za-z]{1,4}\d+)$/);
    if (compact) return { lot: compact[1], plan: compact[2] };
  }
  const lot = reportAddressValue(attributes, REPORT_LOT_FIELDS);
  const plan = reportAddressValue(attributes, REPORT_PLAN_FIELDS);
  return lot && plan ? { lot, plan: plan.replace(/\s+/g, '') } : null;
};

const escapeReportAddressSql = value => String(value || '').replace(/'/g, "''");

export async function queryReportAddressByLotPlan(parcelFeature, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const attributes = parcelFeature?.attributes || parcelFeature || {};
  const lotPlan = reportLotPlan(attributes);
  if (!lotPlan) return null;
  const lot = escapeReportAddressSql(lotPlan.lot);
  const plan = escapeReportAddressSql(lotPlan.plan);
  const compact = escapeReportAddressSql(`${lotPlan.lot}${lotPlan.plan}`);
  const slashed = escapeReportAddressSql(`${lotPlan.lot}/${lotPlan.plan}`);
  const body = new URLSearchParams({
    f: 'json',
    where: `lotplan='${compact}' OR lotplan='${slashed}' OR (lot='${lot}' AND plan='${plan}')`,
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '20'
  });
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${REPORT_ADDRESS_LAYER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller?.signal
    });
    if (!response?.ok) return null;
    const payload = await response.json();
    const addresses = (payload?.features || [])
      .map(feature => parseReportAddress(feature?.attributes || {}))
      .filter(Boolean)
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    return addresses[0] || null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const reportAddressFromGeocoderResult = result => {
  if (typeof result === 'string') return result;
  const candidates = [
    result?.attributes?.LongLabel,
    result?.attributes?.Match_addr,
    result?.attributes?.ShortLabel,
    result?.attributes?.Address,
    result?.address
  ];
  return candidates.find(isLikelyReportStreetAddress) || null;
};

export async function resolvePropertyReportAddress({
  geometry,
  parcelFeature,
  hintAddress,
  hintPoint,
  scanAddressLayers,
  reverseGeocode,
  fetchImpl
} = {}) {
  const attributes = parcelFeature?.attributes || {};
  let address = parseReportAddress(attributes);

  if (isLikelyReportStreetAddress(hintAddress)) {
    address = cleanReportAddressText(hintAddress);
  }
  if (!isLikelyReportStreetAddress(address)) {
    try { address = await queryReportAddressByLotPlan(parcelFeature, { fetchImpl }); } catch {}
  }
  if (!isLikelyReportStreetAddress(address) && typeof scanAddressLayers === 'function') {
    try {
      const layerResult = await scanAddressLayers(geometry, hintPoint);
      const layerCandidates = Array.isArray(layerResult) ? layerResult : [layerResult];
      address = layerCandidates.map(item => item?.address || item?.addr || item).find(isLikelyReportStreetAddress) || address;
    } catch {}
  }
  if (!isLikelyReportStreetAddress(address) && typeof reverseGeocode === 'function') {
    try {
      const point = hintPoint || geometry?.centroid || geometry?.extent?.center || geometry;
      address = reportAddressFromGeocoderResult(await reverseGeocode(point)) || address;
    } catch {}
  }
  if (!isLikelyReportStreetAddress(address)) address = buildReportAddressFromParts(attributes);
  return formatReportAddress(address, attributes) || 'Address unavailable';
}

const installReportCompletionAnimation = () => {
  const status = $('rptStatus');
  const message = $('rptMsg');
  if (!status || !message || typeof MutationObserver === 'undefined') return;

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const checkmark = document.createElementNS(svgNamespace, 'svg');
  checkmark.setAttribute('class', 'checkmark');
  checkmark.setAttribute('viewBox', '0 0 52 52');
  checkmark.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(svgNamespace, 'circle');
  circle.setAttribute('class', 'checkmark__circle');
  circle.setAttribute('cx', '26');
  circle.setAttribute('cy', '26');
  circle.setAttribute('r', '25');
  circle.setAttribute('fill', 'none');

  const tick = document.createElementNS(svgNamespace, 'path');
  tick.setAttribute('class', 'checkmark__check');
  tick.setAttribute('fill', 'none');
  tick.setAttribute('d', 'M14.1 27.2l7.1 7.2 16.7-16.8');

  checkmark.append(circle, tick);
  status.insertBefore(checkmark, message);

  const actions = $('rptActions');
  const overlay = $('rptOverlay');
  const update = () => {
    const reportIsReady = message.textContent.trim().toLowerCase() === 'report ready';
    const readyActionIsVisible = !actions || actions.style.display !== 'none';
    status.classList.toggle('is-complete', reportIsReady && readyActionIsVisible);
  };

  const observer = new MutationObserver(update);
  observer.observe(message, { childList: true, characterData: true, subtree: true });
  if (actions) observer.observe(actions, { attributes: true, attributeFilter: ['style'] });
  if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
  update();
};

installReportCompletionAnimation();

export const backgroundFactor = () =>
  document?.visibilityState === 'hidden' ? 3 : 1;

export const raf = () =>
  new Promise(resolve => {
    if (document?.visibilityState === 'hidden') {
      setTimeout(resolve, 50);
    } else {
      requestAnimationFrame(() => resolve());
    }
  });

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const slug = value =>
  String(value || 'overlay')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const htmlEsc = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const REPORT_MAP_SCALE = 1000;
export const REPORT_MAP_SCALE_INCREMENT = 1000;

export const roundUpReportMapScale = scale => {
  const fittedScale = Number(scale);
  if (!Number.isFinite(fittedScale) || fittedScale <= 0) return REPORT_MAP_SCALE;
  return Math.max(
    REPORT_MAP_SCALE,
    Math.ceil((fittedScale - 0.01) / REPORT_MAP_SCALE_INCREMENT) * REPORT_MAP_SCALE_INCREMENT
  );
};

export const roundReportMapScale = scale => {
  const fittedScale = Number(scale);
  if (!Number.isFinite(fittedScale) || fittedScale <= 0) return REPORT_MAP_SCALE;
  return Math.max(
    REPORT_MAP_SCALE,
    Math.round(fittedScale / REPORT_MAP_SCALE_INCREMENT) * REPORT_MAP_SCALE_INCREMENT
  );
};

export const getReportMapScale = view => roundReportMapScale(view?.scale);

export const reportMapScaleText = (scale = REPORT_MAP_SCALE) =>
  `Scale 1:${roundReportMapScale(scale).toLocaleString('en-AU')}`;

const extentSpan = (extent, axis) => {
  const direct = Number(extent?.[axis === 'x' ? 'width' : 'height']);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const min = Number(extent?.[`${axis}min`]);
  const max = Number(extent?.[`${axis}max`]);
  return Number.isFinite(min) && Number.isFinite(max) ? Math.abs(max - min) : 0;
};

export const estimateReportMapScale = (view, target) => {
  const currentScale = Number(view?.scale);
  const currentExtent = view?.extent;
  const targetExtent = target?.extent || target;
  if (!Number.isFinite(currentScale) || currentScale <= 0 || !currentExtent || !targetExtent) return 0;

  const currentWkid = currentExtent?.spatialReference?.latestWkid || currentExtent?.spatialReference?.wkid;
  const targetWkid = targetExtent?.spatialReference?.latestWkid || targetExtent?.spatialReference?.wkid;
  if (currentWkid && targetWkid && currentWkid !== targetWkid) return 0;

  const currentWidth = extentSpan(currentExtent, 'x');
  const currentHeight = extentSpan(currentExtent, 'y');
  const targetWidth = extentSpan(targetExtent, 'x');
  const targetHeight = extentSpan(targetExtent, 'y');
  const widthRatio = currentWidth > 0 ? targetWidth / currentWidth : 0;
  const heightRatio = currentHeight > 0 ? targetHeight / currentHeight : 0;
  const fitRatio = Math.max(widthRatio, heightRatio);
  return Number.isFinite(fitRatio) && fitRatio > 0 ? currentScale * fitRatio : 0;
};

export const reportTargetFitsView = (view, target) => {
  const viewExtent = view?.extent;
  const targetExtent = target?.extent || target;
  if (!viewExtent || !targetExtent) return null;
  const viewWkid = viewExtent?.spatialReference?.latestWkid || viewExtent?.spatialReference?.wkid;
  const targetWkid = targetExtent?.spatialReference?.latestWkid || targetExtent?.spatialReference?.wkid;
  if (viewWkid && targetWkid && viewWkid !== targetWkid) return null;
  const values = [
    Number(viewExtent.xmin), Number(viewExtent.ymin), Number(viewExtent.xmax), Number(viewExtent.ymax),
    Number(targetExtent.xmin), Number(targetExtent.ymin), Number(targetExtent.xmax), Number(targetExtent.ymax)
  ];
  if (!values.every(Number.isFinite)) return null;
  const tolerance = Math.max(extentSpan(targetExtent, 'x'), extentSpan(targetExtent, 'y'), 1) * 1e-7;
  return targetExtent.xmin >= viewExtent.xmin - tolerance
    && targetExtent.xmax <= viewExtent.xmax + tolerance
    && targetExtent.ymin >= viewExtent.ymin - tolerance
    && targetExtent.ymax <= viewExtent.ymax + tolerance;
};

const DEVELOPMENT_APPLICATION_PORTALS = Object.freeze([
  { match: /brisbane/i, url: 'https://developmenti.brisbane.qld.gov.au/Home/', developmentI: true },
  { match: /fraser\s+coast/i, url: 'https://pdonline.frasercoast.qld.gov.au/' },
  { match: /gold\s+coast/i, url: 'https://developmenti.goldcoast.qld.gov.au/Home/', developmentI: true },
  { match: /gympie/i, url: 'https://daonline.gympie.qld.gov.au/Home/Index' },
  { match: /ipswich/i, url: 'https://developmenti.ipswich.qld.gov.au/Home/', developmentI: true },
  { match: /logan/i, url: 'https://devet.loganhub.com.au/' },
  { match: /moreton\s+bay/i, url: 'https://www.moretonbay.qld.gov.au/Services/Building-Development/DA-Tracker' },
  { match: /noosa/i, url: 'https://www.noosa.qld.gov.au/Planning-and-Development/Development-tools-and-guidelines/Planning-online' },
  { match: /redland/i, url: 'https://developmenti.redland.qld.gov.au/Home/', developmentI: true },
  { match: /sunshine\s+coast/i, url: 'https://developmenti.sunshinecoast.qld.gov.au/Home/', developmentI: true },
  { match: /southern\s+downs/i, url: 'https://www.sdrc.qld.gov.au/payments-services/online-services/development-application-tracking-service' },
  { match: /scenic\s+rim/i, url: 'https://www.scenicrim.qld.gov.au/Planning-and-Permits/Development-Assessment' },
  { match: /toowoomba/i, url: 'https://developmenti.tr.qld.gov.au/Home/', developmentI: true }
]);

export const buildDevelopmentApplicationSearchUrl = ({ council, address, lot } = {}) => {
  const portal = DEVELOPMENT_APPLICATION_PORTALS.find(item => item.match.test(String(council || '')));
  if (!portal) return null;
  if (!portal.developmentI) return portal.url;
  const cleanAddress = String(address || '').trim();
  const cleanLot = String(lot || '').trim();
  const searchText = cleanAddress && cleanAddress !== '--'
    ? cleanAddress
    : (cleanLot && cleanLot !== '--' ? cleanLot : '');
  const url = new URL(portal.url);
  if (searchText) url.searchParams.set('searchText', searchText);
  url.searchParams.set('from', 'lotwise');
  return url.href;
};

export const applyReportMapScale = async (view, geom, waitForIdle, fitTarget) => {
  if (!view) return REPORT_MAP_SCALE;
  // Scale to the lot itself. Council framing buffers are useful for context, but
  // must not force a parcel that fits at 1:3,000 out to 1:4,000.
  const fittedTarget = geom?.extent || geom || fitTarget || view.extent;
  const estimatedFitScale = estimateReportMapScale(view, fittedTarget);
  if (fittedTarget) {
    try {
      await view.goTo(fittedTarget, { animate: false });
    } catch {}
    if (typeof waitForIdle === 'function') {
      try {
        await waitForIdle(260);
      } catch {}
    }
  }

  const fittedScale = Math.max(Number(view.scale) || 0, estimatedFitScale);
  let reportScale = roundReportMapScale(fittedScale);
  const target = fittedTarget?.center || geom?.centroid || geom?.extent?.center || geom || view.center;
  try {
    await view.goTo({ target, scale: reportScale }, { animate: false });
  } catch {
    try {
      view.scale = reportScale;
    } catch {}
  }
  if (typeof waitForIdle === 'function') {
    try {
      await waitForIdle(260);
    } catch {}
  }

  const fitsAtClosestScale = reportTargetFitsView(view, fittedTarget);
  if (fitsAtClosestScale === false) {
    reportScale += REPORT_MAP_SCALE_INCREMENT;
    try {
      await view.goTo({ target, scale: reportScale }, { animate: false });
    } catch {
      try {
        view.scale = reportScale;
      } catch {}
    }
    if (typeof waitForIdle === 'function') {
      try {
        await waitForIdle(260);
      } catch {}
    }
  } else if (fitsAtClosestScale === null && reportScale < fittedScale) {
    reportScale = roundUpReportMapScale(fittedScale);
    try {
      await view.goTo({ target, scale: reportScale }, { animate: false });
    } catch {
      try {
        view.scale = reportScale;
      } catch {}
    }
  }
  return reportScale;
};

const settleBasemapChange = async view => {
  try {
    await view?.map?.basemap?.load?.();
  } catch {}
  let stableChecks = 0;
  for (let attempt = 0; attempt < 80 && stableChecks < 4; attempt += 1) {
    if (view?.updating === false) stableChecks += 1;
    else stableChecks = 0;
    await sleep(50);
  }
  await sleep(200);
};

export const withSatelliteBasemap = async (view, capture) => {
  const map = view?.map;
  const previous = map?.basemap;
  try {
    if (map) {
      map.basemap = 'satellite';
      await settleBasemapChange(view);
    }
    return await capture();
  } finally {
    if (map && previous) {
      try {
        map.basemap = previous;
      } catch {}
      // Do not let overlay screenshots start while satellite tiles are still
      // displayed from the main report image.
      await settleBasemapChange(view);
    }
  }
};

export const QUEENSLAND_FFDI_LAYER_URL =
  'https://gis.fire.qld.gov.au/arcgis/rest/services/Redi/FFDI_h20/MapServer/0';

const queenslandFfdiLayers = new WeakMap();

const queenslandFfdiRenderer = () => ({
  type: 'class-breaks',
  field: 'ffdi',
  defaultLabel: 'FFDI below 25',
  defaultSymbol: {
    type: 'simple-fill',
    color: [255, 237, 160, 90],
    outline: { color: [110, 88, 28, 180], width: 0.5 }
  },
  classBreakInfos: [
    {
      minValue: 25,
      maxValue: 49,
      label: 'Very High (FFDI 25–49)',
      symbol: { type: 'simple-fill', color: [255, 214, 102, 118], outline: { color: [184, 126, 0, 210], width: 0.6 } }
    },
    {
      minValue: 50,
      maxValue: 74,
      label: 'Severe (FFDI 50–74)',
      symbol: { type: 'simple-fill', color: [255, 145, 52, 126], outline: { color: [194, 74, 0, 220], width: 0.65 } }
    },
    {
      minValue: 75,
      maxValue: 99,
      label: 'Extreme (FFDI 75–99)',
      symbol: { type: 'simple-fill', color: [219, 49, 36, 132], outline: { color: [146, 16, 10, 225], width: 0.7 } }
    },
    {
      minValue: 100,
      maxValue: 999,
      label: 'Catastrophic (FFDI 100+)',
      symbol: { type: 'simple-fill', color: [92, 31, 117, 140], outline: { color: [52, 13, 70, 230], width: 0.75 } }
    }
  ]
});

export const isQueenslandFfdiLayer = node => {
  if (!node) return false;
  if (String(node.id || '').toLowerCase() === 'lotwise-qld-ffdi') return true;
  return /gis\.fire\.qld\.gov\.au\/arcgis\/rest\/services\/Redi\/FFDI_h20\/MapServer(?:\/0)?\b/i
    .test(String(node.url || ''));
};

const findQueenslandFfdiLayer = map => {
  let match = null;
  const seen = new Set();
  const visit = node => {
    if (!node || seen.has(node) || match) return;
    seen.add(node);
    if (isQueenslandFfdiLayer(node)) {
      match = node;
      return;
    }
    for (const key of ['layers', 'sublayers']) {
      const collection = node[key];
      if (!collection) continue;
      try {
        if (typeof collection.toArray === 'function') collection.toArray().forEach(visit);
        else if (Array.isArray(collection)) collection.forEach(visit);
        else if (typeof collection.forEach === 'function') collection.forEach(visit);
      } catch {}
    }
  };
  visit(map);
  return match;
};

const operationalLayers = node => {
  const collection = node?.layers;
  if (!collection) return [];
  try {
    if (typeof collection.toArray === 'function') return collection.toArray();
    if (Array.isArray(collection)) return [...collection];
    const layers = [];
    if (typeof collection.forEach === 'function') collection.forEach(layer => layers.push(layer));
    return layers;
  } catch {
    return [];
  }
};

const planningSchemeTitle = title => /^\s*planning\s+scheme\s*$/i.test(String(title || ''));

const layerListTopLevelCategory = layer => {
  const title = String(layer?.title || '').trim();
  if (/\b(?:utilit(?:y|ies|es)|utilis(?:e|es))\b/i.test(title)) return 'utilities';
  if (/\bzoning\b/i.test(title) || /^zones?$/i.test(title)) return 'zoning';
  if (/\bprecincts?\b/i.test(title)) return 'precinct';
  return null;
};

const hiddenOperationalLayer = layer => {
  if (!layer || layer.type === 'graphics' || layer.listMode === 'hide') return true;
  const text = [layer.title, layer.id, layer.url].filter(Boolean).join(' ');
  return /do\s+not\s+(?:touch|toggle)|property[\s_-]*boundar|parcel[\s_-]*boundar|\bcadast(?:re|ral)\b|\bdcdb\b|\baddresses?\b/i.test(text);
};

const removeLayerFromOperationalParent = (parent, layer) => {
  try {
    if (typeof parent?.remove === 'function') parent.remove(layer);
    else if (typeof parent?.layers?.remove === 'function') parent.layers.remove(layer);
  } catch {}
};

/**
 * Keeps the public layer list consistent across council maps. Planning overlays
 * live in one expandable group; Utilities, Zoning and Precincts stay at root.
 * Hidden parcel/address/system layers are deliberately left where they are.
 */
export const organizePlanningSchemeLayers = (map, GroupLayer) => {
  if (!map?.layers || typeof GroupLayer !== 'function') return null;

  let roots = operationalLayers(map);
  let group = roots.find(layer => layer?.type === 'group' && planningSchemeTitle(layer.title)) || null;
  const ungroupedPlanningLayers = roots.filter(layer => layer !== group && planningSchemeTitle(layer?.title));

  if (!group) {
    // Let a portal-backed WebMap finish hydrating first so its authored
    // Planning Scheme group can be reused instead of creating a duplicate.
    if (map.portalItem && map.loadStatus !== 'loaded') return null;
    try {
      group = new GroupLayer({
        id: 'lotwise-planning-scheme',
        title: 'Planning Scheme',
        visible: false,
        listMode: 'show',
        visibilityMode: 'independent'
      });
      map.add(group);
    } catch {
      return null;
    }
  }

  try { group.title = 'Planning Scheme'; } catch {}
  try { group.listMode = 'show'; } catch {}
  try { group.visibilityMode = 'independent'; } catch {}

  // Some portal maps expose Planning Scheme as a MapImageLayer rather than a
  // group. Wrap that service so additional state/local overlays can sit beside it.
  for (const layer of ungroupedPlanningLayers) {
    removeLayerFromOperationalParent(map, layer);
    try { layer.title = 'Planning Scheme Overlays'; } catch {}
    try { group.add(layer); } catch {}
  }

  // Correct portal maps that have one of the three requested root categories
  // nested directly within their Planning Scheme group.
  const promoteRootCategories = parent => {
    for (const child of operationalLayers(parent)) {
      if (layerListTopLevelCategory(child)) {
        removeLayerFromOperationalParent(parent, child);
        try { map.add(child); } catch {}
      } else if (child?.type === 'group') {
        promoteRootCategories(child);
      }
    }
  };
  promoteRootCategories(group);

  roots = operationalLayers(map);
  for (const layer of roots) {
    if (layer === group || planningSchemeTitle(layer?.title)) continue;
    if (layerListTopLevelCategory(layer) || hiddenOperationalLayer(layer)) continue;
    removeLayerFromOperationalParent(map, layer);
    try { group.add(layer); } catch {}
  }

  return group;
};

export const ensureQueenslandFfdiLayer = (map, FeatureLayer, esriConfig) => {
  if (!map || typeof FeatureLayer !== 'function') return null;
  try {
    const servers = esriConfig?.request?.corsEnabledServers;
    if (servers && !servers.includes('gis.fire.qld.gov.au')) servers.push('gis.fire.qld.gov.au');
  } catch {}
  let layer = queenslandFfdiLayers.get(map) || findQueenslandFfdiLayer(map);
  if (!layer) {
    layer = new FeatureLayer({
      id: 'lotwise-qld-ffdi',
      url: QUEENSLAND_FFDI_LAYER_URL,
      title: 'Forest Fire Danger Index (FFDI 5% AEP)',
      listMode: 'show',
      visible: false,
      opacity: 0.68,
      minScale: 0,
      maxScale: 0,
      outFields: ['OBJECTID', 'Id', 'ffdi'],
      popupEnabled: true,
      popupTemplate: {
        title: 'Forest Fire Danger Index',
        content: [{
          type: 'fields',
          fieldInfos: [{ fieldName: 'ffdi', label: 'FFDI', format: { places: 0, digitSeparator: true } }]
        }]
      },
      renderer: queenslandFfdiRenderer()
    });
    const planningGroup = operationalLayers(map)
      .find(candidate => candidate?.type === 'group' && planningSchemeTitle(candidate.title));
    try { (planningGroup || map).add(layer); } catch { return null; }
  } else {
    try { layer.listMode = 'show'; } catch {}
    try { layer.minScale = 0; layer.maxScale = 0; } catch {}
    try { layer.renderer = queenslandFfdiRenderer(); } catch {}
  }
  queenslandFfdiLayers.set(map, layer);
  return layer;
};

// Transport-noise layers are authored differently by each council. Some use a
// descriptive title while others expose only codes such as TNC_SM3. Keep the
// matching and traversal in one place so reports do not depend on a particular
// portal item's naming or nesting convention.
const TRANSPORT_NOISE_CORRIDOR_PATTERN = /(?:\btransport[\s_-]*noise[\s_-]*corridors?\b|\bnoise[\s_-]*corridors?\b|\bstate[\s_-]*designated[\s_-]*noise\b|\bstate.*road.*noise\b|\broad.*traffic.*noise\b|\btmr.*noise\b|\bacoustic.*corridor\b|\bqdc\s*(?:mp\s*)?4\.4\s*noise\b|\bmp\s*4\.4\s*noise\b|\btnc(?:\b|[_-]))/i;

export const isTransportNoiseCorridorText = (...values) => {
  const text = values.flat(Infinity).filter(Boolean).join(' ');
  return TRANSPORT_NOISE_CORRIDOR_PATTERN.test(text);
};

const transportNoiseNodeText = node => [
  node?.title,
  node?.name,
  node?.id,
  node?.url,
  node?.portalItem?.title,
  node?.portalItem?.snippet,
  node?.portalItem?.description,
  node?.portalItem?.tags,
  node?.sourceJSON?.name,
  node?.layerDefinition?.name
];

export const isTransportNoiseCorridorNode = (node, path = '') =>
  !!node && isTransportNoiseCorridorText(path, transportNoiseNodeText(node));

/**
 * Return every renderable TNC leaf, including layers placed under hidden
 * "do not touch" groups. Loading the map first avoids the intermittent empty
 * result seen while portal-backed sublayers are still hydrating.
 */
export async function collectTransportNoiseCorridorDisplayNodes(root, { loadTimeoutMs = 8000 } = {}) {
  if (!root) return [];

  const loadTask = typeof root.loadAll === 'function'
    ? Promise.resolve().then(() => root.loadAll())
    : (typeof root.load === 'function' ? Promise.resolve().then(() => root.load()) : null);
  if (loadTask) {
    let timer = null;
    try {
      await Promise.race([
        loadTask.catch(() => null),
        new Promise(resolve => { timer = setTimeout(resolve, loadTimeoutMs); })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const results = [];
  const seen = new Set();
  const added = new Set();
  const visit = (node, inheritedMatch = false, parentPath = '') => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const label = String(node.title || node.name || node.id || '').trim();
    const path = [parentPath, label].filter(Boolean).join(' / ');
    const matches = inheritedMatch || isTransportNoiseCorridorNode(node, path);
    const children = nativeLayerChildren(node);
    if (children.length) {
      children.forEach(child => visit(child, matches, path));
      return;
    }
    if (!matches || added.has(node) || !('visible' in node)) return;
    added.add(node);
    results.push(node);
  };
  visit(root);
  return results;
}

const reportNodeArray = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    if (typeof value.toArray === 'function') return value.toArray().filter(Boolean);
    if (typeof value[Symbol.iterator] === 'function') return [...value].filter(Boolean);
  } catch {}
  return [];
};

/**
 * Apply the report-section behaviour that every council should share. TNC is
 * special because council portal items use inconsistent names and often keep
 * the useful leaf layers inside hidden groups. Loading and merging those leaves
 * here also ensures their renderers exist before the report key is generated.
 */
export async function prepareMandatoryOverlayReportSection(root, title, collectorFn) {
  const collected = typeof collectorFn === 'function' ? await collectorFn() : [];
  let nodes = reportNodeArray(collected);
  const transportNoise = isTransportNoiseCorridorText(title);

  if (transportNoise) {
    const sharedNodes = await collectTransportNoiseCorridorDisplayNodes(root);
    nodes = [...new Set([...nodes, ...sharedNodes])];
    await Promise.all(nodes.map(async node => {
      if (typeof node?.load !== 'function') return;
      let timer = null;
      try {
        await Promise.race([
          Promise.resolve(node.load()).catch(() => null),
          new Promise(resolve => { timer = setTimeout(resolve, 8000); })
        ]);
      } catch {
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));
  }

  return {
    nodes,
    captureOptions: {
      forceAllVisible: true,
      // TNC keys must come only from features that intersect the selected lot.
      // Keep hidden source leaves queryable without falling back to every
      // class exposed by their renderer.
      legendAllRendererItems: false,
      legendIncludeHiddenNodes: transportNoise,
      legendStrictLotIntersection: transportNoise
    }
  };
}

/**
 * Resolve the exact features touching a selected lot without changing the
 * layer's definition expression. The ID-first query is more reliable across
 * the mix of FeatureLayer and MapImageLayer sublayers used by councils, while
 * leaving every feature available for the report screenshot to render.
 */
export async function queryStrictOverlayFeatureHits(node, geometry, { timeoutMs = 8000 } = {}) {
  if (!node || !geometry) return { ids: [], features: [] };

  const within = promise => {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('overlay feature query timed out')), timeoutMs);
      })
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  const query = { geometry, spatialRelationship: 'intersects' };
  let ids = [];
  try {
    if (typeof node.queryObjectIds === 'function') {
      const result = await within(node.queryObjectIds(query));
      ids = [...new Set((result || []).map(Number).filter(Number.isFinite))];
    }
  } catch {}

  const oid = node.objectIdField
    || (node.fields || []).find(field => String(field?.type || '').toLowerCase() === 'oid')?.name;
  if (!oid || typeof node.queryFeatures !== 'function') return { ids, features: [] };

  if (!ids.length) {
    try {
      const result = await within(node.queryFeatures({
        ...query,
        returnGeometry: true,
        outFields: ['*']
      }));
      const features = result?.features || [];
      ids = [...new Set(features.map(feature => Number(feature.attributes?.[oid])).filter(Number.isFinite))];
      return { ids, features };
    } catch {
      return { ids: [], features: [] };
    }
  }

  try {
    const result = await within(node.queryFeatures({
      where: `${oid} IN (${ids.join(',')})`,
      returnGeometry: true,
      outFields: ['*']
    }));
    return { ids, features: result?.features || [] };
  } catch {
    return { ids, features: [] };
  }
}

const usablePropertyInfoValue = value => {
  const text = String(value ?? '').trim();
  return text && text !== '--' ? text : '';
};

/** Show the same selected-property information bubble on every council map. */
export function showPropertyInfoPopup(view, info = {}, { location = null } = {}) {
  if (!view || !info?.feature?.geometry) return false;
  const reportOverlay = document.getElementById('rptOverlay');
  const reportViewer = document.getElementById('reportViewer');
  const overlayVisible = reportOverlay && (
    (reportOverlay.style.display && reportOverlay.style.display !== 'none')
    || reportOverlay.getAttribute('aria-hidden') === 'false'
  );
  const viewerVisible = reportViewer && (
    reportViewer.classList?.contains('active')
    || reportViewer.getAttribute('aria-hidden') === 'false'
  );
  if (overlayVisible || viewerVisible) return false;

  const address = usablePropertyInfoValue(info.addressText);
  const lot = usablePropertyInfoValue(info.lotText);
  const rows = [
    ['Address', address],
    ['Lot / plan', lot],
    ['Area', usablePropertyInfoValue(info.areaText)],
    ['Property class', usablePropertyInfoValue(info.classText)],
    ['Council', usablePropertyInfoValue(info.councilText)]
  ].filter(([, value]) => value);
  if (!rows.length) return false;

  const geometry = info.feature.geometry;
  const popupLocation = location
    || geometry.centroid
    || geometry.extent?.center
    || (geometry.type === 'point' ? geometry : null);
  if (!popupLocation) return false;

  const content = `<div class="lotwise-property-popup">${rows.map(([label, value]) =>
    `<div style="margin:0 0 6px"><strong>${htmlEsc(label)}:</strong> ${htmlEsc(value)}</div>`
  ).join('')}</div>`;
  const title = address || (lot ? `Lot ${lot}` : 'Property information');

  try {
    // The app owns parcel clicks, so disable the competing automatic layer
    // popup and explicitly open the selected-property summary instead.
    view.popupEnabled = false;
    if (typeof view.openPopup === 'function') {
      Promise.resolve(view.openPopup({ location: popupLocation, title, content })).catch(() => {});
    } else if (view.popup && typeof view.popup.open === 'function') {
      view.popup.open({ location: popupLocation, title, content });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const NATIVE_PARCEL_REFERENCE_PATTERN = /(?:property[\s_-]*boundar|parcel[\s_-]*boundar|boundaries[\s_-]*(?:parcel|holding)|land[\s_-]*parcel[\s_-]*property[\s_-]*framework|property_boundaries_(?:parcel|holding)|\bdcdb\b|\bcadastr(?:e|al)?\b|\blot[\s_-]*(?:numbers?|labels?|plans?)\b)/i;

const nativeParcelReferenceText = node => {
  const tags = node?.portalItem?.tags || node?.tags || [];
  return [
    node?.title,
    node?.id,
    node?.url,
    node?.portalItem?.url,
    Array.isArray(tags) ? tags.join(' ') : tags
  ].filter(Boolean).join(' ');
};

export const isNativeParcelReferenceLayer = node =>
  !!node && NATIVE_PARCEL_REFERENCE_PATTERN.test(nativeParcelReferenceText(node));

const nativeLayerChildren = node => {
  const children = [];
  for (const key of ['layers', 'sublayers']) {
    const collection = node?.[key];
    if (!collection) continue;
    try {
      if (typeof collection.toArray === 'function') children.push(...collection.toArray());
      else if (Array.isArray(collection)) children.push(...collection);
      else if (typeof collection.forEach === 'function') collection.forEach(child => children.push(child));
    } catch {}
  }
  return children;
};

const enableNativeParcelNode = node => {
  if (!node) return;
  if ('visible' in node) {
    try { node.visible = true; } catch {}
  }
  if ('labelsVisible' in node) {
    try { node.labelsVisible = true; } catch {}
  }
  try {
    node.minScale = 0;
    node.maxScale = 0;
  } catch {}
  if (node.type === 'sublayer') {
    try { node.updateFromJSON({ visible: true, minScale: 0, maxScale: 0 }); } catch {}
  }
  let parent = node.parent;
  while (parent) {
    if ('visible' in parent) {
      try { parent.visible = true; } catch {}
    }
    try {
      parent.minScale = 0;
      parent.maxScale = 0;
    } catch {}
    parent = parent.parent;
  }
};

export const showNativeParcelReferences = root => {
  const active = [];
  const seen = new Set();
  const visit = (node, insideParcelGroup = false) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const isParcelReference = insideParcelGroup || isNativeParcelReferenceLayer(node);
    if (isParcelReference) {
      enableNativeParcelNode(node);
      active.push(node);
    }
    nativeLayerChildren(node).forEach(child => visit(child, isParcelReference));
  };
  visit(root);
  return active;
};

export const prepareNativeParcelReferences = async (view, waitForIdle) => {
  const active = showNativeParcelReferences(view?.map);
  if (view?.whenLayerView) {
    const owners = new Set();
    active.forEach(node => {
      let owner = node;
      while (owner?.type === 'sublayer') owner = owner.parent;
      if (owner && owner !== view.map) owners.add(owner);
    });
    await Promise.all(Array.from(owners, owner =>
      Promise.resolve(view.whenLayerView(owner)).catch(() => null)
    ));
  }
  if (typeof waitForIdle === 'function') {
    try { await waitForIdle(120); } catch {}
  } else {
    await raf();
    await sleep(100);
  }
  return active;
};

export const attrEsc = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');

const POD_PDF_WORKER_SRC =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let podPdfLibPromise = null;

const ensurePodPdfjs = async () => {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (!podPdfLibPromise) {
    podPdfLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        if (window.pdfjsLib) {
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = POD_PDF_WORKER_SRC;
          } catch (err) {
            console.warn('pdfjs worker init failed', err);
          }
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('pdf.js did not load'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load pdf.js'));
      document.head.appendChild(script);
    });
  }
  return podPdfLibPromise;
};

const podExtractPdfText = async file => {
  if (!file) throw new Error('No file selected');
  await ensurePodPdfjs();
  if (!window.pdfjsLib) throw new Error('PDF parser not available');
  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str || '').filter(Boolean);
    text += strings.join(' ') + '\n';
  }
  return text;
};

const podParseSubdivisionsFromText = text => {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  const subdivisions = [];
  const planRegex = /\b((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/i;
  const planLooseRegex = /((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)/i;
  const lotRegex = /\b(?:lot|lot\s*no\.?)\s*[:#-]?\s*([0-9A-Za-z-]+)\b/i;
  const comboRegex = /(\d+[A-Za-z-]?)(?:\s*(?:\/|on)\s*|\s*)((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)/i;
  const areaRegex = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:m2|m\u00b2|sqm|square metres?)/i;
  const addUnique = (lot, plan, areaSqm, raw) => {
    const key = `${lot || ''}_${plan || ''}`;
    if (!subdivisions.some(sub => `${sub.lot}_${sub.plan}` === key)) {
      subdivisions.push({ lot: lot || null, plan: plan || null, areaSqm: areaSqm ?? null, raw });
    }
  };

  [...text.matchAll(/\bLot\s+(\d+[A-Za-z-]?)\s+on\s+((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/ig)]
    .forEach(match => addUnique(match[1].toUpperCase(), match[2].replace(/[\s-]+/g, '').toUpperCase(), null, match[0]));
  [...text.matchAll(/\b(\d+[A-Za-z-]?)\s*(?:\/|on)?\s*((?:SP|RP|CP|BUP|SL|DP|SPRP)\s*-?\s*\d+)\b/ig)]
    .forEach(match => addUnique(match[1].toUpperCase(), match[2].replace(/[\s-]+/g, '').toUpperCase(), null, match[0]));

  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    if (!current.lot && !current.plan) return;
    if (typeof current.areaSqm !== 'number' || !Number.isFinite(current.areaSqm)) {
      current.areaSqm = null;
    }
    addUnique(current.lot, current.plan, current.areaSqm, current.raw);
  };

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ');
    const lotMatch = normalized.match(lotRegex);
    let planMatch = normalized.match(planRegex);
    if (!planMatch) planMatch = normalized.match(planLooseRegex);
    const comboMatch = normalized.match(comboRegex);
    const areaMatch = normalized.match(areaRegex);
    let candidateLot = null;
    let candidatePlan = null;

    if (comboMatch) {
      candidateLot = comboMatch[1].toUpperCase();
      candidatePlan = comboMatch[2].replace(/[\s-]+/g, '').toUpperCase();
    }
    if (lotMatch) candidateLot = lotMatch[1].toUpperCase();
    if (planMatch) {
      candidatePlan = planMatch[1].replace(/[\s-]+/g, '').toUpperCase();
      if (!candidateLot && typeof planMatch.index === 'number') {
        const prefix = normalized.slice(0, planMatch.index).trim();
        const inline = prefix.match(/(\d+[A-Za-z-]?)/);
        if (inline) candidateLot = inline[1].toUpperCase();
      }
    }

    const shouldStartNew = !current ||
      (candidateLot && current.lot && candidateLot !== current.lot) ||
      (candidatePlan && current.plan && candidatePlan !== current.plan);
    if (shouldStartNew) {
      pushCurrent();
      current = { lot: null, plan: null, areaSqm: null, raw: normalized };
    } else if (current) {
      current.raw = normalized;
    } else {
      current = { lot: null, plan: null, areaSqm: null, raw: normalized };
    }

    if (candidateLot) current.lot = candidateLot;
    if (candidatePlan) current.plan = candidatePlan;
    if (areaMatch) {
      const parsed = parseFloat(areaMatch[1].replace(/,/g, ''));
      if (!Number.isNaN(parsed)) current.areaSqm = parsed;
    }
  }

  pushCurrent();
  return subdivisions;
};

export function initPodUpload({ focusOnLotPlan, uploadMessage = ' Upload to ArcGIS coming soon.' } = {}) {
  const form = $('podForm');
  const input = $('podFile');
  const statusEl = $('podStatus');
  const list = $('podResultList');
  const wrap = $('podResultWrap');
  const submitBtn = $('podSubmitBtn');
  if (!form || !input || !statusEl) return false;

  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
  };
  const setBusy = busy => {
    if (submitBtn) {
      submitBtn.disabled = busy;
      submitBtn.textContent = busy ? 'Uploading...' : 'Upload & Import';
    }
    input.disabled = busy;
  };
  const renderResults = (items = []) => {
    if (!wrap || !list) return;
    if (!items.length) {
      wrap.hidden = true;
      list.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    list.innerHTML = items.map(sub => {
      const lotRaw = sub.lot || '';
      const planRaw = sub.plan || '';
      const lot = htmlEsc(lotRaw || '?');
      const plan = htmlEsc(planRaw || 'Unknown plan');
      const area = sub.areaSqm ? `${sub.areaSqm.toLocaleString()} sqm` : 'Area N/A';
      const btn = sub.lot && sub.plan
        ? `<button class="pod-zoom-btn" data-lot="${attrEsc(lotRaw)}" data-plan="${attrEsc(planRaw)}">Use</button>`
        : '';
      return `<li><div class="pod-result-row">${btn}<div>Lot ${lot} on ${plan} (${area})</div></div></li>`;
    }).join('');
  };
  const focusLotPlan = async (lot, plan) =>
    typeof focusOnLotPlan === 'function' ? !!(await focusOnLotPlan(lot, plan)) : false;

  list?.addEventListener('click', async evt => {
    const btn = evt.target.closest('.pod-zoom-btn');
    if (!btn) return;
    evt.preventDefault();
    let { lot, plan } = btn.dataset;
    if (!lot || !plan) {
      const txt = (btn.closest('.pod-result-row')?.innerText || '').trim();
      const match = txt.match(/Lot\s+(\S+)\s+on\s+(\S+)/i);
      if (match) {
        lot = match[1];
        plan = match[2];
      }
    }
    if (!lot || !plan) {
      setStatus('Missing lot/plan on selection.', true);
      return;
    }
    setBusy(true);
    setStatus(`Zooming to Lot ${lot} on ${plan}...`);
    const ok = await focusLotPlan(lot, plan);
    setBusy(false);
    setStatus(ok ? `Focused on Lot ${lot} on ${plan}.` : `Could not locate Lot ${lot} on ${plan} in the available parcel datasets.`, !ok);
  });

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    const nameEl = $('podFileName');
    if (file) {
      if (nameEl) nameEl.textContent = file.name;
      setStatus(`Ready to import ${file.name}`);
    } else {
      if (nameEl) nameEl.textContent = 'No file chosen';
      setStatus('Select a POD PDF to begin.');
      renderResults([]);
    }
  });

  form.addEventListener('submit', async evt => {
    evt.preventDefault();
    if (!input.files || !input.files.length) {
      setStatus('Choose a POD PDF first.', true);
      return;
    }
    const file = input.files[0];
    setBusy(true);
    setStatus('Parsing PDF locally...');
    renderResults([]);
    try {
      const text = await podExtractPdfText(file);
      if (!text || !text.trim()) throw new Error('PDF did not contain readable text.');
      const subdivisions = podParseSubdivisionsFromText(text);
      renderResults(subdivisions);
      const count = subdivisions.length;
      let msg = count ? `Parsed ${count} subdivision${count === 1 ? '' : 's'} locally.` : 'No subdivisions detected.';
      let statusError = false;
      const focusTarget = subdivisions.find(sub => sub.lot && sub.plan);
      if (count === 1 && focusTarget) {
        const zoomed = await focusLotPlan(focusTarget.lot, focusTarget.plan);
        if (zoomed) {
          msg += ` Zoomed to Lot ${focusTarget.lot} on ${focusTarget.plan}.`;
        } else {
          msg += ` Could not locate Lot ${focusTarget.lot} on ${focusTarget.plan} in the available parcel datasets.`;
          statusError = true;
        }
      } else if (count > 1) {
        msg += ' Choose a lot below to zoom.';
      }
      if (uploadMessage) msg += uploadMessage;
      setStatus(msg, statusError);
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Local parsing failed', true);
    } finally {
      setBusy(false);
    }
  });

  const dropZone = $('podDropZone');
  const setFile = file => {
    if (!file) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch {
      setStatus('Choose the PDF with the file picker.', true);
      return;
    }
    const nameEl = $('podFileName');
    if (nameEl) nameEl.textContent = file.name;
    setStatus(`Ready to import ${file.name}`);
  };
  const prevent = evt => {
    evt.preventDefault();
    evt.stopPropagation();
  };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone?.addEventListener(eventName, prevent);
  });
  dropZone?.addEventListener('dragenter', () => dropZone.classList.add('dragover'));
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone?.addEventListener('dragend', () => dropZone.classList.remove('dragover'));
  dropZone?.addEventListener('drop', evt => {
    dropZone.classList.remove('dragover');
    const file = evt.dataTransfer?.files?.[0];
    if (file && file.type === 'application/pdf') {
      setFile(file);
    } else {
      setStatus('Drop a PDF file.', true);
    }
  });

  return true;
}

export function addCorsHosts(esriConfig, hosts) {
  try {
    const list = esriConfig.request.corsEnabledServers;
    hosts.forEach(host => {
      if (!list.includes(host)) list.push(host);
    });
  } catch {}
}

export const getQueryParam = name => {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
};

export const formatRemaining = ms => {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const setPaymentLink = url => {
  const link = $('accessPayLink');
  if (link) link.href = url;
};

export const setTimerVisible = show => {
  const timer = $('accessGateTimer');
  if (timer) timer.hidden = !show;
};

export const loadPaymentUrl = async () => {
  if (window.__LOT_WISE_FILE_MODE__) return null;
  try {
    const res = await fetch('/api/payment-config', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.paymentUrl) return json.paymentUrl;
    }
  } catch {}
  return null;
};

export const checkToken = async key => {
  if (window.__LOT_WISE_FILE_MODE__) {
    return {
      ok: true,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
  }
  try {
    const res = await fetch(`/api/check-token?key=${encodeURIComponent(key)}`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const json = await res.json();
      return { ok: true, expiresAt: json.expiresAt };
    }
    const text = await res.text();
    let message = 'Access denied.';
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) message = parsed.error;
    } catch {}
    return { ok: false, error: message };
  } catch {
    return { ok: false, error: 'Access check failed.' };
  }
};

export const setReportViewerVisible = on => {
  const viewer = $('reportViewer');
  if (!viewer) return;
  viewer.classList.toggle('active', !!on);
  viewer.setAttribute('aria-hidden', on ? 'false' : 'true');
};

export const setReportFrameHTML = html => {
  const frame = $('reportFrame');
  if (frame) frame.srcdoc = html || '';
};

export const QSCF_LAND_PARCEL_LAYER_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/QSCF_LandParcelPropertyFramework/MapServer/120";

const QSCF_PARCEL_FIELDS = [
  "lot", "plan", "lotplan", "tenure", "tenure_code", "statedarea", "statedareaunit",
  "excl_area", "lot_volume", "feat_name", "alias_name", "cms_no", "acc_code_desc",
  "acc_method", "acc_value", "surv_ind", "is_base", "is_multi", "is_volumetric",
  "parcel_state", "locality", "lga", "totalstrata", "horzstrata", "vertstrata",
  "uniqueid", "last_edited_date"
];

const qscfCompactLotPlan = value => {
  let text=String(value||"").toUpperCase().trim();
  if(!text || text==="--") return "";
  text=text.replace(/^LOT\s+/i,"").replace(/\s+ON\s+/i,"/");
  const split=text.match(/^([A-Z0-9.-]+)\s*\/\s*([A-Z]{1,6}\s*\d+[A-Z0-9.-]*)$/i);
  if(split) return `${split[1]}${split[2]}`.replace(/[^A-Z0-9]/g,"");
  return text.replace(/[^A-Z0-9]/g,"");
};

const qscfSqlText = value => String(value||"").replace(/'/g,"''");

const qscfGeometryJson = geometry => {
  if(!geometry) return null;
  try{
    const json=typeof geometry.toJSON==="function" ? geometry.toJSON() : JSON.parse(JSON.stringify(geometry));
    if(!json) return null;
    const sr=json.spatialReference || geometry.spatialReference;
    if(sr && !json.spatialReference){
      json.spatialReference=typeof sr.toJSON==="function" ? sr.toJSON() : sr;
    }
    return json;
  }catch{
    return null;
  }
};

const qscfGeometryType = geometry => {
  if(geometry?.rings) return "esriGeometryPolygon";
  if(geometry?.paths) return "esriGeometryPolyline";
  if(geometry?.points) return "esriGeometryMultipoint";
  if(Number.isFinite(Number(geometry?.x)) && Number.isFinite(Number(geometry?.y))) return "esriGeometryPoint";
  if([geometry?.xmin,geometry?.ymin,geometry?.xmax,geometry?.ymax].every(value=>Number.isFinite(Number(value)))){
    return "esriGeometryEnvelope";
  }
  return "esriGeometryPolygon";
};

const qscfSpatialReferenceId = geometry => {
  const sr=geometry?.spatialReference;
  const wkid=Number(sr?.latestWkid || sr?.wkid);
  return Number.isFinite(wkid) && wkid>0 ? wkid : null;
};

const qscfQuery = async (layerUrl, parameters, signal) => {
  const body=new URLSearchParams();
  Object.entries({f:"json",...parameters}).forEach(([key,value])=>{
    if(value!==undefined && value!==null && value!=="") body.set(key,String(value));
  });
  const response=await fetch(`${layerUrl}/query`,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
    body:body.toString(),
    signal
  });
  if(!response.ok) throw new Error(`QSCF request failed (${response.status})`);
  const payload=await response.json();
  if(payload?.error) throw new Error(payload.error.message || "QSCF query failed");
  return payload;
};

const qscfFeatureAttributes = feature => ({...(feature?.attributes||{})});

export async function queryQueenslandCadastralData({lotPlan,geometry,timeoutMs=12000}={}){
  const compactLotPlan=qscfCompactLotPlan(lotPlan);
  const selectedGeometry=qscfGeometryJson(geometry);
  const controller=typeof AbortController!=="undefined" ? new AbortController() : null;
  const timer=controller ? setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||12000)) : null;
  const signal=controller?.signal;
  try{
    let parcelPayload=null;
    if(compactLotPlan){
      parcelPayload=await qscfQuery(QSCF_LAND_PARCEL_LAYER_URL,{
        where:`lotplan='${qscfSqlText(compactLotPlan)}'`,
        outFields:QSCF_PARCEL_FIELDS.join(","),
        returnGeometry:"false",
        resultRecordCount:"10"
      },signal);
    }
    if(!parcelPayload?.features?.length && selectedGeometry){
      const inSR=qscfSpatialReferenceId(selectedGeometry);
      const geometryParameters={
        where:"1=1",
        geometry:JSON.stringify(selectedGeometry),
        geometryType:qscfGeometryType(selectedGeometry),
        inSR:inSR || undefined,
        outFields:QSCF_PARCEL_FIELDS.join(","),
        returnGeometry:"false",
        resultRecordCount:"25"
      };
      parcelPayload=await qscfQuery(QSCF_LAND_PARCEL_LAYER_URL,{
        ...geometryParameters,
        spatialRel:"esriSpatialRelContains"
      },signal);
      if(!parcelPayload?.features?.length){
        parcelPayload=await qscfQuery(QSCF_LAND_PARCEL_LAYER_URL,{
          ...geometryParameters,
          spatialRel:"esriSpatialRelIntersects"
        },signal);
      }
    }

    const candidates=Array.isArray(parcelPayload?.features)?parcelPayload.features:[];
    const exactCandidates=compactLotPlan
      ? candidates.filter(feature=>qscfCompactLotPlan(feature?.attributes?.lotplan)===compactLotPlan)
      : [];
    const parcelFeatures=exactCandidates.length
      ? exactCandidates
      : [candidates.find(feature=>String(feature?.attributes?.is_base||"").toLowerCase()==="yes") || candidates[0]].filter(Boolean);
    const parcelFeature=parcelFeatures[0] || null;
    if(!parcelFeature){
      return {
        ok:false,
        reason:"parcel_not_found",
        lotPlan:compactLotPlan || null,
        parcel:null,
        source:{parcel:QSCF_LAND_PARCEL_LAYER_URL},
        queriedAt:new Date().toISOString()
      };
    }

    return {
      ok:true,
      lotPlan:compactLotPlan || parcelFeature?.attributes?.lotplan || null,
      parcel:qscfFeatureAttributes(parcelFeature),
      parcelPartCount:parcelFeatures.length,
      source:{parcel:QSCF_LAND_PARCEL_LAYER_URL},
      queriedAt:new Date().toISOString()
    };
  }finally{
    if(timer) clearTimeout(timer);
  }
}

const qscfFormatArea = attrs => {
  const amount=Number(attrs?.statedarea);
  if(!Number.isFinite(amount)) return "--";
  const unit=String(attrs?.statedareaunit||"Square Meter").trim();
  const unitText=/square\s*met/i.test(unit) ? "m²" : unit;
  return `${amount.toLocaleString("en-AU",{maximumFractionDigits:2})} ${unitText}`;
};

export function composeLandscapePropertyReport({
      title,
      address,
      lot,
      area,
      propertyClass,
      council,
      generatedAt,
      baseShot,
      shots,
      detailPages,
      qscfData,
      hasFlood,
      floodUrl,
      floodAuthority,
      renderScale,
      planningLink,
      daSearchUrl
    }){
      const esc=htmlEsc;
      const scaleHTML=typeof renderScale==="function" ? renderScale : (shot=>shot?.scaleText ? `<div class="map-scale">${esc(shot.scaleText)}</div>` : "");
      const makePlanningLink=typeof planningLink==="function" ? planningLink : (()=>null);
      const currentFloodUrl=floodUrl||null;
      const showFloodWise=!!currentFloodUrl;
      const resolvedAddress=formatReportAddress(address);
      const safeAddress=resolvedAddress || (lot && lot!=="--" ? `Lot ${lot}, ${council}` : "Property report");
      const displayAddress=resolvedAddress || "Address unavailable";
      const currentDaSearchUrl=daSearchUrl||buildDevelopmentApplicationSearchUrl({council,address:resolvedAddress,lot});
      const when=generatedAt.toLocaleString("en-AU",{day:"numeric",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
      const logoBlack="./images/lot-companion-logo-black.png";
      const logoWhite="./images/lot-companion-logo-white.png";
      const brandIcon="./images/lot-companion-icon.png";
      const reportArea=qscfData?.ok && qscfData?.parcel ? qscfFormatArea(qscfData.parcel) : area;
      const suppliedDetailPages=Array.isArray(detailPages)?detailPages.filter(page=>page&&page.title):[];
      const supplementalPages=suppliedDetailPages.map((page,index)=>({
        ...page,
        id:page.id||`detail-${slug(page.title)||index+1}`
      }));
      const reportShots=(Array.isArray(shots)?shots:[]).map(shot=>{
        if(!shot||!/^(?:FFDI|Forest Fire Danger Index(?:\s*\([^)]*\))?)$/i.test(String(shot.title||"").trim())) return shot;
        return {...shot,title:"Forest Fire Danger Index"};
      }).filter(Boolean);
      const totalPages=2+supplementalPages.length+(showFloodWise?1:0)+reportShots.length+1;
      let pageNumber=0;
      const coverAddress=(()=>{
        const parts=String(safeAddress).match(/^(.+?\b(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Crescent|Cres|Place|Pl|Lane|Ln|Terrace|Tce|Highway|Hwy))[,\s]+(.+)$/i);
        return parts ? `${esc(parts[1])}<br>${esc(parts[2])}` : esc(safeAddress);
      })();
      const pageHeader=()=>`<header class="page-header"><img src="${logoBlack}" alt="Lot Companion"><div>${esc(safeAddress)} - ${esc(when)}</div></header>`;
      const pageFooter=()=>{
        pageNumber+=1;
        return `<footer class="page-footer"><span>Generated by Lot Companion. Confirm against the current planning scheme and authoritative datasets before relying on this report.</span><span>Page ${pageNumber} / ${totalPages}</span></footer>`;
      };
      const out=[];
      out.push("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>",esc(title),"</title>",
        "<link rel='icon' type='image/png' sizes='512x512' href='./images/lot-companion-icon.png?v=20260828-report-favicon'>",
        "<link rel='shortcut icon' type='image/x-icon' href='./Favicon.ico?v=20260828-report-favicon'>",
        "<link rel='apple-touch-icon' href='./images/lot-companion-icon.png?v=20260828-report-favicon'>");
      out.push("<style>",
        "@page{size:A4 landscape;margin:0}",
        ":root{--ink:#050505;--muted:#60646b;--line:#aeb2b8;--blue:#2054d4;--paper:#fff}",
        "@font-face{font-family:'Hanken Grotesk';font-style:normal;font-weight:300 900;font-display:swap;src:url('./fonts/hanken-grotesk-latin.woff2') format('woff2')}@font-face{font-family:'Hanken Grotesk';font-style:italic;font-weight:300 900;font-display:swap;src:url('./fonts/hanken-grotesk-italic-latin.woff2') format('woff2')}",
        "*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e7e8ea;color:var(--ink);font-family:'Hanken Grotesk',Arial,sans-serif;line-height:1.22}body{padding:12mm 0}a{color:inherit}",
        ".report-page{position:relative;width:297mm;height:210mm;margin:0 auto 12mm;background:var(--paper);overflow:hidden;break-after:page;page-break-after:always;box-shadow:0 4mm 12mm rgba(0,0,0,.18);padding:10mm 10mm 13mm;display:grid;grid-template-rows:13mm minmax(0,1fr) 8mm}",
        ".report-page:last-child{break-after:auto;page-break-after:auto}",
        ".cover-page{padding:10mm 11mm 13mm;background:#000;color:#fff;grid-template-rows:18mm minmax(0,1fr) 30mm}",
        ".cover-head{display:flex;justify-content:space-between;align-items:flex-start;font-size:8px;color:#b8b8b8}.cover-head img{display:block;width:34mm;height:auto}",
        ".cover-title{align-self:center;max-width:152mm;margin-bottom:9mm}.cover-title h1{margin:0;font-size:30px;line-height:1.05;font-weight:800;letter-spacing:-.5px}.cover-rule{width:10mm;height:1mm;margin:8mm 0 6mm;background:#fff}.cover-tagline{margin:0;font-size:18px;font-weight:400;color:#ededed}",
        ".cover-credits{display:grid;grid-template-columns:10mm auto;grid-auto-rows:10mm;align-items:center;column-gap:2mm;font-size:9px;color:#bdbdbd}.cover-credit-icon{width:9mm;height:9mm;border-radius:50%;display:grid;place-items:center;background:#fff;color:#000;font-size:17px;font-weight:800}.cover-credit-icon.brand{border-radius:1.5mm;background:var(--blue);overflow:hidden}.cover-credit-icon.brand img{width:100%;height:100%;object-fit:cover}.cover-credits strong{display:block;color:#fff;font-size:10px;line-height:1.05}",
        ".page-header{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm;font-size:8px;font-weight:700;white-space:nowrap}.page-header img{display:block;width:32mm;height:auto}.page-header div{padding-top:2.5mm;text-align:right;overflow:hidden;text-overflow:ellipsis}",
        ".page-footer{position:absolute;left:0;right:0;bottom:0;height:10mm;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;gap:8mm;background:#000;color:#fff;font-size:7.5px;font-weight:400}.page-footer span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.page-footer span:last-child{flex:0 0 auto}",
        ".page-content{min-height:0;display:flex;flex-direction:column}.page-title{margin:3.5mm 0 3mm;font-size:23px;line-height:1;font-weight:800;letter-spacing:-.25px}",
        ".property-meta{margin-bottom:3.5mm;font-size:10px}.badges{display:flex;align-items:center;gap:1.5mm;margin-bottom:2.5mm}.badge-pill{display:inline-flex;align-items:center;min-height:6mm;border:.35mm solid #767b82;border-radius:4mm;padding:.6mm 2.2mm;background:#fff;font-size:9px;white-space:nowrap}.property-kv{display:flex;flex-direction:column;gap:1.6mm}",
        ".property-map{position:relative;min-height:0;flex:1;margin-top:3.5mm;border-radius:4mm;overflow:hidden;background:#e8eaed}.property-map img{display:block;width:100%;height:100%;object-fit:cover}.property-map .map-scale{position:absolute;right:3mm;bottom:2.5mm;margin:0;padding:1mm 1.6mm;border-radius:1mm;background:rgba(255,255,255,.88);font-size:7.5px;font-weight:500;color:#111}",
        ".summary-page .page-title{margin-top:6mm;margin-bottom:6mm}.summary-grid{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(var(--summary-rows),14mm);align-content:start;gap:0 3mm;min-height:0;flex:1;padding-bottom:2mm}.summary-item{position:relative;display:flex;flex-direction:column;justify-content:center;min-width:0;padding:1.4mm 9mm 1.4mm 2mm;border:.3mm solid var(--line);border-bottom:0;text-decoration:none;background:#fff;overflow:hidden}.summary-item.column-end,.summary-item:last-child{border-bottom:.3mm solid var(--line)}.summary-title{font-size:11px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.summary-count{font-size:8px;font-weight:500}.summary-note{font-size:8px;color:#4c5056;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.summary-chevron{position:absolute;right:3mm;top:50%;width:2.5mm;height:2.5mm;border-top:.55mm solid #111;border-right:.55mm solid #111;transform:translateY(-50%) rotate(45deg)}.summary-empty{padding:5mm;border:.3mm solid var(--line);font-size:11px}",
        ".overlay-page .page-title{margin-top:5mm;margin-bottom:4mm}.overlay-actions{display:flex;gap:2mm;margin-bottom:3mm}.action-link{display:inline-flex;align-items:center;min-height:6mm;padding:.8mm 2.4mm;border:.3mm solid #777;border-radius:4mm;text-decoration:none;font-size:8px;font-weight:700;background:#fff}.overlay-layout{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(55mm,.8fr);gap:4mm;min-height:0;flex:1}.overlay-map{position:relative;min-height:0;border-radius:4mm;overflow:hidden;background:#e8eaed}.overlay-map>img{display:block;width:100%;height:100%;object-fit:cover}.overlay-map .map-scale{position:absolute;right:3mm;bottom:2.5mm;margin:0;padding:1mm 1.6mm;border-radius:1mm;background:rgba(255,255,255,.9);font-size:7.5px;color:#111}",
        ".legend-panel{min-height:0;padding:3mm;border:.3mm solid var(--line);border-radius:3mm;overflow-x:hidden;overflow-y:auto;scrollbar-gutter:stable;font-size:9px}.legend-heading{position:sticky;top:-3mm;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:3mm;margin:-3mm -3mm 2mm;padding:2.2mm 3mm;background:#fff;border-bottom:.3mm solid var(--line);font-size:9px}.legend-heading span{color:var(--muted);font-size:7px;font-weight:500}.legend-panel .leg{font-size:8px;line-height:1.3}.legend-panel .row{display:flex;align-items:center;gap:2mm;margin:1.5mm 0}.legend-panel .swbox{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:5mm;height:4.5mm;padding:.3mm;border:.3mm solid #9aa0a6;border-radius:.8mm;overflow:hidden;background:#fff}.legend-panel .swbox img,.legend-panel .swbox svg,.legend-panel .swbox canvas{width:100%;height:100%;display:block;object-fit:contain}.dense-legend .leg{font-size:7.2px;line-height:1.2}.dense-legend .row{margin:.9mm 0}.note{display:block;margin:0 0 3mm;padding:2.5mm;border-radius:2mm;background:#f1f2f4;font-size:9px;font-weight:700}",
        ".detail-panel{min-height:0;overflow-y:auto;padding:3mm;border:.3mm solid var(--line);border-radius:3mm;font-size:9px}.detail-panel table{width:100%;border-collapse:collapse}.detail-panel th,.detail-panel td{padding:2mm;border-top:.3mm solid var(--line);vertical-align:top;text-align:left}.detail-panel tbody th{width:30%;color:var(--muted)}.detail-panel thead th{width:auto;color:var(--ink)}.detail-panel section+section{margin-top:3mm}.detail-panel p{margin:0 0 3mm}.detail-panel ul{margin:2mm 0;padding-left:6mm}.detail-panel li{margin:1.5mm 0}.detail-panel a{font-weight:700}",
        ".setback-page{break-inside:avoid-page;page-break-inside:avoid}.setback-page .page-content{min-height:0;overflow:hidden}.setback-page .page-title{flex:0 0 auto;margin-top:5mm;margin-bottom:4mm}.setback-page .detail-panel{min-height:0;max-height:100%;padding:0;border:0;overflow:hidden}.setback-guide{display:flex;min-height:0;max-height:100%;height:100%;flex-direction:column;gap:3mm;overflow:hidden}.setback-intro{display:flex;flex:0 0 auto;align-items:flex-start;justify-content:space-between;gap:8mm;padding:3mm 4mm;border-left:1.2mm solid var(--blue);background:#f1f4f8}.setback-intro p{max-width:128mm;margin:0;font-size:10px;line-height:1.35;color:#3f454d;overflow-wrap:anywhere}.setback-intro .setback-lead{font-size:13px;font-weight:800;color:#050505}.setback-context{display:grid;flex:0 0 auto;grid-template-columns:repeat(5,minmax(0,1fr));gap:2mm}.setback-context>div{min-width:0;padding:2.3mm 2.6mm;border:.3mm solid var(--line);border-radius:2mm;background:#fff;break-inside:avoid;page-break-inside:avoid}.setback-context span{display:block;margin-bottom:1mm;color:var(--muted);font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.25px}.setback-context strong{display:block;font-size:11px;line-height:1.2;overflow-wrap:anywhere}.setback-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-flow:row;grid-auto-rows:minmax(0,1fr);align-content:stretch;gap:2mm;min-height:0;flex:1;overflow:hidden}.setback-card{min-width:0;min-height:0;padding:2.7mm 3.2mm;border:.3mm solid var(--line);border-radius:2mm;background:#fff;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.setback-card h2{margin:0 0 1mm;color:#353b43;font-size:9.5px;font-weight:800;overflow-wrap:anywhere}.setback-card .setback-value{font-size:14.5px;line-height:1.08;font-weight:800;overflow-wrap:anywhere}.setback-card p{margin:1.2mm 0 0;font-size:9px;line-height:1.3;color:#4f555d;overflow-wrap:anywhere;hyphens:auto}.setback-dense .setback-card{padding:2.3mm 2.8mm}.setback-dense .setback-card p{font-size:8.5px;line-height:1.24}.setback-support-page{justify-content:flex-start}.setback-notes{min-height:0;padding:3mm;border-radius:2mm;background:#f3f4f5;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.setback-notes h2,.setback-sources h2{margin:0 0 2mm;font-size:11px}.setback-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm}.setback-check-grid p{min-width:0;margin:0;padding:2.5mm;border:.3mm solid #d1d4d8;border-radius:2mm;background:#fff;font-size:9.5px;line-height:1.35;color:#454a51;overflow-wrap:anywhere;hyphens:auto;break-inside:avoid;page-break-inside:avoid}.setback-sources{flex:0 0 auto;padding:3mm;border:.3mm solid var(--line);border-radius:2mm;font-size:9px;line-height:1.35;color:#454a51;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.setback-source-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5mm 4mm}.setback-source-list a,.setback-source-list span{min-width:0;padding:2mm;border-radius:1.5mm;background:#f1f4f8;font-weight:700;color:#124fae;overflow-wrap:anywhere;text-decoration:none}",
        ".flood-copy,.disclaimer-copy{max-width:225mm;margin-top:8mm;font-size:15px;line-height:1.5}.flood-copy p,.disclaimer-copy p{margin:0 0 5mm}.flood-link{display:inline-flex;padding:2.5mm 4mm;border-radius:5mm;background:#000;color:#fff;text-decoration:none;font-size:11px;font-weight:700}.disclaimer-lead{font-size:18px;font-weight:700}.disclaimer-list{margin:5mm 0 0;padding-left:7mm}.disclaimer-list li{margin:3mm 0}.disclaimer-foot{margin-top:7mm;padding-top:4mm;border-top:.3mm solid var(--line);font-size:10px;color:var(--muted)}",
        "@media screen and (max-width:1150px){body{padding:0}.report-page{width:100vw;height:70.707vw;margin:0 auto 12px}}",
        "@media print{html,body{background:#fff}body{padding:0}.report-page{margin:0;box-shadow:none}.legend-panel,.detail-panel{overflow:hidden;scrollbar-gutter:auto}.legend-heading{position:static}.legend-heading span{display:none}.dense-legend{padding:2mm}.dense-legend .legend-heading{margin:-2mm -2mm 1mm;padding:1.5mm 2mm}.dense-legend .leg{font-size:6.2px;line-height:1.08}.dense-legend .row{gap:1mm;margin:.35mm 0}.dense-legend .swbox{width:4mm;height:3.5mm}.detail-panel{font-size:7px;padding:2mm}.detail-panel th,.detail-panel td{padding:1mm}.setback-page .detail-panel{padding:0}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}",
        "</style></head><body>"
      );
      out.push(
        "<section class='report-page cover-page'>",
          "<div class='cover-head'><img src='",logoWhite,"' alt='Lot Companion'><span>",esc(when),"</span></div>",
          "<div class='cover-title'><h1>",coverAddress,"</h1><div class='cover-rule'></div><p class='cover-tagline'>Know your lot before you build.</p></div>",
          "<div class='cover-credits'>",
            "<span class='cover-credit-icon brand'><img src='",brandIcon,"' alt=''></span><span>Prepared by<strong>Lot Companion</strong></span>",
          "</div>",
        "</section>"
      );
      out.push(
        "<section class='report-page property-page' id='property'>",pageHeader(),
          "<main class='page-content'><h1 class='page-title'>Property</h1>",
            "<div class='property-meta'><div class='badges'>",
              "<span class='badge-pill'><strong>Lot/Plan:&nbsp;</strong>",esc(lot),"</span>",
              "<span class='badge-pill'><strong>Area:&nbsp;</strong>",esc(reportArea),"</span>",
              "<span class='badge-pill'><strong>Class:&nbsp;</strong>",esc(propertyClass),"</span>",
            "</div><div class='property-kv'><span><strong>Address:</strong>&nbsp; ",esc(displayAddress),"</span><span><strong>Council:</strong>&nbsp; ",esc(council),"</span></div></div>",
            "<div class='property-map'><img src='",baseShot.dataUrl,"' alt='Aerial map of ",esc(safeAddress),"'>",scaleHTML(baseShot),"</div>",
          "</main>",pageFooter(),
        "</section>"
      );
      const summaryItems=[];
      if(currentDaSearchUrl){
        summaryItems.push({title:"Development application search",note:"Open the council property and application search",href:currentDaSearchUrl,external:true});
      }
      if(showFloodWise){
        summaryItems.push({title:"FloodWise property search",note:"Open the FloodWise property search or resolved report",href:currentFloodUrl,external:true});
      }
      supplementalPages.filter(page=>page.summary!==false).forEach(page=>summaryItems.push({
        title:page.summaryTitle||page.title,
        note:page.summaryNote||"View the property-specific information",
        href:`#${page.id}`,
        external:false
      }));
      reportShots.forEach(shot=>summaryItems.push({
        title:shot.title,
        note:shot.note||"View planning scheme",
        href:`#${shot.id}`,
        count:shot.count,
        external:false
      }));
      const summaryRows=Math.max(1,Math.ceil(summaryItems.length/2));
      out.push("<section class='report-page summary-page' id='summary'>",pageHeader(),"<main class='page-content'><h1 class='page-title'>Summary</h1>");
      if(summaryItems.length){
        out.push("<div class='summary-grid' style='--summary-rows:",summaryRows,"'>");
        summaryItems.forEach((item,index)=>{
          const countText=item.count!=null ? ` (${item.count} feature${item.count===1?"":"s"})` : "";
          const columnEnd=(index===summaryRows-1 || index===summaryItems.length-1) ? " column-end" : "";
          const externalAttrs=item.external?" target='_blank' rel='noopener'":"";
          out.push("<a class='summary-item",columnEnd,"' href='",esc(item.href),"'",externalAttrs,"><span class='summary-title'>",esc(item.title),"<span class='summary-count'>",esc(countText),"</span></span><span class='summary-note'>",esc(item.note),"</span><span class='summary-chevron' aria-hidden='true'></span></a>");
        });
        out.push("</div>");
      }else{
        out.push("<div class='summary-empty'>No overlays intersect this parcel (excluding DNT groups).</div>");
      }
      out.push("</main>",pageFooter(),"</section>");
      supplementalPages.forEach(page=>{
        const pageClass=page.kind==="setbacks"?" setback-page":"";
        out.push(
          "<section class='report-page detail-page",pageClass,"' id='",esc(page.id),"'>",pageHeader(),
            "<main class='page-content'><h1 class='page-title'>",esc(page.title),"</h1><div class='detail-panel'>",page.html||"","</div></main>",pageFooter(),
          "</section>"
        );
      });
      if(showFloodWise){
        const floodIntro=hasFlood
          ? `Flood mapping affects this parcel. Use ${esc(floodAuthority||council||"the relevant authority")}'s current FloodWise Property Report for development and floor-level decisions.`
          : `Search ${esc(floodAuthority||council||"the relevant authority")}'s current FloodWise Property Report for property-specific flood planning information.`;
        out.push(
          "<section class='report-page flood-page' id='floodwise'>",pageHeader(),
            "<main class='page-content'><h1 class='page-title'>FloodWise Property Report</h1><div class='flood-copy'>",
              "<p>",floodIntro,"</p>",
              "<p>The map snapshots in this Lot Companion report are indicative only.</p>",
              "<a class='flood-link' target='_blank' rel='noopener' href='",esc(currentFloodUrl),"'>Open FloodWise Report</a>",
            "</div></main>",pageFooter(),
          "</section>"
        );
      }
      reportShots.forEach(shot=>{
        const schemeLink=shot.schemeLink||makePlanningLink(shot.title);
        const denseLegend=/utilit/i.test(shot.title||"")||String(shot.legendHTML||"").length>1800;
        out.push(
          "<section class='report-page overlay-page' id='",shot.id,"'>",pageHeader(),
            "<main class='page-content'><h1 class='page-title'>",esc(shot.title),"</h1><div class='overlay-actions'>",
              schemeLink?`<a class='action-link' target='_blank' rel='noopener' href='${esc(schemeLink)}'>Open planning scheme</a>`:"",
              "<a class='action-link' href='#summary'>Back to Summary</a></div>",
              "<div class='overlay-layout'><div class='overlay-map'><img src='",shot.dataUrl,"' alt='",esc(shot.title)," map'>",scaleHTML(shot),"</div>",
              "<aside class='legend-panel",denseLegend?" dense-legend":"","'><div class='legend-heading'><strong>Key</strong>",denseLegend?"<span>Scroll for all items</span>":"","</div>",shot.note?"<div class='note'>"+esc(shot.note)+"</div>":"",shot.legendHTML||(shot.note?"":"<span>No mapped features.</span>"),"</aside></div>",
            "</main>",pageFooter(),
          "</section>"
        );
      });
      out.push(
        "<section class='report-page disclaimer-page'>",pageHeader(),
          "<main class='page-content'><h1 class='page-title'>Disclaimer</h1><div class='disclaimer-copy'>",
            "<p class='disclaimer-lead'>This report is a high-level snapshot only and must be verified against authoritative sources.</p>",
            "<ul class='disclaimer-list'><li>No legal, planning, building or certification advice is provided.</li><li>Mapping layers may be sourced from third parties and can change without notice.</li><li>Lot Companion does not guarantee the accuracy, completeness or currency of any data shown.</li><li>Obtain independent professional advice and confirm information with the relevant authority before acting.</li><li>To the maximum extent permitted by law, Lot Companion disclaims liability for loss or damage arising from use of this report.</li></ul>",
            "<div class='disclaimer-foot'><strong>Terms of Use &amp; Privacy Policy:</strong> Refer to the Lot Companion Terms &amp; Privacy page for full details.</div>",
          "</div></main>",pageFooter(),
        "</section></body></html>"
      );
      return out.join("");
    }
