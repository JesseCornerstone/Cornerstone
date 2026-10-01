const { detectCouncil, listCouncils } = require('../councils');
const { renderBrowserPropertyReport } = require('./browser-property-report');

async function createPropertyReport(input = {}, options = {}) {
  const job = normaliseJobInput(input);
  const detected = detectCouncil(job);
  const council = detected.council;
  const manualReviewReasons = [];

  if (!job.lot || !job.plan) {
    throw codedError(
      'Lot Companion could not locate a parcel because both lot and plan are required.',
      'parcel_not_found'
    );
  }

  if (!council) {
    throw codedError(
      'Lot Companion could not determine the council needed to locate the parcel.',
      'parcel_not_found'
    );
  }

  if (council && detected.confidence === 'low') {
    manualReviewReasons.push({
      code: 'low_confidence_council_detection',
      message: 'Council was inferred from address text only and should be confirmed.'
    });
  }

  const rendered = await renderBrowserPropertyReport(
    job,
    council,
    options.onProgress
  );
  const status = manualReviewReasons.length ? 'manual_review' : 'complete';
  const ignoredSections = new Set([
    'Property',
    'Summary',
    'Disclaimer',
    'FloodWise Property Report'
  ]);
  const overlaysFound = rendered.sectionTitles.filter(
    title => !ignoredSections.has(title)
  );

  const summary = {
    council: council
      ? {
          id: council.id,
          name: council.name,
          source: detected.source,
          confidence: detected.confidence
        }
      : null,
    applicationType: job.applicationType || null,
    overlaysFound,
    keyFlags: manualReviewReasons.map(reason => reason.code),
    manualReview: status === 'manual_review',
    manualReviewReasons,
    supportedCouncils: listCouncils(),
    pageCount: rendered.pageCount,
    reportTitle: rendered.title,
    generatedAt: new Date().toISOString()
  };

  return {
    status,
    summary,
    report: {
      buffer: rendered.buffer,
      extension: '.pdf',
      contentType: 'application/pdf',
      fileName: reportFileName(job)
    }
  };
}

function normaliseJobInput(input) {
  const suppliedLotPlan = clean(input.lotPlan || input.lot_plan || input.realPropertyDescription);
  const parsedLotPlan = splitLotPlan(suppliedLotPlan);
  const lot = clean(input.lot || input.lotNumber || parsedLotPlan.lot);
  const plan = clean(input.plan || input.planNumber || parsedLotPlan.plan);

  return {
    address: clean(input.address || input.propertyAddress || input.siteAddress),
    lot,
    plan,
    lotPlan: suppliedLotPlan || (lot && plan ? `${lot}/${plan}` : ''),
    council: clean(input.council || input.localGovernmentArea || input.lga),
    jobNumber: clean(input.jobNumber || input.jobNo || input.reference || input.referenceNumber),
    vaJobId: clean(input.vaJobId || input.jobId || input.visualApprovalsJobId),
    applicationType: clean(input.applicationType || input.application || input.approvalType),
    latitude: toNumberOrNull(input.latitude || input.lat),
    longitude: toNumberOrNull(input.longitude || input.lng || input.lon),
    raw: input
  };
}

function splitLotPlan(value) {
  const text = clean(value).toUpperCase();
  const match = text.match(
    /(?:\bLOT\s*)?([0-9A-Z-]+)\s*(?:\/|\bON\b)\s*([A-Z]{1,6}\s*\d{1,10})\b/i
  );
  return match
    ? {
        lot: match[1],
        plan: match[2].replace(/\s+/g, '')
      }
    : { lot: '', plan: '' };
}

function reportFileName(job) {
  const stem = clean(job.jobNumber || job.vaJobId || job.address || 'manual-review')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stem || 'property'}-lot-companion-property-report.pdf`;
}

function clean(value) {
  return String(value || '').trim();
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  createPropertyReport,
  normaliseJobInput,
  splitLotPlan
};
