const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  MASTER_PROMPT_RULES,
  SNAPSHOT_FIELDS,
  analyzeCompany,
  buildExcelWorkbook,
  discoverLatestAnnualReport,
  extractFinancialFacts,
} = require('../automation');

const root = path.join(__dirname, '..');

function responseJson(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function responseText(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => 'text/html' },
    json: async () => JSON.parse(payload),
    text: async () => payload,
  };
}

const mockTickerMap = {
  0: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
};

const mockSubmissions = {
  filings: {
    recent: {
      form: ['10-Q', '10-K', '10-K'],
      filingDate: ['2025-10-25', '2025-07-30', '2024-07-30'],
      reportDate: ['2025-09-30', '2025-06-30', '2024-06-30'],
      accessionNumber: ['0000000000-25-000001', '0000789019-25-000100', '0000789019-24-000100'],
      primaryDocument: ['q1.htm', 'msft-20250630.htm', 'msft-20240630.htm'],
      primaryDocDescription: ['10-Q', '10-K', '10-K'],
    },
  },
};

function fact(concept, unit, val, extra = {}) {
  return {
    label: concept,
    units: {
      [unit]: [{
        val,
        form: '10-K',
        fp: extra.fp || 'FY',
        fy: 2025,
        start: '2024-07-01',
        end: '2025-06-30',
        filed: '2025-07-30',
        accn: '0000789019-25-000100',
        ...extra,
      }],
    },
  };
}

const mockFacts = {
  facts: {
    'us-gaap': {
      Revenues: fact('Revenues', 'USD', 245000000000),
      GrossProfit: fact('GrossProfit', 'USD', 171000000000),
      OperatingIncomeLoss: fact('OperatingIncomeLoss', 'USD', 109000000000),
      NetIncomeLoss: fact('NetIncomeLoss', 'USD', 88000000000),
      EarningsPerShareDiluted: fact('EarningsPerShareDiluted', 'USD/shares', 11.8),
      NetCashProvidedByUsedInOperatingActivities: fact('NetCashProvidedByUsedInOperatingActivities', 'USD', 118000000000),
      PaymentsToAcquirePropertyPlantAndEquipment: fact('PaymentsToAcquirePropertyPlantAndEquipment', 'USD', 44000000000),
      CashAndCashEquivalentsAtCarryingValue: fact('CashAndCashEquivalentsAtCarryingValue', 'USD', 18000000000, { fp: 'FY' }),
      EntityCommonStockSharesOutstanding: fact('EntityCommonStockSharesOutstanding', 'shares', 7430000000, { fp: 'FY' }),
      DebtCurrent: fact('DebtCurrent', 'USD', 6000000000, { fp: 'FY' }),
      LongTermDebtNoncurrent: fact('LongTermDebtNoncurrent', 'USD', 42000000000, { fp: 'FY' }),
      Assets: fact('Assets', 'USD', 510000000000, { fp: 'FY' }),
      StockholdersEquity: fact('StockholdersEquity', 'USD', 260000000000, { fp: 'FY' }),
    },
  },
};

const mockAnnualReportHtml = `
  <html><body>
    <h1>Microsoft Corp 2025 Form 10-K</h1>
    <p>The consolidated financial statements include Microsoft Corporation and its subsidiaries. The basis of consolidation eliminates intercompany balances and transactions.</p>
    <h2>Item 1. Business</h2>
    <p>We are a technology company whose mission is to empower every person and every organization on the planet to achieve more through software, devices, cloud services and artificial intelligence platforms.</p>
    <p>The company provides cloud-based solutions, productivity applications, operating systems, gaming services, search advertising and business applications to commercial and consumer customers worldwide.</p>
    <p>Our segments include productivity and business processes, intelligent cloud, and more personal computing, which serve enterprises, developers, public sector customers and consumers.</p>
    <h2>Item 1A. Risk Factors</h2>
    <p>Cybersecurity attacks may disrupt services, compromise data, harm customer trust and adversely affect financial results.</p>
    <p>Competition in cloud services and artificial intelligence may reduce revenue growth or require increased investment.</p>
    <p>Regulatory actions related to privacy, competition and artificial intelligence could adversely affect our operations.</p>
    <h2>Item 7. Management's Discussion and Analysis</h2>
    <p>Revenue increased due to demand for cloud services, growth in server products and higher usage of artificial intelligence infrastructure.</p>
    <p>Commercial bookings growth was driven by customer demand for security, analytics, cloud migrations and AI services.</p>
    <p>Management continues to invest in cloud infrastructure, artificial intelligence innovation and security to expand capacity and improve customer value.</p>
    <p>Our strategic priorities include building leading AI platforms, expanding cloud capacity, and improving operating efficiency through disciplined capital allocation.</p>
    <h2>Item 8. Financial Statements</h2>
  </body></html>
`;

async function mockFetch(url) {
  if (url.endsWith('/company_tickers.json')) return responseJson(mockTickerMap);
  if (url.includes('/submissions/CIK0000789019.json')) return responseJson(mockSubmissions);
  if (url.includes('/api/xbrl/companyfacts/CIK0000789019.json')) return responseJson(mockFacts);
  if (url.includes('/Archives/edgar/data/789019/000078901925000100/msft-20250630.htm')) return responseText(mockAnnualReportHtml);
  throw new Error(`Unexpected URL in mock fetch: ${url}`);
}

