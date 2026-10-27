(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const form = document.querySelector('#report-form');
  const apiBaseInput = document.querySelector('#api-base');
  const apiKeyInput = document.querySelector('#api-key');
  const submitButton = document.querySelector('#submit-button');
  const downloadButton = document.querySelector('#download-button');
  const adminLink = document.querySelector('#admin-link');
  const statusPanel = document.querySelector('.status-panel');
  const statusHeading = document.querySelector('#status-heading');
  const statusMessage = document.querySelector('#status-message');
  const reportDetails = document.querySelector('#report-details');

  apiBaseInput.value = params.get('apiBase') || window.location.origin;
  apiKeyInput.value = params.get('apiKey') || '';

  let activeRequestId = '';

  updateAdminLink();
  apiBaseInput.addEventListener('change', updateAdminLink);
  apiKeyInput.addEventListener('change', updateAdminLink);
  form.addEventListener('submit', submitReport);
  downloadButton.addEventListener('click', downloadReport);

  async function submitReport(event) {
    event.preventDefault();
    submitButton.disabled = true;
    downloadButton.disabled = true;
    activeRequestId = '';
    setStatus('Submitting', 'Sending the application details to Lot Companion.', 'running');

    const lot = valueOf('lot');
    const plan = valueOf('plan');
    const payload = {
      vaJobId: valueOf('job-number'),
      jobNumber: valueOf('job-number'),
      address: valueOf('address'),
      lot,
      plan,
      lotPlan: [lot, plan].filter(Boolean).join('/'),
      council: valueOf('council'),
      applicationType: valueOf('application-type')
    };

    try {
      const created = await fetchJson('/api/va/report-request', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, 202);
      activeRequestId = created.requestId;
      setStatus('In progress', 'The council maps and planning layers are being prepared.', 'running');
      await pollUntilComplete(created.requestId);
    } catch (error) {
      setStatus('Unable to generate report', error.message, 'failed');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function pollUntilComplete(requestId) {
    const started = Date.now();
    while (true) {
      const result = await fetchJson(`/api/va/report-status/${encodeURIComponent(requestId)}`);
      if (result.status === 'failed') {
        throw new Error(result.error || 'Report generation failed.');
      }
      if (result.status === 'complete' || result.status === 'manual_review') {
        renderCompleted(result);
        downloadButton.disabled = false;
        return;
      }
      if (!result.parcelFound && Date.now() - started >= 10 * 60 * 1000) {
        throw new Error('Lot Companion could not locate the parcel within 10 minutes.');
      }
      setStatus(
        'In progress',
        result.parcelFound
          ? `Parcel located. Generating the complete report. Request ${requestId}`
          : `Current stage: ${friendlyStatus(result.phase || result.status)}. Request ${requestId}`,
        'running'
      );
      await delay(1200);
    }
  }

  function renderCompleted(result) {
    const review = result.status === 'manual_review';
    setStatus(
      review ? 'Complete — verification required' : 'Complete',
      review
        ? 'The report was generated successfully and has been marked for verification.'
        : 'The Lot Companion property report is ready to download.',
      'complete'
    );
    const summary = result.summary || {};
    const council = summary.council || {};
    const report = result.report || {};
    showDetails([
      ['Request ID', result.requestId],
      ['Council', council.name || council.code || 'Not supplied'],
      ['Pages', summary.pageCount || 'Not supplied'],
      ['File', report.originalFileName || report.fileName || 'Property report']
    ]);
  }

  async function downloadReport() {
    if (!activeRequestId) return;
    downloadButton.disabled = true;
    try {
      const response = await apiFetch(`/api/va/report-download/${encodeURIComponent(activeRequestId)}`);
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = contentDispositionName(response) || `${activeRequestId}-lot-companion-property-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setStatus('Download failed', error.message, 'failed');
    } finally {
      downloadButton.disabled = false;
    }
  }

  async function fetchJson(path, options = {}, expectedStatus = 200) {
    const response = await apiFetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== expectedStatus || body.ok === false) {
      throw new Error(body.error || `The service returned HTTP ${response.status}.`);
    }
    return body;
  }

  function apiFetch(path, options = {}) {
    const base = apiBaseInput.value.trim().replace(/\/$/, '');
    const key = apiKeyInput.value.trim();
    return fetch(`${base}${path}`, {
      ...options,
      headers: { 'x-api-key': key, ...(options.headers || {}) }
    });
  }

  function setStatus(heading, message, state) {
    statusHeading.textContent = heading;
    statusMessage.textContent = message;
    statusPanel.dataset.state = state;
    if (state !== 'complete') reportDetails.hidden = true;
  }

  function showDetails(rows) {
    reportDetails.replaceChildren();
    rows.forEach(([label, value]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = String(value || '');
      reportDetails.append(term, description);
    });
    reportDetails.hidden = false;
  }

  function updateAdminLink() {
    const query = new URLSearchParams({
      apiBase: apiBaseInput.value.trim(),
      apiKey: apiKeyInput.value.trim()
    });
    adminLink.href = `/VAAdmin.html?${query}`;
  }

  function valueOf(id) { return document.getElementById(id).value.trim(); }
  function friendlyStatus(value) { return String(value || 'pending').replaceAll('_', ' '); }
  function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
  function contentDispositionName(response) {
    const header = response.headers.get('content-disposition') || '';
    const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    return match ? decodeURIComponent(match[1]) : '';
  }
  async function responseError(response) {
    const body = await response.json().catch(() => ({}));
    return body.error || `The service returned HTTP ${response.status}.`;
  }
})();
