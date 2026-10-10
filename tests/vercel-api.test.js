const assert = require('assert');
const health = require('../api/health');
const exportApi = require('../api/export');

function createReq(method, body) {
  return {
    method,
    body,
    on() {},
  };
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value = '') { this.body += value; },
  };
}

(async () => {
  const healthRes = createRes();
  await health(createReq('GET'), healthRes);
  assert.strictEqual(healthRes.statusCode, 200);
  assert.strictEqual(JSON.parse(healthRes.body).ok, true);

  const exportRes = createRes();
  await exportApi(createReq('POST', {
    analysis: {
      input: { ticker: 'TEST' },
      source: { sourceType: 'Unit Test', documentUrl: 'https://example.com/report.htm' },
      fields: [{ datapoint: 'Revenue / Turnover', value: 123, displayValue: '123', status: 'Validated', evidence: {} }],
      validation: { counts: { Validated: 1 }, warnings: [] },
      steps: [],
      sourceAnnotations: [],
      finalReport: {},
      reportingScope: {},
      debtComponents: {},
    },
  }), exportRes);
  assert.strictEqual(exportRes.statusCode, 200);
  assert.ok(exportRes.headers['content-type'].includes('application/vnd.ms-excel'));
  assert.ok(exportRes.body.includes('Revenue / Turnover'));

  console.log('Vercel API tests passed: health and POST export handlers are serverless-ready.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});