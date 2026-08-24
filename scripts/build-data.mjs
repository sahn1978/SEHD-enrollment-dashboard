// =============================================================
// build-data.mjs
// Reads every data/Enrollment_*.xlsx file and regenerates
// src/lib/seedData.js (the data the dashboard displays).
//
// Runs automatically during `npm run build`, which GitHub Actions
// executes on every push. Workflow to update the dashboard:
//   1. Add or replace an Excel file in the data/ folder
//   2. Commit / push
//   3. GitHub rebuilds and everyone sees the new data
//
// The parser reads by the HEADER LABELS in the header row, not by
// column position. So it does not matter which column a value lands
// in: as long as the header text is recognizable, it is read
// correctly. This keeps old files and new files (with the added
// Enrolled columns) working from one code path.
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

const num = (v) => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
const norm = (h) => String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// Map a header cell to a known field. Order matters: the more specific
// "admitted but not matriculated" checks run before the plain
// "matriculated" checks, because the former contains the latter.
function classify(h) {
  const s = norm(h);
  if (!s) return null;
  if (s.includes('admitted but not matriculated (summer)')) return 'admSummer';
  if (s.includes('admitted but not matriculated (fall)'))   return 'admFall';
  if (s.includes('total admitted but not matriculated'))    return 'admTotal';
  if (s.includes('total matriculated'))                     return 'matTotal';
  if (s.includes('matriculated (summer)'))                  return 'matSummer';
  if (s.includes('matriculated (fall)'))                    return 'matFall';
  if (s.includes('total enrolled'))                         return 'enrTotal';
  if (s.includes('enrolled (summer)'))                      return 'enrSummer';
  if (s.includes('enrolled (fall)'))                        return 'enrFall';
  if (s.includes('variance') && s.includes('enrolled'))     return 'varEnr';
  if (s.includes('target'))                                 return 'target';
  if (s.includes('variance'))                               return 'variance'; // from matriculated
  if (s.includes('buffer'))                                 return 'buffer';
  return null;
}

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

  // Find the header row: within the first 5 rows, the one with the most
  // recognizable header labels.
  let headerRowIdx = 1, best = -1;
  for (let i = 0; i < Math.min(5, grid.length); i++) {
    const count = (grid[i] || []).filter(c => classify(c)).length;
    if (count > best) { best = count; headerRowIdx = i; }
  }
  const colOf = {};
  (grid[headerRowIdx] || []).forEach((h, idx) => {
    const f = classify(h);
    if (f && !(f in colOf)) colOf[f] = idx;
  });
  if (!('matTotal' in colOf) && !('matSummer' in colOf)) {
    throw new Error(`${fileName}: could not find the Matriculated columns. Check the header row labels.`);
  }

  const val = (r, field) => {
    if (!(field in colOf)) return null;
    return num(r[colOf[field]]);
  };

  const dq = [];
  if (headerDate && headerDate !== fileDate) {
    dq.push(`Internal header date ${headerDate} differs from filename; filename used`);
  }
  const hasEnrolled = ['enrSummer', 'enrFall', 'enrTotal'].some(k => k in colOf);
  if (!hasEnrolled) dq.push('Enrolled not tracked in this file');
  if (!('target' in colOf)) dq.push('Target not recorded; backfilled where possible');

  const rows = [];
  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || r[0] == null || String(r[0]).trim() === '') continue;
    const program = String(r[0]).trim();

    const matSummer = val(r, 'matSummer') ?? 0;
    const matFall   = val(r, 'matFall') ?? 0;
    let   matTotal  = val(r, 'matTotal');
    if (matTotal == null) matTotal = matSummer + matFall;

    let enrSummer = val(r, 'enrSummer');
    let enrFall   = val(r, 'enrFall');
    let enrTotal  = val(r, 'enrTotal');
    if (enrTotal == null && (enrSummer != null || enrFall != null)) {
      enrTotal = (enrSummer ?? 0) + (enrFall ?? 0);
    }

    const admSummer = val(r, 'admSummer') ?? 0;
    const admFall   = val(r, 'admFall') ?? 0;
    let   admTotal  = val(r, 'admTotal');
    if (admTotal == null) admTotal = admSummer + admFall;

    const target   = val(r, 'target');   // may be null, backfilled below
    let   variance = val(r, 'variance');  // variance from matriculated
    let   varEnr   = val(r, 'varEnr');    // variance to target from enrolled
    const buffer   = val(r, 'buffer');

    rows.push({
      program, matSummer, matFall, matTotal,
      enrSummer, enrFall, enrTotal,
      admSummer, admFall, admTotal,
      target, variance, varEnr, buffer,
    });
  }
  if (rows.length === 0) throw new Error(`${fileName}: no data rows found`);
  return { date: fileDate, sourceFile: fileName, dataQualityNote: dq.join('; '), rows };
}

