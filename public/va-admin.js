(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const apiBase = (params.get('apiBase') || window.location.origin).replace(/\/$/, '');
  const apiKeyInput = document.querySelector('#api-key');
  const statusFilter = document.querySelector('#status-filter');
  const refreshButton = document.querySelector('#refresh-button');
  const listStatus = document.querySelector('#list-status');
  const rows = document.querySelector('#report-rows');

  refreshButton.addEventListener('click', loadReports);
  statusFilter.addEventListener('change', loadReports);
  listStatus.textContent = 'Enter the API key, then select Refresh.';

  async function loadReports() {
    refreshButton.disabled = true;
    listStatus.textContent = 'Loading report requests…';
    rows.replaceChildren();
    const query = new URLSearchParams({ limit: '100' });
    if (statusFilter.value) query.set('status', statusFilter.value);

    try {
      const response = await apiFetch(`/api/va/admin/reports?${query}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `The service returned HTTP ${response.status}.`);
      }
      renderRows(body.jobs || []);
      listStatus.textContent = `${body.count || 0} report request${body.count === 1 ? '' : 's'}`;
    } catch (error) {
      listStatus.textContent = `Unable to load reports: ${error.message}`;
    } finally {
      refreshButton.disabled = false;
    }
  }

  function renderRows(jobs) {
    if (!jobs.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No report requests match this filter.';
      row.appendChild(cell);
      rows.appendChild(row);
      return;
    }

    jobs.forEach(job => {
      const row = document.createElement('tr');
      addCell(row, formatDate(job.createdAt));
      addCell(row, job.input?.jobNumber || job.input?.vaJobId || job.requestId);
      addCell(row, job.input?.address || 'Not supplied');

      const statusCell = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = `status-chip ${job.status || ''}`;
      chip.textContent = String(job.status || 'unknown').replaceAll('_', ' ');
      statusCell.appendChild(chip);
      row.appendChild(statusCell);

      const actionCell = document.createElement('td');
      if (['complete', 'manual_review'].includes(job.status)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'small-button';
        button.textContent = 'Download';
        button.addEventListener('click', () => downloadReport(job, button));
        actionCell.appendChild(button);
      } else if (job.status === 'failed') {
        actionCell.textContent = job.error || 'Generation failed';
      } else {
        actionCell.textContent = 'Not ready';
      }
      row.appendChild(actionCell);
      rows.appendChild(row);
    });
  }

  async function downloadReport(job, button) {
    button.disabled = true;
    try {
      const response = await apiFetch(`/api/va/report-download/${encodeURIComponent(job.requestId)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `The service returned HTTP ${response.status}.`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = job.report?.originalFileName || `${job.requestId}-lot-companion-property-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      listStatus.textContent = `Download failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  function apiFetch(path, options = {}) {
    return fetch(`${apiBase}${path}`, {
      ...options,
      headers: { 'x-api-key': apiKeyInput.value.trim(), ...(options.headers || {}) }
    });
  }

  function addCell(row, text) {
    const cell = document.createElement('td');
    cell.textContent = String(text || '');
    row.appendChild(cell);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value || '') : date.toLocaleString('en-AU');
  }
})();
