const { buildExcelWorkbook, setCors, sendJson, readJson } = require('./_utils');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, errors: ['Use POST /api/export with the current analysis payload on Vercel.'] });
    return;
  }
  try {
    const payload = await readJson(req);
    const analysis = payload.analysis || payload;
    if (!analysis || !Array.isArray(analysis.fields)) {
      sendJson(res, 400, { ok: false, errors: ['Missing analysis payload. Run Analyze first.'] });
      return;
    }
    const workbook = buildExcelWorkbook(analysis);
    const ticker = (analysis.input && analysis.input.ticker) || 'company';
    const date = new Date().toISOString().slice(0, 10);
    setCors(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ticker}_Annual_Report_Snapshot_${date}.xls"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(workbook);
  } catch (error) {
    sendJson(res, 500, { ok: false, errors: [error.message] });
  }
};