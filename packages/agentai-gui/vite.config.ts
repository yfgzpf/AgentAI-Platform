import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',  // ✅ 关键：Tauri 2 webview 需要相对路径，否则 prod 下 /assets/xxx 会 404
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1', // 明确指定 host
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/v1': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        secure: false,
        timeout: 30000, // 30秒超时
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('[Vite Proxy] /v1 error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('[Vite Proxy] Sending Request:', req.method, req.url, '→', proxyReq.path);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('[Vite Proxy] Received Response:', proxyRes.statusCode, req.url);
          });
        },
      },
      '/health': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        secure: false,
        timeout: 30000,
      },
      '/agent': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        secure: false,
        timeout: 30000,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // 确保chunk文件使用相对路径
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
    esbuildOptions: { target: 'es2022' },
  },
  worker: {
    format: 'es',
  },
  clearScreen: false,
});
