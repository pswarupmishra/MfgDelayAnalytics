import React, { useState } from "react";

function childArray(children) {
  return React.Children.toArray(children);
}

function childrenOf(children, names) {
  return childArray(children).filter(child => names.includes(child?.type?.name));
}

function firstChild(children, names) {
  return childrenOf(children, names)[0];
}

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "-");
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function safe(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function numericKeys(data, preferred) {
  const keys = preferred.filter(Boolean);
  const fallback = Object.keys(data[0] || {}).filter(key => data.some(row => Number.isFinite(Number(row?.[key]))));
  return [...new Set([...keys, ...fallback])].filter(key => data.some(row => Number.isFinite(Number(row?.[key]))));
}

function labelKey(data, explicit) {
  if (explicit) return explicit;
  return ["name", "period", "hour", "weekday", "bin"].find(key => key in (data[0] || {})) || Object.keys(data[0] || {})[0];
}

function extractConfig(children) {
  const xAxis = firstChild(children, ["XAxis"]);
  const yAxis = firstChild(children, ["YAxis"]);
  const series = childrenOf(children, ["Bar", "Area", "Line", "Pie"]);
  return {
    xKey: xAxis?.props?.dataKey,
    yKey: yAxis?.props?.dataKey,
    series,
  };
}

function TooltipBox({ point }) {
  if (!point) return null;
  const hasMatchQuality = point.values.some(row => String(row.name).toLowerCase().includes("match") || String(row.name).toLowerCase().includes("similarity"));
  return (
    <div className="svg-chart-tooltip" style={{ left: point.left, top: point.top }}>
      <b>{point.label}</b>
      {point.description && <small>Representative delay</small>}
      {point.description && <p>{point.description}</p>}
      {point.values.map(row => <span key={row.name}>{row.name}: {fmt(row.value)}</span>)}
      {hasMatchQuality && <em>Match quality shows how consistently the records in this group describe the same kind of delay. Higher means tighter, cleaner grouping.</em>}
    </div>
  );
}

function EmptyChart() {
  return <div className="empty">No chart data available.</div>;
}

function VerticalBarChart({ data, children, margin = {} }) {
  const [hover, setHover] = useState(null);
  const { xKey, yKey, series } = extractConfig(children);
  const valueKey = numericKeys(data, series.map(s => s.props.dataKey))[0];
  const nameKey = labelKey(data, yKey || xKey);
  if (!data?.length || !valueKey) return <EmptyChart />;

  const rows = data.slice(0, 16);
  const width = 860;
  const rowH = 30;
  const height = Math.max(320, rows.length * rowH + 76);
  const left = Math.max(150, margin.left || 150);
  const right = 36;
  const top = 24;
  const max = Math.max(1, ...rows.map(row => Number(row[valueKey]) || 0));
  const barW = width - left - right;

  return (
    <div className="svg-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <rect width={width} height={height} fill="#f8fbff" rx="12" />
        {rows.map((row, index) => {
          const value = Number(row[valueKey]) || 0;
          const y = top + index * rowH;
          const w = Math.max(3, (value / max) * barW);
          const label = safe(row[nameKey]);
          return (
            <g key={`${label}-${index}`} onMouseEnter={() => setHover({ left: left + Math.min(w + 12, barW - 120), top: y + 6, label, description: safe(row.description || row.representative_description), values: [{ name: valueKey, value }] })} onMouseLeave={() => setHover(null)}>
              <text x={left - 12} y={y + 20} textAnchor="end" fontSize="12" fill="#334155">{label.slice(0, 24)}</text>
              <rect x={left} y={y + 6} width={w} height="18" fill="#0b63a7" rx="5" />
              <text x={left + w + 7} y={y + 20} fontSize="12" fill="#073763">{fmt(value)}</text>
            </g>
          );
        })}
      </svg>
      <TooltipBox point={hover} />
    </div>
  );
}

function BarLikeChart({ data = [], children, variant = "bar", layout, margin = {} }) {
  if (layout === "vertical") return <VerticalBarChart data={data} children={children} margin={margin} />;

  const [hover, setHover] = useState(null);
  const { xKey, series } = extractConfig(children);
  const keys = numericKeys(data, series.map(s => s.props.dataKey));
  const primaryKey = keys[0];
  const secondaryKey = keys[1];
  const label = labelKey(data, xKey);
  if (!data?.length || !primaryKey) return <EmptyChart />;

  const rows = data.slice(0, 48);
  const width = Math.max(760, rows.length * 42);
  const height = 340;
  const m = { top: 22, right: 34, bottom: 70, left: 62 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const max = Math.max(1, ...rows.flatMap(row => keys.slice(0, 2).map(key => Number(row[key]) || 0)));
  const x = index => m.left + (index + 0.5) * (innerW / rows.length);
  const y = value => m.top + innerH - ((Number(value) || 0) / max) * innerH;
  const barW = Math.max(8, Math.min(28, innerW / rows.length * 0.55));
  const linePath = secondaryKey ? rows.map((row, i) => `${i ? "L" : "M"} ${x(i)} ${y(row[secondaryKey])}`).join(" ") : "";
  const areaPath = variant === "area" ? `${rows.map((row, i) => `${i ? "L" : "M"} ${x(i)} ${y(row[primaryKey])}`).join(" ")} L ${x(rows.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z` : "";

  return (
    <div className="svg-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <rect width={width} height={height} fill="#f8fbff" rx="12" />
        {[0, 0.25, 0.5, 0.75, 1].map(t => <g key={t}>
          <line x1={m.left} x2={width - m.right} y1={y(max * t)} y2={y(max * t)} stroke="#dbe3ef" strokeDasharray="3 3" />
          <text x={m.left - 10} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="#64748b">{fmt(max * t)}</text>
        </g>)}
        {areaPath && <path d={areaPath} fill="#bfdbfe" opacity="0.55" />}
        {variant !== "area" && rows.map((row, index) => {
          const value = Number(row[primaryKey]) || 0;
          const bx = x(index) - barW / 2;
          return <rect key={index} x={bx} y={y(value)} width={barW} height={Math.max(2, y(0) - y(value))} fill="#0b63a7" rx="4" />;
        })}
        {variant === "area" && <path d={rows.map((row, i) => `${i ? "L" : "M"} ${x(i)} ${y(row[primaryKey])}`).join(" ")} fill="none" stroke="#0b63a7" strokeWidth="3" />}
        {linePath && <path d={linePath} fill="none" stroke="#f97316" strokeWidth="3" />}
        {rows.map((row, index) => {
          const text = safe(row[label]);
          const values = keys.slice(0, 2).map(key => ({ name: key, value: row[key] }));
          return (
            <g key={`${text}-${index}`} onMouseEnter={() => setHover({ left: x(index) + 10, top: Math.min(y(row[primaryKey]) + 8, height - 118), label: text, description: safe(row.description || row.representative_description), values })} onMouseLeave={() => setHover(null)}>
              <rect x={x(index) - Math.max(12, barW / 2)} y={m.top} width={Math.max(24, barW)} height={innerH} fill="transparent" />
              <text x={x(index)} y={height - m.bottom + 24} textAnchor="end" transform={`rotate(-35 ${x(index)} ${height - m.bottom + 24})`} fontSize="11" fill="#475569">{text.slice(0, 14)}</text>
            </g>
          );
        })}
        <line x1={m.left} x2={m.left} y1={m.top} y2={y(0)} stroke="#94a3b8" />
        <line x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
      </svg>
      <TooltipBox point={hover} />
    </div>
  );
}

function InteractivePieChart({ children }) {
  const [hover, setHover] = useState(null);
  const pie = firstChild(children, ["Pie"]);
  const data = pie?.props?.data || [];
  const valueKey = pie?.props?.dataKey || "value";
  const nameKey = pie?.props?.nameKey || "name";
  if (!data.length) return <EmptyChart />;

  const width = 520;
  const height = 340;
  const cx = 170;
  const cy = 170;
  const r = 105;
  const total = data.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0) || 1;
  let angle = -90;
  const colors = ["#0b63a7", "#f97316", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#ca8a04", "#be185d"];
  const arc = (start, end) => {
    const s = (Math.PI / 180) * start;
    const e = (Math.PI / 180) * end;
    const x1 = cx + r * Math.cos(s);
    const y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy + r * Math.sin(e);
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  };

  return (
    <div className="svg-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <rect width={width} height={height} fill="#f8fbff" rx="12" />
        {data.map((row, index) => {
          const value = Number(row[valueKey]) || 0;
          const start = angle;
          const end = angle + (value / total) * 360;
          angle = end;
          const mid = (start + end) / 2;
          const lx = cx + (r + 25) * Math.cos((Math.PI / 180) * mid);
          const ly = cy + (r + 25) * Math.sin((Math.PI / 180) * mid);
          const name = safe(row[nameKey]);
          return (
            <g key={`${name}-${index}`} onMouseEnter={() => setHover({ left: 300, top: 48 + index * 28, label: name, values: [{ name: valueKey, value }] })} onMouseLeave={() => setHover(null)}>
              <path d={arc(start, end)} fill={colors[index % colors.length]} stroke="white" strokeWidth="2" />
              {value / total > 0.05 && <text x={lx} y={ly} textAnchor={lx < cx ? "end" : "start"} fontSize="11" fill="#334155">{name.slice(0, 14)}</text>}
              <rect x="330" y={44 + index * 24} width="12" height="12" fill={colors[index % colors.length]} rx="3" />
              <text x="350" y={55 + index * 24} fontSize="12" fill="#334155">{name.slice(0, 20)} ({fmt(value)})</text>
            </g>
          );
        })}
      </svg>
      <TooltipBox point={hover} />
    </div>
  );
}

export function ResponsiveContainer({ children, height = "100%" }) {
  return <div style={{ width: "100%", height, minHeight: 300 }}>{children}</div>;
}

export function AreaChart(props) { return <BarLikeChart {...props} variant="area" />; }
export function BarChart(props) { return <BarLikeChart {...props} variant="bar" />; }
export function ComposedChart(props) { return <BarLikeChart {...props} variant="composed" />; }
export function PieChart(props) { return <InteractivePieChart {...props} />; }
export function CartesianGrid() { return null; }
export function Tooltip() { return null; }
export function XAxis() { return null; }
export function YAxis() { return null; }
export function Area() { return null; }
export function Line() { return null; }
export function Bar() { return null; }
export function Pie() { return null; }
