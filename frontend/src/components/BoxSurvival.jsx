const API_ROOT = import.meta.env.VITE_API_ROOT || "";
import React, { useMemo, useState } from 'react';
import { Upload, Settings, BarChart3, Activity } from 'lucide-react';

const API = `${API_ROOT}/api/box`;
const ALL = '__ALL__';
const PERIODS = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];

function fmt(n, d = 1) { return n === undefined || n === null || Number.isNaN(n) ? '-' : Number(n).toFixed(d); }

function BoxPlotChart({ data = [] }) {
  const [hover, setHover] = useState(null);
  const width = Math.max(620, Math.min(1100, data.length * 90));
  const height = 360;
  const margin = { top: 25, right: 25, bottom: 80, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxY = Math.max(10, ...data.flatMap(d => [d.max || 0, d.whiskerHigh || 0, ...(d.outliers || [])])) * 1.08;
  const y = v => margin.top + innerH - (Number(v || 0) / maxY) * innerH;
  const x = i => margin.left + (i + 0.5) * (innerW / Math.max(data.length, 1));
  const boxW = Math.max(24, Math.min(50, innerW / Math.max(data.length, 1) * 0.45));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxY * t));

  return <div className="svg-scroll">
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width={width} height={height} fill="white" />
      {ticks.map(t => <g key={t}>
        <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke="#dbe3ef" strokeDasharray="3 3" />
        <text x={margin.left - 12} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#475569">{t}</text>
      </g>)}
      <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#94a3b8" />
      <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#94a3b8" />
      <text transform={`translate(18 ${margin.top + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize="13" fill="#334155">Duration (minutes)</text>
      {data.map((d, i) => {
        const cx = x(i), q1 = y(d.q1), q3 = y(d.q3), med = y(d.median), low = y(d.whiskerLow), high = y(d.whiskerHigh);
        return <g key={d.period} onMouseEnter={() => setHover({ d, x: cx, y: q3 })} onMouseLeave={() => setHover(null)}>
          <line x1={cx} x2={cx} y1={high} y2={low} stroke="#334155" strokeWidth="2" />
          <line x1={cx - boxW / 3} x2={cx + boxW / 3} y1={high} y2={high} stroke="#334155" strokeWidth="2" />
          <line x1={cx - boxW / 3} x2={cx + boxW / 3} y1={low} y2={low} stroke="#334155" strokeWidth="2" />
          <rect x={cx - boxW / 2} y={q3} width={boxW} height={Math.max(3, q1 - q3)} fill="#dbeafe" stroke="#1d4ed8" strokeWidth="2" rx="4" />
          <line x1={cx - boxW / 2} x2={cx + boxW / 2} y1={med} y2={med} stroke="#1e3a8a" strokeWidth="3" />
          {(d.outliers || []).map((v, j) => <circle key={j} cx={cx} cy={y(v)} r="4" fill="#dc2626" />)}
          <text x={cx} y={height - margin.bottom + 24} textAnchor="end" transform={`rotate(-35 ${cx} ${height - margin.bottom + 24})`} fontSize="12" fill="#334155">{d.period}</text>
        </g>;
      })}
      {hover && <g>
        <rect x={Math.min(hover.x + 10, width - 210)} y={Math.max(8, hover.y - 40)} width="190" height="118" rx="8" fill="#0f172a" opacity="0.92" />
        <text x={Math.min(hover.x + 22, width - 198)} y={Math.max(28, hover.y - 20)} fontSize="12" fill="white">{hover.d.period} | n={hover.d.count}</text>
        <text x={Math.min(hover.x + 22, width - 198)} y={Math.max(48, hover.y)} fontSize="12" fill="white">Q1: {fmt(hover.d.q1)}  Median: {fmt(hover.d.median)}</text>
        <text x={Math.min(hover.x + 22, width - 198)} y={Math.max(68, hover.y + 20)} fontSize="12" fill="white">Q3: {fmt(hover.d.q3)}</text>
        <text x={Math.min(hover.x + 22, width - 198)} y={Math.max(88, hover.y + 40)} fontSize="12" fill="white">Whisker: {fmt(hover.d.whiskerLow)} - {fmt(hover.d.whiskerHigh)}</text>
        <text x={Math.min(hover.x + 22, width - 198)} y={Math.max(108, hover.y + 60)} fontSize="12" fill="white">Min/Max: {fmt(hover.d.min)} - {fmt(hover.d.max)}</text>
      </g>}
    </svg>
  </div>;
}

function SurvivalCurveChart({ data = [] }) {
  const [hover, setHover] = useState(null);
  const points = data
    .map(d => ({ time: Number(d.time), survival: Number(d.survival), atRisk: d.atRisk, events: d.events }))
    .filter(d => Number.isFinite(d.time) && Number.isFinite(d.survival))
    .sort((a, b) => a.time - b.time);

  if (!points.length) {
    return <div className="empty">No survival curve data available.</div>;
  }

  const width = 900;
  const height = 360;
  const margin = { top: 24, right: 28, bottom: 58, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxTime = Math.max(1, ...points.map(p => p.time));
  const x = t => margin.left + (Number(t || 0) / maxTime) * innerW;
  const y = s => margin.top + innerH - Math.max(0, Math.min(1, Number(s || 0))) * innerH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxTime * t));

  const stepPath = points.reduce((path, point, index) => {
    const px = x(point.time);
    const py = y(point.survival);
    if (index === 0) return `M ${px} ${py}`;
    const prev = points[index - 1];
    return `${path} H ${px} V ${py}`;
  }, '');
  const areaPath = `${stepPath} L ${x(points[points.length - 1].time)} ${y(0)} L ${x(points[0].time)} ${y(0)} Z`;

  return <div className="svg-scroll">
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width={width} height={height} fill="white" />
      {yTicks.map(t => <g key={t}>
        <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke="#dbe3ef" strokeDasharray="3 3" />
        <text x={margin.left - 12} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#475569">{Math.round(t * 100)}%</text>
      </g>)}
      {xTicks.map(t => <g key={t}>
        <line x1={x(t)} x2={x(t)} y1={margin.top} y2={height - margin.bottom} stroke="#eef2f7" />
        <text x={x(t)} y={height - margin.bottom + 24} textAnchor="middle" fontSize="12" fill="#475569">{t}</text>
      </g>)}
      <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#94a3b8" />
      <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#94a3b8" />
      <text transform={`translate(20 ${margin.top + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize="13" fill="#334155">Probability still delayed</text>
      <text x={margin.left + innerW / 2} y={height - 14} textAnchor="middle" fontSize="13" fill="#334155">Duration minutes</text>
      <path d={areaPath} fill="#bfdbfe" opacity="0.45" />
      <path d={stepPath} fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={`${p.time}-${i}`} cx={x(p.time)} cy={y(p.survival)} r="4" fill="#1d4ed8" onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} />)}
      {hover && <g>
        <rect x={Math.min(x(hover.time) + 12, width - 230)} y={Math.max(8, y(hover.survival) - 42)} width="210" height="86" rx="8" fill="#0f172a" opacity="0.92" />
        <text x={Math.min(x(hover.time) + 24, width - 218)} y={Math.max(30, y(hover.survival) - 18)} fontSize="12" fill="white">Duration: {fmt(hover.time)} min</text>
        <text x={Math.min(x(hover.time) + 24, width - 218)} y={Math.max(50, y(hover.survival) + 2)} fontSize="12" fill="white">Survival: {fmt(hover.survival * 100)}%</text>
        <text x={Math.min(x(hover.time) + 24, width - 218)} y={Math.max(70, y(hover.survival) + 22)} fontSize="12" fill="white">At risk: {hover.atRisk} | Events: {hover.events}</text>
      </g>}
    </svg>
  </div>;
}

