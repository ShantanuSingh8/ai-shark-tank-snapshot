const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { URL } = require('url');

const SEC_USER_AGENT = 'AISharkTankSnapshot/1.0 ssingh5@example.com';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_COMPANY_SEARCH_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=exclude&count=40&output=atom';
const ANNUAL_FORMS = ['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A'];
let secNodeFetchUnavailable = false;
const NOT_AVAILABLE = 'Not Available';
const HUMAN_REVIEW = 'Human Review';
const NOT_ESTABLISHED = 'Not established from the available official documents.';
const NOT_FOUND = 'Not Found';

const MASTER_PROMPT_RULES = {
  sourceRule: 'Use the official latest annual filing/report as the primary source. Do not use third-party websites, general industry knowledge, analyst estimates, or unsupported assumptions to fill gaps.',
  consolidatedFirst: 'Always use consolidated financial statements, consolidated notes, segment disclosures, and management discussion for the consolidated group whenever subsidiaries exist and consolidated information is available.',
  standaloneRestriction: 'Use standalone data only when the filing verifies that the company has no subsidiaries or that consolidated statements are not applicable. Never substitute standalone figures merely because they are easier to locate.',
  consistencyRule: 'Do not mix consolidated revenue with standalone profit, cash flow, debt, equity, risks, growth drivers, or strategy unless the scope difference is explicitly disclosed and flagged for human review.',
  missingValueRule: 'If a value is not available in the filing, keep the value cell blank and flag the field as Not Available or Human Review rather than fabricating a value.',
  pageRule: 'Never invent printed page numbers, PDF page numbers, quotations, source headings, or disclosures. Use Not verified where page references cannot be verified from the available HTML/XBRL source.',
};

const SNAPSHOT_FIELDS = [
  { section: 'Company Profile', number: 'Company Name', datapoint: 'Prefilled', adjustment: 'Legal entity name', kind: 'Prefilled' },
  { section: 'Company Profile', number: 'Ticker', datapoint: 'Prefilled', adjustment: 'Exchange:Ticker', kind: 'Prefilled' },
  { section: 'Company Profile', number: 'Sector', datapoint: 'Prefilled', adjustment: 'Standard sector taxonomy', kind: 'Prefilled' },
  { section: 'Company Profile', number: 'Industry', datapoint: 'Prefilled', adjustment: 'Standard industry taxonomy', kind: 'Prefilled' },
  { section: 'Report Metadata', number: '1', datapoint: 'Fiscal Year End', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Report Metadata', number: '2', datapoint: 'Report Type', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Report Metadata', number: '3', datapoint: 'Reporting Currency', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Report Metadata', number: '4', datapoint: 'Reporting Unit', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Scale & Growth', number: '5', datapoint: 'Revenue / Turnover', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Scale & Growth', number: '6', datapoint: 'Gross Profit', adjustment: 'Extracted / Calculated', kind: 'Extracted' },
  { section: 'Scale & Growth', number: '7', datapoint: 'Operating Income (EBIT)', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Scale & Growth', number: '8', datapoint: 'Net Income', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Scale & Growth', number: '9', datapoint: 'Diluted EPS', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Scale & Growth', number: '10', datapoint: 'Normalized EPS', adjustment: 'Extracted / Calculated', kind: 'Extracted' },
  { section: 'Cash Flow', number: '11', datapoint: 'Operating Cash Flow', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Cash Flow', number: '12', datapoint: 'Capital Expenditure (CapEx)', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Cash Flow', number: '13', datapoint: 'Free Cash Flow', adjustment: 'Calculated', kind: 'Calculated' },
  { section: 'Financial Strength', number: '14', datapoint: 'Cash & Cash Equivalents', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Financial Strength', number: '15', datapoint: 'Total Shares Outstanding (TSO)', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Financial Strength', number: '16', datapoint: 'Total Debt', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Financial Strength', number: '17', datapoint: 'Total Assets', adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Financial Strength', number: '18', datapoint: "Shareholders' Equity", adjustment: 'Extracted', kind: 'Extracted' },
  { section: 'Business Drivers & Ratios', number: '19', datapoint: 'Gross Margin %', adjustment: 'Calculated', kind: 'Calculated' },
  { section: 'Business Drivers & Ratios', number: '20', datapoint: 'Operating Margin %', adjustment: 'Calculated', kind: 'Calculated' },
  { section: 'Business Drivers & Ratios', number: '21', datapoint: 'Net Margin %', adjustment: 'Calculated', kind: 'Calculated' },
  { section: 'Business Drivers & Ratios', number: '22', datapoint: 'Debt-to-Equity', adjustment: 'Calculated', kind: 'Calculated' },
  { section: 'AI-Generated Snapshot Insights', number: '23', datapoint: 'Business Summary (2-3 sentences)', adjustment: 'Researched', kind: 'Researched' },
  { section: 'AI-Generated Snapshot Insights', number: '24', datapoint: 'Primary Growth Drivers (Top 3)', adjustment: 'Researched', kind: 'Researched' },
  { section: 'AI-Generated Snapshot Insights', number: '25', datapoint: 'Management Strategic Priorities (Top 3)', adjustment: 'Researched', kind: 'Researched' },
  { section: 'AI-Generated Snapshot Insights', number: '26', datapoint: 'Key Risks Highlighted (Top 3)', adjustment: 'Researched', kind: 'Researched' },
  { section: 'AI-Generated Snapshot Insights', number: '27', datapoint: 'One-Line Investment Snapshot', adjustment: 'Researched', kind: 'Researched' },
];

const CONCEPTS = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
    'SalesRevenueServicesNet',
    'RevenueFromContractsWithCustomers',
    'Revenue',
    'InterestIncomeExpenseNonOperatingNet',
    'InterestAndDividendIncomeOperating',
    'InterestIncomeOperating',
    'FinanceIncome',
    'InsuranceRevenue',
    'FeeAndCommissionIncome',
  ],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'ProfitLossAttributableToOwnersOfParent', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  dilutedEps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'DilutedEarningsLossPerShare'],
  operatingCashFlow: [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
    'CashFlowsFromUsedInOperatingActivities',
  ],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'CapitalExpenditures',
  ],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    'CashAndCashEquivalents',
    'CashAndDueFromBanks',
  ],
  shares: ['EntityCommonStockSharesOutstanding', 'CommonStocksIncludingAdditionalPaidInCapitalSharesOutstanding'],
  assets: ['Assets'],
  currentAssets: ['AssetsCurrent'],
  nonCurrentAssets: ['AssetsNoncurrent'],
  equity: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity', 'Equity', 'EquityAttributableToOwnersOfParent'],
  debtSingle: ['LongTermDebtAndFinanceLeaseObligations', 'LongTermDebt', 'DebtAndFinanceLeaseObligations'],
  debtCurrent: ['ShortTermBorrowings', 'DebtCurrent', 'LongTermDebtCurrent', 'LongTermDebtAndFinanceLeaseObligationsCurrent'],
  debtNonCurrent: ['LongTermDebtNoncurrent', 'LongTermDebtAndFinanceLeaseObligationsNoncurrent'],
  leaseCurrent: ['OperatingLeaseLiabilityCurrent', 'OperatingLeaseLiabilitiesCurrent', 'FinanceLeaseLiabilityCurrent', 'FinanceLeaseLiabilitiesCurrent'],
  leaseNonCurrent: ['OperatingLeaseLiabilityNoncurrent', 'OperatingLeaseLiabilitiesNoncurrent', 'FinanceLeaseLiabilityNoncurrent', 'FinanceLeaseLiabilitiesNoncurrent'],
  leaseSingle: ['OperatingLeaseLiability', 'OperatingLeaseLiabilities', 'FinanceLeaseLiability', 'FinanceLeaseLiabilities', 'LeaseLiability'],
};

function createEmptyResult(input) {
  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    input: normalizeInput(input),
    policy: 'Only the latest applicable annual filing/report is selected and used for extraction. No quarterly or external marketing source is used for values unless explicitly provided as a manual annual-report URL.',
    masterPromptRules: MASTER_PROMPT_RULES,
    source: null,
    reportingScope: null,
    debtComponents: null,
    finalReport: null,
    sourceAnnotations: [],
    steps: [
      { key: 'discover', label: 'Discover', status: 'Pending', message: 'Locate latest applicable annual filing.' },
      { key: 'download', label: 'Download', status: 'Pending', message: 'Save source document and metadata.' },
      { key: 'extract', label: 'Extract', status: 'Pending', message: 'Extract reported values and filing passages.' },
      { key: 'calculate', label: 'Calculate', status: 'Pending', message: 'Apply supplied formulas.' },
      { key: 'validate', label: 'Validate', status: 'Pending', message: 'Check source, period, unit, arithmetic, and exceptions.' },
      { key: 'generate', label: 'Generate', status: 'Pending', message: 'Generate template-aligned snapshot output.' },
    ],
    fields: [],
    validation: { counts: {}, warnings: [] },
    errors: [],
  };
}

