const { analyzeCompany, setCors, sendJson, readJson } = require('./_utils');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, errors: ['Method not allowed'] });
    return;
  }
  try {
    const input = await readJson(req);
    const analysis = await analyzeCompany(input, { skipWrite: true });
    analysis.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sendJson(res, analysis.ok ? 200 : 422, analysis);
  } catch (error) {
    const status = /Invalid JSON|Missing required input/i.test(error.message) ? 400 : 500;
    sendJson(res, status, { ok: false, errors: [error.message] });
  }
};