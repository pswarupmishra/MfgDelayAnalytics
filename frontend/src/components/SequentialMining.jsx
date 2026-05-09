const API_ROOT = import.meta.env.VITE_API_ROOT || "";

import React, { useMemo, useState } from "react";
import { Upload, GitBranch, Loader2, AlertTriangle } from "lucide-react";

const API_URL = `${API_ROOT}/api/sequential/sequential-analyze`;

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

function SequentialMining() {
  const [file, setFile] = useState(null);
  const [sequenceMode, setSequenceMode] = useState("time_window");
  const [windowMinutes, setWindowMinutes] = useState(120);
  const [maxPatternLength, setMaxPatternLength] = useState(4);
  const [minSupportCount, setMinSupportCount] = useState(2);
  const [includeAgency, setIncludeAgency] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedDelay, setSelectedDelay] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const bestSequence = useMemo(() => {
    if (!result?.top_sequences?.length) return null;
    return result.top_sequences[0];
  }, [result]);

  const availableAntecedents = useMemo(() => {
    if (!result?.next_delay_prediction) return [];
    return Object.keys(result.next_delay_prediction);
  }, [result]);

  async function analyze() {
    setError("");
    setResult(null);
    setSelectedDelay("");

    if (!file) {
      setError("Please upload an Excel or CSV delay file.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("delay_column", "auto");
    form.append("sequence_mode", sequenceMode);
    form.append("window_minutes", String(windowMinutes));
    form.append("max_pattern_length", String(maxPatternLength));
    form.append("min_support_count", String(minSupportCount));
    form.append("include_agency", String(includeAgency));

    try {
      setLoading(true);
      const response = await fetch(API_URL, { method: "POST", body: form });
      const data = await response.json();

      if (!response.ok) throw new Error(data.detail || "Sequential analysis failed.");

      setResult(data);
      const firstDelay = Object.keys(data.next_delay_prediction || {})[0];
      if (firstDelay) setSelectedDelay(firstDelay);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const predictions = selectedDelay && result?.next_delay_prediction
    ? result.next_delay_prediction[selectedDelay] || []
    : [];

  return (
    <div className="page">
      <header className="hero">
        <div>
          <div className="eyebrow">Operational Intelligence</div>
          <h1>Sequential Delay Mining</h1>
          <p>Upload manufacturing delay logs and discover ordered delay cascades such as Power Dip → Hydraulic Issue → Crane Delay.</p>
        </div>
        <div className="hero-icon"><GitBranch size={48} /></div>
      </header>

      <section className="upload-panel module-upload-panel">
          <label className="file-box">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Upload size={22} />
            <span>{file ? file.name : "Choose Excel / CSV file"}</span>
          </label>

          <label>
            Sequence Mode
            <select value={sequenceMode} onChange={(e) => setSequenceMode(e.target.value)}>
              <option value="time_window">Time Window</option>
              <option value="shift">Shift</option>
              <option value="heat">Heat / Cast</option>
            </select>
          </label>

          <label>
            Window Minutes
            <input type="number" min="15" value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))} disabled={sequenceMode !== "time_window"} />
          </label>

          <label>
            Max Chain Length
            <input type="number" min="2" max="6" value={maxPatternLength} onChange={(e) => setMaxPatternLength(Number(e.target.value))} />
          </label>

          <label>
            Min Occurrence
            <input type="number" min="1" value={minSupportCount} onChange={(e) => setMinSupportCount(Number(e.target.value))} />
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={includeAgency} onChange={(e) => setIncludeAgency(e.target.checked)} />
            Include agency
          </label>
        <button className="primary-btn" onClick={analyze} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <GitBranch size={18} />}
          {loading ? "Mining sequences..." : "Run Sequential Mining"}
        </button>

        {error && <div className="error"><AlertTriangle size={18} />{error}</div>}
      </section>

      {result && (
        <>
          <section className="metrics">
            <MetricCard title="Rows Read" value={result.summary.rows_read} subtitle="Input records" />
            <MetricCard title="Events Used" value={result.summary.events_used} subtitle="Valid ordered delay events" />
            <MetricCard title="Sequences" value={result.summary.sequences_analyzed} subtitle="Operational chains analyzed" />
            <MetricCard title="Patterns Found" value={result.summary.top_sequences_found} subtitle="Repeated delay chains" />
          </section>

          {bestSequence && (
            <section className="insight">
              <div className="insight-label">Top Delay Cascade</div>
              <h2>{bestSequence.sequence}</h2>
              <p>Occurred <b>{bestSequence.count}</b> times · Support <b>{pct(bestSequence.support)}</b> · Chain Length <b>{bestSequence.length}</b></p>
            </section>
          )}

          <section className="panel">
            <div className="panel-title">Top Sequential Delay Patterns</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Sequence</th><th>Length</th><th>Count</th><th>Support</th></tr></thead>
                <tbody>
                  {result.top_sequences.map((row, idx) => (
                    <tr key={idx}><td className="sequence-cell">{row.sequence}</td><td>{row.length}</td><td>{row.count}</td><td>{pct(row.support)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="two-col">
            <div className="panel">
              <div className="panel-title">Transition Probabilities</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>From Delay</th><th>Next Delay</th><th>Probability</th><th>Count</th></tr></thead>
                  <tbody>
                    {result.transitions.slice(0, 25).map((row, idx) => (
                      <tr key={idx}><td>{row.from_delay}</td><td>{row.to_delay}</td><td>{pct(row.probability)}</td><td>{row.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Next Delay Prediction</div>
              <label>
                Current Delay
                <select value={selectedDelay} onChange={(e) => setSelectedDelay(e.target.value)}>
                  {availableAntecedents.map((delay) => <option key={delay} value={delay}>{delay}</option>)}
                </select>
              </label>

              <div className="prediction-list">
                {predictions.slice(0, 8).map((p, idx) => (
                  <div className="prediction-card" key={idx}>
                    <div><b>{p.next_delay}</b><span>Count: {p.count}</span></div>
                    <strong>{pct(p.probability)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default SequentialMining;
