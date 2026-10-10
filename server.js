const http = require('http');
const fs = require('fs');
const path = require('path');
const { analyzeCompany, buildExcelWorkbook } = require('./automation');

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const latestAnalysisById = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleAnalyze(req, res) {
  try {
    const body = await readBody(req);
    let input;
    try {
      input = JSON.parse(body || '{}');
    } catch (error) {
      sendJson(res, 400, { ok: false, errors: ['Invalid JSON request body.'] });
      return;
    }
    const analysis = await analyzeCompany(input, { outputDir: path.join(root, 'downloads') });
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    analysis.id = id;
    latestAnalysisById.set(id, analysis);
    sendJson(res, analysis.ok ? 200 : 422, analysis);
  } catch (error) {
    sendJson(res, 500, { ok: false, errors: [error.message] });
  }
}

async function handleExport(req, res) {
  try {
    let analysis = null;
    if (req.method === 'POST') {
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (error) {
        sendJson(res, 400, { ok: false, errors: ['Invalid JSON request body.'] });
        return;
      }
      analysis = payload.analysis || payload;
    } else {
      const parsed = new URL(req.url, `http://${req.headers.host}`);
      const id = parsed.searchParams.get('id');
      analysis = latestAnalysisById.get(id);
    }

    if (!analysis) {
      sendJson(res, 404, { ok: false, errors: ['Analysis not found. Run Analyze first, then export the current analysis.'] });
      return;
    }

    const workbook = buildExcelWorkbook(analysis);
    const ticker = (analysis.input && analysis.input.ticker) || 'company';
    const date = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ticker}_Annual_Report_Snapshot_${date}.xls"`,
      'Cache-Control': 'no-store',
    });
    res.end(workbook);
  } catch (error) {
    sendJson(res, 500, { ok: false, errors: [error.message] });
  }
}

function handleStatic(req, res) {
  const requestedPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestedPath.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, errors: [`API route not found: ${requestedPath}`] });
    return;
  }

  const safePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
  const routePath = parsed.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'GET' && routePath === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      status: 'ready',
      service: 'AI Shark Tank Annual Report Automation',
      workflow: 'Discover -> Download -> Extract -> Calculate -> Validate -> Generate',
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST' && routePath === '/api/analyze') {
    await handleAnalyze(req, res);
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && routePath === '/api/export') {
    await handleExport(req, res);
    return;
  }

  if (req.method === 'GET') {
    handleStatic(req, res);
    return;
  }

  sendJson(res, 405, { ok: false, errors: ['Method not allowed'] });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`AI Shark Tank Annual Report Automation running at http://localhost:${port}`);
    console.log('Enter company name, ticker, sector and industry, then run Analyze.');
    console.log('Press Ctrl+C to stop.');
  });
}

module.exports = { createServer };
