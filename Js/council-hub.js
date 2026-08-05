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
