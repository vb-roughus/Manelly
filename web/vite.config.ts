import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the Manelly server runs separately on port 3000 (see server/).
const apiTarget = 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': apiTarget },
  },
});
