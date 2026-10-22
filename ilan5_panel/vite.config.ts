import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';

// The panel is built into the extension folder. Chrome extension pages forbid inline
// and remote scripts, so everything is emitted as local files with relative paths.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  build: {
    outDir: '../ilan5_extension/panel',
    emptyOutDir: true,
    modulePreload: {polyfill: false},
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
});