// ---- read all files ----
const files = fs.readdirSync(dataDir)
  .filter(f => /^Enrollment_\d{4}-\d{2}-\d{2}\.xlsx?$/i.test(f))
  .sort();
if (files.length === 0) { console.error('No Enrollment_*.xlsx files found in data/. Aborting.'); process.exit(1); }

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

// ---- build a stable target table, then backfill missing targets/variances ----
const targetByProgram = {};
for (const s of snapshots) for (const r of s.rows) {
  if (r.target != null && !(r.program in targetByProgram)) targetByProgram[r.program] = r.target;
}
for (const s of snapshots) for (const r of s.rows) {
  if (r.target == null) r.target = targetByProgram[r.program] ?? 0;
  if (r.variance == null) r.variance = r.target ? r.matTotal - r.target : 0;
  // Enrolled variance = enrolled total minus target, only where enrolled exists.
  if (r.varEnr == null && r.enrTotal != null) r.varEnr = r.target ? r.enrTotal - r.target : 0;
}

// ---- write seedData.js ----
const j = (v) => (v === null || v === undefined) ? 'null' : v;
const fmtRow = (r) =>
  `    {program:${JSON.stringify(r.program)},matSummer:${j(r.matSummer)},matFall:${j(r.matFall)},matTotal:${j(r.matTotal)},` +
  `enrSummer:${j(r.enrSummer)},enrFall:${j(r.enrFall)},enrTotal:${j(r.enrTotal)},` +
  `admSummer:${j(r.admSummer)},admFall:${j(r.admFall)},admTotal:${j(r.admTotal)},` +
  `target:${j(r.target)},variance:${j(r.variance)},varEnr:${j(r.varEnr)},buffer:${j(r.buffer)}},`;

const body = snapshots.map(s =>
  `  {date:${JSON.stringify(s.date)},sourceFile:${JSON.stringify(s.sourceFile)},` +
  `dataQualityNote:${JSON.stringify(s.dataQualityNote)},rows:[\n${s.rows.map(fmtRow).join('\n')}\n  ]},`
).join('\n');

const enrolledCount = snapshots.filter(s => s.rows.some(r => r.enrTotal != null)).length;
const header = `// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Regenerated by scripts/build-data.mjs from every data/Enrollment_*.xlsx file.
// To update the dashboard: add or replace an Excel file in the data/ folder,
// then commit and push. GitHub rebuilds and the change goes live.
// ${snapshots.length} snapshots, ${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}.
// ${enrolledCount} of them include Enrolled tracking.

export const INITIAL_SNAPSHOTS = [
${body}
];
`;

fs.writeFileSync(outFile, header);
console.log(`Wrote ${snapshots.length} snapshots to src/lib/seedData.js`);
console.log(`Range: ${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}`);
console.log(`Snapshots with Enrolled data: ${enrolledCount}`);
console.log(`Targets: ${JSON.stringify(targetByProgram)}`);
