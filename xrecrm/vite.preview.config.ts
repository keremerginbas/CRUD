// Sunucusuz tek dosya önizleme yapısı: pnpm build:preview
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "client",
  base: "./",
  publicDir: false,
  plugins: [react()],
  define: { "import.meta.env.VITE_XRE_PREVIEW": JSON.stringify("1") },
  build: {
    outDir: "../dist/preview",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
