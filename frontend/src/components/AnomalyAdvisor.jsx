const API_ROOT = import.meta.env.VITE_API_ROOT || "";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Ban, Loader2, Radar, SearchCheck, ShieldAlert, Table2, Upload } from "lucide-react";

const API_BASE = `${API_ROOT}/api/anomaly`;
const NONE = "__none__";

const FIELDS = [
  ["date", "Date", false],
  ["duration", "Duration", true],
  ["agency", "Agency", true],
  ["category", "Category", true],
  ["detail", "Delay Description", false],
];

function safe(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fmt(value, digits = 2) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString(undefined, { maximumFractionDigits: digits }) : "-";
}

function pct(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${(num * 100).toFixed(1)}%` : "-";
}

function MetricCard({ title, value, subtitle }) {
  return (
    <div className="metric-card">
      <div className="metric-title">{title}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-subtitle">{subtitle}</div>
    </div>
  );
}

function MethodBadge({ method }) {
  const key = String(method || "").toLowerCase().replace(/\s+/g, "-");
  return <span className={`method-badge ${key}`}>{safe(method)}</span>;
}

function AnomalyAdvisor() {
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [minGroupSize, setMinGroupSize] = useState(5);
  const [contamination, setContamination] = useState(0.1);
  const [combos, setCombos] = useState([]);
  const [excludedCombos, setExcludedCombos] = useState(new Set());
  const [comboFilter, setComboFilter] = useState("");
  const [selectedPriorityCombo, setSelectedPriorityCombo] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [loadingCombos, setLoadingCombos] = useState(false);
  const [loadingAnomalies, setLoadingAnomalies] = useState(false);

  function cleanMapping() {
    const clean = {};
    Object.entries(mapping).forEach(([key, value]) => {
      if (value && value !== NONE) clean[key] = value;
    });
    return clean;
  }

  async function onFileChange(selectedFile) {
    setFile(selectedFile);
    setResult(null);
    setSelectedPriorityCombo("");
    setCombos([]);
    setExcludedCombos(new Set());
    setColumns([]);
    setSampleRows([]);
    setMapping({});
    setError("");
    if (!selectedFile) return;

    const form = new FormData();
    form.append("file", selectedFile);

    try {
      setLoadingColumns(true);
      const response = await fetch(`${API_BASE}/columns`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(safe(data.detail || "Column read failed."));

      const nextMapping = {};
      FIELDS.forEach(([key]) => {
        nextMapping[key] = data.auto_mapping?.[key] || NONE;
      });
      setColumns(data.columns || []);
      setSampleRows(data.sample_rows || []);
      setMapping(nextMapping);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingColumns(false);
    }
  }

  async function loadCombos() {
    if (!file) {
      setError("Please upload an Excel or CSV delay file.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("mapping_json", JSON.stringify(cleanMapping()));

    try {
      setError("");
      setLoadingCombos(true);
      const response = await fetch(`${API_BASE}/combos`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(safe(data.detail || "Could not load agency/category combinations."));
      setCombos(data.combos || []);
      setExcludedCombos(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingCombos(false);
    }
  }

  function toggleCombo(key) {
    setExcludedCombos((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function analyzeAnomalies() {
    if (!file) {
      setError("Please upload an Excel or CSV delay file.");
      return;
    }

    setError("");
    setResult(null);
    setSelectedPriorityCombo("");

    const form = new FormData();
    form.append("file", file);
    form.append("mapping_json", JSON.stringify(cleanMapping()));
    form.append("min_group_size", String(minGroupSize));
    form.append("contamination", String(contamination));
    form.append("excluded_combos_json", JSON.stringify([...excludedCombos]));

    try {
      setLoadingAnomalies(true);
      const response = await fetch(`${API_BASE}/analyze`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(safe(data.detail || "Anomaly analysis failed."));
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingAnomalies(false);
    }
  }

  const topCombos = useMemo(() => {
    if (!result?.combo_summary) return [];
    return result.combo_summary.filter((row) => Number(row.anomalies || 0) > 0).slice(0, 5);
  }, [result]);

  const selectedPriorityRows = useMemo(() => {
    if (!selectedPriorityCombo || !result?.anomalies) return [];
    return result.anomalies.filter((row) => `${row.category} | ${row.agency}` === selectedPriorityCombo);
  }, [result, selectedPriorityCombo]);

  const filteredCombos = useMemo(() => {
    const term = comboFilter.trim().toLowerCase();
    if (!term) return combos;
    return combos.filter((row) => `${row.agency} ${row.category} ${row.combo}`.toLowerCase().includes(term));
  }, [combos, comboFilter]);

  const requiredMapped = ["duration", "agency", "category"].every((key) => mapping[key] && mapping[key] !== NONE);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <div className="eyebrow">Isolation Forest</div>
          <h1>Anomaly Advisor</h1>
          <p>
            Upload a delay log and find unusually long delays for each agency and category combination
            using an Isolation Forest model trained on duration patterns within that combination.
          </p>
        </div>
        <div className="hero-icon">
          <ShieldAlert size={52} />
        </div>
      </header>

      <section className="upload-panel anomaly-upload-panel">
        <label className="file-box">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
          <Upload size={22} />
          <span>{file ? file.name : "Choose Excel / CSV delay file"}</span>
        </label>

        <label className="small-input">
          Minimum Records
          <input
            type="number"
            min="2"
            max="100"
            step="1"
            value={minGroupSize}
            onChange={(e) => setMinGroupSize(Number(e.target.value))}
            title="Minimum records needed before an agency and category pair is modeled."
          />
        </label>

        <label className="small-input">
          Expected Anomaly %
          <input
            type="number"
            min="1"
            max="40"
            step="1"
            value={Math.round(contamination * 100)}
            onChange={(e) => setContamination(Number(e.target.value) / 100)}
            title="Approximate share of records the Isolation Forest should treat as unusual. Lower values are stricter."
          />
          <span className="input-note">Lower = stricter</span>
        </label>

        <button className="primary-btn" onClick={analyzeAnomalies} disabled={loadingAnomalies || loadingColumns || !file}>
          {loadingAnomalies ? <Loader2 className="spin" size={18} /> : <SearchCheck size={18} />}
          {loadingAnomalies ? "Analyzing..." : "Find Anomalies"}
        </button>

        {error && (
          <div className="error">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <Table2 size={20} />
          <span>Field Mapping</span>
        </div>
        {!file && <div className="empty">Upload a file to load columns.</div>}
        {loadingColumns && (
          <div className="empty">
            <Loader2 className="spin" size={18} />
            Reading file columns...
          </div>
        )}
        {!!columns.length && (
          <>
            <div className="mapping-grid anomaly-mapping-grid">
              {FIELDS.map(([key, label, required]) => (
                <label key={key} className="map-field">
                  {label}{required ? " *" : ""}
                  <select value={mapping[key] || NONE} onChange={(e) => {
                    setMapping({ ...mapping, [key]: e.target.value });
                    setCombos([]);
                    setExcludedCombos(new Set());
                  }}>
                    <option value={NONE}>-- Not mapped --</option>
                    {columns.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className="secondary-btn combo-load-btn" onClick={loadCombos} disabled={loadingCombos || !requiredMapped}>
              {loadingCombos ? <Loader2 className="spin" size={17} /> : <Ban size={17} />}
              {loadingCombos ? "Loading combinations..." : "Load exclusion options"}
            </button>
          </>
        )}
      </section>

      {!!combos.length && (
        <section className="panel">
          <div className="panel-title">
            <Ban size={20} />
            <span>Exclude Agency and Category Combinations</span>
          </div>
          <div className="exclusion-toolbar">
            <label className="small-input">
              Search combinations
              <input value={comboFilter} onChange={(e) => setComboFilter(e.target.value)} placeholder="Agency or category" />
            </label>
            <div className="exclusion-actions">
              <button className="secondary-btn" onClick={() => setExcludedCombos(new Set(combos.map((row) => row.key)))}>Exclude all</button>
              <button className="secondary-btn" onClick={() => setExcludedCombos(new Set())}>Clear exclusions</button>
            </div>
            <div className="exclusion-count">{fmt(excludedCombos.size, 0)} excluded of {fmt(combos.length, 0)}</div>
          </div>
          <div className="combo-check-grid">
            {filteredCombos.map((row) => (
              <label key={row.key} className="combo-check">
                <input type="checkbox" checked={excludedCombos.has(row.key)} onChange={() => toggleCombo(row.key)} />
                <span>
                  <strong>{row.category}</strong>
                  <small>{row.agency} · {fmt(row.records, 0)} records</small>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {!!sampleRows.length && (
        <section className="panel">
          <div className="panel-title">Sample Rows Preview</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{columns.slice(0, 12).map((column) => <th key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {sampleRows.map((row, index) => (
                  <tr key={index}>
                    {columns.slice(0, 12).map((column) => (
                      <td key={column}>{safe(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <>
          <section className="metrics">
            <MetricCard title="Records Used" value={fmt(result.summary.records_used, 0)} subtitle={`${fmt(result.summary.records_excluded, 0)} excluded`} />
            <MetricCard title="Combos Analyzed" value={fmt(result.summary.combos_analyzed, 0)} subtitle={`${fmt(result.summary.combos_excluded, 0)} excluded combos`} />
            <MetricCard title="Combos With Anomalies" value={fmt(result.summary.combos_with_anomalies, 0)} subtitle="Pairs that need review" />
            <MetricCard title="Anomalies Found" value={fmt(result.summary.anomalies_found, 0)} subtitle="Isolation Forest high-duration outliers" />
          </section>

          <section className="panel anomaly-model-note">
            <div className="panel-title">Model Threshold</div>
            <p>
              The threshold shown in the grids is determined by the Isolation Forest model for each
              Agency + Category combination. It is displayed as the lowest duration among records
              the model flagged as high-duration anomalies for that combination.
            </p>
          </section>

          {!!topCombos.length && (
            <section className="panel anomaly-priority-panel">
              <div className="panel-title">
                <Radar size={20} />
                <span>Priority Combos</span>
              </div>
              <div className="priority-combos">
                {topCombos.map((row) => (
                  <div className={`priority-combo ${selectedPriorityCombo === row.combo ? "active" : ""}`} key={`${row.agency}-${row.category}`}>
                    <span>{row.combo}</span>
                    <strong>{fmt(row.anomalies, 0)} anomalies</strong>
                    <small>{pct(row.anomaly_rate)} of {fmt(row.records, 0)} records</small>
                    <button className="link-btn" onClick={() => setSelectedPriorityCombo(row.combo)}>Show</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedPriorityCombo && (
            <section className="panel priority-detail-panel">
              <div className="panel-title">
                <ShieldAlert size={20} />
                <span>Marked Anomalies: {selectedPriorityCombo}</span>
              </div>
              {!selectedPriorityRows.length && <div className="empty">No marked anomaly rows found for this combo.</div>}
              {!!selectedPriorityRows.length && (
                <div className="table-wrap">
                  <table className="anomaly-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Date</th>
                        <th>Duration</th>
                        <th>Anomaly Score</th>
                        <th>Model Threshold</th>
                        <th>Excess</th>
                        <th>Method</th>
                        <th>Delay Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPriorityRows.map((row) => (
                        <tr key={`priority-${row.row_number}-${row.duration_min}`}>
                          <td className="strong">#{row.row_number}</td>
                          <td>{safe(row.date)}</td>
                          <td className="strong">{fmt(row.duration_min)} min</td>
                          <td>{fmt(row.anomaly_score, 4)}</td>
                          <td>{fmt(row.threshold_min)} min</td>
                          <td>{fmt(row.excess_min)} min</td>
                          <td><MethodBadge method={row.method} /></td>
                          <td className="delay-detail">{safe(row.detail)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="panel">
            <div className="panel-title">
              <ShieldAlert size={20} />
              <span>Anomalous Delays</span>
            </div>
            {!result.anomalies?.length && <div className="empty">No duration anomalies found with the current settings.</div>}
            {!!result.anomalies?.length && (
              <div className="table-wrap">
                <table className="anomaly-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Date</th>
                      <th>Agency</th>
                      <th>Category</th>
                      <th>Duration</th>
                      <th>Anomaly Score</th>
                      <th>Model Threshold</th>
                      <th>Excess</th>
                      <th>Method</th>
                      <th>Delay Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.anomalies.map((row) => (
                      <tr key={`${row.row_number}-${row.duration_min}`}>
                        <td className="strong">#{row.row_number}</td>
                        <td>{safe(row.date)}</td>
                        <td>{safe(row.agency)}</td>
                        <td>{safe(row.category)}</td>
                        <td className="strong">{fmt(row.duration_min)} min</td>
                        <td>{fmt(row.anomaly_score, 4)}</td>
                        <td>{fmt(row.threshold_min)} min</td>
                        <td>{fmt(row.excess_min)} min</td>
                        <td><MethodBadge method={row.method} /></td>
                        <td className="delay-detail">{safe(row.detail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              <Table2 size={20} />
              <span>All Included Agency and Category Combos</span>
            </div>
            <div className="table-wrap">
              <table className="combo-table">
                <thead>
                  <tr>
                    <th>Agency</th>
                    <th>Category</th>
                    <th>Records</th>
                    <th>Anomalies</th>
                    <th>Anomaly Rate</th>
                    <th>Median Duration</th>
                    <th>Max Duration</th>
                    <th>Model Threshold</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {result.combo_summary.map((row) => (
                    <tr key={`${row.agency}-${row.category}`}>
                      <td>{safe(row.agency)}</td>
                      <td>{safe(row.category)}</td>
                      <td>{fmt(row.records, 0)}</td>
                      <td className={Number(row.anomalies || 0) > 0 ? "anomaly-count" : ""}>{fmt(row.anomalies, 0)}</td>
                      <td>{pct(row.anomaly_rate)}</td>
                      <td>{fmt(row.median_duration_min)} min</td>
                      <td>{fmt(row.max_duration_min)} min</td>
                      <td>{fmt(row.threshold_min)} min</td>
                      <td><MethodBadge method={row.method} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default AnomalyAdvisor;