async function analyzeCompany(input, options = {}) {
  const normalizedInput = normalizeInput(input);
  const result = createEmptyResult(normalizedInput);
  try {
    validateInput(normalizedInput);
  } catch (error) {
    result.errors.push(error.message);
    updateStep(result, options, 'discover', 'Error', error.message);
    result.fields = buildFailureFields(normalizedInput, result.source, error.message);
    result.validation = validateSnapshot(result.fields, result.source);
    return result;
  }

  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch;
  if (typeof fetchImpl !== 'function' && process.platform !== 'win32') {
    throw new Error('No HTTP client is available in this Node runtime. Use Node 18+ with fetch, provide fetchImpl, or run on Windows with PowerShell available.');
  }

  try {
    updateStep(result, options, 'discover', 'Running', 'Searching authoritative annual filing sources.');
    const source = await discoverLatestAnnualReport(normalizedInput, { ...options, fetchImpl });
    result.source = source;
    updateStep(result, options, 'discover', 'Complete', `Selected ${source.form || 'annual report'} filed ${source.filingDate || 'date unavailable'} from ${source.sourceType}.`);

    updateStep(result, options, 'download', 'Running', 'Downloading selected annual report only.');
    const downloaded = await downloadAnnualReport(source, { ...options, fetchImpl });
    result.source = { ...source, ...downloaded.metadata };
    updateStep(result, options, 'download', 'Complete', `Saved ${downloaded.metadata.documentName} to ${downloaded.metadata.localPath || 'memory'}.`);

    updateStep(result, options, 'extract', 'Running', 'Fetching SEC companyfacts for structured annual XBRL values.');
    const facts = await fetchCompanyFacts(source, { ...options, fetchImpl });
    updateStep(result, options, 'extract', 'Running', 'Converting the selected annual filing into bounded analysis text.');
    const text = htmlToText(downloaded.content);
    updateStep(result, options, 'extract', 'Running', 'Extracting template fields from XBRL facts and official filing passages.');
    const extracted = extractSnapshot(normalizedInput, result.source, facts, text);
    result.reportingScope = extracted.reportingScope;
    result.debtComponents = extracted.debtComponents;
    result.finalReport = extracted.finalReport;
    result.sourceAnnotations = extracted.sourceAnnotations;
    updateStep(result, options, 'extract', 'Complete', `Extracted ${extracted.extractedCount} fields with direct evidence or filing passages.`);

    updateStep(result, options, 'calculate', 'Running', 'Calculating margins, FCF, and leverage ratios.');
    result.fields = extracted.fields;
    updateStep(result, options, 'calculate', 'Complete', 'Calculated free cash flow, margins, and debt-to-equity where source inputs are available.');

    updateStep(result, options, 'validate', 'Running', 'Checking source traceability, period consistency, and arithmetic.');
    result.validation = validateSnapshot(result.fields, result.source);
    updateStep(result, options, 'validate', result.validation.warnings.length ? 'Review' : 'Complete', `${result.validation.counts.Validated || 0} validated, ${result.validation.counts[HUMAN_REVIEW] || 0} human-review, ${result.validation.counts[NOT_AVAILABLE] || 0} unavailable.`);

    updateStep(result, options, 'generate', 'Complete', 'Template-aligned snapshot is ready for Excel export.');
    result.ok = true;
    return result;
  } catch (error) {
    const failedStep = result.steps.find((step) => step.status === 'Running') || result.steps.find((step) => step.status === 'Pending');
    if (failedStep) {
      failedStep.status = 'Error';
      failedStep.message = error.message;
      notifyProgress(options, failedStep, result);
    }
    result.errors.push(error.message);
    result.fields = buildFailureFields(normalizedInput, result.source, error.message);
    result.validation = validateSnapshot(result.fields, result.source);
    return result;
  }
}

function normalizeInput(input = {}) {
  return {
    companyName: String(input.companyName || '').trim(),
    ticker: String(input.ticker || '').trim().toUpperCase(),
    sector: String(input.sector || '').trim(),
    industry: String(input.industry || '').trim(),
    annualReportUrl: String(input.annualReportUrl || '').trim(),
  };
}

function validateInput(input) {
  const missing = [];
  if (!input.companyName) missing.push('Company Name');
  if (!input.ticker) missing.push('Company Ticker');
  if (!input.sector) missing.push('Sector');
  if (!input.industry) missing.push('Industry');
  if (missing.length) throw new Error(`Missing required input: ${missing.join(', ')}`);
}

function setStep(result, key, status, message) {
  const step = result.steps.find((item) => item.key === key);
  if (step) {
    step.status = status;
    step.message = message;
    step.timestamp = new Date().toISOString();
  }
}

function updateStep(result, options, key, status, message) {
  setStep(result, key, status, message);
  const step = result.steps.find((item) => item.key === key);
  notifyProgress(options, step, result);
}

function notifyProgress(options, step, result) {
  if (typeof options.onProgress === 'function' && step) {
    options.onProgress({ ...step }, result);
  }
}

async function discoverLatestAnnualReport(input, options) {
  if (input.annualReportUrl) {
    const manualUrl = new URL(input.annualReportUrl);
    const lowerPath = manualUrl.pathname.toLowerCase();
    return {
      sourceType: 'Manual Annual Report URL',
      companyTitle: input.companyName,
      ticker: input.ticker,
      form: /20-f/.test(lowerPath) ? '20-F' : /40-f/.test(lowerPath) ? '40-F' : /10-k/.test(lowerPath) ? '10-K' : 'Annual Report',
      filingDate: '',
      reportDate: '',
      documentUrl: input.annualReportUrl,
      documentName: path.basename(manualUrl.pathname) || `${safeFileName(input.ticker)}-annual-report`,
      latestAnnualOnly: true,
      notes: 'Manual URL supplied by user. The system still treats it as the single annual-report source for this run.',
    };
  }

  const fetchImpl = options.fetchImpl;
  let tickerMap = null;
  let tickerMapError = null;
  try {
    tickerMap = await fetchJson(SEC_TICKERS_URL, fetchImpl);
  } catch (error) {
    tickerMapError = error;
  }

  const company = tickerMap ? findCompanyInSecMap(tickerMap, input) : null;
  if (!company) {
    const directSource = await discoverLatestAnnualReportFromSecSearch(input, fetchImpl, tickerMapError);
    if (directSource) return directSource;
    const reason = tickerMapError ? ` SEC ticker registry fetch failed first: ${tickerMapError.message}.` : '';
    throw new Error(`Could not match ticker/name ${input.ticker || input.companyName} in SEC annual filing sources.${reason} Paste the company's latest official annual-report HTML/SEC filing URL in the manual URL box for non-SEC issuers.`);
  }

  const source = await discoverAnnualFromSubmissions(company, input, fetchImpl);
  if (tickerMapError) {
    source.notes = `${source.notes} SEC ticker registry initially failed but lookup recovered. Registry error: ${tickerMapError.message}`;
  }
  return source;
}

async function discoverAnnualFromSubmissions(company, input, fetchImpl) {
  const cik = String(company.cik_str || company.cik || '').replace(/^CIK/i, '').padStart(10, '0');
  if (!/^\d{10}$/.test(cik)) {
    throw new Error(`Could not determine a valid SEC CIK for ${input.ticker || input.companyName}.`);
  }
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const submissions = await fetchJson(submissionsUrl, fetchImpl);
  const recent = submissions.filings && submissions.filings.recent;
  if (!recent || !Array.isArray(recent.form)) {
    throw new Error(`SEC submissions did not contain recent filings for ${input.ticker}.`);
  }

  const filings = recent.form.map((form, index) => ({
    form,
    filingDate: recent.filingDate[index],
    reportDate: recent.reportDate[index],
    accessionNumber: recent.accessionNumber[index],
    primaryDocument: recent.primaryDocument[index],
    primaryDocDescription: recent.primaryDocDescription[index],
  })).filter((filing) => ANNUAL_FORMS.includes(filing.form) && filing.primaryDocument && filing.accessionNumber);

  if (!filings.length) {
    const searched = await discoverLatestAnnualReportFromSecSearch(input, fetchImpl, null, cik);
    if (searched) return searched;
    throw new Error(`No 10-K/20-F/40-F annual filing found in SEC recent filings for ${input.ticker}. Paste the company's latest official annual-report HTML/SEC filing URL manually.`);
  }

  filings.sort((a, b) => String(b.filingDate || '').localeCompare(String(a.filingDate || '')));
  const latest = filings[0];
  const accessionNoDashes = latest.accessionNumber.replace(/-/g, '');
  const cikNoLeadingZeros = String(Number(cik));
  const documentUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoDashes}/${latest.primaryDocument}`;

  return {
    sourceType: 'SEC EDGAR',
    companyTitle: company.title || company.name || input.companyName,
    ticker: company.ticker || input.ticker,
    cik,
    form: latest.form,
    filingDate: latest.filingDate,
    reportDate: latest.reportDate,
    accessionNumber: latest.accessionNumber,
    primaryDocument: latest.primaryDocument,
    primaryDocDescription: latest.primaryDocDescription,
    documentUrl,
    submissionsUrl,
    factsUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    latestAnnualOnly: true,
    notes: `Latest annual filing selected from SEC forms ${ANNUAL_FORMS.join(', ')} by filing date.`,
  };
}

async function discoverLatestAnnualReportFromSecSearch(input, fetchImpl, priorError = null, knownCik = '') {
  const identifiers = uniqueValues([input.ticker, input.companyName, knownCik].filter(Boolean));
  for (const identifier of identifiers) {
    for (const form of ['10-K', '20-F', '40-F']) {
      const url = `${SEC_COMPANY_SEARCH_URL}&CIK=${encodeURIComponent(identifier)}&type=${encodeURIComponent(form)}`;
      try {
        const atom = await fetchText(url, fetchImpl, { accept: 'application/atom+xml,application/xml,text/xml,text/html,*/*', allowPdf: false });
        const filing = parseSecAtomAnnualEntry(atom, form);
        if (!filing) continue;
        const resolvedFiling = await resolveSecSearchPrimaryDocument(filing, fetchImpl);
        const cik = filing.cik || knownCik || parseCikFromSecAtom(atom) || '';
        const accessionNoDashes = filing.accessionNumber.replace(/-/g, '');
        const cikNoLeadingZeros = String(Number(String(cik).replace(/^CIK/i, '')) || '').replace(/^0+/, '') || String(cik).replace(/^0+/, '');
        const documentUrl = resolvedFiling.documentUrl || (cikNoLeadingZeros && resolvedFiling.primaryDocument ? `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoDashes}/${resolvedFiling.primaryDocument}` : resolvedFiling.filingHref);
        if (!documentUrl || isSecIndexUrl(documentUrl)) continue;
        return {
          sourceType: 'SEC EDGAR Search',
          companyTitle: resolvedFiling.companyTitle || input.companyName,
          ticker: input.ticker,
          cik: cik ? String(cik).replace(/^CIK/i, '').padStart(10, '0') : '',
          form: resolvedFiling.form || form,
          filingDate: resolvedFiling.filingDate || '',
          reportDate: resolvedFiling.reportDate || '',
          accessionNumber: resolvedFiling.accessionNumber,
          primaryDocument: resolvedFiling.primaryDocument,
          primaryDocDescription: resolvedFiling.primaryDocDescription || resolvedFiling.form || form,
          documentUrl,
          submissionsUrl: cik ? `https://data.sec.gov/submissions/CIK${String(cik).replace(/^CIK/i, '').padStart(10, '0')}.json` : '',
          factsUrl: cik ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).replace(/^CIK/i, '').padStart(10, '0')}.json` : '',
          latestAnnualOnly: true,
          notes: `Recovered latest annual filing through SEC company search for ${identifier}. ${priorError ? `Initial ticker registry issue: ${priorError.message}` : ''}`.trim(),
        };
      } catch (error) {
        // Try the next identifier/form. The final caller returns an actionable manual URL instruction.
      }
    }
  }
  return null;
}

async function resolveSecSearchPrimaryDocument(filing, fetchImpl) {
  if (filing.documentUrl && !isSecIndexUrl(filing.documentUrl)) return filing;
  if (!filing.filingHref) return filing;
  try {
    const indexHtml = await fetchText(filing.filingHref, fetchImpl, { accept: 'text/html,application/xhtml+xml,text/plain,*/*', allowPdf: false });
    const primary = parseSecFilingIndexPrimaryDocument(indexHtml, filing.form);
    if (primary) return { ...filing, ...primary };
  } catch (error) {
    // Keep the original Atom-derived filing so the caller can still report an SEC search source.
  }
  return filing;
}

function parseSecAtomAnnualEntry(atom, expectedForm) {
  const entry = ((String(atom || '').match(/<entry[\s\S]*?<\/entry>/i) || [])[0]) || '';
  if (!entry) return null;
  const text = decodeXml(entry);
  const accessionNumber = xmlTag(entry, 'accession-number') || firstMatch(text, /Accession Number:\s*([0-9-]+)/i);
  const filingHref = xmlTag(entry, 'filing-href') || xmlAttribute(entry, 'link', 'href') || '';
  const title = xmlTag(entry, 'title') || '';
  const filingDate = normalizeDate(xmlTag(entry, 'filing-date') || xmlTag(entry, 'updated') || firstMatch(text, /Filed:\s*(\d{4}-\d{2}-\d{2})/i));
  const form = normalizeAnnualForm(xmlTag(entry, 'filing-type') || firstMatch(title, /(10-K|20-F|40-F)(?:\/A)?/i) || expectedForm || '');
  if (!accessionNumber || !ANNUAL_FORMS.includes(form)) return null;
  const normalizedHref = absoluteSecUrl(filingHref);
  const documentUrl = secPrimaryDocumentUrl(normalizedHref, accessionNumber);
  const parsedPrimary = documentUrl ? path.basename(new URL(documentUrl).pathname) : '';
  return {
    form,
    accessionNumber,
    filingDate,
    reportDate: normalizeDate(firstMatch(text, /Period of Report:\s*(\d{4}-\d{2}-\d{2})/i)) || '',
    filingHref: normalizedHref,
    documentUrl,
    primaryDocument: parsedPrimary,
    cik: xmlTag(entry, 'cik') || parseCikFromSecAtom(atom),
    companyTitle: firstMatch(atom, /<conformed-name>([\s\S]*?)<\/conformed-name>/i) || '',
  };
}

function parseCikFromSecAtom(atom) {
  return xmlTag(atom, 'cik') || firstMatch(atom, /CIK=(\d{1,10})/i) || firstMatch(atom, /CIK\s*:?\s*(\d{1,10})/i) || '';
}

function normalizeAnnualForm(form) {
  const match = String(form || '').toUpperCase().match(/(10-K|20-F|40-F)(?:\/A)?/);
  if (!match) return String(form || '').toUpperCase();
  return /\/A/i.test(form) ? `${match[1]}/A` : match[1];
}

function absoluteSecUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `https://www.sec.gov${url}`;
  return `https://www.sec.gov/${url}`;
}

