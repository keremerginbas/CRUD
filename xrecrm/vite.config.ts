import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "client",
  publicDir: "../public",
  plugins: [react()],
  build: { outDir: "../dist/public", emptyOutDir: true },
  server: { host: "0.0.0.0", allowedHosts: true },
});
