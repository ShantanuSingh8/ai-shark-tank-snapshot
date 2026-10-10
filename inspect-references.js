const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const referencesDir = path.join(root, 'references');
const extractedDir = path.join(root, 'extracted');

const sourceFiles = [
  {
    name: 'Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx',
    candidates: [
      path.join(root, 'Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx'),
      path.join(referencesDir, 'Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx'),
      'C:\\Users\\ssingh5\\Downloads\\Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx',
      'C:\\Users\\ssingh5\\Desktop\\Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx',
      'C:\\Users\\ssingh5\\Documents\\Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx',
    ],
  },
  {
    name: 'Training Template.xlsx',
    candidates: [
      path.join(root, 'Training Template.xlsx'),
      path.join(referencesDir, 'Training Template.xlsx'),
      'C:\\Users\\ssingh5\\Downloads\\Training Template.xlsx',
      'C:\\Users\\ssingh5\\Desktop\\Training Template.xlsx',
      'C:\\Users\\ssingh5\\Documents\\Training Template.xlsx',
    ],
  },
  {
    name: 'Training 82 companies.xlsx',
    candidates: [
      path.join(root, 'Training 82 companies.xlsx'),
      path.join(referencesDir, 'Training 82 companies.xlsx'),
      'C:\\Users\\ssingh5\\Downloads\\Training 82 companies.xlsx',
      'C:\\Users\\ssingh5\\Desktop\\Training 82 companies.xlsx',
      'C:\\Users\\ssingh5\\Documents\\Training 82 companies.xlsx',
    ],
  },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyReferences() {
  ensureDir(referencesDir);
  const found = [];
  const missing = [];

  for (const file of sourceFiles) {
    const source = file.candidates.find((candidate) => fs.existsSync(candidate));
    if (!source) {
      missing.push(file.name);
      continue;
    }
    const destination = path.join(referencesDir, file.name);
    if (path.resolve(source) !== path.resolve(destination)) {
      fs.copyFileSync(source, destination);
    }
    found.push({ name: file.name, path: destination, bytes: fs.statSync(destination).size });
  }

  return { found, missing };
}

function expandArchive(file, destination) {
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  ensureDir(destination);
  const zipCopy = path.join(extractedDir, `${path.basename(file)}.zip`);
  fs.copyFileSync(file, zipCopy);
  execFileSync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
  ], { stdio: 'pipe' });
  fs.rmSync(zipCopy, { force: true });
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPptxText(pptxPath) {
  const destination = path.join(extractedDir, 'brief');
  expandArchive(pptxPath, destination);
  const slidesDir = path.join(destination, 'ppt', 'slides');
  const files = fs.readdirSync(slidesDir)
    .filter((file) => /^slide\d+\.xml$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const slides = files.map((file) => {
    const xml = fs.readFileSync(path.join(slidesDir, file), 'utf8');
    const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeXml(match[1]))
      .filter(Boolean);
    return { file, texts };
  });

  return slides;
}

function extractWorkbookSheets(xlsxPath, label) {
  const destination = path.join(extractedDir, label);
  expandArchive(xlsxPath, destination);
  const xlDir = path.join(destination, 'xl');
  const workbookPath = path.join(xlDir, 'workbook.xml');
  const relsPath = path.join(xlDir, '_rels', 'workbook.xml.rels');
  if (!fs.existsSync(workbookPath) || !fs.existsSync(relsPath)) return [];

  const sharedStringsPath = path.join(xlDir, 'sharedStrings.xml');
  let sharedStrings = [];
  if (fs.existsSync(sharedStringsPath)) {
    const xml = fs.readFileSync(sharedStringsPath, 'utf8');
    sharedStrings = Array.from(xml.matchAll(/<si[\s\S]*?<\/si>/g)).map((match) => {
      return Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
        .map((part) => decodeXml(part[1]))
        .join('');
    });
  }

  const workbookXml = fs.readFileSync(workbookPath, 'utf8');
  const relsXml = fs.readFileSync(relsPath, 'utf8');
  const relMap = {};
  for (const match of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[match[1]] = match[2];
  }

  const sheets = Array.from(workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*sheetId="([^"]+)"[^>]*r:id="([^"]+)"/g))
    .map((match) => ({ name: decodeXml(match[1]), sheetId: match[2], rid: match[3] }));

  function cellValue(cellXml) {
    const type = (cellXml.match(/\st="([^"]+)"/) || [])[1];
    const value = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
    const inlineValue = (cellXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/) || [])[1];
    if (type === 's') return sharedStrings[Number(value)] || '';
    if (type === 'inlineStr') return decodeXml(inlineValue || '');
    return decodeXml(value);
  }

  return sheets.map((sheet) => {
    const target = relMap[sheet.rid];
    const normalizedTarget = target.replace(/^\.\.\//, '');
    const sheetPath = path.join(xlDir, normalizedTarget);
    const xml = fs.readFileSync(sheetPath, 'utf8');
    const rows = Array.from(xml.matchAll(/<row[^>]*r="([^"]+)"[^>]*>([\s\S]*?)<\/row>/g))
      .slice(0, 40)
      .map((rowMatch) => {
        const cells = Array.from(rowMatch[2].matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)).map((cellMatch) => cellValue(cellMatch[0]));
        return { row: Number(rowMatch[1]), cells };
      });
    return { name: sheet.name, path: normalizedTarget, rows };
  });
}

function main() {
  ensureDir(extractedDir);
  const copied = copyReferences();
  const output = { copied, pptSlides: [], workbooks: {} };

  const pptx = path.join(referencesDir, 'Public_Equity_AI_Snapshot_Challenge_Participant_Brief 2.pptx');
  if (fs.existsSync(pptx)) output.pptSlides = extractPptxText(pptx);

  const template = path.join(referencesDir, 'Training Template.xlsx');
  if (fs.existsSync(template)) output.workbooks.template = extractWorkbookSheets(template, 'template');

  const training = path.join(referencesDir, 'Training 82 companies.xlsx');
  if (fs.existsSync(training)) output.workbooks.training82 = extractWorkbookSheets(training, 'training82');

  const jsonPath = path.join(extractedDir, 'reference-summary.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));

  const textPath = path.join(extractedDir, 'reference-summary.txt');
  const lines = [];
  lines.push('FOUND REFERENCES');
  for (const item of output.copied.found) lines.push(`- ${item.name} (${item.bytes} bytes): ${item.path}`);
  if (output.copied.missing.length) {
    lines.push('MISSING REFERENCES');
    for (const item of output.copied.missing) lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('PPT SLIDES');
  for (const slide of output.pptSlides) {
    lines.push(`--- ${slide.file} ---`);
    for (const text of slide.texts) lines.push(text);
  }
  lines.push('');
  lines.push('WORKBOOKS');
  for (const [name, sheets] of Object.entries(output.workbooks)) {
    lines.push(`=== ${name} ===`);
    for (const sheet of sheets) {
      lines.push(`--- ${sheet.name} (${sheet.path}) ---`);
      for (const row of sheet.rows) lines.push(`${row.row}: ${row.cells.join(' | ')}`);
    }
  }
  fs.writeFileSync(textPath, lines.join('\n'));
  console.log(textPath);
}

main();