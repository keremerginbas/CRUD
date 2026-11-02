import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Derlenen dosyalar sunucunun servis ettiği server/public klasörüne yazılır
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../server/public', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
