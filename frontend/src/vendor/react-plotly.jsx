import React from "react";

export default function Plot({ data = [], layout = {}, style = {} }) {
  const height = layout.height || 320;
  return (
    <div style={{ ...style, minHeight: height, display: "grid", alignContent: "center", gap: 8 }}>
      {data.filter(item => item.mode?.includes("lines") && item.hoverinfo !== "skip").map((item, index) => (
        <div key={`${item.name}-${index}`} style={{ borderLeft: "4px solid #0b63a7", padding: "6px 10px", background: "#f7fbff" }}>
          <strong>{item.name}</strong>
          <div style={{ fontSize: 12, color: "#55708a" }}>{item.x?.length || 0} points</div>
        </div>
      ))}
    </div>
  );
}
