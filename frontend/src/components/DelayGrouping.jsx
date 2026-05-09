const API_ROOT = import.meta.env.VITE_API_ROOT || "";

import React, { useState } from "react";
import { AlertTriangle, GitMerge, Layers3, Loader2, SearchCheck, Upload } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const API_BASE = `${API_ROOT}/api/grouping`;
const NONE = "__none__";

const FIELDS = [
  ["description", "Delay Description"],
  ["category", "Category"],
  ["agency", "Agency"],
];

function safe(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fmt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";
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

function tags(items = []) {
  if (!items.length) return "-";
  return items.map((item) => `${item.name} (${item.count})`).join(", ");
}

const CHART_COLORS = ["#0b63a7", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"];

function chartLabel(text, max = 22) {
  const value = safe(text);
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function topNames(groups, key, limit = 6) {
  const totals = new Map();
  groups.forEach((group) => {
    (group[key] || []).forEach((item) => {
      totals.set(item.name, (totals.get(item.name) || 0) + Number(item.count || 0));
    });
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);
}

function countFor(items = [], name) {
  return Number(items.find((item) => item.name === name)?.count || 0);
}

function buildChartData(groups = []) {
  const sorted = [...groups].sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const topGroups = sorted.slice(0, 12);
  const total = sorted.reduce((sum, group) => sum + Number(group.count || 0), 0) || 1;
  let cumulative = 0;
  const categoryNames = topNames(topGroups, "categories");
  const agencyNames = topNames(topGroups, "agencies");

  return {
    categoryNames,
    agencyNames,
    groupSizes: topGroups.map((group) => ({
      name: `G${group.group_id}`,
      count: Number(group.count || 0),
      description: group.representative_description,
    })),
    pareto: topGroups.map((group) => {
      cumulative += Number(group.count || 0);
      return {
        name: `G${group.group_id}`,
        description: group.representative_description,
        count: Number(group.count || 0),
        cumulative: Number(((cumulative / total) * 100).toFixed(1)),
      };
    }),
    categoryMix: topGroups.map((group) => Object.fromEntries([
      ["name", `G${group.group_id}`],
      ["description", group.representative_description],
      ...categoryNames.map((name) => [name, countFor(group.categories, name)]),
    ])),
    agencyMix: topGroups.map((group) => Object.fromEntries([
      ["name", `G${group.group_id}`],
      ["description", group.representative_description],
      ...agencyNames.map((name) => [name, countFor(group.agencies, name)]),
    ])),
    similarity: topGroups.map((group) => ({
      name: `G${group.group_id}`,
      description: group.representative_description,
      similarity: Number(group.avg_similarity || 0),
      count: Number(group.count || 0),
    })),
  };
}

function ChartPanel({ title, children }) {
  return (
    <section className="panel grouping-chart-panel">
      <div className="panel-title">{title}</div>
      <div className="grouping-chart-box">{children}</div>
    </section>
  );
}

function GroupTooltip({ active, label, payload = [] }) {
  const visiblePayload = Array.isArray(payload) ? payload.filter((entry) => entry && entry.value !== undefined) : [];
  if (!active || !visiblePayload.length) return null;
  const row = visiblePayload.find((entry) => entry?.payload?.description)?.payload || visiblePayload[0]?.payload || {};
  return (
    <div className="group-chart-tooltip">
      <strong>{label}</strong>
      <small>Representative delay</small>
      <p>{safe(row.description)}</p>
      {visiblePayload
        .filter((entry) => entry.dataKey !== "description" && entry.value !== 0)
        .map((entry) => (
          <span key={`${entry.dataKey}-${entry.name}`}>
            {entry.name || entry.dataKey}: {entry.name === "Cumulative %" ? `${fmt(entry.value)}%` : fmt(entry.value)}
          </span>
        ))}
    </div>
  );
}


function DelayGrouping() {
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [threshold, setThreshold] = useState(0.58);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  async function onFileChange(selectedFile) {
    setFile(selectedFile);
    setResult(null);
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

  async function groupDelays() {
    if (!file) {
      setError("Please upload an Excel or CSV delay file.");
      return;
    }

    const cleanMapping = {};
    Object.entries(mapping).forEach(([key, value]) => {
      if (value && value !== NONE) cleanMapping[key] = value;
    });

    setError("");
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    form.append("mapping_json", JSON.stringify(cleanMapping));
    form.append("similarity_threshold", String(threshold));

    try {
      setLoadingGroups(true);
      const response = await fetch(`${API_BASE}/group`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(safe(data.detail || "Grouping failed."));
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingGroups(false);
    }
  }

  const charts = result ? buildChartData(result.groups || []) : null;

  return (
    <div className="page">
      <header className="hero">
        <div>
          <div className="eyebrow">Similarity Grouping</div>
          <h1>Delay Description Grouping</h1>
          <p>
            Upload a delay log, map description/category/agency fields, and cluster similar delay
            narratives into reviewable groups.
          </p>
        </div>
        <div className="hero-icon">
          <GitMerge size={52} />
        </div>
      </header>

      <section className="upload-panel grouping-upload-panel">
        <label className="file-box">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
          <Upload size={22} />
          <span>{file ? file.name : "Choose Excel / CSV delay file"}</span>
        </label>

        <label className="small-input similarity-field">
          Match Strictness
          <input
            type="number"
            min="0.1"
            max="0.95"
            step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            title="Higher values create tighter groups; lower values merge more loosely related delays."
          />
          <span>Higher = tighter groups</span>
        </label>

        <button className="primary-btn" onClick={groupDelays} disabled={loadingGroups || loadingColumns || !file}>
          {loadingGroups ? <Loader2 className="spin" size={18} /> : <SearchCheck size={18} />}
          {loadingGroups ? "Grouping..." : "Group Delays"}
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
          <Layers3 size={20} />
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
            <div className="mapping-grid grouping-mapping-grid">
              {FIELDS.map(([key, label]) => (
                <label key={key} className="map-field">
                  {label}
                  <select value={mapping[key] || NONE} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}>
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
          </>
        )}
      </section>

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
            <MetricCard title="Rows Read" value={fmt(result.summary.rows_read)} subtitle="Input records" />
            <MetricCard title="Rows Used" value={fmt(result.summary.rows_used)} subtitle="Rows with descriptions" />
            <MetricCard title="Groups Found" value={fmt(result.summary.groups_found)} subtitle="Similarity clusters" />
            <MetricCard title="Match Strictness" value={fmt(result.summary.similarity_threshold)} subtitle="Higher values create tighter, more exact delay groups" />
          </section>

          <div className="grid-two grouping-chart-grid">
            <ChartPanel title="Top Delay Groups">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.groupSizes} margin={{ left: 8, right: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip content={(props) => <GroupTooltip {...props} />} wrapperStyle={{ zIndex: 30 }} />
                  <Bar dataKey="count" name="Delay Count" fill="#0b63a7" />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Pareto of Grouped Delays">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.pareto} margin={{ left: 8, right: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="count" />
                  <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} />
                  <Tooltip content={(props) => <GroupTooltip {...props} />} wrapperStyle={{ zIndex: 30 }} />
                  <Bar yAxisId="count" dataKey="count" name="Delay Count" fill="#16a34a" />
                  <Line yAxisId="percent" type="monotone" dataKey="cumulative" name="Cumulative %" stroke="#dc2626" strokeWidth={2} dot />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Category Mix by Group">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.categoryMix} margin={{ left: 8, right: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip content={(props) => <GroupTooltip {...props} />} wrapperStyle={{ zIndex: 30 }} />
                  {charts.categoryNames.map((name, index) => (
                    <Bar key={name} dataKey={name} stackId="category" fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Agency Mix by Group">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.agencyMix} margin={{ left: 8, right: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip content={(props) => <GroupTooltip {...props} />} wrapperStyle={{ zIndex: 30 }} />
                  {charts.agencyNames.map((name, index) => (
                    <Bar key={name} dataKey={name} stackId="agency" fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Group Match Quality">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.similarity} margin={{ left: 8, right: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis domain={[0, 1]} />
                  <Tooltip content={(props) => <GroupTooltip {...props} />} wrapperStyle={{ zIndex: 30 }} />
                  <Bar dataKey="similarity" name="Avg Match Quality" fill="#7c3aed" />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>

          <section className="panel">
            <div className="panel-title">
              <GitMerge size={20} />
              <span>Grouped Delays</span>
            </div>
            <div className="table-wrap">
              <table className="group-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Count</th>
                    <th>Similarity</th>
                    <th>Representative Delay</th>
                    <th>Top Category</th>
                    <th>Top Agency</th>
                    <th>Category Mix</th>
                    <th>Agency Mix</th>
                    <th>Sample Delays</th>
                  </tr>
                </thead>
                <tbody>
                  {result.groups.map((group) => (
                    <tr key={group.group_id}>
                      <td className="strong">G{group.group_id}</td>
                      <td>{group.count}</td>
                      <td>{fmt(group.avg_similarity)}</td>
                      <td className="group-description">{group.representative_description}</td>
                      <td>{group.top_category}</td>
                      <td>{group.top_agency}</td>
                      <td>{tags(group.categories)}</td>
                      <td>{tags(group.agencies)}</td>
                      <td>
                        <div className="delay-samples">
                          {group.sample_delays.map((item) => (
                            <span key={`${group.group_id}-${item.row_number}`}>
                              #{item.row_number}: {item.description}
                            </span>
                          ))}
                        </div>
                      </td>
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

export default DelayGrouping;
