import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["terminal.local"],
    proxy: {
      "/control": { target: "ws://127.0.0.1:8787", ws: true },
      "/api": { target: "http://127.0.0.1:8787" },
    },
  },
});
