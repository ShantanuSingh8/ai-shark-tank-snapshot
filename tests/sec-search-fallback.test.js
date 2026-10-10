const assert = require('assert');
const { discoverLatestAnnualReport, parseSecAtomAnnualEntry } = require('../automation');

function responseJson(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function responseText(payload, ok = true, status = 200, contentType = 'text/html') {
  return {
    ok,
    status,
    headers: { get: () => contentType },
    json: async () => JSON.parse(payload),
    text: async () => payload,
  };
}

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <title>20-F - Banco Santander, S.A. (0000891478)</title>
    <updated>2026-02-27T12:00:00-05:00</updated>
    <filing-href>https://www.sec.gov/Archives/edgar/data/891478/000095010326002590/0000950103-26-002590-index.htm</filing-href>
    <filing-type>20-F</filing-type>
    <filing-date>2026-02-27</filing-date>
    <accession-number>0000950103-26-002590</accession-number>
    <cik>0000891478</cik>
    <conformed-name>BANCO SANTANDER, S.A.</conformed-name>
  </entry>
</feed>`;

const filingIndexHtml = `
  <html><body>
    <table>
      <tr><td><a href="/Archives/edgar/data/891478/000095010326002590/FilingSummary.xml">FilingSummary.xml</a></td><td>EX-101.INS</td></tr>
      <tr><td><a href="/Archives/edgar/data/891478/000095010326002590/san-20251231.htm">san-20251231.htm</a></td><td>20-F</td></tr>
    </table>
  </body></html>
`;

async function fallbackMockFetch(url) {
  if (url.endsWith('/company_tickers.json')) return responseJson({}, false, 503);
  if (url.includes('/cgi-bin/browse-edgar') && url.includes('type=20-F')) return responseText(atom, true, 200, 'application/atom+xml');
  if (url.endsWith('/0000950103-26-002590-index.htm')) return responseText(filingIndexHtml);
  throw new Error(`Unexpected fallback URL: ${url}`);
}

(async () => {
  const parsed = parseSecAtomAnnualEntry(atom, '20-F');
  assert.strictEqual(parsed.form, '20-F');
  assert.strictEqual(parsed.cik, '0000891478');
  assert.strictEqual(parsed.filingDate, '2026-02-27');
  assert.strictEqual(parsed.documentUrl, '', 'Atom index URL should not be treated as the primary filing document');

  const discovered = await discoverLatestAnnualReport({
    companyName: 'Banco Santander SA',
    ticker: 'SAN',
    sector: 'Financial Services',
    industry: 'Banks - Diversified',
  }, { fetchImpl: fallbackMockFetch });

  assert.strictEqual(discovered.sourceType, 'SEC EDGAR Search');
  assert.strictEqual(discovered.form, '20-F');
  assert.strictEqual(discovered.cik, '0000891478');
  assert.strictEqual(discovered.primaryDocument, 'san-20251231.htm');
  assert.strictEqual(discovered.documentUrl, 'https://www.sec.gov/Archives/edgar/data/891478/000095010326002590/san-20251231.htm');
  assert.ok(discovered.notes.includes('Initial ticker registry issue'), 'Fallback should preserve the original ticker registry failure context');

  console.log('SEC search fallback tests passed: Atom discovery resolves the primary annual filing document.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});