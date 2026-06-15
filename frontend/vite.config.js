import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dev proxy target follows VITE_API_URL when set (e.g. when developing
// against a remote backend), otherwise defaults to the local backend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_URL || 'http://localhost:5000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: proxyTarget,
          ws: true,
        },
      },
    },
  };
});
