import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// AI Studio convention: expose the Gemini key as process.env.API_KEY at build time.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const key = env.GEMINI_API_KEY || env.API_KEY || '';
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(key),
      'process.env.GEMINI_API_KEY': JSON.stringify(key),
    },
  };
});