function secPrimaryDocumentUrl(filingHref, accessionNumber) {
  if (!filingHref) return '';
  if (/\/ixviewer\/doc\/[^?#]+/i.test(filingHref)) {
    const parsed = new URL(filingHref);
    return absoluteSecUrl(parsed.pathname.replace(/^\/ixviewer\/doc/i, ''));
  }
  if (/\/Archives\/edgar\/data\//i.test(filingHref) && !/-index\.htm(l)?($|\?)/i.test(filingHref) && /\.htm(l)?($|\?)/i.test(filingHref)) {
    return filingHref;
  }
  return '';
}

function isSecIndexUrl(url) {
  return /-index\.htm(l)?($|\?)/i.test(String(url || ''));
}

function parseSecFilingIndexPrimaryDocument(html, expectedForm) {
  const rows = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const expectedBaseForm = normalizeAnnualForm(expectedForm).replace('/A', '');
  for (const row of rows) {
    const href = firstMatch(row, /<a[^>]+href=["']([^"']+)["']/i);
    if (!href || !/\.(htm|html|xhtml)($|\?)/i.test(href) || isSecIndexUrl(href)) continue;
    if (/FilingSummary|R\d+\.htm|Financial_Report/i.test(href)) continue;
    const rowText = htmlToText(row);
    const rowForm = normalizeAnnualForm(firstMatch(rowText, /\b(10-K|20-F|40-F)(?:\/A)?\b/i) || expectedForm);
    if (!ANNUAL_FORMS.includes(rowForm)) continue;
    if (expectedBaseForm && rowForm.replace('/A', '') !== expectedBaseForm) continue;
    const documentUrl = absoluteSecUrl(href);
    return {
      documentUrl,
      primaryDocument: path.basename(new URL(documentUrl).pathname),
      primaryDocDescription: rowText,
    };
  }
  return null;
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function xmlTag(xml, tagName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function xmlAttribute(xml, tagName, attributeName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}[^>]*\\s${attributeName}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function firstMatch(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? decodeXml(match[1]).trim() : '';
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const compact = text.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return '';
}

function findCompanyInSecMap(tickerMap, input) {
  const rows = Object.values(tickerMap || {});
  const targetTicker = normalizeTicker(input.ticker);
  const targetName = normalizeText(input.companyName);
  const exactTicker = rows.find((row) => normalizeTicker(row.ticker) === targetTicker);
  if (exactTicker) return exactTicker;
  return rows.find((row) => normalizeText(row.title).includes(targetName) || targetName.includes(normalizeText(row.title)));
}

function normalizeTicker(ticker) {
  return String(ticker || '').toUpperCase().replace(/\./g, '-').replace(/[^A-Z0-9-]/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|corp|corporation|company|co|ltd|plc|sa|ag|nv|se|group|holdings)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function downloadAnnualReport(source, options) {
  const content = await fetchText(source.documentUrl, options.fetchImpl, { timeoutMs: options.downloadTimeoutMs || 180000 });
  const outputDir = options.outputDir || path.join(__dirname, 'downloads');
  ensureDir(outputDir);
  const extension = source.documentName ? path.extname(source.documentName) : path.extname(source.primaryDocument || '');
  const documentName = source.documentName || `${safeFileName(source.ticker || source.companyTitle)}_${safeFileName(source.accessionNumber || 'annual')}${extension || '.html'}`;
  const localPath = path.join(outputDir, documentName);
  if (!options.skipWrite) fs.writeFileSync(localPath, content, 'utf8');
  return {
    content,
    metadata: {
      documentName,
      localPath: options.skipWrite ? '' : localPath,
      downloadedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(content, 'utf8'),
    },
  };
}

async function fetchCompanyFacts(source, options) {
  if (!source.factsUrl) return null;
  try {
    return await fetchJson(source.factsUrl, options.fetchImpl);
  } catch (error) {
    return { error: error.message, facts: {} };
  }
}

async function fetchJson(url, fetchImpl) {
  const text = await requestText(url, {
    fetchImpl,
    accept: 'application/json,text/plain,*/*',
    kind: 'Fetch',
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Fetch returned non-JSON content for ${url}: ${text.slice(0, 180)}`);
  }
}

async function fetchText(url, fetchImpl, options = {}) {
  if (options.allowPdf === false && /\.pdf($|\?)/i.test(url)) {
    throw new Error('PDF annual reports need a PDF parser, which is not available without dependencies. Use an SEC HTML filing or HTML annual report URL for automated extraction.');
  }
  const text = await requestText(url, {
    fetchImpl,
    accept: options.accept || 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
    kind: 'Download',
    retries: options.retries,
    timeoutMs: options.timeoutMs,
    allowSystemFallback: options.allowSystemFallback,
  });
  if (/\.pdf($|\?)/i.test(url)) {
    throw new Error('PDF annual reports need a PDF parser, which is not available without dependencies. Use an SEC HTML filing or HTML annual report URL for automated extraction.');
  }
  return text;
}

async function requestText(url, options = {}) {
  const headers = {
    'User-Agent': SEC_USER_AGENT,
    Accept: options.accept || '*/*',
  };
  const errors = [];
  const allowSystemFallback = options.allowSystemFallback !== undefined
    ? Boolean(options.allowSystemFallback)
    : (typeof options.fetchImpl !== 'function' || options.fetchImpl === global.fetch);
  const shouldTryNodeFetch = typeof options.fetchImpl === 'function'
    && !(allowSystemFallback && process.platform === 'win32' && secNodeFetchUnavailable && isSecUrl(url));

  if (shouldTryNodeFetch) {
    const retries = options.retries === undefined ? 1 : Number(options.retries);
    const nodeTimeoutMs = options.nodeTimeoutMs
      || (allowSystemFallback && process.platform === 'win32' ? 12000 : options.timeoutMs)
      || 30000;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let timeoutId = null;
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        timeoutId = controller ? setTimeout(() => controller.abort(), nodeTimeoutMs) : null;
        const response = await options.fetchImpl(url, { headers, signal: controller ? controller.signal : undefined });
        if (timeoutId) clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers && response.headers.get ? response.headers.get('content-type') || '' : '';
        if (/application\/pdf/i.test(contentType)) {
          throw new Error('PDF response received; automated extraction requires HTML/XHTML/text filing content.');
        }
        return response.text();
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        errors.push(`Node fetch attempt ${attempt + 1} failed: ${error.message}`);
        if (process.platform === 'win32' && /fetch failed|network|tls|socket|undici/i.test(error.message || '')) {
          if (isSecUrl(url)) secNodeFetchUnavailable = true;
          break;
        }
        if (attempt < retries) await delay(350 * (attempt + 1));
      }
    }
  }

  if (allowSystemFallback && process.platform === 'win32') {
    try {
      return await requestTextWithPowerShell(url, headers, options.timeoutMs || 45000);
    } catch (error) {
      errors.push(`PowerShell fallback failed: ${error.message}`);
    }
  }

  throw new Error(`${options.kind || 'Request'} failed for ${url}. ${errors.join(' | ') || 'No HTTP client available.'}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSecUrl(url) {
  return /^https:\/\/(www\.|data\.)?sec\.gov\//i.test(String(url || ''));
}

function requestTextWithPowerShell(url, headers, timeoutMs) {
  const tempPath = path.join(os.tmpdir(), `ai-shark-tank-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    `$headers = @{ 'User-Agent' = ${psQuote(headers['User-Agent'])}; 'Accept' = ${psQuote(headers.Accept)} }`,
    `$outFile = ${psQuote(tempPath)}`,
    `$response = Invoke-WebRequest -Uri ${psQuote(url)} -Headers $headers -UseBasicParsing -TimeoutSec ${Math.ceil(timeoutMs / 1000)} -OutFile $outFile`,
    'if (!(Test-Path -LiteralPath $outFile)) { throw "No response body was written by Invoke-WebRequest" }',
    'Write-Output "OK"',
  ].join('; ');

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        fs.rmSync(tempPath, { force: true });
        reject(new Error((stderr || error.message || '').trim() || 'unknown PowerShell request error'));
        return;
      }
      try {
        const content = fs.readFileSync(tempPath, 'utf8').replace(/^\uFEFF/, '');
        fs.rmSync(tempPath, { force: true });
        resolve(content);
      } catch (readError) {
        fs.rmSync(tempPath, { force: true });
        reject(new Error(`PowerShell response file could not be read: ${readError.message}. Output: ${String(stdout || '').trim()}`));
      }
    });
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function extractSnapshot(input, source, companyFacts, reportText) {
  const facts = extractFinancialFacts(companyFacts, source, input);
  const reportingScope = determineReportingScope(reportText, source, input);
  const fields = [];
  const byName = {};
  const sourceEvidence = baseEvidence(source);

  function add(field) {
    fields.push(field);
    byName[field.datapoint] = field;
  }

  add(prefilledField('Company Name', input.companyName, sourceEvidence, 'User-supplied company name; validated against selected filing where SEC match exists.'));
  add(prefilledField('Ticker', input.ticker, sourceEvidence, 'User-supplied ticker; SEC ticker registry is used for matching when no manual URL is supplied.'));
  add(prefilledField('Sector', input.sector, sourceEvidence, 'User-supplied sector retained; the workflow does not invent a replacement taxonomy.'));
  add(prefilledField('Industry', input.industry, sourceEvidence, 'User-supplied industry retained; the workflow does not invent a replacement taxonomy.'));
  add(extractedLiteralField('Fiscal Year End', source.reportDate || '', source.reportDate ? 'Validated' : NOT_AVAILABLE, sourceEvidence, 'Latest annual filing reportDate from source metadata. Distinguish this from publication/filing date.'));
  add(extractedLiteralField('Report Type', normalizeReportType(source.form), source.form ? 'Validated' : HUMAN_REVIEW, sourceEvidence, 'Annual filing selected from 10-K/20-F/40-F family.'));
  add(extractedLiteralField('Reporting Currency', facts.currency || '', facts.currency ? 'Validated' : NOT_AVAILABLE, facts.currencyEvidence || sourceEvidence, 'Presentation currency inferred from XBRL fact units; do not substitute functional currency unless explicitly required by the filing.'));
  add(extractedLiteralField('Reporting Unit', facts.currency ? 'Actual units (XBRL)' : '', facts.currency ? 'Validated' : NOT_AVAILABLE, facts.currencyEvidence || sourceEvidence, 'SEC companyfacts values are reported in actual units. Preserve filing scale when parsed directly from reports.'));

  add(factField('Revenue / Turnover', facts.revenue));
  add(factField('Gross Profit', facts.grossProfit));
  add(factField('Operating Income (EBIT)', facts.operatingIncome));
  add(factField('Net Income', facts.netIncome));
  add(factField('Diluted EPS', facts.dilutedEps));
  add(normalizedEpsField(facts.dilutedEps));
  add(factField('Operating Cash Flow', facts.operatingCashFlow));
  add(capexField(facts.capex));
  add(calculatedField('Free Cash Flow', calculateFreeCashFlow(facts.operatingCashFlow, facts.capex), [facts.operatingCashFlow, facts.capex], 'Operating Cash Flow - absolute Capital Expenditure.'));
  add(factField('Cash & Cash Equivalents', facts.cash));
  add(factField('Total Shares Outstanding (TSO)', facts.shares));
  add(debtField(facts.totalDebt, facts.debtComponents));
  add(factField('Total Assets', facts.assets));
  add(factField("Shareholders' Equity", facts.equity));
  add(calculatedField('Gross Margin %', calculatePercent(facts.grossProfit, facts.revenue), [facts.grossProfit, facts.revenue], 'Gross Profit / Revenue.'));
  add(calculatedField('Operating Margin %', calculatePercent(facts.operatingIncome, facts.revenue), [facts.operatingIncome, facts.revenue], 'Operating Income / Revenue.'));
  add(calculatedField('Net Margin %', calculatePercent(facts.netIncome, facts.revenue), [facts.netIncome, facts.revenue], 'Net Income / Revenue.'));
  add(calculatedField('Debt-to-Equity', calculateRatio(facts.totalDebt, facts.equity), [facts.totalDebt, facts.equity], 'Total Debt / Shareholders Equity.'));

  const insights = extractInsights(reportText, source, byName, reportingScope);
  add(researchedField('Business Summary (2-3 sentences)', insights.businessSummary));
  add(researchedField('Primary Growth Drivers (Top 3)', insights.growthDrivers));
  add(researchedField('Management Strategic Priorities (Top 3)', insights.priorities));
  add(researchedField('Key Risks Highlighted (Top 3)', insights.risks));
  add(researchedField('One-Line Investment Snapshot', buildOneLineSnapshot(byName, insights, reportingScope)));

  const alignedFields = alignFieldsToTemplate(fields).map((field) => applyMasterPromptFieldRules(field, reportingScope));
  const sourceAnnotations = buildSourceAnnotations(alignedFields, source, reportingScope, insights);
  const finalReport = buildFinalReport(input, source, reportingScope, alignedFields, insights, sourceAnnotations);

  return {
    fields: alignedFields,
    reportingScope,
    debtComponents: facts.debtComponents,
    finalReport,
    sourceAnnotations,
    extractedCount: fields.filter((field) => ![NOT_AVAILABLE, HUMAN_REVIEW].includes(field.status)).length,
  };
}

function alignFieldsToTemplate(fields) {
  return SNAPSHOT_FIELDS.map((definition) => {
    const matched = fields.find((field) => {
      if (definition.datapoint === 'Prefilled') return field.number === definition.number;
      return field.datapoint === definition.datapoint || field.number === definition.number;
    });
    if (matched) return { ...definition, ...matched };
    return buildField(definition.datapoint, '', NOT_AVAILABLE, 0, {}, 'Template field not generated.');
  });
}

function buildFailureFields(input, source, message) {
  const evidence = source ? baseEvidence(source) : { source: 'Workflow error' };
  return alignFieldsToTemplate([
    prefilledField('Company Name', input.companyName, evidence, 'User supplied.'),
    prefilledField('Ticker', input.ticker, evidence, 'User supplied.'),
    prefilledField('Sector', input.sector, evidence, 'User supplied.'),
    prefilledField('Industry', input.industry, evidence, 'User supplied.'),
    buildField('One-Line Investment Snapshot', '', HUMAN_REVIEW, 0, evidence, message),
  ]);
}

function findDefinition(datapoint) {
  return SNAPSHOT_FIELDS.find((field) => field.datapoint === datapoint || field.number === datapoint) || { section: '', number: '', datapoint, adjustment: '', kind: '' };
}

function buildField(datapoint, value, status, confidence, evidence = {}, notes = '') {
  const definition = findDefinition(datapoint);
  return {
    section: definition.section,
    number: definition.number,
    datapoint: definition.datapoint,
    adjustment: definition.adjustment,
    value,
    displayValue: formatDisplayValue(value, definition.datapoint),
    status,
    confidence,
    evidence,
    notes,
  };
}

function prefilledField(numberName, value, evidence, notes) {
  const definition = SNAPSHOT_FIELDS.find((field) => field.number === numberName);
  return {
    ...definition,
    value,
    displayValue: value,
    status: 'Prefilled',
    confidence: value ? 1 : 0,
    evidence,
    notes,
  };
}

function extractedLiteralField(datapoint, value, status, evidence, notes) {
  return buildField(datapoint, value, status, value ? 0.95 : 0, evidence, notes);
}

function factField(datapoint, fact) {
  if (!fact || !isFiniteNumber(fact.value)) {
    return buildField(
      datapoint,
      '',
      fact && fact.status ? fact.status : NOT_AVAILABLE,
      fact && fact.confidence ? fact.confidence : 0,
      fact && fact.evidence ? fact.evidence : {},
      fact && fact.notes ? fact.notes : 'Required fact was not found in the latest annual XBRL facts.'
    );
  }
  return buildField(datapoint, fact.value, fact.status || 'Validated', fact.confidence || 0.9, fact.evidence, fact.notes || `Extracted from ${fact.concept}.`);
}

function capexField(fact) {
  if (!fact || !isFiniteNumber(fact.value)) return factField('Capital Expenditure (CapEx)', fact);
  const normalized = { ...fact, value: Math.abs(fact.value), notes: 'Capital expenditure normalized as a positive cash outflow magnitude.' };
  return factField('Capital Expenditure (CapEx)', normalized);
}

function debtField(fact, debtComponents) {
  if (!fact || !isFiniteNumber(fact.value)) return factField('Total Debt', fact);
  const componentNote = debtComponents
    ? ` Short-Term Debt: ${componentDisplay(debtComponents.shortTermDebt)}; Long-Term Debt: ${componentDisplay(debtComponents.longTermDebt)}; Lease Debt: ${componentDisplay(debtComponents.leaseDebt)}.`
    : '';
  return buildField('Total Debt', fact.value, fact.status || 'Validated', fact.confidence || 0.86, fact.evidence, `${fact.notes || 'Total debt extracted or calculated from separately identifiable debt concepts without trade payables/provisions.'}${componentNote}`);
}

function normalizedEpsField(dilutedEps) {
  if (!dilutedEps || !isFiniteNumber(dilutedEps.value)) {
    return buildField('Normalized EPS', '', NOT_AVAILABLE, 0, {}, 'Normalized EPS requires reported EPS and special-item adjustments; no supported EPS value found.');
  }
  return buildField('Normalized EPS', dilutedEps.value, HUMAN_REVIEW, 0.55, dilutedEps.evidence, 'Using reported diluted EPS as a proxy. Human review required for special items / normalization adjustments.');
}

function calculatedField(datapoint, calculation, dependencies, formula) {
  if (!calculation || !isFiniteNumber(calculation.value)) {
    return buildField(datapoint, '', NOT_AVAILABLE, 0, {}, `Cannot calculate. Missing inputs for formula: ${formula}`);
  }
  const humanReviewInput = dependencies.some((dependency) => dependency && dependency.status === HUMAN_REVIEW);
  return buildField(datapoint, calculation.value, humanReviewInput ? HUMAN_REVIEW : 'Calculated', humanReviewInput ? 0.65 : 0.93, {
    source: 'Calculated from latest annual filing values',
    formula,
    inputs: dependencies.filter(Boolean).map((dependency) => ({ concept: dependency.concept, value: dependency.value, unit: dependency.unit, period: dependency.end })),
  }, formula);
}

function researchedField(datapoint, insight) {
  if (!insight || !insight.value) {
    return buildField(datapoint, '', NOT_AVAILABLE, 0, insight && insight.evidence ? insight.evidence : {}, 'No sufficiently specific annual-report passage found.');
  }
  return buildField(datapoint, insight.value, insight.status || 'Validated', insight.confidence || 0.72, insight.evidence, insight.notes || 'Generated from cited annual-report passages only.');
}

function extractFinancialFacts(companyFacts, source, input = {}) {
  const revenue = selectRevenueFact(companyFacts, source, input);
  const grossProfit = selectFact(companyFacts, CONCEPTS.grossProfit, source, { unitsLike: 'currency' }) || calculateGrossProfit(companyFacts, source, revenue);
  const operatingIncome = selectFact(companyFacts, CONCEPTS.operatingIncome, source, { unitsLike: 'currency' });
  const netIncome = selectFact(companyFacts, CONCEPTS.netIncome, source, { unitsLike: 'currency' });
  const dilutedEps = selectFact(companyFacts, CONCEPTS.dilutedEps, source, { unitsLike: 'perShare' });
  const operatingCashFlow = selectFact(companyFacts, CONCEPTS.operatingCashFlow, source, { unitsLike: 'currency' });
  const capex = selectFact(companyFacts, CONCEPTS.capex, source, { unitsLike: 'currency' });
  const cash = selectFact(companyFacts, CONCEPTS.cash, source, { unitsLike: 'currency', instant: true });
  const shares = selectFact(companyFacts, CONCEPTS.shares, source, { unitsLike: 'shares', instant: true });
  const assets = selectFact(companyFacts, CONCEPTS.assets, source, { unitsLike: 'currency', instant: true }) || calculateTotalAssets(companyFacts, source);
  const equity = selectFact(companyFacts, CONCEPTS.equity, source, { unitsLike: 'currency', instant: true });
  const debtCalculation = calculateDebt(companyFacts, source, input);
  const totalDebt = debtCalculation.totalDebt;
  const currency = [revenue, grossProfit, operatingIncome, netIncome, operatingCashFlow, cash, assets, equity, totalDebt].find((fact) => fact && isCurrencyUnit(fact.unit));

  return {
    revenue,
    grossProfit,
    operatingIncome,
    netIncome,
    dilutedEps,
    operatingCashFlow,
    capex,
    cash,
    shares,
    totalDebt,
    debtComponents: debtCalculation.components,
    assets,
    equity,
    currency: currency ? currency.unit : '',
    currencyEvidence: currency ? currency.evidence : null,
  };
}

function selectRevenueFact(companyFacts, source, input = {}) {
  const standardRevenue = selectFact(companyFacts, CONCEPTS.revenue, source, { unitsLike: 'currency' });
  if (!isFinancialInstitution(input)) return standardRevenue;

  const bankingGrossIncome = selectFact(companyFacts, ['GrossProfit'], source, { unitsLike: 'currency' });
  if (bankingGrossIncome && (!standardRevenue || /FeeAndCommission|BrokerageFee|RevenueFromDividends/i.test(standardRevenue.concept || '') || Math.abs(bankingGrossIncome.value) > Math.abs(standardRevenue.value))) {
    return {
      ...bankingGrossIncome,
      notes: 'Financial-services issuer: selected the broader official XBRL GrossProfit / gross-income fact for Revenue / Turnover instead of a narrower fee, commission, dividend, or other component revenue line.',
    };
  }

  return standardRevenue;
}

function isFinancialInstitution(input = {}) {
  return /bank|financial|insurance|capital\s+markets|credit|asset\s+management/i.test(`${input.sector || ''} ${input.industry || ''}`);
}

function calculateTotalAssets(companyFacts, source) {
  const currentAssets = selectFact(companyFacts, CONCEPTS.currentAssets, source, { unitsLike: 'currency', instant: true });
  const nonCurrentAssets = selectFact(companyFacts, CONCEPTS.nonCurrentAssets, source, { unitsLike: 'currency', instant: true });
  if (!currentAssets || !nonCurrentAssets || !isFiniteNumber(currentAssets.value) || !isFiniteNumber(nonCurrentAssets.value)) return null;
  return {
    value: currentAssets.value + nonCurrentAssets.value,
    unit: currentAssets.unit || nonCurrentAssets.unit,
    concept: `${currentAssets.concept} + ${nonCurrentAssets.concept}`,
    label: 'Calculated Total Assets',
    status: 'Calculated',
    confidence: 0.82,
    evidence: {
      source: 'Calculated from XBRL asset components',
      formula: 'Current assets + non-current assets',
      inputs: [currentAssets.evidence, nonCurrentAssets.evidence],
    },
    notes: 'Total assets was not explicitly found; calculated only because current assets and non-current assets were available and non-overlapping.',
  };
}

function calculateGrossProfit(companyFacts, source, revenue) {
  const cost = selectFact(companyFacts, CONCEPTS.costOfRevenue, source, { unitsLike: 'currency' });
  if (!revenue || !cost || !isFiniteNumber(revenue.value) || !isFiniteNumber(cost.value)) return null;
  return {
    value: revenue.value - Math.abs(cost.value),
    unit: revenue.unit,
    concept: 'Revenue minus CostOfRevenue',
    label: 'Calculated Gross Profit',
    status: 'Calculated',
    confidence: 0.78,
    evidence: {
      source: 'Calculated from XBRL facts',
      formula: 'Revenue - Cost of Revenue',
      inputs: [revenue.evidence, cost.evidence],
    },
    notes: 'Gross profit was not directly found; calculated from revenue and cost of revenue.',
  };
}

function calculateDebt(companyFacts, source, input = {}) {
  const current = selectFact(companyFacts, CONCEPTS.debtCurrent, source, { unitsLike: 'currency', instant: true });
  const nonCurrent = selectFact(companyFacts, CONCEPTS.debtNonCurrent, source, { unitsLike: 'currency', instant: true });
  const leaseCurrent = selectFact(companyFacts, CONCEPTS.leaseCurrent, source, { unitsLike: 'currency', instant: true });
  const leaseNonCurrent = selectFact(companyFacts, CONCEPTS.leaseNonCurrent, source, { unitsLike: 'currency', instant: true });
  const leaseSingle = selectFact(companyFacts, CONCEPTS.leaseSingle, source, { unitsLike: 'currency', instant: true });
  const shortTermDebt = current || missingComponent('Short-Term Debt', source);
  const longTermDebt = nonCurrent || missingComponent('Long-Term Debt', source);
  const leaseDebt = combineLeaseDebt(leaseCurrent, leaseNonCurrent, leaseSingle, source);
  const leaseAlreadyIncluded = /lease/i.test(`${current && current.concept || ''} ${nonCurrent && nonCurrent.concept || ''}`);
  const available = [current, nonCurrent, !leaseAlreadyIncluded && leaseDebt && leaseDebt.found ? leaseDebt : null].filter((item) => item && isFiniteNumber(item.value));

  const components = { shortTermDebt, longTermDebt, leaseDebt };

  if (available.length) {
    if (isFinancialInstitution(input) && available.every((item) => /lease/i.test(`${item.concept || ''} ${item.label || ''}`))) {
      return { totalDebt: {
        value: '',
        unit: '',
        concept: 'Financial institution debt requires review',
        label: 'Total Debt',
        status: HUMAN_REVIEW,
        confidence: 0.35,
        evidence: baseEvidence(source),
        notes: 'Financial-services issuer: only lease liabilities were separately identified by the generic XBRL debt search. Total Debt is left blank for human review instead of treating lease-only liabilities as total debt.',
      }, components };
    }
    return { totalDebt: {
      value: available.reduce((sum, item) => sum + Math.abs(Number(item.value)), 0),
      unit: (available.find((item) => item.unit) || {}).unit || '',
      concept: available.map((item) => item.concept).join(' + '),
      label: 'Calculated Total Debt',
      status: 'Calculated',
      confidence: 0.86,
      evidence: {
        source: 'Calculated from separately identifiable XBRL debt components',
        formula: 'Short-Term Debt + Long-Term Debt + Lease Debt, using available separately identifiable amounts only',
        inputs: available.map((item) => item.evidence),
      },
      notes: leaseAlreadyIncluded
        ? 'Total debt excludes trade payables, provisions, and other non-debt liabilities. Lease liabilities appear included in selected debt concepts, so separate lease concepts were not added again. Missing components are marked Not Found, not assumed zero.'
        : 'Total debt excludes trade payables, provisions, and other non-debt liabilities. Missing components are excluded and marked Not Found, not assumed zero.',
    }, components };
  }
  const single = selectFact(companyFacts, CONCEPTS.debtSingle, source, { unitsLike: 'currency', instant: true });
  if (single) return { totalDebt: { ...single, status: HUMAN_REVIEW, confidence: 0.62, notes: 'Single debt concept used. Human review recommended to confirm it includes all current and non-current debt and lease debt without double-counting.' }, components };
  return { totalDebt: null, components };
}

function combineLeaseDebt(leaseCurrent, leaseNonCurrent, leaseSingle, source) {
  if (leaseCurrent && leaseNonCurrent && isFiniteNumber(leaseCurrent.value) && isFiniteNumber(leaseNonCurrent.value)) {
    return {
      found: true,
      value: Math.abs(leaseCurrent.value) + Math.abs(leaseNonCurrent.value),
      unit: leaseCurrent.unit || leaseNonCurrent.unit,
      concept: `${leaseCurrent.concept} + ${leaseNonCurrent.concept}`,
      label: 'Lease Debt',
      status: 'Calculated',
      confidence: 0.82,
      evidence: {
        source: 'Calculated from current and non-current XBRL lease liabilities',
        formula: 'Current lease liabilities + non-current lease liabilities',
        inputs: [leaseCurrent.evidence, leaseNonCurrent.evidence],
      },
      notes: 'Lease debt includes separately identifiable current and non-current lease liabilities.',
    };
  }
  if (leaseSingle && isFiniteNumber(leaseSingle.value)) return { ...leaseSingle, found: true, label: 'Lease Debt', status: HUMAN_REVIEW, notes: 'Single lease liability concept found; review for current/non-current coverage and double-counting.' };
  return missingComponent('Lease Debt', source);
}

function missingComponent(label, source) {
  return {
    found: false,
    value: '',
    unit: '',
    concept: label,
    label,
    status: NOT_FOUND,
    confidence: 0,
    evidence: baseEvidence(source),
    notes: `${label} not found as a separately identifiable annual-report/XBRL component; excluded from total debt and not assumed zero.`,
  };
}

function componentDisplay(component) {
  if (!component || component.status === NOT_FOUND || component.value === '') return NOT_FOUND;
  return `${formatDisplayValue(component.value, component.label || '')} ${component.unit || ''}`.trim();
}

function selectFact(companyFacts, concepts, source, options = {}) {
  if (!companyFacts || !companyFacts.facts) return null;
  const candidates = [];
  for (const [taxonomy, taxonomyFacts] of Object.entries(companyFacts.facts)) {
    for (const concept of concepts) {
      const fact = taxonomyFacts && taxonomyFacts[concept];
      if (!fact || !fact.units) continue;
      for (const [unit, unitFacts] of Object.entries(fact.units)) {
        if (!unitMatches(unit, options)) continue;
        for (const item of unitFacts) {
          if (!isFiniteNumber(item.val)) continue;
          if (!ANNUAL_FORMS.includes(item.form) && item.form !== source.form) continue;
          if (!options.instant && item.fp && item.fp !== 'FY') continue;
          candidates.push({
            taxonomy,
            concept,
            label: fact.label || concept,
            description: fact.description || '',
            unit,
            value: Number(item.val),
            start: item.start || '',
            end: item.end || '',
            fy: item.fy || '',
            fp: item.fp || '',
            form: item.form || '',
            filed: item.filed || '',
            accn: item.accn || '',
          });
        }
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => scoreFact(b, source, options) - scoreFact(a, source, options));
  const best = candidates[0];
  return {
    ...best,
    status: 'Validated',
    confidence: scoreFact(best, source, options) >= 140 ? 0.94 : 0.82,
    evidence: {
      source: 'SEC XBRL companyfacts',
      document: source.documentName || source.primaryDocument,
      filingDate: source.filingDate,
      reportDate: source.reportDate,
      accessionNumber: best.accn || source.accessionNumber,
      concept: `${best.taxonomy}:${best.concept}`,
      label: best.label,
      period: best.end,
      unit: best.unit,
      url: source.factsUrl || source.documentUrl,
    },
  };
}

function unitMatches(unit, options) {
  if (options.units && options.units.length && !options.units.includes(unit)) return false;
  if (options.unitsLike === 'currency') return isCurrencyUnit(unit);
  if (options.unitsLike === 'perShare') return /per|\/shares?|USD\/shares?|EUR\/shares?/i.test(unit);
  if (options.unitsLike === 'shares') return /shares?/i.test(unit);
  return true;
}

function isCurrencyUnit(unit) {
  return /^[A-Z]{3}$/i.test(String(unit || ''));
}

function scoreFact(fact, source, options) {
  let score = 0;
  if (source.accessionNumber && fact.accn === source.accessionNumber) score += 90;
  if (source.reportDate && fact.end === source.reportDate) score += 70;
  if (fact.fp === 'FY') score += 30;
  if (fact.form === source.form) score += 20;
  if (options.instant && source.reportDate && fact.end === source.reportDate) score += 20;
  if (fact.filed) score += Math.min(Number(String(fact.filed).slice(0, 4)) || 0, 3000) / 100;
  return score;
}

function calculateFreeCashFlow(ocf, capex) {
  if (!ocf || !capex || !isFiniteNumber(ocf.value) || !isFiniteNumber(capex.value)) return null;
  return { value: ocf.value - Math.abs(capex.value) };
}

function calculatePercent(numerator, denominator) {
  if (!numerator || !denominator || !isFiniteNumber(numerator.value) || !isFiniteNumber(denominator.value) || denominator.value === 0) return null;
  return { value: Number(((numerator.value / denominator.value) * 100).toFixed(2)) };
}

function calculateRatio(numerator, denominator) {
  if (!numerator || !denominator || !isFiniteNumber(numerator.value) || !isFiniteNumber(denominator.value) || denominator.value === 0) return null;
  return { value: Number((numerator.value / denominator.value).toFixed(2)) };
}

function extractInsights(reportText, source, byName, reportingScope) {
  const fallbackText = trimForNarrativeScanning(reportText);
  const business = extractSection(reportText, [/item\s+1\.?\s+business/i, /item\s+4\.?\s+information\s+on\s+the\s+company/i, /business\s+overview/i], [/item\s+1a\.?\s+risk\s+factors/i, /item\s+3\.?\s*d\.?\s+risk\s+factors/i, /item\s+1b/i, /item\s+2/i, /item\s+5\.?\s+operating/i]);
  const risks = extractSection(reportText, [/item\s+1a\.?\s+risk\s+factors/i, /item\s+3\.?\s*d\.?\s+risk\s+factors/i, /risk\s+factors/i], [/item\s+1b/i, /item\s+2/i, /item\s+4\.?\s+information/i, /item\s+5\.?\s+operating/i, /item\s+7\.?\s+management/i]);
  const mda = extractSection(reportText, [/item\s+7\.?\s+management/i, /management'?s\s+discussion\s+and\s+analysis/i, /item\s+5\.?\s+operating\s+and\s+financial\s+review\s+and\s+prospects/i], [/item\s+7a/i, /item\s+8/i, /item\s+6\.?\s+directors/i]);

  return {
    businessSummary: summarizeBusiness(business || fallbackText, source, reportingScope),
    growthDrivers: selectInsightSentences(mda || business || fallbackText, source, 'MD&A / Operating and Financial Review / Business', ['increase', 'growth', 'demand', 'volume', 'pricing', 'price', 'sales', 'revenue', 'market', 'customer', 'product', 'capacity', 'acquisition'], 3),
    priorities: selectInsightSentences(business + ' ' + mda, source, 'Business / MD&A Strategy', ['strategy', 'strategic', 'priority', 'focus', 'invest', 'investment', 'expand', 'innovation', 'efficiency', 'capital allocation', 'cloud', 'ai', 'artificial intelligence'], 3),
    risks: selectInsightSentences(risks || fallbackText, source, 'Risk Factors', ['risk', 'may', 'could', 'adverse', 'competition', 'regulation', 'regulatory', 'depend', 'cybersecurity', 'supply', 'macroeconomic', 'litigation'], 3),
  };
}

function summarizeBusiness(text, source, reportingScope) {
  const sentences = splitSentences(text).filter((sentence) => sentence.length >= 80 && sentence.length <= 420);
  const selected = sentences
    .filter((sentence) => /we |company|business|products|services|customers|markets|segment|operates|provides|manufactures|develops/i.test(sentence))
    .slice(0, 3);
  if (!selected.length) return null;
  return {
    value: selected.slice(0, 3).join(' '),
    status: 'Validated',
    confidence: 0.74,
    evidence: textEvidence(source, 'Item 1 Business', selected[0]),
    notes: `Summary reflects the selected reporting basis: ${reportingScope.financialStatementBasis}.`,
  };
}

function selectInsightSentences(text, source, label, keywords, count) {
  const sentences = splitSentences(trimForNarrativeScanning(text)).filter((sentence) => sentence.length >= 70 && sentence.length <= 420);
  const scored = sentences.map((sentence) => {
    const lower = sentence.toLowerCase();
    const keywordScore = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    const numberScore = /\d/.test(sentence) ? 0.5 : 0;
    return { sentence, score: keywordScore + numberScore };
  }).filter((item) => item.score > 0);
  scored.sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length);
  const selected = uniqueSentences(scored.map((item) => item.sentence)).slice(0, count);
  if (!selected.length) return null;
  return {
    value: selected.map((sentence, index) => `${index + 1}) ${sentence}`).join('\n'),
    status: selected.length === count ? 'Validated' : HUMAN_REVIEW,
    confidence: selected.length === count ? 0.72 : 0.55,
    evidence: textEvidence(source, label, selected[0]),
    notes: selected.length === count ? 'Top passages ranked by challenge-specific keywords.' : `Only ${selected.length} supported passage(s) found; missing ranks require human review.`,
  };
}

function buildOneLineSnapshot(byName, insights, reportingScope) {
  const revenue = byName['Revenue / Turnover'];
  const growth = firstNumberedInsight(insights.growthDrivers && insights.growthDrivers.value);
  const risk = firstNumberedInsight(insights.risks && insights.risks.value);
  if (!revenue || !revenue.value || !growth || !risk) return null;
  const value = `Latest annual filing reports revenue of ${formatDisplayValue(revenue.value, 'Revenue / Turnover')}; management disclosure points to ${lowercaseFirst(growth)}; key disclosed risk is ${lowercaseFirst(risk)}`;
  return {
    value: value.replace(/\s+/g, ' ').trim(),
    status: 'Validated',
    confidence: 0.7,
    evidence: {
      source: 'Generated from validated snapshot fields and annual-report passages',
      reportingBasis: reportingScope.financialStatementBasis,
      revenueEvidence: revenue.evidence,
      growthEvidence: insights.growthDrivers.evidence,
      riskEvidence: insights.risks.evidence,
    },
  };
}

function firstNumberedInsight(value) {
  if (!value) return '';
  return String(value).split(/\n/)[0].replace(/^\d+\)\s*/, '').trim();
}

function lowercaseFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function extractSection(text, startPatterns, endPatterns) {
  const normalized = normalizeWhitespace(text);
  const candidates = [];
  for (const pattern of startPatterns) {
    const regex = new RegExp(pattern.source, `${pattern.flags.includes('i') ? 'i' : ''}g`);
    let match;
    while ((match = regex.exec(normalized))) {
      const start = match.index;
      let end = normalized.length;
      for (const endPattern of endPatterns) {
        const endRegex = new RegExp(endPattern.source, endPattern.flags.includes('i') ? 'i' : '');
        const tail = normalized.slice(start + 20);
        const endMatch = endRegex.exec(tail);
        if (endMatch) end = Math.min(end, start + 20 + endMatch.index);
      }
      const slice = normalized.slice(start, end);
      if (slice.length > 500) candidates.push(slice.slice(0, 160000));
    }
  }
  if (!candidates.length) return '';
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function splitSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.replace(/^item\s+\d+[a-z]?\.?\s*/i, '').trim())
    .filter((sentence) => sentence && !/^table of contents$/i.test(sentence));
}

function uniqueSentences(sentences) {
  const seen = new Set();
  const out = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
  }
  return out;
}

function htmlToText(html) {
  return normalizeWhitespace(trimHtmlForTextExtraction(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<ix:[^>]+>/gi, ' ')
    .replace(/<\/ix:[^>]+>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<\/p>/gi, '. ')
    .replace(/<\/div>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

function trimHtmlForTextExtraction(html) {
  const source = String(html || '');
  if (source.length <= 4_000_000) return source;
  const windows = [];
  const patterns = [
    /item\s+1\.?\s+business/ig,
    /item\s+1a\.?\s+risk\s+factors/ig,
    /item\s+3\.?\s*d\.?\s+risk\s+factors/ig,
    /item\s+4\.?\s+information\s+on\s+the\s+company/ig,
    /item\s+5\.?\s+operating\s+and\s+financial\s+review\s+and\s+prospects/ig,
    /management'?s\s+discussion\s+and\s+analysis/ig,
    /consolidated\s+financial\s+statements/ig,
    /basis\s+of\s+consolidation/ig,
    /subsidiar(y|ies|undertakings)/ig,
  ];
  let totalLength = 0;
  const maxTotalLength = 2_500_000;
  for (const pattern of patterns) {
    let match;
    let count = 0;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(source)) && count < 8) {
      const start = Math.max(0, match.index - 120000);
      const end = Math.min(source.length, match.index + 320000);
      const window = source.slice(start, end);
      windows.push(window);
      totalLength += window.length;
      if (totalLength >= maxTotalLength) break;
      count += 1;
    }
    if (totalLength >= maxTotalLength) break;
  }
  if (!windows.length) return `${source.slice(0, 1_000_000)} ${source.slice(-1_000_000)}`;
  return windows.join('\n');
}

function trimForNarrativeScanning(text) {
  const source = String(text || '');
  if (source.length <= 750000) return source;
  return `${source.slice(0, 500000)} ${source.slice(-250000)}`;
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function textEvidence(source, label, passage) {
  return {
    source: 'Latest annual report text',
    document: source.documentName || source.primaryDocument,
    filingDate: source.filingDate,
    reportDate: source.reportDate,
    accessionNumber: source.accessionNumber,
    sectionHeading: label,
    printedPage: 'Not verified',
    pdfPage: 'Not verified',
    label,
    passage: String(passage || '').slice(0, 700),
    url: source.documentUrl,
  };
}

function baseEvidence(source) {
  return {
    source: source ? source.sourceType : 'User Input',
    document: source ? source.documentName || source.primaryDocument : '',
    filingDate: source ? source.filingDate : '',
    reportDate: source ? source.reportDate : '',
    accessionNumber: source ? source.accessionNumber : '',
    printedPage: 'Not verified',
    pdfPage: 'Not verified',
    url: source ? source.documentUrl : '',
  };
}

function determineReportingScope(reportText, source, input) {
  const hasConsolidated = /consolidated\s+(financial\s+statements|statements\s+of|balance\s+sheets|statements\s+of\s+operations|statements\s+of\s+cash\s+flows|statement\s+of\s+financial\s+position)/i.test(reportText);
  const hasSubsidiaryEvidence = /subsidiar(y|ies)|basis\s+of\s+consolidation|consolidated\s+subsidiaries|group\s+structure|subsidiary\s+undertakings/i.test(reportText);
  const noSubsidiariesVerified = /(has|have)\s+no\s+subsidiar(y|ies)|no\s+subsidiar(y|ies)\s+(were|are)\s+disclosed|does\s+not\s+have\s+subsidiar(y|ies)/i.test(reportText);
  const evidenceMatch = reportText.match(/(.{0,160}(consolidated financial statements|basis of consolidation|subsidiar(?:y|ies)|group structure).{0,260})/i);

  let reportingEntity = 'Consolidated group';
  let financialStatementBasis = 'Consolidated';
  let subsidiaryStatus = 'Subsidiaries disclosed / consolidated information available';
  let status = 'Verified';
  let reason = MASTER_PROMPT_RULES.consolidatedFirst;

  if (hasConsolidated) {
    reportingEntity = 'Consolidated group';
    financialStatementBasis = 'Consolidated';
    subsidiaryStatus = hasSubsidiaryEvidence ? 'Subsidiaries disclosed / consolidated information available' : 'Consolidated statements available; subsidiary details not separately verified';
    status = 'Verified';
    reason = MASTER_PROMPT_RULES.consolidatedFirst;
  } else if (noSubsidiariesVerified) {
    reportingEntity = 'Parent company';
    financialStatementBasis = 'Standalone';
    subsidiaryStatus = 'No subsidiaries disclosed and verified';
    status = 'Verified';
    reason = MASTER_PROMPT_RULES.standaloneRestriction;
  } else {
    reportingEntity = 'Unverified';
    financialStatementBasis = 'Unverified — human review required';
    subsidiaryStatus = hasSubsidiaryEvidence ? 'Subsidiary evidence found but consolidated statements not verified' : 'Unable to verify';
    status = HUMAN_REVIEW;
    reason = 'Subsidiary status and consolidated statement availability could not be established from the downloaded text. Do not assume standalone data is acceptable.';
  }

  return {
    companyName: input.companyName,
    reportingEntity,
    financialStatementBasis,
    reasonForSelectingBasis: reason,
    subsidiaryStatus,
    scopeVerificationStatus: status,
    consistencyRule: MASTER_PROMPT_RULES.consistencyRule,
    evidence: {
      document: source.documentName || source.primaryDocument,
      filingDate: source.filingDate,
      sectionHeading: evidenceMatch ? 'Consolidation / subsidiary disclosure' : 'Not verified',
      printedPage: 'Not verified',
      pdfPage: 'Not verified',
      passage: evidenceMatch ? normalizeWhitespace(evidenceMatch[1]) : NOT_ESTABLISHED,
      url: source.documentUrl,
    },
  };
}

function applyMasterPromptFieldRules(field, reportingScope) {
  const next = { ...field };
  if (next.value === null || next.value === undefined || next.value === 'N/A' || next.value === '-' || next.value === 'null') {
    next.value = '';
    next.displayValue = '';
  }
  if ([NOT_AVAILABLE, HUMAN_REVIEW, NOT_FOUND].includes(next.status) && next.value === '') {
    next.displayValue = '';
  }
  next.reportingBasis = reportingScope.financialStatementBasis;
  next.scopeStatus = reportingScope.scopeVerificationStatus;
  if (reportingScope.scopeVerificationStatus === HUMAN_REVIEW && isFinancialDatapoint(next.datapoint)) {
    next.status = HUMAN_REVIEW;
    next.notes = `${next.notes || ''} Reporting scope is unverified; consolidated-first rule requires human review.`.trim();
  }
  return next;
}

function isFinancialDatapoint(datapoint) {
  return /Revenue|Profit|Income|EPS|Cash|CapEx|Flow|Debt|Assets|Equity|Margin|Shares/i.test(datapoint);
}

function buildSourceAnnotations(fields, source, reportingScope, insights) {
  const rows = fields.map((field) => ({
    Factor: sourceAnnotationFactor(field.datapoint),
    Claim: field.value ? `${field.datapoint}: ${field.displayValue || field.value}` : `${field.datapoint}: ${NOT_ESTABLISHED}`,
    'Document Name': source.documentName || source.primaryDocument || '',
    'Filing Date': source.filingDate || '',
    'Section Heading': field.evidence && (field.evidence.sectionHeading || field.evidence.label || field.evidence.source) || 'Not verified',
    'Printed Page': field.evidence && field.evidence.printedPage || 'Not verified',
    'PDF Page': field.evidence && field.evidence.pdfPage || 'Not verified',
    'Supporting Evidence': evidenceToText(field.evidence) || field.notes || NOT_ESTABLISHED,
    'Review Status': field.status || HUMAN_REVIEW,
  }));
  rows.unshift({
    Factor: 'Reporting Scope',
    Claim: `Financial Statement Basis: ${reportingScope.financialStatementBasis}; Subsidiary Status: ${reportingScope.subsidiaryStatus}`,
    'Document Name': source.documentName || source.primaryDocument || '',
    'Filing Date': source.filingDate || '',
    'Section Heading': reportingScope.evidence.sectionHeading,
    'Printed Page': reportingScope.evidence.printedPage,
    'PDF Page': reportingScope.evidence.pdfPage,
    'Supporting Evidence': reportingScope.evidence.passage,
    'Review Status': reportingScope.scopeVerificationStatus,
  });
  return rows;
}

function sourceAnnotationFactor(datapoint) {
  if (/Business Summary/i.test(datapoint)) return 'Business Summary';
  if (/Strategic Priorities/i.test(datapoint)) return 'Strategic Priorities';
  if (/Risks/i.test(datapoint)) return 'Key Risks';
  if (/Growth Drivers/i.test(datapoint)) return 'Growth Drivers';
  if (/Investment Snapshot/i.test(datapoint)) return 'Investment Consideration';
  return 'Financial Snapshot';
}

function buildFinalReport(input, source, reportingScope, fields, insights, sourceAnnotations) {
  const get = (name) => fields.find((field) => field.datapoint === name);
  const summary = get('Business Summary (2-3 sentences)');
  const priorities = get('Management Strategic Priorities (Top 3)');
  const risks = get('Key Risks Highlighted (Top 3)');
  const investment = get('One-Line Investment Snapshot');
  const growth = get('Primary Growth Drivers (Top 3)');
  const reviewWarnings = fields.filter((field) => [HUMAN_REVIEW, NOT_AVAILABLE, NOT_FOUND].includes(field.status)).map((field) => `${field.datapoint}: ${field.status}`);
  const confidence = reviewWarnings.length > 10 ? 'Low' : reviewWarnings.length > 4 ? 'Medium' : 'High';

  return {
    A_CompanyAndReportingScope: {
      companyName: input.companyName,
      ticker: input.ticker,
      financialYearAndLatestPeriod: source.reportDate || '',
      annualFilingTitle: source.documentName || source.primaryDocument || '',
      filingDate: source.filingDate || '',
      reportingEntity: reportingScope.reportingEntity,
      financialStatementBasis: reportingScope.financialStatementBasis,
      subsidiaryStatus: reportingScope.subsidiaryStatus,
      scopeEvidence: reportingScope.evidence,
      reportingCurrency: (get('Reporting Currency') || {}).value || '',
      reportingUnit: (get('Reporting Unit') || {}).value || '',
    },
    B_CoreBusinessSummary: summary && summary.value ? summary.value : NOT_ESTABLISHED,
    C_ManagementStrategicPrioritiesTop3: buildRankedNarrativeRows(priorities, 'Strategic Priority', 'Management\'s Stated Objective / Action', 'Strategic Rationale'),
    D_KeyRisksHighlightedTop3: buildRankedNarrativeRows(risks, 'Key Risk', 'Description', 'Potential Business / Financial Impact'),
    E_InvestorConsiderationSummary: {
      summary: investment && investment.value ? investment.value : NOT_ESTABLISHED,
      materialQualification: risks && risks.value ? firstNumberedInsight(risks.value) : NOT_ESTABLISHED,
      sourceReferences: investment ? evidenceToText(investment.evidence) : NOT_ESTABLISHED,
    },
    F_PrimaryGrowthDriversTop3: buildGrowthDriverRows(growth, source, get('Revenue / Turnover')),
    G_DetailedSourceAnnotation: sourceAnnotations,
    H_LimitationsConfidenceAndHumanReview: {
      limitations: [
        'Printed and PDF page numbers are Not verified for SEC HTML/XBRL sources unless a parsed PDF/page map is provided.',
        reportingScope.scopeVerificationStatus === HUMAN_REVIEW ? 'Subsidiary status or consolidated scope requires human review.' : '',
        ...reviewWarnings,
      ].filter(Boolean),
      overallConfidence: confidence,
      explanation: `Confidence is ${confidence} based on source availability, XBRL extraction coverage, annual-report text specificity, and human-review flags.`,
      qualityControl: MASTER_PROMPT_RULES,
      checklist: {
        consolidatedDataUsedWhenAvailable: reportingScope.financialStatementBasis === 'Consolidated',
        standaloneUsedOnlyWhenNoSubsidiariesVerified: reportingScope.financialStatementBasis !== 'Standalone' || reportingScope.subsidiaryStatus === 'No subsidiaries disclosed and verified',
        missingFactsFlaggedRatherThanInvented: true,
        printedAndPdfPagesNotInvented: true,
        sourceEvidenceRequiredForMaterialClaims: true,
      },
    },
  };
}

function buildRankedNarrativeRows(field, labelColumn, descriptionColumn, rationaleColumn) {
  const lines = field && field.value ? String(field.value).split(/\n/).filter(Boolean) : [];
  return [0, 1, 2].map((index) => {
    const text = lines[index] ? lines[index].replace(/^\d+\)\s*/, '') : NOT_ESTABLISHED;
    return {
      Rank: index + 1,
      [labelColumn]: text,
      [descriptionColumn]: text === NOT_ESTABLISHED ? NOT_ESTABLISHED : text,
      [rationaleColumn]: text === NOT_ESTABLISHED ? NOT_ESTABLISHED : 'Issuer-supported disclosure selected by prominence and keyword relevance; no unsupported analyst interpretation added.',
      'Source Section': field && field.evidence && (field.evidence.sectionHeading || field.evidence.label) || 'Not verified',
      'Printed Page': 'Not verified',
      'PDF Page': 'Not verified',
      'Review Status': lines[index] ? field.status : HUMAN_REVIEW,
    };
  });
}

function buildGrowthDriverRows(field, source, revenueField) {
  const lines = field && field.value ? String(field.value).split(/\n/).filter(Boolean) : [];
  return [0, 1, 2].map((index) => {
    const text = lines[index] ? lines[index].replace(/^\d+\)\s*/, '') : NOT_ESTABLISHED;
    return {
      Rank: index + 1,
      'Primary Growth Driver': text,
      'Latest Period Figure': revenueField && revenueField.value ? revenueField.displayValue || revenueField.value : '',
      'Comparative Prior-Year Figure': '',
      'Reported / Derived Change': text === NOT_ESTABLISHED ? NOT_ESTABLISHED : 'Contribution not quantified by the issuer.',
      'Issuer-Disclosed Explanation': text,
      'Historical / Forward-Looking': text === NOT_ESTABLISHED ? HUMAN_REVIEW : 'Historical or management-discussed; verify period comparability in filing.',
      Source: `${source.documentName || source.primaryDocument || ''}; filed ${source.filingDate || ''}; page Not verified`,
    };
  });
}

function normalizeReportType(form) {
  if (!form) return '';
  if (ANNUAL_FORMS.includes(form)) return `Annual (${form})`;
  if (/annual/i.test(form)) return form;
  return `${form} (${HUMAN_REVIEW})`;
}

function validateSnapshot(fields, source) {
  const counts = fields.reduce((acc, field) => {
    acc[field.status] = (acc[field.status] || 0) + 1;
    return acc;
  }, {});
  const warnings = [];
  if (!source) warnings.push('No annual-report source metadata available.');
  if (source && !source.latestAnnualOnly) warnings.push('Source was not marked as latest annual only.');
  for (const field of fields) {
    if (!field.status || field.status === NOT_AVAILABLE || field.status === HUMAN_REVIEW) warnings.push(`${field.datapoint}: ${field.status || HUMAN_REVIEW}`);
    if (['Extracted', 'Calculated', 'Validated'].includes(field.status) && !field.evidence) warnings.push(`${field.datapoint}: missing evidence object.`);
  }
  return { counts, warnings };
}

function buildExcelWorkbook(analysis) {
  const sourceRows = analysis.source ? Object.entries(analysis.source).map(([key, value]) => ({ Field: key, Value: stringifyCell(value) })) : [];
  const scopeRows = analysis.reportingScope ? Object.entries(analysis.reportingScope).map(([key, value]) => ({ Field: key, Value: stringifyCell(value) })) : [];
  const debtRows = analysis.debtComponents ? Object.entries(analysis.debtComponents).map(([component, item]) => ({
    Component: component,
    Label: item.label || component,
    Amount: item.value === '' || item.value == null ? '' : item.value,
    Unit: item.unit || '',
    Status: item.status || '',
    Evidence: evidenceToText(item.evidence),
    Notes: item.notes || '',
  })) : [];
  const finalReportRows = analysis.finalReport ? flattenFinalReport(analysis.finalReport) : [];
  const annotationRows = analysis.sourceAnnotations || [];
  const snapshotRows = (analysis.fields || []).map((field) => ({
    'Snapshot Header': field.section,
    '#': field.number,
    Datapoint: field.datapoint,
    'Standardization / Adjustment': field.adjustment,
    Value: field.value === '' || field.value == null ? '' : field.value,
    Status: field.status,
    Confidence: field.confidence,
    Evidence: evidenceToText(field.evidence),
    Notes: field.notes || '',
  }));
  const validationRows = [
    { Check: 'Latest annual report only', Result: analysis.source && analysis.source.latestAnnualOnly ? 'Pass' : HUMAN_REVIEW },
    { Check: 'Workflow status', Result: analysis.ok ? 'Complete' : 'Error / Review' },
    ...Object.entries(analysis.validation && analysis.validation.counts ? analysis.validation.counts : {}).map(([key, value]) => ({ Check: `Status count: ${key}`, Result: value })),
    ...((analysis.validation && analysis.validation.warnings) || []).map((warning) => ({ Check: 'Warning', Result: warning })),
  ];
  const stepRows = (analysis.steps || []).map((step) => ({ Step: step.label, Status: step.status, Message: step.message, Timestamp: step.timestamp || '' }));

  return htmlWorkbook([
    { name: 'Snapshot', rows: snapshotRows },
    { name: 'Final Report A-H', rows: finalReportRows },
    { name: 'Source Annotations', rows: annotationRows },
    { name: 'Scope Verification', rows: scopeRows },
    { name: 'Debt Components', rows: debtRows },
    { name: 'Source Metadata', rows: sourceRows },
    { name: 'Validation', rows: validationRows },
    { name: 'Workflow Log', rows: stepRows },
  ]);
}

function flattenFinalReport(finalReport) {
  const rows = [];
  for (const [section, value] of Object.entries(finalReport)) {
    if (section === 'G_DetailedSourceAnnotation') continue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [field, fieldValue] of Object.entries(value)) {
        rows.push({ Section: section, Field: field, Value: stringifyCell(fieldValue) });
      }
    } else {
      rows.push({ Section: section, Field: '', Value: stringifyCell(value) });
    }
  }
  return rows;
}

function htmlWorkbook(sheets) {
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; }
    h2 { color: #111827; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th { background: #111827; color: #fff; font-weight: 700; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; mso-number-format:"\\@"; }
  </style>
</head>
<body>
${sheets.map((sheet) => `<h2>${escapeHtml(sheet.name)}</h2>${objectTable(sheet.rows)}`).join('<br style="page-break-before:always" />')}
</body>
</html>`;
}

function objectTable(rows) {
  if (!rows || !rows.length) return '<table><tbody><tr><td>No data</td></tr></tbody></table>';
  const headers = Object.keys(rows[0]);
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function evidenceToText(evidence) {
  if (!evidence) return '';
  if (typeof evidence === 'string') return evidence;
  return Object.entries(evidence)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${stringifyCell(value)}`)
    .join(' | ');
}

function stringifyCell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDisplayValue(value, datapoint) {
  if (value === '' || value === null || value === undefined) return '';
  if (!isFiniteNumber(value)) return String(value);
  if (/%/.test(datapoint)) return `${Number(value).toFixed(2)}%`;
  if (/EPS|Debt-to-Equity/i.test(datapoint)) return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (/Shares/i.test(datapoint)) return Number(value).toLocaleString('en-US');
  if (/Revenue|Profit|Income|Cash|Debt|Assets|Equity|CapEx|Flow/i.test(datapoint)) return Number(value).toLocaleString('en-US');
  return String(value);
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeFileName(value) {
  return String(value || 'annual-report').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'annual-report';
}

module.exports = {
  ANNUAL_FORMS,
  MASTER_PROMPT_RULES,
  SNAPSHOT_FIELDS,
  analyzeCompany,
  buildExcelWorkbook,
  discoverLatestAnnualReport,
  parseSecAtomAnnualEntry,
  extractSnapshot,
  htmlToText,
  extractFinancialFacts,
};