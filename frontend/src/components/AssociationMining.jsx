const API_ROOT = import.meta.env.VITE_API_ROOT || "";

import React, { useMemo, useState } from "react";
import { Upload, Network, BarChart3, AlertTriangle, Loader2 } from "lucide-react";

const API_URL = `${API_ROOT}/api/association/analyze`;

function pct(x) {
  if (x === undefined || x === null) return "-";
  return `${(x * 100).toFixed(1)}%`;
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

function AssociationMining() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("time_window");
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [minSupport, setMinSupport] = useState(0.03);
  const [minConfidence, setMinConfidence] = useState(0.3);
  const [includeAgency, setIncludeAgency] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const strongestRule = useMemo(() => {
    if (!result?.rules?.length) return null;
    return result.rules[0];
  }, [result]);

  async function analyze() {
    setError("");
    setResult(null);

    if (!file) {
      setError("Please upload an Excel or CSV delay file.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("delay_column", "auto");
    form.append("mode", mode);
    form.append("window_minutes", String(windowMinutes));
    form.append("min_support", String(minSupport));
    form.append("min_confidence", String(minConfidence));
    form.append("include_agency", String(includeAgency));

    try {
      setLoading(true);
      const response = await fetch(API_URL, { method: "POST", body: form });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Analysis failed.");
      }

      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <div className="eyebrow">Manufacturing Intelligence</div>
          <h1>Delay Association Mining</h1>
          <p>
            Upload SMS / manufacturing delay logs and discover which delays commonly occur together,
            similar to Market Basket Analysis.
          </p>
        </div>
        <div className="hero-icon"><Network size={48} /></div>
      </header>

      <section className="upload-panel module-upload-panel">
          <label className="file-box">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <Upload size={22} />
            <span>{file ? file.name : "Choose Excel / CSV file"}</span>
          </label>

          <label>
            Transaction Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="time_window">Time Window</option>
              <option value="shift">Shift</option>
              <option value="agency">Agency</option>
            </select>
          </label>

          <label>
            Window Minutes
            <input
              type="number"
              min="5"
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
              disabled={mode !== "time_window"}
            />
          </label>

          <label>
            Minimum Support
            <input
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              value={minSupport}
              onChange={(e) => setMinSupport(Number(e.target.value))}
            />
          </label>

          <label>
            Minimum Confidence
            <input
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeAgency}
              onChange={(e) => setIncludeAgency(e.target.checked)}
            />
            Include agency in delay item
          </label>
        <button className="primary-btn" onClick={analyze} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <BarChart3 size={18} />}
          {loading ? "Analyzing..." : "Run Delay Mining"}
        </button>

        {error && (
          <div className="error">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
      </section>

      {result && (
        <>
          <section className="metrics">
            <MetricCard title="Rows Read" value={result.summary.rows_read} subtitle="Input records" />
            <MetricCard title="Rows Used" value={result.summary.rows_used} subtitle="Valid timestamp + delay" />
            <MetricCard title="Baskets" value={result.summary.baskets_analyzed} subtitle="Transaction groups" />
            <MetricCard title="Rules Found" value={result.summary.rules_found} subtitle="Association rules" />
          </section>

          {strongestRule && (
            <section className="insight">
              <div className="insight-label">Strongest Executive Insight</div>
              <h2>{strongestRule.antecedent} → {strongestRule.consequent}</h2>
              <p>
                Confidence: <b>{pct(strongestRule.confidence)}</b> · Lift: <b>{strongestRule.lift}</b> · Support: <b>{pct(strongestRule.support)}</b>
              </p>
              <span>{strongestRule.interpretation}</span>
            </section>
          )}

          <section className="panel">
            <div className="panel-title">Top Association Rules</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Antecedent</th>
                    <th>Consequent</th>
                    <th>Support</th>
                    <th>Confidence</th>
                    <th>Lift</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rules.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.antecedent}</td>
                      <td>{r.consequent}</td>
                      <td>{pct(r.support)}</td>
                      <td>{pct(r.confidence)}</td>
                      <td>{r.lift}</td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="two-col">
            <div className="panel">
              <div className="panel-title">Frequent Delay Pairs</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Delay A</th>
                      <th>Delay B</th>
                      <th>Support</th>
                      <th>Lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.frequent_pairs.slice(0, 15).map((p, idx) => (
                      <tr key={idx}>
                        <td>{p.delay_a}</td>
                        <td>{p.delay_b}</td>
                        <td>{pct(p.support)}</td>
                        <td>{p.lift}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Most Common Delays</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Delay</th>
                      <th>Count</th>
                      <th>Support</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.item_frequency.slice(0, 15).map((i, idx) => (
                      <tr key={idx}>
                        <td>{i.delay}</td>
                        <td>{i.count}</td>
                        <td>{pct(i.support)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default AssociationMining;
