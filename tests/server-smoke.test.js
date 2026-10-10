const assert = require('assert');
const http = require('http');
const { createServer } = require('../server');

const port = 4181;

function request(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const server = createServer();

  try {
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    await wait(100);

    const home = await request('GET', '/');
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('Run End-to-End Analysis'));
    assert.ok(home.body.includes('Checking backend'), 'UI must not claim local server is ready before /api/health succeeds');

    const health = await request('GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.ok(health.headers['content-type'].includes('application/json'));
    assert.strictEqual(JSON.parse(health.body).ok, true);

    const missing = await request('GET', '/api/missing');
    assert.strictEqual(missing.status, 404);
    assert.ok(missing.headers['content-type'].includes('application/json'));
    assert.ok(JSON.parse(missing.body).errors[0].includes('API route not found'));

    const analyze = await request('POST', '/api/analyze/', JSON.stringify({ companyName: '', ticker: '', sector: '', industry: '' }));
    assert.strictEqual(analyze.status, 422);
    assert.ok(analyze.headers['content-type'].includes('application/json'));
    assert.ok(JSON.parse(analyze.body).errors[0].includes('Missing required input'));

    console.log('Server smoke tests passed: UI loads, /api/health works, API 404 is JSON, and /api/analyze/ trailing slash is handled.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});