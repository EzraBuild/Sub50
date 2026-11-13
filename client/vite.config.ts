import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER = process.env.SUB50_SERVER ?? 'http://127.0.0.1:3001'; // 127.0.0.1, not localhost: avoids ::1 on Windows

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // bind 0.0.0.0 so phones on the same Wi-Fi can connect
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: SERVER, ws: true },
      '/healthz': SERVER,
    },
  },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', sourcemap: true },
});
