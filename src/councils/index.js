const COUNCILS = [
  {
    id: 'BCC',
    name: 'Brisbane City Council',
    page: 'BCC.html',
    aliases: ['BCC', 'BRISBANE', 'BRISBANE CITY', 'BRISBANE CITY COUNCIL']
  },
  {
    id: 'GCCC',
    name: 'City of Gold Coast',
    page: 'GCCC.html',
    aliases: ['GCCC', 'GOLD COAST', 'CITY OF GOLD COAST', 'GOLD COAST CITY COUNCIL']
  },
  {
    id: 'GCCC2',
    name: 'City of Gold Coast',
    page: 'GCCC2.html',
    aliases: ['GCCC2', 'GOLD COAST 2']
  },
  {
    id: 'MBRC',
    name: 'City of Moreton Bay',
    page: 'MBRC.html',
    aliases: ['MBRC', 'MORETON BAY', 'CITY OF MORETON BAY', 'MORETON BAY REGIONAL COUNCIL']
  },
  {
    id: 'LCC',
    name: 'Logan City Council',
    page: 'LCC.html',
    aliases: ['LCC', 'LOGAN', 'LOGAN CITY', 'LOGAN CITY COUNCIL']
  },
  {
    id: 'ICC2',
    name: 'Ipswich City Council',
    page: 'ICC2.html',
    aliases: ['ICC', 'ICC2', 'IPSWICH', 'IPSWICH CITY', 'IPSWICH CITY COUNCIL']
  },
  {
    id: 'RCC',
    name: 'Redland City Council',
    page: 'RCC.html',
    aliases: ['RCC', 'REDLAND', 'REDLANDS', 'REDLAND CITY', 'REDLAND CITY COUNCIL']
  },
  {
    id: 'NSC',
    name: 'Noosa Shire Council',
    page: 'NSC.html',
    aliases: ['NSC', 'NOOSA', 'NOOSA SHIRE', 'NOOSA SHIRE COUNCIL']
  },
  {
    id: 'FCRC',
    name: 'Fraser Coast Regional Council',
    page: 'FCRC.html',
    aliases: ['FCRC', 'FRASER COAST', 'FRASER COAST REGIONAL COUNCIL']
  },
  {
    id: 'GRC',
    name: 'Gympie Regional Council',
    page: 'GRC.html',
    aliases: ['GRC', 'GYMPIE', 'GYMPIE REGIONAL COUNCIL']
  },
  {
    id: 'SCRC',
    name: 'Sunshine Coast Council',
    page: 'SCRC.html',
    aliases: ['SCRC', 'SUNSHINE COAST', 'SUNSHINE COAST COUNCIL']
  },
  {
    id: 'SDRC',
    name: 'Southern Downs Regional Council',
    page: 'SDRC.html',
    aliases: ['SDRC', 'SOUTHERN DOWNS', 'SOUTHERN DOWNS REGIONAL COUNCIL']
  },
  {
    id: 'SRRC',
    name: 'Scenic Rim Regional Council',
    page: 'SRRC.html',
    aliases: ['SRRC', 'SCENIC RIM', 'SCENIC RIM REGIONAL COUNCIL']
  },
  {
    id: 'TRC',
    name: 'Toowoomba Regional Council',
    page: 'TRC.html',
    aliases: ['TRC', 'TOOWOOMBA', 'TOOWOOMBA REGIONAL COUNCIL']
  }
];

const aliasIndex = new Map();

for (const council of COUNCILS) {
  aliasIndex.set(normaliseCouncilText(council.id), council);
  aliasIndex.set(normaliseCouncilText(council.name), council);
  for (const alias of council.aliases) {
    aliasIndex.set(normaliseCouncilText(alias), council);
  }
}

function normaliseCouncilText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function findCouncil(value) {
  const normalised = normaliseCouncilText(value);
  if (!normalised) return null;
  if (aliasIndex.has(normalised)) return aliasIndex.get(normalised);

  for (const [alias, council] of aliasIndex.entries()) {
    if (alias && normalised.includes(alias)) return council;
  }

  return null;
}

function detectCouncil(input = {}) {
  const explicit = findCouncil(input.council);
  if (explicit) {
    return {
      council: explicit,
      source: 'supplied_council',
      confidence: 'high'
    };
  }

  const address = String(input.address || '');
  const fromAddress = findCouncil(address);
  if (fromAddress) {
    return {
      council: fromAddress,
      source: 'address_text',
      confidence: 'low'
    };
  }

  return {
    council: null,
    source: 'not_detected',
    confidence: 'none'
  };
}

function getCouncilModule(id) {
  return findCouncil(id);
}

function listCouncils() {
  return COUNCILS.map(council => ({
    id: council.id,
    name: council.name,
    page: council.page
  }));
}

module.exports = {
  detectCouncil,
  getCouncilModule,
  listCouncils,
  normaliseCouncilText
};