(async () => {
  assert.strictEqual(SNAPSHOT_FIELDS.length, 31, 'Template should include 4 prefilled + 27 numbered fields');
  assert.ok(MASTER_PROMPT_RULES.consolidatedFirst.includes('consolidated financial statements'), 'Master prompt consolidated-first rule must be implemented');

  const discovered = await discoverLatestAnnualReport({ companyName: 'Microsoft Corp', ticker: 'MSFT', sector: 'Technology', industry: 'Software' }, { fetchImpl: mockFetch });
  assert.strictEqual(discovered.form, '10-K', 'Discovery must select the latest annual filing, not a 10-Q');
  assert.strictEqual(discovered.reportDate, '2025-06-30');
  assert.ok(discovered.documentUrl.includes('msft-20250630.htm'));

  const facts = extractFinancialFacts(mockFacts, discovered);
  assert.strictEqual(facts.revenue.value, 245000000000);
  assert.strictEqual(facts.totalDebt.value, 48000000000);

  const outputDir = path.join(root, 'test-downloads');
  fs.rmSync(outputDir, { recursive: true, force: true });
  const analysis = await analyzeCompany({
    companyName: 'Microsoft Corp',
    ticker: 'MSFT',
    sector: 'Technology',
    industry: 'Software - Infrastructure',
  }, { fetchImpl: mockFetch, outputDir });

  assert.strictEqual(analysis.ok, true, JSON.stringify(analysis.errors));
  assert.strictEqual(analysis.fields.length, 31, 'Analysis must output all template rows');
  assert.strictEqual(analysis.reportingScope.financialStatementBasis, 'Consolidated', 'Consolidated basis must be selected when consolidated statements/subsidiaries are disclosed');
  assert.strictEqual(analysis.reportingScope.scopeVerificationStatus, 'Verified');
  assert.ok(analysis.masterPromptRules.standaloneRestriction.includes('Never substitute standalone'), 'Standalone substitution rule must be present in output');
  assert.ok(analysis.source.localPath && fs.existsSync(analysis.source.localPath), 'Annual report should be downloaded locally');
  assert.strictEqual(analysis.fields.find((field) => field.datapoint === 'Revenue / Turnover').value, 245000000000);
  assert.strictEqual(analysis.fields.find((field) => field.datapoint === 'Free Cash Flow').value, 74000000000);
  assert.strictEqual(analysis.fields.find((field) => field.datapoint === 'Gross Margin %').value, 69.8);
  assert.ok(analysis.fields.find((field) => field.datapoint === 'Business Summary (2-3 sentences)').value.includes('technology company'));
  assert.strictEqual(analysis.debtComponents.shortTermDebt.value, 6000000000);
  assert.strictEqual(analysis.debtComponents.longTermDebt.value, 42000000000);
  assert.strictEqual(analysis.debtComponents.leaseDebt.status, 'Not Found');
  assert.ok(analysis.finalReport.A_CompanyAndReportingScope.financialStatementBasis === 'Consolidated');
  assert.ok(analysis.finalReport.H_LimitationsConfidenceAndHumanReview.qualityControl.consolidatedFirst.includes('consolidated'));
  assert.ok(Array.isArray(analysis.sourceAnnotations) && analysis.sourceAnnotations.length >= analysis.fields.length, 'Source annotation table must cover generated fields');
  assert.ok(analysis.steps.every((step) => ['Complete', 'Review'].includes(step.status)), 'Workflow should complete or mark review');

  const workbook = buildExcelWorkbook(analysis);
  assert.ok(workbook.includes('Snapshot'));
  assert.ok(workbook.includes('Revenue / Turnover'));
  assert.ok(workbook.includes('245000000000'));
  assert.ok(workbook.includes('Source Metadata'));
  assert.ok(workbook.includes('Final Report A-H'));
  assert.ok(workbook.includes('Source Annotations'));
  assert.ok(workbook.includes('Scope Verification'));
  assert.ok(workbook.includes('Debt Components'));
  assert.ok(workbook.includes('Never substitute standalone'));
  assert.ok(workbook.includes('Validation'));

  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.ok(appJs.includes('parseApiResponse'), 'Frontend must use safe API response parsing');
  assert.ok(appJs.includes('http://localhost:4173'), 'Frontend must fall back to the Node backend when opened from another local server');
  assert.ok(appJs.includes('The API endpoint returned Not found'), 'Frontend must show an actionable backend-start message for non-JSON Not found responses');

  const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(serverJs.includes('routePath'), 'Server must route API paths independent of query/trailing slash');
  assert.ok(serverJs.includes('API route not found'), 'Server must return JSON for missing API routes');
  assert.ok(serverJs.includes('Access-Control-Allow-Origin'), 'Server must support CORS for local UI opened from another origin');

  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log('Smoke tests passed: mocked end-to-end annual-report automation, extraction, calculations, validation, and Excel export are working.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
