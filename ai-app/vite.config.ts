import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// AI Studio convention: expose the Gemini key as process.env.API_KEY at build time.
// `base: './'` keeps asset paths relative so the build works whether it's served
// from a domain root or a GitHub Pages project sub-path (/<repo>/).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const key = env.GEMINI_API_KEY || env.API_KEY || '';
  return {
    base: './',
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(key),
      'process.env.GEMINI_API_KEY': JSON.stringify(key),
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 900,
    },
  };
});
