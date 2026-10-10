const { setCors, sendJson } = require('./_utils');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, errors: ['Method not allowed'] });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    status: 'ready',
    service: 'AI Shark Tank Annual Report Automation',
    workflow: 'Discover -> Download -> Extract -> Calculate -> Validate -> Generate',
    runtime: 'vercel-serverless',
    generatedAt: new Date().toISOString(),
  });
};