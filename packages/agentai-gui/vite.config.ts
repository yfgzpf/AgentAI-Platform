import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

// 读取 package.json 版本号（供 __APP_VERSION__ 宏注入）
function readPkgVersion(): string {
  try {
    const raw = readFileSync(path.resolve(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw).version || '0.1.0';
  } catch { return '0.1.0'; }
}
const APP_VERSION = process.env.npm_package_version || readPkgVersion() || '0.1.0';

export default defineConfig({
  base: './',
  plugins: [
    // @ant-design/icons v5 是 ES module + 支持 tree-shaking，不需要 babel-plugin-import
    // antd 5.x 使用 CSS-in-JS，样式自动注入，也不需要 babel-plugin-import
    react(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: [
      'react', 'react-dom',
      'antd', '@ant-design/cssinjs', '@ant-design/icons', '@ant-design/icons-svg',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
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
        timeout: 30000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('[vite proxy] error:', err);
          });
        },
      },
    },
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'antd-vendor': ['antd', '@ant-design/icons'],
          'editor-vendor': ['@monaco-editor/react', 'monaco-editor'],
          'socket-vendor': ['socket.io-client'],
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    assetsInlineLimit: 4096,
    cssCodeSplit: true,
  },
});
