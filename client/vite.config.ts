import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'client',
    plugins: [react()],
    server: { port: Number(env.WEB_PORT || 5173), strictPort: true, proxy: { '/api': `http://localhost:${env.PORT || 8080}` } },
    build: { outDir: '../dist/client', emptyOutDir: true }
  };
});
