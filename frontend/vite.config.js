import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      axios: path.resolve(__dirname, "src/vendor/axios.js"),
      recharts: path.resolve(__dirname, "src/vendor/recharts.jsx"),
      "react-plotly.js": path.resolve(__dirname, "src/vendor/react-plotly.jsx"),
      "plotly.js": path.resolve(__dirname, "src/vendor/plotly.js"),
    },
  },
});
