// =============================================================
// build-data.mjs
// Reads every data/Enrollment_*.xlsx file and regenerates
// src/lib/seedData.js (the data the dashboard displays).
//
// This runs automatically during `npm run build`, which is what
// GitHub Actions executes on every push. So the workflow is:
//   1. Add or replace an Excel file in the data/ folder
//   2. Commit / push
//   3. GitHub rebuilds and everyone sees the new data
//
// No filenames are hardcoded. Any file matching
// Enrollment_YYYY-MM-DD.xlsx is picked up automatically.
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSXns from 'xlsx';
const XLSX = XLSXns.default ?? XLSXns; // robust across Node ESM interop

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const outFile = path.join(root, 'src', 'lib', 'seedData.js');

const num = (v) => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);

function parseWorkbook(filePath, fileName) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const m = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  if (!m) throw new Error(`${fileName}: filename must contain a date like YYYY-MM-DD`);
  const fileDate = m[1];

  const a1 = String(grid[0]?.[0] || '');
  const hd = a1.match(/(\d{4}-\d{2}-\d{2})/);
  const headerDate = hd ? hd[1] : '';

  const ncols = Math.max(...grid.slice(0, 9).map(r => (r ? r.length : 0)));

  const dq = [];
  if (headerDate && headerDate !== fileDate) {
    dq.push(`Internal header says ${headerDate}; filename treated as authoritative`);
  }
  if (ncols < 10) dq.push('Target/Variance not recorded in source file; backfilled from known targets where available');
  else if (ncols < 11) dq.push('Buffer not recorded in source file');

  const rows = [];
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i];
    if (!r || !r[0]) continue;
    const program = String(r[0]).trim();
    const matTotal = ncols > 3 ? num(r[3]) : 0;
    const hasTarget = ncols > 8 && r[8] != null;
    const target = hasTarget ? num(r[8]) : null; // null = backfill later
    let variance = null;
    if (ncols > 9 && r[9] != null) variance = num(r[9]);
    rows.push({
      program,
      matSummer: ncols > 1 ? num(r[1]) : 0,
      matFall:   ncols > 2 ? num(r[2]) : 0,
      matTotal,
      admSummer: ncols > 4 ? num(r[4]) : 0,
      admFall:   ncols > 5 ? num(r[5]) : 0,
      admTotal:  ncols > 6 ? num(r[6]) : 0,
      target,
      variance,
      buffer: ncols > 10 && r[10] != null ? num(r[10]) : null,
    });
  }
  if (rows.length === 0) throw new Error(`${fileName}: no data rows found`);
  return { date: fileDate, sourceFile: fileName, dataQualityNote: dq.join('; '), rows };
}

// ---- read all files ----
const files = fs.readdirSync(dataDir)
  .filter(f => /^Enrollment_\d{4}-\d{2}-\d{2}\.xlsx?$/i.test(f))
  .sort();

if (files.length === 0) {
  console.error('No Enrollment_*.xlsx files found in data/. Aborting.');
  process.exit(1);
}

let snapshots;
try {
  snapshots = files.map(f => parseWorkbook(path.join(dataDir, f), f));
} catch (err) {
  console.error('\n[build-data] FAILED while reading Excel files:');
  console.error('  ' + err.message);
  console.error('Check that the file is a valid .xlsx and matches the standard template.\n');
  process.exit(1);
}
snapshots.sort((a, b) => a.date.localeCompare(b.date));

// ---- build a global target table from every file that recorded targets ----
// Targets are stable per program, so use the earliest recorded value, falling
// back to any recorded value, so early files missing targets can be backfilled.
const targetByProgram = {};
for (const s of snapshots) {
  for (const r of s.rows) {
    if (r.target != null && !(r.program in targetByProgram)) {
      targetByProgram[r.program] = r.target;
    }
  }
}

// ---- backfill missing targets and variances ----
for (const s of snapshots) {
  for (const r of s.rows) {
    if (r.target == null) r.target = targetByProgram[r.program] ?? 0;
    if (r.variance == null) r.variance = r.target ? r.matTotal - r.target : 0;
  }
}

// ---- write seedData.js ----
const fmtRow = (r) =>
  `    {program:${JSON.stringify(r.program)},matSummer:${r.matSummer},matFall:${r.matFall},` +
  `matTotal:${r.matTotal},admSummer:${r.admSummer},admFall:${r.admFall},admTotal:${r.admTotal},` +
  `target:${r.target},variance:${r.variance},buffer:${r.buffer === null ? 'null' : r.buffer}},`;

const body = snapshots.map(s =>
  `  {date:${JSON.stringify(s.date)},sourceFile:${JSON.stringify(s.sourceFile)},` +
  `dataQualityNote:${JSON.stringify(s.dataQualityNote)},rows:[\n${s.rows.map(fmtRow).join('\n')}\n  ]},`
).join('\n');

const header = `// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Regenerated by scripts/build-data.mjs from every data/Enrollment_*.xlsx file.
// To update the dashboard: add or replace an Excel file in the data/ folder,
// then commit and push. GitHub rebuilds and the change goes live.
// ${snapshots.length} snapshots, ${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}.

export const INITIAL_SNAPSHOTS = [
${body}
];
`;

fs.writeFileSync(outFile, header);
console.log(`Wrote ${snapshots.length} snapshots to src/lib/seedData.js`);
console.log(`Range: ${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}`);
console.log(`Targets table: ${JSON.stringify(targetByProgram)}`);