function BoxSurvival() {
  const [upload, setUpload] = useState(null);
  const [mapping, setMapping] = useState({});
  const [meta, setMeta] = useState({ agencies: [], categories: [] });
  const [filters, setFilters] = useState({ agency: ALL, category: ALL, period: 'month' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function uploadFile(file) {
    setError(''); setLoading(true);
    const form = new FormData(); form.append('file', file);
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed');
      const data = await res.json();
      setUpload(data);
      const m = { dateColumn: data.mapping.date, durationColumn: data.mapping.duration, agencyColumn: data.mapping.agency, categoryColumn: data.mapping.category };
      setMapping(m);
      await loadMetadata(data.datasetId, m);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function loadMetadata(datasetId = upload?.datasetId, m = mapping) {
    if (!datasetId) return;
    const body = { datasetId, ...m, period: filters.period };
    const res = await fetch(`${API}/metadata`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).detail || 'Metadata failed');
    const data = await res.json();
    setMeta(data);
    setFilters(f => ({ ...f, agency: ALL, category: ALL }));
  }

  async function analyze() {
    setError(''); setLoading(true);
    try {
      const cleanFilters = {
        agency: filters.agency === ALL ? '' : filters.agency,
        category: filters.category === ALL ? '' : filters.category,
        period: filters.period
      };
      const res = await fetch(`${API}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: upload.datasetId, ...mapping, ...cleanFilters }) });
      if (!res.ok) throw new Error((await res.json()).detail || 'Analysis failed');
      setResult(await res.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const columns = upload?.columns || [];

  return <div className="app">
    <header><div><h1>Delay Duration Analytics</h1><p>Box plot over time + survival analysis by Agency and Category</p></div><Activity /></header>
    {error && <div className="error">{error}</div>}
    <section className="upload-panel box-upload-panel">
      <label className="file-box">
        <input type="file" accept=".csv,.xlsx,.xls" onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0])} />
        <Upload size={22} />
        <span>{upload ? upload.filename : "Choose CSV / Excel delay file"}</span>
      </label>
      {upload && <span className="pill">{upload.rows} rows uploaded</span>}
    </section>

    {upload && <section className="grid two">
      <div className="card"><h2><Settings size={18}/> Configuration</h2>{['dateColumn','durationColumn','agencyColumn','categoryColumn'].map(k => <label key={k}>{k.replace('Column','')}<select value={mapping[k] || ''} onChange={e => setMapping({ ...mapping, [k]: e.target.value })}>{columns.map(c => <option key={c} value={c}>{c}</option>)}</select></label>)}<button onClick={() => loadMetadata()}>Apply Mapping</button></div>
      <div className="card"><h2>Filters</h2><label>Agency<select value={filters.agency} onChange={e => setFilters({ ...filters, agency: e.target.value })}><option value={ALL}>All Agencies</option>{meta.agencies.map(a => <option key={a} value={a}>{a}</option>)}</select></label><label>Category<select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}><option value={ALL}>All Categories</option>{meta.categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label><label>Time Period<select value={filters.period} onChange={e => setFilters({ ...filters, period: e.target.value })}>{PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label><button onClick={analyze} disabled={loading}>{loading ? 'Running...' : 'Run Analysis'}</button></div>
    </section>}

    {result?.summary?.count > 0 && <>
      <section className="kpis"><div><b>{result.summary.count}</b><span>Records</span></div><div><b>{fmt(result.summary.avgDuration)}</b><span>Avg min</span></div><div><b>{fmt(result.summary.medianDuration)}</b><span>Median min</span></div><div><b>{fmt(result.summary.p90Duration)}</b><span>P90 min</span></div><div><b>{fmt(result.summary.maxDuration)}</b><span>Max min</span></div></section>
      <section className="grid box-chart-grid"><div className="card chart"><h2><BarChart3 size={18}/> Duration Box Plot by {PERIODS.find(p=>p.value===filters.period)?.label}</h2><BoxPlotChart data={result.boxplot} /></div>
      <div className="card chart"><h2>Survival Curve: Probability delay exceeds duration</h2><SurvivalCurveChart data={result.survival} /></div></section>
      <section className="card"><h2>Filtered Records</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Duration Min</th><th>Agency</th><th>Category</th><th>Details</th></tr></thead><tbody>{result.records.map((r,i)=><tr key={i}><td>{r.date}</td><td>{fmt(r.duration_min)}</td><td>{r.agency}</td><td>{r.category}</td><td>{r.details}</td></tr>)}</tbody></table></div></section>
    </>}
    {result?.summary?.count === 0 && <div className="card">No records found for the selected Agency and Category.</div>}
  </div>;
}

export default BoxSurvival;
