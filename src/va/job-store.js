const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class VaJobStore {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(process.cwd(), 'storage');
    this.reportsDir = options.reportsDir || path.join(this.storageDir, 'reports');
    this.dbPath = options.dbPath || path.join(this.storageDir, 'va-report-requests.json');
    this.jobs = new Map();

    fs.mkdirSync(this.storageDir, { recursive: true });
    fs.mkdirSync(this.reportsDir, { recursive: true });
    this.load();
  }

  create(input, requester) {
    const now = new Date().toISOString();
    const requestId = createRequestId();
    const job = {
      requestId,
      status: 'pending',
      input,
      requester: requester || null,
      summary: null,
      report: null,
      error: null,
      errorCode: null,
      phase: 'pending',
      parcelFound: false,
      events: [
        {
          at: now,
          type: 'created',
          message: 'Lot Companion report request accepted.'
        }
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };
    this.jobs.set(requestId, job);
    this.save();
    return job;
  }

  get(requestId) {
    return this.jobs.get(String(requestId || '')) || null;
  }

  list(options = {}) {
    const status = options.status ? String(options.status) : null;
    const requestedLimit = Number(options.limit);
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(500, requestedLimit))
      : 100;

    return Array.from(this.jobs.values())
      .filter(job => !status || job.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  update(requestId, patch, event) {
    const job = this.get(requestId);
    if (!job) return null;

    const now = new Date().toISOString();
    Object.assign(job, patch || {}, { updatedAt: now });
    if (['complete', 'failed', 'manual_review'].includes(job.status) && !job.completedAt) {
      job.completedAt = now;
    }
    if (event) {
      job.events.push({
        at: now,
        type: event.type || 'updated',
        message: event.message || ''
      });
    }
    this.save();
    return job;
  }

  writeReport(requestId, report) {
    const job = this.get(requestId);
    if (!job) throw new Error(`Unknown Lot Companion report request ${requestId}`);

    const extension = report.extension || '.pdf';
    const safeName = sanitiseFileName(report.fileName || `${requestId}${extension}`);
    const fileName = safeName.toLowerCase().endsWith(extension)
      ? `${requestId}-${safeName}`
      : `${requestId}-${safeName}${extension}`;
    const filePath = path.join(this.reportsDir, fileName);

    fs.writeFileSync(filePath, report.buffer);
    return {
      fileName,
      originalFileName: safeName,
      path: filePath,
      contentType: report.contentType || 'application/octet-stream',
      size: fs.statSync(filePath).size,
      createdAt: new Date().toISOString()
    };
  }

  load() {
    if (!fs.existsSync(this.dbPath)) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      for (const job of jobs) {
        if (job && job.requestId) this.jobs.set(job.requestId, job);
      }
    } catch (err) {
      console.error('Could not read VA job store:', err);
    }
  }

  save() {
    const payload = {
      jobs: Array.from(this.jobs.values())
    };
    const tmpPath = `${this.dbPath}.${process.pid}.${Date.now()}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    try {
      fs.renameSync(tmpPath, this.dbPath);
    } catch (err) {
      if (!isTransientRenameError(err)) {
        cleanupTempFile(tmpPath);
        throw err;
      }
      fs.copyFileSync(tmpPath, this.dbPath);
      cleanupTempFile(tmpPath);
    }
  }
}

function createRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function sanitiseFileName(value) {
  return String(value || 'report.pdf')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function isTransientRenameError(err) {
  return err && ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
}

function cleanupTempFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('Could not remove temporary VA job-store file:', err.message);
    }
  }
}

module.exports = {
  VaJobStore
};
