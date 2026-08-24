import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, ReferenceLine, Cell
} from 'recharts';
import * as XLSX from 'xlsx';
import {
  Upload, AlertTriangle, TrendingDown, TrendingUp, RotateCcw,
  FileSpreadsheet, Users, Activity, Database, Trash2, Lock, Unlock, GraduationCap
} from 'lucide-react';
import { storage } from './lib/storage.js';
import { INITIAL_SNAPSHOTS } from './lib/seedData.js';
import { ADMIN_PASSWORD_HASH } from './config.js';

// SHA-256 hex via Web Crypto. Used to compare an entered password against
// the configured ADMIN_PASSWORD_HASH without ever transmitting plaintext.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ADMIN_PROTECTION_ENABLED = !!ADMIN_PASSWORD_HASH && ADMIN_PASSWORD_HASH.length === 64;



const PROGRAM_ORDER = ['APPH', 'AT', 'CNSM', 'HE MSED', 'HE EdD', 'SADM'];
const PROGRAM_COLORS = {
  'APPH': '#8B3A3A',
  'AT': '#1F4E40',
  'CNSM': '#1E3A5F',
  'HE MSED': '#6B4F8C',
  'HE EdD': '#8B6B14',
  'SADM': '#4A5A2C',
};

// ============================================================
// Excel parsing (client side, via SheetJS)
// ============================================================
function parseExcelFile(file, knownTargets = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        const m = file.name.match(/(\d{4}-\d{2}-\d{2})/);
        if (!m) {
          reject(new Error(`Filename must contain a date in YYYY-MM-DD format. Example: Enrollment_2026-06-05.xlsx`));
          return;
        }
        const fileDate = m[1];

        const a1 = String(grid[0]?.[0] || '');
        const hdMatch = a1.match(/(\d{4}-\d{2}-\d{2})/);
        const headerDate = hdMatch ? hdMatch[1] : '';

        // Detect column count by inspecting the widest row
        const ncols = Math.max(...grid.slice(0, 9).map(r => r ? r.length : 0));

        const dqParts = [];
        if (headerDate && headerDate !== fileDate) {
          dqParts.push(`Internal header says ${headerDate}; filename treated as authoritative`);
        }
        if (ncols < 10) {
          dqParts.push('Target/Variance not recorded in source file; backfilled from known targets where available');
        } else if (ncols < 11) {
          dqParts.push('Buffer not recorded in source file');
        }

        const num = (v) => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);

        const rows = [];
        for (let i = 2; i < grid.length; i++) {
          const r = grid[i];
          if (!r || !r[0]) continue;
          const program = String(r[0]).trim();
          const matTotal = ncols > 3 ? num(r[3]) : 0;
          let target = ncols > 8 && r[8] != null ? num(r[8]) : (knownTargets[program] || 0);
          let variance;
          if (ncols > 9 && r[9] != null) {
            variance = num(r[9]);
          } else {
            variance = target ? matTotal - target : 0;
          }
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
        if (rows.length === 0) {
          reject(new Error('No data rows found. Check the file structure matches the standard enrollment template.'));
          return;
        }
        resolve({ date: fileDate, sourceFile: file.name, dataQualityNote: dqParts.join('; '), rows });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ============================================================
// Helpers
// ============================================================
const fmtDate = (s) => {
  const d = new Date(s + 'T00:00:00');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthAbbr[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const fmtShortDate = (s) => {
  const d = new Date(s + 'T00:00:00');
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthAbbr[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

// ============================================================
// Sub components
// ============================================================
function StatCard({ label, value, sublabel, accent, icon: Icon }) {
  return (
    <div className="bg-white border border-stone-200 p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent || '#1E2A44' }} />
      <div className="flex items-start justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.15em] text-stone-500 font-medium">{label}</div>
        {Icon && <Icon size={14} className="text-stone-400" strokeWidth={1.5} />}
      </div>
      <div className="font-serif text-3xl text-stone-900 leading-none mb-1" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
        {value}
      </div>
      {sublabel && (
        <div className="text-xs text-stone-500 mt-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

function VarianceBadge({ value }) {
  if (value === 0 || value == null) {
    return <span className="text-stone-400 text-xs">on target</span>;
  }
  const positive = value > 0;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium"
      style={{
        background: positive ? '#E8EEDA' : '#F5DBDB',
        color: positive ? '#3D5023' : '#8B2635',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {positive ? <TrendingUp size={11} strokeWidth={2} /> : <TrendingDown size={11} strokeWidth={2} />}
      {positive ? '+' : ''}{value}
    </span>
  );
}

// ============================================================
// Main dashboard
// ============================================================
export default function EnrollmentDashboard() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState('matTotal');
  // Admin state. If protection is disabled (no hash configured), default to
  // false so the management UI is hidden from public viewers.
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [checkingPassword, setCheckingPassword] = useState(false);

  // Load from storage on mount; merge with INITIAL_SNAPSHOTS so any new
  // historical data added across dashboard versions gets included, while
  // user uploads in storage are preserved (storage wins on conflict).
  useEffect(() => {
    let cancelled = false;
    async function init() {
      // The data/ folder is the single source of truth. scripts/build-data.mjs
      // converts every data/Enrollment_*.xlsx file into INITIAL_SNAPSHOTS at
      // build time, so whatever is in the data folder is exactly what every
      // visitor sees. No browser storage merge, so there is no per-device drift.
      try {
        const loaded = [...INITIAL_SNAPSHOTS].sort((a, b) => a.date.localeCompare(b.date));
        let storageWorks = false;
        try { await storage.list('snapshot:'); storageWorks = true; } catch (e) { storageWorks = false; }
        if (!cancelled) {
          setSnapshots(loaded);
          setStorageReady(storageWorks);
        }
      } catch (e) {
        if (!cancelled) {
          setSnapshots([...INITIAL_SNAPSHOTS]);
          setStorageReady(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Restore admin state from sessionStorage on mount. sessionStorage clears
  // on browser close, so closing the tab effectively logs out. That's more
  // secure than localStorage for a shared device.
  useEffect(() => {
    if (!ADMIN_PROTECTION_ENABLED) return;
    try {
      if (sessionStorage.getItem('edash:admin') === '1') {
        setIsAdmin(true);
      }
    } catch {}
  }, []);

  const tryLogin = useCallback(async () => {
    if (!passwordInput) return;
    setCheckingPassword(true);
    setLoginError('');
    try {
      const entered = await sha256Hex(passwordInput);
      if (entered === ADMIN_PASSWORD_HASH.toLowerCase()) {
        setIsAdmin(true);
        try { sessionStorage.setItem('edash:admin', '1'); } catch {}
        setShowLoginModal(false);
        setPasswordInput('');
      } else {
        setLoginError('Incorrect password');
        // Tiny delay to discourage rapid retries
        await new Promise(r => setTimeout(r, 400));
      }
    } catch (e) {
      setLoginError('Could not verify password. Your browser may not support the Web Crypto API.');
    } finally {
      setCheckingPassword(false);
    }
  }, [passwordInput]);

  const logout = useCallback(() => {
    setIsAdmin(false);
    try { sessionStorage.removeItem('edash:admin'); } catch {}
  }, []);

  const handleFiles = useCallback(async (fileList) => {
    setUploadError('');
    setUploadSuccess('');
    const files = Array.from(fileList).filter(f => /\.xlsx?$/.test(f.name));
    if (files.length === 0) {
      setUploadError('Please upload .xlsx files');
      return;
    }
    // Build known targets from the most recent snapshot that has them,
    // so old-schema uploads can backfill target/variance.
    const knownTargets = {};
    for (let i = snapshots.length - 1; i >= 0 && Object.keys(knownTargets).length < 10; i--) {
      for (const r of snapshots[i].rows) {
        if (r.target && !(r.program in knownTargets)) {
          knownTargets[r.program] = r.target;
        }
      }
    }
    let added = 0, replaced = 0, errors = [];
    const next = [...snapshots];
    for (const file of files) {
      try {
        const snap = await parseExcelFile(file, knownTargets);
        const existingIdx = next.findIndex(s => s.date === snap.date);
        if (existingIdx >= 0) {
          next[existingIdx] = snap;
          replaced++;
        } else {
          next.push(snap);
          added++;
        }
        try { await storage.set(`snapshot:${snap.date}`, JSON.stringify(snap)); } catch {}
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }
    next.sort((a, b) => a.date.localeCompare(b.date));
    setSnapshots(next);
    const parts = [];
    if (added) parts.push(`${added} new snapshot${added > 1 ? 's' : ''} added`);
    if (replaced) parts.push(`${replaced} existing snapshot${replaced > 1 ? 's' : ''} updated`);
    if (parts.length) setUploadSuccess(parts.join(', '));
    if (errors.length) setUploadError(errors.join(' | '));
  }, [snapshots]);

  const removeSnapshot = useCallback(async (date) => {
    if (!confirm(`Remove snapshot ${fmtDate(date)}?`)) return;
    try { await storage.delete(`snapshot:${date}`); } catch {}
    setSnapshots(prev => prev.filter(s => s.date !== date));
  }, []);

  const resetToInitial = useCallback(async () => {
    if (!confirm('Reset all data to the original four uploaded snapshots? Any added snapshots will be removed.')) return;
    try {
      const result = await storage.list('snapshot:');
      if (result?.keys) {
        for (const key of result.keys) {
          try { await storage.delete(key); } catch {}
        }
      }
      for (const snap of INITIAL_SNAPSHOTS) {
        try { await storage.set(`snapshot:${snap.date}`, JSON.stringify(snap)); } catch {}
      }
    } catch {}
    setSnapshots([...INITIAL_SNAPSHOTS]);
    setUploadSuccess('Reset to initial four snapshots');
    setUploadError('');
  }, []);

  // Derived: latest snapshot
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  // KPIs from latest Total row
  const totalRow = latest?.rows.find(r => r.program === 'Total');
  const prevTotalRow = previous?.rows.find(r => r.program === 'Total');
  const matMomentum = totalRow && prevTotalRow ? totalRow.matTotal - prevTotalRow.matTotal : 0;

  // Trend data: one row per snapshot date, one column per program (matTotal by default)
  const trendData = useMemo(() => {
    const metricKey = selectedMetric;
    return snapshots.map(s => {
      const row = { date: s.date, _label: fmtShortDate(s.date) };
      for (const prog of PROGRAM_ORDER) {
        const r = s.rows.find(rr => rr.program === prog);
        row[prog] = r ? r[metricKey] : 0;
      }
      const tot = s.rows.find(rr => rr.program === 'Total');
      row['Total'] = tot ? tot[metricKey] : 0;
      return row;
    });
  }, [snapshots, selectedMetric]);

  // Change analysis: latest vs previous, per program, key metrics
  const changeRows = useMemo(() => {
    if (!latest || !previous) return [];
    return PROGRAM_ORDER.concat(['Total']).map(prog => {
      const cur = latest.rows.find(r => r.program === prog);
      const prv = previous.rows.find(r => r.program === prog);
      if (!cur || !prv) return null;
      return {
        program: prog,
        matTotal: cur.matTotal - prv.matTotal,
        matSummer: cur.matSummer - prv.matSummer,
        matFall: cur.matFall - prv.matFall,
        admTotal: cur.admTotal - prv.admTotal,
        variance: cur.variance - prv.variance,
      };
    }).filter(Boolean);
  }, [latest, previous]);

  // Variance bar data
  const varianceData = useMemo(() => {
    if (!latest) return [];
    return PROGRAM_ORDER.map(p => {
      const r = latest.rows.find(x => x.program === p);
      return r ? { program: p, variance: r.variance, target: r.target, matriculated: r.matTotal } : null;
    }).filter(Boolean);
  }, [latest]);

  // Data quality alerts
  const dqAlerts = snapshots.filter(s => s.dataQualityNote);

  // Melt detection: any program where matTotal dropped between consecutive snapshots
  const meltEvents = useMemo(() => {
    const events = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const cur = snapshots[i];
      for (const prog of PROGRAM_ORDER) {
        const a = prev.rows.find(r => r.program === prog);
        const b = cur.rows.find(r => r.program === prog);
        if (!a || !b) continue;
        const delta = b.matTotal - a.matTotal;
        if (delta < 0) {
          events.push({
            program: prog,
            fromDate: prev.date,
            toDate: cur.date,
            delta,
            from: a.matTotal,
            to: b.matTotal,
          });
        }
      }
    }
    return events.sort((x, y) => y.toDate.localeCompare(x.toDate) || x.delta - y.delta);
  }, [snapshots]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F7F2E8' }}>
        <div className="text-stone-500 text-sm">Loading enrollment data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#F7F2E8', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <style>{`
        .tabular { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
        .display { font-family: 'Fraunces', Georgia, serif; }
      `}</style>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="mb-8 pb-6" style={{ borderBottom: '1px solid #D4C9B0' }}>
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 mb-2 font-medium">
                Enrollment Intelligence
              </div>
              <h1 className="display text-4xl text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, letterSpacing: '-0.02em' }}>
                FY27 Matriculation Tracker
              </h1>
            </div>
            <div className="flex items-start gap-4">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.15em] text-stone-500 mb-1">As of</div>
                <div className="display text-xl text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
                  {latest ? fmtDate(latest.date) : 'No data'}
                </div>
                <div className="text-xs text-stone-500 mt-1 tabular">
                  {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} tracked
                </div>
              </div>
              {ADMIN_PROTECTION_ENABLED && (
                isAdmin ? (
                  <button
                    onClick={logout}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-700 hover:text-stone-900 transition-colors"
                    style={{ background: '#E8EEDA', border: '1px solid #C8D4A8' }}
                    title="You are signed in as admin. Click to lock again."
                  >
                    <Unlock size={12} strokeWidth={2} />
                    <span className="font-medium">Admin</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowLoginModal(true); setLoginError(''); setPasswordInput(''); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-500 hover:text-stone-800 transition-colors"
                    style={{ background: 'transparent', border: '1px solid #D4C9B0' }}
                    title="Unlock management features"
                  >
                    <Lock size={12} strokeWidth={1.5} />
                  </button>
                )
              )}
            </div>
          </div>

          {dqAlerts.length > 0 && (
            <div className="mt-4 flex items-start gap-2 px-3 py-2" style={{ background: '#FBF3D9', borderLeft: '3px solid #B8860B' }}>
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#8B6B14' }} />
              <div className="text-xs text-stone-700">
                <span className="font-medium">Data quality:</span>{' '}
                {dqAlerts.length} snapshot{dqAlerts.length > 1 ? 's have' : ' has'} a mismatch between filename date and internal header date. Filename treated as authoritative.
              </div>
            </div>
          )}
        </header>

        {/* KPI Strip */}
        {totalRow && (
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
            <StatCard
              label="Matriculated"
              value={<span className="tabular">{totalRow.matTotal}</span>}
              sublabel={
                <span>
                  of <span className="tabular">{totalRow.target}</span> target {' '}
                  <VarianceBadge value={totalRow.variance} />
                </span>
              }
              accent="#1E2A44"
              icon={Users}
            />
            <StatCard
              label="Enrolled"
              value={<span className="tabular">{totalRow.enrTotal ?? '—'}</span>}
              sublabel={
                totalRow.enrTotal != null ? (
                  <span>
                    of <span className="tabular">{totalRow.target}</span> target {' '}
                    <VarianceBadge value={totalRow.varEnr} />
                  </span>
                ) : 'not tracked this snapshot'
              }
              accent="#3D5023"
              icon={GraduationCap}
            />
            <StatCard
              label="Pending Applicants"
              value={<span className="tabular">{totalRow.admTotal}</span>}
              sublabel="admitted, decision pending"
              accent="#8B6B14"
              icon={Activity}
            />
            <StatCard
              label="Period Momentum"
              value={
                <span className="tabular" style={{ color: matMomentum < 0 ? '#8B2635' : matMomentum > 0 ? '#3D5023' : '#1E2A44' }}>
                  {matMomentum > 0 ? '+' : ''}{matMomentum}
                </span>
              }
              sublabel={previous ? `vs ${fmtShortDate(previous.date)}` : 'no prior snapshot'}
              accent={matMomentum < 0 ? '#8B2635' : '#3D5023'}
              icon={matMomentum < 0 ? TrendingDown : TrendingUp}
            />
            <StatCard
              label="Melt Events"
              value={<span className="tabular">{meltEvents.length}</span>}
              sublabel="program drops detected"
              accent="#8B2635"
              icon={AlertTriangle}
            />
          </section>
        )}

        {/* Current state table + Trend chart side by side */}
        <section className="grid lg:grid-cols-5 gap-6 mb-8">
          <div className="lg:col-span-3 bg-white border border-stone-200">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid #E8E0CC' }}>
              <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                Current State by Program
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">Snapshot of {latest ? fmtDate(latest.date) : ''}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-stone-500" style={{ borderBottom: '1px solid #E8E0CC' }}>
                    <th className="px-4 py-2.5 text-left font-medium">Program</th>
                    <th className="px-2 py-2.5 text-right font-medium">Summer</th>
                    <th className="px-2 py-2.5 text-right font-medium">Fall</th>
                    <th className="px-2 py-2.5 text-right font-medium">Matric.</th>
                    <th className="px-2 py-2.5 text-right font-medium">Enrolled</th>
                    <th className="px-2 py-2.5 text-right font-medium">Pending</th>
                    <th className="px-2 py-2.5 text-right font-medium">Target</th>
                    <th className="px-4 py-2.5 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {latest && latest.rows.filter(r => r.program !== 'Total').map(r => (
                    <tr key={r.program} className="hover:bg-stone-50" style={{ borderBottom: '1px solid #F0E9D6' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-4" style={{ background: PROGRAM_COLORS[r.program] || '#1E2A44' }} />
                          <span className="font-medium text-stone-900">{r.program}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right tabular text-stone-700">{r.matSummer}</td>
                      <td className="px-2 py-3 text-right tabular text-stone-700">{r.matFall}</td>
                      <td className="px-2 py-3 text-right tabular font-medium text-stone-900">{r.matTotal}</td>
                      <td className="px-2 py-3 text-right tabular text-stone-700">{r.enrTotal ?? '—'}</td>
                      <td className="px-2 py-3 text-right tabular text-stone-700">{r.admTotal}</td>
                      <td className="px-2 py-3 text-right tabular text-stone-500">{r.target}</td>
                      <td className="px-4 py-3 text-right">
                        <VarianceBadge value={r.variance} />
                      </td>
                    </tr>
                  ))}
                  {totalRow && (
                    <tr style={{ background: '#FAF6EC', borderTop: '2px solid #1E2A44' }}>
                      <td className="px-4 py-3 font-semibold text-stone-900">Total</td>
                      <td className="px-2 py-3 text-right tabular font-medium">{totalRow.matSummer}</td>
                      <td className="px-2 py-3 text-right tabular font-medium">{totalRow.matFall}</td>
                      <td className="px-2 py-3 text-right tabular font-semibold">{totalRow.matTotal}</td>
                      <td className="px-2 py-3 text-right tabular font-medium">{totalRow.enrTotal ?? '—'}</td>
                      <td className="px-2 py-3 text-right tabular font-medium">{totalRow.admTotal}</td>
                      <td className="px-2 py-3 text-right tabular">{totalRow.target}</td>
                      <td className="px-4 py-3 text-right"><VarianceBadge value={totalRow.variance} /></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white border border-stone-200">
            <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid #E8E0CC' }}>
              <div>
                <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                  Variance vs Target
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">Latest snapshot</p>
              </div>
            </div>
            <div className="p-3" style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={varianceData} layout="vertical" margin={{ top: 10, right: 30, left: 50, bottom: 5 }}>
                  <CartesianGrid horizontal={false} stroke="#E8E0CC" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#78716C' }} axisLine={{ stroke: '#D4C9B0' }} />
                  <YAxis type="category" dataKey="program" tick={{ fontSize: 11, fill: '#44403C', fontFamily: 'IBM Plex Sans' }} axisLine={{ stroke: '#D4C9B0' }} width={70} />
                  <Tooltip
                    contentStyle={{ background: '#FFFFFF', border: '1px solid #D4C9B0', fontSize: 12 }}
                    formatter={(v) => [v, 'Variance']}
                  />
                  <ReferenceLine x={0} stroke="#1E2A44" strokeWidth={1.5} />
                  <Bar dataKey="variance" radius={0}>
                    {varianceData.map((d, i) => (
                      <Cell key={i} fill={d.variance < 0 ? '#8B2635' : d.variance > 0 ? '#3D5023' : '#78716C'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Trend chart */}
        <section className="bg-white border border-stone-200 mb-8">
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: '1px solid #E8E0CC' }}>
            <div>
              <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                Longitudinal Trend by Program
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Each line is one program across all snapshots. Downward slopes signal melt.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs">
              {[
                { key: 'matTotal', label: 'Matriculated' },
                { key: 'enrTotal', label: 'Enrolled' },
                { key: 'admTotal', label: 'Pending Applicants' },
                { key: 'variance', label: 'Variance' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSelectedMetric(opt.key)}
                  className="px-3 py-1.5 transition-colors"
                  style={{
                    background: selectedMetric === opt.key ? '#1E2A44' : 'transparent',
                    color: selectedMetric === opt.key ? '#FFFFFF' : '#57534E',
                    border: '1px solid ' + (selectedMetric === opt.key ? '#1E2A44' : '#D4C9B0'),
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4" style={{ height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#E8E0CC" />
                <XAxis
                  dataKey="_label"
                  tick={{ fontSize: 10, fill: '#57534E' }}
                  axisLine={{ stroke: '#D4C9B0' }}
                  angle={-40}
                  textAnchor="end"
                  height={50}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11, fill: '#57534E' }} axisLine={{ stroke: '#D4C9B0' }} />
                <Tooltip
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #D4C9B0', fontSize: 12 }}
                  labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} iconType="line" />
                {selectedMetric === 'variance' && (
                  <ReferenceLine y={0} stroke="#1E2A44" strokeWidth={1} strokeDasharray="3 3" />
                )}
                {PROGRAM_ORDER.map(prog => (
                  <Line
                    key={prog}
                    type="monotone"
                    dataKey={prog}
                    stroke={PROGRAM_COLORS[prog]}
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0, fill: PROGRAM_COLORS[prog] }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Change analysis */}
        {changeRows.length > 0 && (
          <section className="bg-white border border-stone-200 mb-8">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid #E8E0CC' }}>
              <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                Period over Period Change
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Movement from {fmtDate(previous.date)} to {fmtDate(latest.date)}. Negative on Matriculated rows indicates melt.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-stone-500" style={{ borderBottom: '1px solid #E8E0CC' }}>
                    <th className="px-4 py-2.5 text-left font-medium">Program</th>
                    <th className="px-3 py-2.5 text-right font-medium">Δ Matric. Total</th>
                    <th className="px-3 py-2.5 text-right font-medium">Δ Summer</th>
                    <th className="px-3 py-2.5 text-right font-medium">Δ Fall</th>
                    <th className="px-3 py-2.5 text-right font-medium">Δ Pending</th>
                    <th className="px-4 py-2.5 text-right font-medium">Δ Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {changeRows.map(r => (
                    <tr key={r.program} className={r.program === 'Total' ? '' : 'hover:bg-stone-50'}
                        style={{
                          borderBottom: '1px solid #F0E9D6',
                          background: r.program === 'Total' ? '#FAF6EC' : 'transparent',
                          borderTop: r.program === 'Total' ? '2px solid #1E2A44' : 'none',
                        }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {r.program !== 'Total' && (
                            <div className="w-1 h-4" style={{ background: PROGRAM_COLORS[r.program] }} />
                          )}
                          <span className={r.program === 'Total' ? 'font-semibold text-stone-900' : 'font-medium text-stone-900'}>
                            {r.program}
                          </span>
                        </div>
                      </td>
                      {['matTotal', 'matSummer', 'matFall', 'admTotal', 'variance'].map(k => {
                        const v = r[k];
                        const color = v < 0 ? '#8B2635' : v > 0 ? '#3D5023' : '#A8A29E';
                        return (
                          <td key={k} className="px-3 py-3 text-right tabular" style={{ color, fontWeight: v !== 0 ? 500 : 400 }}>
                            {v > 0 ? '+' : ''}{v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Melt log */}
        {meltEvents.length > 0 && (
          <section className="bg-white border border-stone-200 mb-8">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid #E8E0CC' }}>
              <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                Melt Event Log
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Every recorded decrease in matriculated count between consecutive snapshots, most recent first.
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-[10px] uppercase tracking-wider text-stone-500" style={{ borderBottom: '1px solid #E8E0CC' }}>
                    <th className="px-4 py-2.5 text-left font-medium">Program</th>
                    <th className="px-3 py-2.5 text-left font-medium">Period</th>
                    <th className="px-3 py-2.5 text-right font-medium">From</th>
                    <th className="px-3 py-2.5 text-right font-medium">To</th>
                    <th className="px-4 py-2.5 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {meltEvents.map((e, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F0E9D6' }}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-4" style={{ background: PROGRAM_COLORS[e.program] }} />
                          <span className="font-medium text-stone-900">{e.program}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-stone-600 text-xs">
                        {fmtShortDate(e.fromDate)} to {fmtShortDate(e.toDate)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-stone-500">{e.from}</td>
                      <td className="px-3 py-2.5 text-right tabular text-stone-700">{e.to}</td>
                      <td className="px-4 py-2.5 text-right tabular font-medium" style={{ color: '#8B2635' }}>
                        {e.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Data management (admin only when protection is enabled) */}
        {(!ADMIN_PROTECTION_ENABLED || isAdmin) && (
        <section className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Upload zone */}
          <div className="bg-white border border-stone-200">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid #E8E0CC' }}>
              <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                Add New Snapshot
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Drop an Enrollment_YYYY-MM-DD.xlsx file. Same date overwrites; new date appends.
              </p>
            </div>
            <div className="p-5">
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFiles(e.dataTransfer.files);
                }}
                className="block cursor-pointer transition-colors p-8 text-center"
                style={{
                  border: '2px dashed ' + (dragOver ? '#1E2A44' : '#D4C9B0'),
                  background: dragOver ? '#F0EBD9' : '#FAF6EC',
                }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <Upload size={28} className="mx-auto mb-3" style={{ color: '#8B7355' }} strokeWidth={1.5} />
                <div className="text-sm text-stone-700 font-medium mb-1">
                  Drop files here or click to browse
                </div>
                <div className="text-xs text-stone-500">
                  Accepts multiple .xlsx files. Parses in your browser; nothing leaves the page.
                </div>
              </label>
              {uploadError && (
                <div className="mt-3 px-3 py-2 text-xs" style={{ background: '#F5DBDB', color: '#8B2635', borderLeft: '3px solid #8B2635' }}>
                  {uploadError}
                </div>
              )}
              {uploadSuccess && (
                <div className="mt-3 px-3 py-2 text-xs" style={{ background: '#E8EEDA', color: '#3D5023', borderLeft: '3px solid #3D5023' }}>
                  {uploadSuccess}
                </div>
              )}
            </div>
          </div>

          {/* Snapshot list */}
          <div className="bg-white border border-stone-200">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E8E0CC' }}>
              <div>
                <h2 className="display text-lg text-stone-900" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                  Snapshot Archive
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  {storageReady ? 'Persisted across sessions' : 'Session only (storage unavailable)'}
                </p>
              </div>
              <button
                onClick={resetToInitial}
                className="text-xs text-stone-500 hover:text-stone-800 flex items-center gap-1.5 px-2 py-1 transition-colors"
                title="Restore initial four snapshots"
              >
                <RotateCcw size={12} strokeWidth={1.5} />
                Reset
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {snapshots.length === 0 ? (
                <div className="p-5 text-sm text-stone-500">No snapshots yet. Upload one above.</div>
              ) : (
                <ul>
                  {[...snapshots].reverse().map((s, idx) => (
                    <li
                      key={s.date}
                      className="px-5 py-3 flex items-center justify-between hover:bg-stone-50"
                      style={{ borderBottom: '1px solid #F0E9D6' }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileSpreadsheet size={14} className="text-stone-400 flex-shrink-0" strokeWidth={1.5} />
                        <div className="min-w-0">
                          <div className="text-sm text-stone-900 font-medium">
                            {fmtDate(s.date)}
                            {idx === 0 && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: '#1E2A44', color: '#FFF' }}>
                                Latest
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-stone-500 truncate">{s.sourceFile}</div>
                          {s.dataQualityNote && (
                            <div className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: '#8B6B14' }}>
                              <AlertTriangle size={10} strokeWidth={2} />
                              {s.dataQualityNote}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => removeSnapshot(s.date)}
                        className="ml-3 text-stone-400 hover:text-stone-800 p-1 flex-shrink-0"
                        title="Remove this snapshot"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
        )}

        {/* Footer note */}
        <footer className="text-center text-xs text-stone-500 mt-12 pt-6" style={{ borderTop: '1px solid #D4C9B0' }}>
          <div className="flex items-center justify-center gap-2 mb-2">
            <Database size={11} strokeWidth={1.5} />
            <span>
              Long format snapshot store with {snapshots.length * (snapshots[0]?.rows.length || 0)} observations across {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="text-stone-400">
            Data comes from the Excel files in the repository data folder. Add a new file there and commit to update the live dashboard for everyone.
          </div>
        </footer>
      </div>

      {/* Password modal */}
      {showLoginModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(30, 26, 18, 0.45)' }}
          onClick={() => setShowLoginModal(false)}
        >
          <div
            className="bg-white max-w-sm w-full p-6"
            style={{ border: '1px solid #D4C9B0', boxShadow: '0 20px 40px rgba(30, 26, 18, 0.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Lock size={14} strokeWidth={1.5} style={{ color: '#1E2A44' }} />
              <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-medium">
                Admin Access
              </div>
            </div>
            <h3 className="display text-xl text-stone-900 mb-4" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
              Enter password
            </h3>
            <form onSubmit={(e) => { e.preventDefault(); tryLogin(); }}>
              <input
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setLoginError(''); }}
                className="w-full px-3 py-2.5 mb-3 text-sm focus:outline-none"
                style={{
                  background: '#FAF6EC',
                  border: '1px solid ' + (loginError ? '#8B2635' : '#D4C9B0'),
                  fontFamily: 'IBM Plex Sans, sans-serif',
                }}
                placeholder="Password"
                disabled={checkingPassword}
              />
              {loginError && (
                <div className="text-xs mb-3" style={{ color: '#8B2635' }}>
                  {loginError}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!passwordInput || checkingPassword}
                  className="px-4 py-2 text-sm font-medium text-white transition-opacity"
                  style={{ background: '#1E2A44', opacity: (!passwordInput || checkingPassword) ? 0.5 : 1 }}
                >
                  {checkingPassword ? 'Checking...' : 'Unlock'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
            <div className="text-[11px] text-stone-500 mt-4 leading-relaxed">
              Admin access unlocks the upload and snapshot archive sections. Session ends when you close the browser tab.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
