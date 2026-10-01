const fs = require('fs');
const path = require('path');
const express = require('express');
const { createPropertyReport } = require('../report-engine/property-report-engine');

function createVaRouter(options = {}) {
  const router = express.Router();
  const store = options.store;
  const getBaseUrl = options.getBaseUrl;

  if (!store) throw new Error('createVaRouter requires a store');

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    console.log(
      `[VA API] ${req.method} ${req.originalUrl} key=${req.vaClient?.keyId || 'unknown'}`
    );
    next();
  });

  router.post('/report-request', (req, res) => {
    const input = req.body || {};
    const job = store.create(input, req.vaClient || null);
    const links = buildLinks(req, job.requestId, getBaseUrl);

    setImmediate(() => {
      runReport(job.requestId, store).catch(err => {
        console.error('Lot Companion report runner error:', err);
      });
    });

    return res.status(202).json({
      ok: true,
      accepted: true,
      requestId: job.requestId,
      status: job.status,
      links
    });
  });

  // One-call integration for systems that need the document itself and do not
  // want to reproduce the browser UI or manage the asynchronous polling flow.
  router.post('/report-generate', async (req, res) => {
    let job = null;
    try {
      const input = req.body || {};
      job = store.create(input, req.vaClient || null);

      await runReport(job.requestId, store);
      const completedJob = store.get(job.requestId);

      if (!completedJob) {
        return res.status(500).json({
          ok: false,
          error: 'The report request could not be read after generation.'
        });
      }
      if (completedJob.status === 'failed') {
        return res.status(500).json({
          ok: false,
          requestId: completedJob.requestId,
          status: completedJob.status,
          error: completedJob.error || 'Report generation failed.',
          errorCode: completedJob.errorCode || null,
          links: buildLinks(req, completedJob.requestId, getBaseUrl)
        });
      }

      return sendReportFile(res, completedJob, {
        disposition: normaliseDisposition(req.query.disposition),
        includeIntegrationHeaders: true
      });
    } catch (err) {
      console.error('Direct Lot Companion report generation error:', err);
      return res.status(500).json({
        ok: false,
        requestId: job?.requestId || null,
        status: 'failed',
        error: err.message || 'Report generation failed.',
        errorCode: err.code || null
      });
    }
  });

  router.get('/report-status/:requestId', (req, res) => {
    const job = store.get(req.params.requestId);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Unknown requestId.' });
    }
    return res.json(publicJob(job, req, getBaseUrl));
  });

  router.get('/report-summary/:requestId', (req, res) => {
    const job = store.get(req.params.requestId);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Unknown requestId.' });
    }
    return res.json({
      ok: true,
      requestId: job.requestId,
      status: job.status,
      summary: job.summary || null
    });
  });

  router.get('/report-download/:requestId', (req, res) => {
    const job = store.get(req.params.requestId);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Unknown requestId.' });
    }
    if (!['complete', 'manual_review'].includes(job.status)) {
      return res.status(409).json({
        ok: false,
        error: 'Report is not ready.',
        status: job.status
      });
    }
    return sendReportFile(res, job, {
      disposition: normaliseDisposition(req.query.disposition)
    });
  });

  router.get('/admin/reports', (req, res) => {
    const jobs = store
      .list({
        status: req.query.status,
        limit: req.query.limit
      })
      .map(job => publicJob(job, req, getBaseUrl));

    return res.json({
      ok: true,
      count: jobs.length,
      jobs
    });
  });

  return router;
}

async function runReport(requestId, store) {
  const job = store.update(
    requestId,
    {
      status: 'running',
      phase: 'locating_parcel',
      parcelFound: false,
      error: null,
      errorCode: null
    },
    {
      type: 'running',
      message: 'Lot Companion report generation started.'
    }
  );
  if (!job) return;

  try {
    const result = await createPropertyReport(job.input, {
      onProgress: update => {
        const patch = {
          phase: update.phase || 'running'
        };
        if (typeof update.parcelFound === 'boolean') {
          patch.parcelFound = update.parcelFound;
        }
        store.update(requestId, patch, {
          type: 'progress',
          message: update.message || 'Lot Companion report generation is continuing.'
        });
      }
    });
    const report = store.writeReport(requestId, result.report);
    store.update(
      requestId,
      {
        status: result.status,
        summary: result.summary,
        report,
        error: null,
        errorCode: null,
        phase: 'complete',
        parcelFound: true
      },
      {
        type: result.status,
        message:
          result.status === 'manual_review'
            ? 'Manual-review report generated.'
            : 'Report generated.'
      }
    );
  } catch (err) {
    store.update(
      requestId,
      {
        status: 'failed',
        error: err.message || 'Report generation failed.',
        errorCode: err.code || null,
        phase: err.code === 'parcel_not_found' ? 'parcel_not_found' : 'failed'
      },
      {
        type: 'failed',
        message: err.message || 'Report generation failed.'
      }
    );
  }
}

function sendReportFile(res, job, options = {}) {
  if (!job.report || !job.report.path || !fs.existsSync(job.report.path)) {
    return res.status(404).json({
      ok: false,
      requestId: job.requestId,
      error: 'Report file was not found.'
    });
  }

  const fileName = job.report.originalFileName || job.report.fileName;
  res.setHeader('Content-Type', job.report.contentType || 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${options.disposition || 'attachment'}; filename="${fileName}"`
  );

  if (options.includeIntegrationHeaders) {
    res.setHeader('X-Lot-Wise-Request-Id', job.requestId);
    res.setHeader('X-Lot-Wise-Report-Status', job.status);
    res.setHeader('X-Lot-Wise-Manual-Review', String(job.status === 'manual_review'));
  }

  return res.sendFile(path.resolve(job.report.path));
}

function normaliseDisposition(value) {
  return String(value || '').toLowerCase() === 'inline' ? 'inline' : 'attachment';
}

function publicJob(job, req, getBaseUrl) {
  return {
    ok: true,
    requestId: job.requestId,
    status: job.status,
    input: {
      jobNumber: job.input?.jobNumber || job.input?.jobNo || job.input?.reference || null,
      vaJobId: job.input?.vaJobId || job.input?.jobId || null,
      address: job.input?.address || job.input?.propertyAddress || job.input?.siteAddress || null,
      lotPlan: job.input?.lotPlan || job.input?.lot_plan || job.input?.realPropertyDescription || null,
      council: job.input?.council || job.input?.localGovernmentArea || job.input?.lga || null,
      applicationType: job.input?.applicationType || job.input?.application || null
    },
    manualReview: job.status === 'manual_review' || !!job.summary?.manualReview,
    manualReviewReasons: job.summary?.manualReviewReasons || [],
    summary: job.summary || null,
    error: job.error || null,
    errorCode: job.errorCode || null,
    phase: job.phase || null,
    parcelFound: job.parcelFound === true,
    report: job.report
      ? {
          fileName: job.report.originalFileName || job.report.fileName,
          contentType: job.report.contentType,
          size: job.report.size,
          createdAt: job.report.createdAt
        }
      : null,
    links: buildLinks(req, job.requestId, getBaseUrl),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    events: job.events || []
  };
}

function buildLinks(req, requestId, getBaseUrl) {
  const baseUrl = typeof getBaseUrl === 'function' ? getBaseUrl(req) : '';
  return {
    status: `${baseUrl}/api/va/report-status/${encodeURIComponent(requestId)}`,
    summary: `${baseUrl}/api/va/report-summary/${encodeURIComponent(requestId)}`,
    download: `${baseUrl}/api/va/report-download/${encodeURIComponent(requestId)}`
  };
}

module.exports = {
  createVaRouter
};
