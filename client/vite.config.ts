import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'client',
    plugins: [react()],
    // host: true atende também pelo IP da máquina na rede (o Vite mostra o endereço em "Network"), para abrir em outro aparelho;
    // a API já escuta em 0.0.0.0 e o proxy continua indo para ela pelo localhost
    server: { host: true, port: Number(env.WEB_PORT || 5173), strictPort: true, proxy: { '/api': `http://localhost:${env.PORT || 8080}` } },
    build: { outDir: '../dist/client', emptyOutDir: true }
  };
});
