const API_ROOT = import.meta.env.VITE_API_ROOT || "";

import React, { useMemo, useState } from "react";
import { Upload, Loader2, AlertTriangle, BarChart3, Clock, Factory, Activity, Database, Settings, SearchCheck } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Line, AreaChart, Area, PieChart, Pie, ComposedChart } from "recharts";

const API_BASE = `${API_ROOT}/api/eda`;
const NONE = "__none__";

const FIELDS = [
  ["date", "Date"],
  ["start_time", "Start Time"],
  ["end_time", "End Time"],
  ["duration", "Duration"],
  ["agency", "Agency / Department"],
  ["category", "Category"],
  ["detail", "Delay Detail / Reason"],
  ["unit", "Unit / Equipment"],
  ["shift", "Shift"],
];

function safe(v) {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(v) { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString(undefined, {maximumFractionDigits: 2}) : "-"; }
function pct(v) { const n = Number(v); return Number.isFinite(n) ? `${(n*100).toFixed(1)}%` : "-"; }

function normalizeRows(rows=[]) {
  return rows.map((r,i)=>({
    ...r,
    name: safe(r.name),
    delay_count: num(r.delay_count),
    total_duration_min: num(r.total_duration_min),
    avg_duration_min: num(r.avg_duration_min),
    duration_share: num(r.duration_share),
    cumulative_duration_share: num(r.cumulative_duration_share),
    __id: i
  }));
}

function MetricCard({title,value,subtitle,icon}) {
  return <div className="metric-card">
    <div className="metric-top"><span>{title}</span>{icon}</div>
    <div className="metric-value">{value}</div>
    <div className="metric-subtitle">{subtitle}</div>
  </div>
}

function Section({title, icon, children}) {
  return <section className="panel"><div className="panel-title">{icon}<span>{title}</span></div>{children}</section>
}

function RankingTable({rows, nameLabel}) {
  const data = normalizeRows(rows);
  return <div className="table-wrap"><table>
    <thead><tr><th>{nameLabel}</th><th>Count</th><th>Total Min</th><th>Avg Min</th><th>Share</th><th>Cumulative</th></tr></thead>
    <tbody>{data.map(r=><tr key={r.__id}><td className="strong">{r.name}</td><td>{fmt(r.delay_count)}</td><td>{fmt(r.total_duration_min)}</td><td>{fmt(r.avg_duration_min)}</td><td>{pct(r.duration_share)}</td><td>{pct(r.cumulative_duration_share)}</td></tr>)}</tbody>
  </table></div>
}

function MatrixTable({matrix}) {
  if (!matrix?.rows?.length) return <div className="empty">No matrix data available.</div>;
  const rows = matrix.rows.map(safe), cols = matrix.columns.map(safe), lookup = {};
  (matrix.values || []).forEach(v => lookup[`${safe(v.row)}|${safe(v.column)}`] = num(v.value));
  return <div className="table-wrap"><table className="matrix">
    <thead><tr><th></th>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
    <tbody>{rows.map(r=><tr key={r}><th>{r}</th>{cols.map(c=>{const val=lookup[`${r}|${c}`]||0; return <td key={c} className={val>0?"heat":""}>{fmt(val)}</td>})}</tr>)}</tbody>
  </table></div>
}

function EDADashboard() {
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [topN, setTopN] = useState(15);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("config");
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [loadingEda, setLoadingEda] = useState(false);
  const [error, setError] = useState("");

  async function onFileChange(f) {
    setFile(f); setResult(null); setColumns([]); setSampleRows([]); setMapping({}); setError("");
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    try {
      setLoadingColumns(true);
      const res = await fetch(`${API_BASE}/columns`, {method:"POST", body: form});
      const data = await res.json();
      if (!res.ok) throw new Error(safe(data.detail || "Column read failed"));
      setColumns(data.columns || []);
      setSampleRows(data.sample_rows || []);
      const m = {};
      FIELDS.forEach(([key]) => m[key] = data.auto_mapping?.[key] || NONE);
      setMapping(m);
      setActiveTab("config");
    } catch(e) {
      setError(e.message);
    } finally {
      setLoadingColumns(false);
    }
  }

  async function generateDashboard() {
    if (!file) { setError("Please upload a file first."); return; }
    setError(""); setResult(null);
    const cleanMapping = {};
    Object.entries(mapping).forEach(([k,v]) => { if (v && v !== NONE) cleanMapping[k]=v; });
    const form = new FormData();
    form.append("file", file);
    form.append("top_n", String(topN));
    form.append("mapping_json", JSON.stringify(cleanMapping));
    try {
      setLoadingEda(true);
      const res = await fetch(`${API_BASE}/eda`, {method:"POST", body: form});
      const data = await res.json();
      if (!res.ok) throw new Error(safe(data.detail || "EDA failed"));
      console.log("EDA", data);
      setResult(data);
      setActiveTab("overview");
    } catch(e) {
      setError(e.message);
    } finally {
      setLoadingEda(false);
    }
  }

  const byAgency = normalizeRows(result?.rankings?.by_agency || []);
  const byCategory = normalizeRows(result?.rankings?.by_category || []);
  const byDetail = normalizeRows(result?.rankings?.by_detail || []);
  const byUnit = normalizeRows(result?.rankings?.by_unit || []);
  const byShift = normalizeRows(result?.trends?.by_shift || []);
  const daily = (result?.trends?.daily || []).map((r,i)=>({...r, period:safe(r.period), delay_count:num(r.delay_count), total_duration_min:num(r.total_duration_min), __id:i}));
  const byHour = (result?.trends?.by_hour || []).map((r,i)=>({...r, hour:safe(r.hour), total_duration_min:num(r.total_duration_min), delay_count:num(r.delay_count), __id:i}));
  const byWeekday = (result?.trends?.by_weekday || []).map((r,i)=>({...r, weekday:safe(r.weekday), total_duration_min:num(r.total_duration_min), __id:i}));
  const pieData = byAgency.slice(0,8).map(x=>({name:x.name, value:x.total_duration_min}));

  return <div className="page">
    <header className="hero">
      <div><div className="eyebrow">Executive Manufacturing Analytics</div><h1>Delay Analytics EDA Dashboard</h1><p>Upload delay logs, map fields once, and generate executive-grade Pareto, trend, duration, cross-analysis and data-quality views.</p></div>
      <div className="hero-icon"><BarChart3 size={52}/></div>
    </header>

    <section className="upload-panel">
      <label className="file-box"><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>onFileChange(e.target.files?.[0] || null)} /><Upload size={22}/><span>{file ? file.name : "Choose Excel / CSV delay file"}</span></label>
      <label className="small-input">Top N<input type="number" min="5" max="100" value={topN} onChange={e=>setTopN(Number(e.target.value))}/></label>
      <button className="primary-btn" onClick={generateDashboard} disabled={loadingEda || loadingColumns || !file}>{loadingEda ? <Loader2 className="spin" size={18}/> : <SearchCheck size={18}/>} {loadingEda ? "Analyzing..." : "Generate EDA Dashboard"}</button>
    </section>

    {error && <div className="error"><AlertTriangle size={18}/>{error}</div>}

    <nav className="tabs">
      {[
        ["config","Configuration"],
        ["overview","Overview"],
        ["pareto","Pareto"],
        ["trends","Trends"],
        ["duration","Duration"],
        ["cross","Cross Analysis"],
        ["quality","Data Quality"],
      ].map(([k,l])=><button key={k} className={activeTab===k?"active":""} onClick={()=>setActiveTab(k)}>{l}</button>)}
    </nav>

    {activeTab==="config" && <div className="grid-one">
      <Section title="Field Mapping Configuration" icon={<Settings size={20}/>}>
        {!file && <div className="empty">Upload your Excel/CSV file to load columns and configure mapping.</div>}
        {loadingColumns && <div className="empty"><Loader2 className="spin" size={18}/> Reading file columns...</div>}
        {!!columns.length && <>
          <div className="mapping-grid">
            {FIELDS.map(([key,label])=><label key={key} className="map-field">{label}
              <select value={mapping[key] || NONE} onChange={e=>setMapping({...mapping, [key]: e.target.value})}>
                <option value={NONE}>-- Not mapped --</option>
                {columns.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </label>)}
          </div>
          <div className="hint">
            Minimum recommended mapping: <b>Date</b>, <b>Start Time</b>, <b>Duration</b>, <b>Agency</b>, <b>Category</b>, <b>Delay Detail</b>.
            If Duration is not mapped, backend will calculate duration using Start Time and End Time.
          </div>
        </>}
      </Section>

      {!!sampleRows.length && <Section title="Sample Rows Preview" icon={<Database size={20}/>}>
        <div className="table-wrap"><table>
          <thead><tr>{columns.slice(0,12).map(c=><th key={c}>{c}</th>)}</tr></thead>
          <tbody>{sampleRows.map((r,i)=><tr key={i}>{columns.slice(0,12).map(c=><td key={c}>{safe(r[c])}</td>)}</tr>)}</tbody>
        </table></div>
      </Section>}
    </div>}

    {result && <>
      <section className="metrics">
        <MetricCard title="Delay Records" value={fmt(result.kpis.total_records)} subtitle="Total input rows" icon={<Database size={20}/>} />
        <MetricCard title="Total Delay Hours" value={fmt(result.kpis.total_duration_hr)} subtitle={`${fmt(result.kpis.total_duration_min)} minutes`} icon={<Clock size={20}/>} />
        <MetricCard title="Avg Delay Min" value={fmt(result.kpis.avg_duration_min)} subtitle="Mean duration per record" icon={<Activity size={20}/>} />
        <MetricCard title="Agencies" value={fmt(result.kpis.unique_agencies)} subtitle={`${fmt(result.kpis.unique_categories)} categories`} icon={<Factory size={20}/>} />
      </section>

      {activeTab==="overview" && <div className="grid-two">
        <Section title="Delay by Agency" icon={<Factory size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" outerRadius={105} label/><Tooltip formatter={v=>fmt(v)}/></PieChart></ResponsiveContainer></div></Section>
        <Section title="Daily Delay Trend" icon={<BarChart3 size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period" tickFormatter={v=>safe(v).slice(5)}/><YAxis/><Tooltip/><Bar dataKey="total_duration_min" name="Total Duration Min"/><Line type="monotone" dataKey="delay_count" name="Delay Count"/></ComposedChart></ResponsiveContainer></div></Section>
        <Section title="Top Categories" icon={<BarChart3 size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={byCategory.slice(0,10)} layout="vertical" margin={{left:150}}><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis type="category" dataKey="name" tickFormatter={v=>safe(v).slice(0,18)}/><Tooltip/><Bar dataKey="total_duration_min"/></BarChart></ResponsiveContainer></div></Section>
        <Section title="Executive Summary" icon={<Activity size={20}/>}><div className="summary-list">
          <div><b>Date Range:</b> {safe(result.kpis.date_range?.from)} to {safe(result.kpis.date_range?.to)}</div>
          <div><b>Top Agency:</b> {safe(byAgency[0]?.name)}</div>
          <div><b>Top Category:</b> {safe(byCategory[0]?.name)}</div>
          <div><b>Top Delay Detail:</b> {safe(byDetail[0]?.name)}</div>
          <div><b>P95 Duration:</b> {fmt(result.duration_analysis.stats?.p95)} min</div>
        </div></Section>
      </div>}

      {activeTab==="pareto" && <div className="grid-one">
        <Section title="Agency Pareto" icon={<Factory size={20}/>}><RankingTable rows={byAgency} nameLabel="Agency"/></Section>
        <Section title="Category Pareto" icon={<BarChart3 size={20}/>}><RankingTable rows={byCategory} nameLabel="Category"/></Section>
        <Section title="Delay Detail Pareto" icon={<BarChart3 size={20}/>}><RankingTable rows={byDetail} nameLabel="Delay Detail"/></Section>
        <Section title="Unit / Equipment Pareto" icon={<Factory size={20}/>}><RankingTable rows={byUnit} nameLabel="Unit / Equipment"/></Section>
      </div>}

      {activeTab==="trends" && <div className="grid-two">
        <Section title="Daily Trend" icon={<Clock size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period" tickFormatter={v=>safe(v).slice(5)}/><YAxis/><Tooltip/><Area dataKey="total_duration_min"/></AreaChart></ResponsiveContainer></div></Section>
        <Section title="Hourly Pattern" icon={<Clock size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={byHour}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="hour"/><YAxis/><Tooltip/><Bar dataKey="total_duration_min"/></BarChart></ResponsiveContainer></div></Section>
        <Section title="Shift Pattern" icon={<Factory size={20}/>}><RankingTable rows={byShift} nameLabel="Shift"/></Section>
        <Section title="Weekday Pattern" icon={<Clock size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={byWeekday}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="weekday"/><YAxis/><Tooltip/><Bar dataKey="total_duration_min"/></BarChart></ResponsiveContainer></div></Section>
      </div>}

      {activeTab==="duration" && <div className="grid-two">
        <Section title="Duration Distribution" icon={<Activity size={20}/>}><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={(result.duration_analysis.histogram||[]).map((r,i)=>({bin:safe(r.bin), count:num(r.count), __id:i}))}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bin"/><YAxis/><Tooltip/><Bar dataKey="count"/></BarChart></ResponsiveContainer></div></Section>
        <Section title="Duration Statistics" icon={<Activity size={20}/>}><div className="stats-grid">{Object.entries(result.duration_analysis.stats||{}).map(([k,v])=><div className="stat" key={k}><span>{k.toUpperCase()}</span><b>{fmt(v)}</b></div>)}</div></Section>
        <Section title="Top Outlier Delays" icon={<AlertTriangle size={20}/>}><div className="table-wrap"><table><thead><tr><th>Date</th><th>Agency</th><th>Category</th><th>Detail</th><th>Duration Min</th><th>Threshold</th></tr></thead><tbody>{(result.duration_analysis.outliers||[]).map((r,i)=><tr key={i}><td>{safe(r.date)}</td><td>{safe(r.agency)}</td><td>{safe(r.category)}</td><td>{safe(r.detail)}</td><td>{fmt(r.duration_min)}</td><td>{fmt(r.threshold_min)}</td></tr>)}</tbody></table></div></Section>
      </div>}

      {activeTab==="cross" && <div className="grid-one">
        <Section title="Agency × Category Duration Matrix" icon={<Factory size={20}/>}><MatrixTable matrix={result.cross_analysis.agency_category_matrix}/></Section>
        <Section title="Shift × Category Duration Matrix" icon={<Clock size={20}/>}><MatrixTable matrix={result.cross_analysis.shift_category_matrix}/></Section>
        <Section title="Agency × Shift Duration Matrix" icon={<Factory size={20}/>}><MatrixTable matrix={result.cross_analysis.agency_shift_matrix}/></Section>
      </div>}

      {activeTab==="quality" && <div className="grid-two">
        <Section title="Mapping Used" icon={<Settings size={20}/>}><div className="summary-list">{Object.entries(result.data_quality.mapping_used||{}).map(([k,v])=><div key={k}><b>{k}:</b> {safe(v)}</div>)}</div></Section>
        <Section title="Data Quality Metrics" icon={<AlertTriangle size={20}/>}><div className="stats-grid"><div className="stat"><span>Invalid timestamps</span><b>{fmt(result.data_quality.invalid_timestamp_records)}</b></div><div className="stat"><span>Missing durations</span><b>{fmt(result.data_quality.missing_duration_records)}</b></div><div className="stat"><span>Zero durations</span><b>{fmt(result.data_quality.zero_duration_records)}</b></div></div></Section>
        <Section title="Missing Values by Column" icon={<Database size={20}/>}><div className="table-wrap"><table><thead><tr><th>Column</th><th>Missing Count</th><th>Missing Share</th></tr></thead><tbody>{(result.data_quality.missing_by_column||[]).map((r,i)=><tr key={i}><td>{safe(r.column)}</td><td>{fmt(r.missing_count)}</td><td>{pct(r.missing_share)}</td></tr>)}</tbody></table></div></Section>
      </div>}
    </>}
  </div>
}

export default EDADashboard;
