import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, forward /ws to the Node server so hot-reload works against the live PLC
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } } },
});
