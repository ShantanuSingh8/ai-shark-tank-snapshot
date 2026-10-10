(function () {
  'use strict';

  const state = {
    currentAnalysis: null,
  };

  const dom = {};
  const API_ORIGIN = getApiOrigin();

  const defaultSteps = [
    { key: 'discover', label: 'Discover', status: 'Pending', message: 'Locate the latest applicable annual filing.' },
    { key: 'download', label: 'Download', status: 'Pending', message: 'Save the source and retain document metadata.' },
    { key: 'extract', label: 'Extract', status: 'Pending', message: 'Capture required reported datapoints.' },
    { key: 'calculate', label: 'Calculate', status: 'Pending', message: 'Apply supplied formulas and standardization rules.' },
    { key: 'validate', label: 'Validate', status: 'Pending', message: 'Check source, period, unit, arithmetic and exceptions.' },
    { key: 'generate', label: 'Generate', status: 'Pending', message: 'Populate Excel and company snapshot output.' },
  ];

  function cacheDom() {
    [
      'companyForm',
      'companyName',
      'ticker',
      'sector',
      'industry',
      'annualReportUrl',
      'analyzeButton',
      'exportButton',
      'resetButton',
      'validatedCount',
      'validatedCaption',
      'sourceType',
      'sourceDetail',
      'reportType',
      'filingDate',
      'reviewCount',
      'downloadStatus',
      'downloadPath',
      'fieldCount',
      'fieldTableBody',
      'steps',
      'policyText',
      'sourceUrl',
      'analysisStatus',
      'insights',
      'scopePanel',
      'debtTableBody',
      'finalReport',
      'annotationCount',
      'annotationTableBody',
      'toast',
      'serverStatus',
      'serverStatusPill',
    ].forEach((id) => {
      dom[id] = document.getElementById(id);
      if (!dom[id]) throw new Error(`Missing required element #${id}`);
    });
  }

  function bindEvents() {
    dom.companyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runAnalysis();
    });

    dom.exportButton.addEventListener('click', async () => {
      if (!state.currentAnalysis) {
        showToast('Run analysis before exporting.');
        return;
      }
      await exportCurrentAnalysis();
    });

    dom.resetButton.addEventListener('click', reset);
  }

  async function runAnalysis() {
    const payload = {
      companyName: dom.companyName.value.trim(),
      ticker: dom.ticker.value.trim(),
      sector: dom.sector.value.trim(),
      industry: dom.industry.value.trim(),
      annualReportUrl: dom.annualReportUrl.value.trim(),
    };

    if (!payload.companyName || !payload.ticker || !payload.sector || !payload.industry) {
      showToast('Company Name, Ticker, Sector and Industry are required.');
      return;
    }

    setLoading(true);
    renderSteps(defaultSteps.map((step, index) => index === 0 ? { ...step, status: 'Running', message: 'Starting discovery...' } : step));
    dom.analysisStatus.textContent = 'Running';
    dom.fieldTableBody.innerHTML = '<tr><td colspan="5">Running full annual-report automation...</td></tr>';

    try {
      await checkBackendHealth({ quiet: true });
      const response = await fetch(apiUrl('/api/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const analysis = await parseApiResponse(response);
      state.currentAnalysis = analysis;
      renderAnalysis(analysis);
      if (!response.ok || !analysis.ok) {
        showToast((analysis.errors && analysis.errors[0]) || 'Analysis completed with review items.');
      } else {
        showToast('End-to-end annual-report snapshot generated.');
      }
    } catch (error) {
      const message = normalizeApiError(error);
      showToast(message);
      error.message = message;
      renderError(error);
    } finally {
      setLoading(false);
    }
  }

  function renderAnalysis(analysis) {
    const fields = analysis.fields || [];
    const counts = (analysis.validation && analysis.validation.counts) || {};
    const validated = (counts.Validated || 0) + (counts.Calculated || 0) + (counts.Prefilled || 0);
    const review = (counts['Human Review'] || 0) + (counts['Not Available'] || 0);

    dom.validatedCount.textContent = validated;
    dom.validatedCaption.textContent = `${fields.length} total template fields`;
    dom.reviewCount.textContent = review;
    dom.analysisStatus.textContent = analysis.ok ? 'Complete' : 'Needs review';
    dom.exportButton.disabled = !analysis.fields || !analysis.fields.length;

    if (analysis.source) {
      dom.sourceType.textContent = analysis.source.sourceType || '--';
      dom.sourceDetail.textContent = analysis.source.companyTitle || analysis.source.documentName || '--';
      dom.reportType.textContent = analysis.source.form || '--';
      dom.filingDate.textContent = analysis.source.filingDate ? `Filed ${analysis.source.filingDate}` : 'Filing date unavailable';
      dom.downloadStatus.textContent = analysis.source.bytes ? `${Number(analysis.source.bytes).toLocaleString()} bytes` : 'Saved';
      dom.downloadPath.textContent = analysis.source.localPath || analysis.source.documentName || '--';
      dom.policyText.textContent = analysis.policy || 'Only latest annual report used.';
      dom.sourceUrl.innerHTML = analysis.source.documentUrl ? `<a href="${escapeAttribute(analysis.source.documentUrl)}" target="_blank" rel="noreferrer">${escapeHtml(analysis.source.documentUrl)}</a>` : '--';
    }

    renderSteps(analysis.steps || defaultSteps);
    renderFields(fields);
    renderInsights(fields);
    renderScope(analysis.reportingScope);
    renderDebtComponents(analysis.debtComponents);
    renderFinalReport(analysis.finalReport);
    renderAnnotations(analysis.sourceAnnotations || []);
  }

  function renderFields(fields) {
    dom.fieldCount.textContent = `${fields.length} fields`;
    if (!fields.length) {
      dom.fieldTableBody.innerHTML = '<tr><td colspan="5">No fields generated.</td></tr>';
      return;
    }

    dom.fieldTableBody.innerHTML = fields.map((field) => {
      const statusClass = statusToClass(field.status);
      return `
        <tr>
          <td>${escapeHtml(field.number)}</td>
          <td>
            <strong>${escapeHtml(field.datapoint)}</strong><br />
            <small>${escapeHtml(field.section)} · ${escapeHtml(field.adjustment)}</small>
          </td>
          <td>${escapeHtml(field.displayValue || field.value || '')}</td>
          <td><span class="badge ${statusClass}">${escapeHtml(field.status || 'Review')}</span></td>
          <td>${escapeHtml(evidenceSummary(field.evidence))}</td>
        </tr>
      `;
    }).join('');
  }

  function renderInsights(fields) {
    const names = [
      'Business Summary (2-3 sentences)',
      'Primary Growth Drivers (Top 3)',
      'Management Strategic Priorities (Top 3)',
      'Key Risks Highlighted (Top 3)',
      'One-Line Investment Snapshot',
    ];
    const insightFields = fields.filter((field) => names.includes(field.datapoint));
    if (!insightFields.length) {
      dom.insights.innerHTML = '<p>No insight fields generated yet.</p>';
      return;
    }

    dom.insights.innerHTML = insightFields.map((field) => `
      <article class="insight-card">
        <div class="insight-card-header">
          <h4>${escapeHtml(field.datapoint)}</h4>
          <span class="badge ${statusToClass(field.status)}">${escapeHtml(field.status)}</span>
        </div>
        <p>${escapeHtml(field.value || field.notes || '')}</p>
        <small>${escapeHtml(evidenceSummary(field.evidence))}</small>
      </article>
    `).join('');
  }

  function renderScope(scope) {
    if (!scope) {
      dom.scopePanel.innerHTML = '<p>Reporting scope not established.</p>';
      return;
    }
    const rows = [
      ['Reporting Entity', scope.reportingEntity],
      ['Financial Statement Basis', scope.financialStatementBasis],
      ['Subsidiary Status', scope.subsidiaryStatus],
      ['Reason for Basis', scope.reasonForSelectingBasis],
      ['Verification Status', scope.scopeVerificationStatus],
      ['Evidence', scope.evidence && scope.evidence.passage],
    ];
    dom.scopePanel.innerHTML = rows.map(([label, value]) => `
      <div class="info-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '')}</strong>
      </div>
    `).join('');
  }

  function renderDebtComponents(components) {
    if (!components) {
      dom.debtTableBody.innerHTML = '<tr><td colspan="3">Debt components not generated.</td></tr>';
      return;
    }
    dom.debtTableBody.innerHTML = Object.entries(components).map(([key, item]) => `
      <tr>
        <td><strong>${escapeHtml(item.label || key)}</strong><br /><small>${escapeHtml(item.notes || '')}</small></td>
        <td>${escapeHtml(formatAmount(item.value, item.unit))}</td>
        <td><span class="badge ${statusToClass(item.status)}">${escapeHtml(item.status || '')}</span></td>
      </tr>
    `).join('');
  }

  function renderFinalReport(report) {
    if (!report) {
      dom.finalReport.innerHTML = '<p>Final report not generated.</p>';
      return;
    }
    dom.finalReport.innerHTML = Object.entries(report)
      .filter(([section]) => section !== 'G_DetailedSourceAnnotation')
      .map(([section, value]) => `
        <article class="report-card">
          <h4>${escapeHtml(section.replace(/_/g, ' '))}</h4>
          <pre>${escapeHtml(typeof value === 'object' ? JSON.stringify(value, null, 2) : value)}</pre>
        </article>
      `).join('');
  }

  function renderAnnotations(rows) {
    dom.annotationCount.textContent = `${rows.length} rows`;
    if (!rows.length) {
      dom.annotationTableBody.innerHTML = '<tr><td colspan="6">No source annotations generated.</td></tr>';
      return;
    }
    dom.annotationTableBody.innerHTML = rows.slice(0, 80).map((row) => `
      <tr>
        <td>${escapeHtml(row.Factor)}</td>
        <td>${escapeHtml(row.Claim)}</td>
        <td>${escapeHtml(row['Section Heading'])}</td>
        <td>${escapeHtml(row['Printed Page'])}</td>
        <td>${escapeHtml(row['PDF Page'])}</td>
        <td>${escapeHtml(row['Review Status'])}</td>
      </tr>
    `).join('');
  }

  function renderSteps(steps) {
    dom.steps.innerHTML = steps.map((step) => `
      <div class="step ${statusToClass(step.status)}">
        <div class="step-marker">${escapeHtml(step.label.slice(0, 1))}</div>
        <div>
          <strong>${escapeHtml(step.label)}</strong>
          <span>${escapeHtml(step.status)}</span>
          <p>${escapeHtml(step.message)}</p>
        </div>
      </div>
    `).join('');
  }

  function renderError(error) {
    renderSteps(defaultSteps.map((step, index) => index === 0 ? { ...step, status: 'Error', message: error.message || 'Workflow failed.' } : step));
    dom.analysisStatus.textContent = 'Error';
    dom.fieldTableBody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message || 'Workflow failed.')}</td></tr>`;
  }

  function setLoading(isLoading) {
    dom.analyzeButton.disabled = isLoading;
    dom.analyzeButton.textContent = isLoading ? 'Running Automation...' : 'Run End-to-End Analysis';
  }

  function reset() {
    state.currentAnalysis = null;
    dom.exportButton.disabled = true;
    dom.validatedCount.textContent = '0';
    dom.validatedCaption.textContent = 'Run analysis to populate';
    dom.sourceType.textContent = '--';
    dom.sourceDetail.textContent = 'No report selected';
    dom.reportType.textContent = '--';
    dom.filingDate.textContent = '--';
    dom.reviewCount.textContent = '0';
    dom.downloadStatus.textContent = '--';
    dom.downloadPath.textContent = '--';
    dom.fieldCount.textContent = 'Waiting';
    dom.fieldTableBody.innerHTML = '<tr><td colspan="5">Run analysis to generate the annual-report snapshot.</td></tr>';
    dom.policyText.textContent = 'Only the latest applicable annual filing/report is used. Run analysis to see selected source.';
    dom.sourceUrl.textContent = '--';
    dom.analysisStatus.textContent = 'Not run';
    dom.insights.innerHTML = '<p>Business summary, growth drivers, strategic priorities, risks, and one-line investment snapshot will appear here after extraction.</p>';
    dom.scopePanel.innerHTML = '<p>Run analysis to verify subsidiary status and the selected financial statement basis.</p>';
    dom.debtTableBody.innerHTML = '<tr><td colspan="3">Run analysis to calculate debt components.</td></tr>';
    dom.finalReport.innerHTML = '<p>Run analysis to generate sections A-H from the master prompt.</p>';
    dom.annotationCount.textContent = '0 rows';
    dom.annotationTableBody.innerHTML = '<tr><td colspan="6">Run analysis to populate source annotations.</td></tr>';
    renderSteps(defaultSteps);
    showToast('Workflow reset.');
  }

  function statusToClass(status) {
    return String(status || '').toLowerCase().replace(/\s+/g, '-');
  }

  function evidenceSummary(evidence) {
    if (!evidence) return '';
    if (typeof evidence === 'string') return evidence;
    return evidence.label || evidence.concept || evidence.document || evidence.source || evidence.url || '';
  }

  function formatAmount(value, unit) {
    if (value === '' || value === undefined || value === null) return '';
    const numeric = Number(value);
    const formatted = Number.isFinite(numeric) ? numeric.toLocaleString('en-US') : String(value);
    return `${formatted}${unit ? ` ${unit}` : ''}`;
  }

  function getApiOrigin() {
    if (window.location.protocol === 'file:') return 'http://localhost:4173';
    if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port && window.location.port !== '4173') return 'http://localhost:4173';
    return window.location.origin;
  }

  function apiUrl(path) {
    return `${API_ORIGIN}${path}`;
  }

  async function parseApiResponse(response) {
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      const backendHint = /not found/i.test(text)
        ? 'The API endpoint returned Not found. Start the backend with `node server.js` and open http://localhost:4173.'
        : `The API returned non-JSON content: ${text.slice(0, 180)}`;
      throw new Error(backendHint);
    }

    if (!response.ok && (!payload || !payload.errors)) {
      throw new Error(`API request failed with HTTP ${response.status}.`);
    }
    return payload;
  }

  async function exportCurrentAnalysis() {
    try {
      dom.exportButton.disabled = true;
      const response = await fetch(apiUrl('/api/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: state.currentAnalysis }),
      });
      if (!response.ok) {
        const payload = await parseApiResponse(response);
        throw new Error((payload.errors && payload.errors[0]) || `Export failed with HTTP ${response.status}.`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const ticker = (state.currentAnalysis.input && state.currentAnalysis.input.ticker) || 'company';
      const fileName = fileNameMatch ? fileNameMatch[1] : `${ticker}_Annual_Report_Snapshot.xls`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      URL.revokeObjectURL(link.href);
      link.remove();
      showToast('Excel export downloaded.');
    } catch (error) {
      showToast(normalizeApiError(error));
    } finally {
      dom.exportButton.disabled = !state.currentAnalysis;
    }
  }

  async function checkBackendHealth(options = {}) {
    setServerStatus('checking', `Checking ${API_ORIGIN}...`);
    try {
      const response = await fetch(apiUrl('/api/health'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = await parseApiResponse(response);
      if (!payload.ok) throw new Error((payload.errors && payload.errors[0]) || 'Backend health check failed.');
      setServerStatus('ready', `Backend ready (${API_ORIGIN})`);
      return payload;
    } catch (error) {
      const message = normalizeApiError(error);
      setServerStatus('offline', 'Backend offline');
      if (!options.quiet) showToast(message);
      throw new Error(message);
    }
  }

  function setServerStatus(status, message) {
    if (!dom.serverStatus || !dom.serverStatusPill) return;
    dom.serverStatus.textContent = message;
    dom.serverStatusPill.classList.remove('checking', 'ready', 'offline');
    dom.serverStatusPill.classList.add(status);
    dom.serverStatusPill.title = status === 'offline'
      ? `Start the backend with: cd ${API_ORIGIN.includes('localhost') ? 'ai-shark-tank-snapshot' : '<project>'} && node server.js`
      : message;
  }

  function normalizeApiError(error) {
    const raw = error && error.message ? error.message : String(error || '');
    if (/failed to fetch|networkerror|load failed|cannot reach backend|fetch/i.test(raw)) {
      return `Cannot reach backend API at ${API_ORIGIN}. Start it with: node server.js, then open http://localhost:4173.`;
    }
    return raw || 'Analysis failed.';
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('visible');
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => dom.toast.classList.remove('visible'), 3200);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function init() {
    cacheDom();
    bindEvents();
    renderSteps(defaultSteps);
    checkBackendHealth().catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);

  if (typeof window !== 'undefined') {
    window.AnnualReportApp = { getApiOrigin, apiUrl, parseApiResponse, checkBackendHealth, normalizeApiError, exportCurrentAnalysis };
  }
})();
