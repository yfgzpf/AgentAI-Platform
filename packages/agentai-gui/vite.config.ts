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
  base: './',  // ✅ 关键：Tauri 2 webview 需要相对路径，否则 prod 下 /assets/xxx 会 404
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    /*
     * ╔═══════════════════════════════════════════════════════════════╗
     * ║ 构建vs开发一致性修复 (P1): dedupe                           ║
     * ║ pnpm monorepo 可能出现多份 antd/react 实例 → 打包后样式    ║
     * ║ 优先级错乱、React hooks 重复初始化异常。强制在构建时去重    ║
     * ╚═══════════════════════════════════════════════════════════════╝
     */
    dedupe: [
      'react', 'react-dom',
      'antd', '@ant-design/cssinjs', '@ant-design/icons', '@ant-design/icons-svg',
    ],
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
    cssCodeSplit: true, // 懒加载 chunk 的 CSS 单独抽取为 .css 文件
    chunkSizeWarningLimit: 1600, // antd/react/vendor 合起来就 1MB+, 正常范围
    commonjsOptions: {
      transformMixedEsModules: true,
      strictRequires: true,
    },
    rollupOptions: {
      output: {
        // 确保chunk文件使用相对路径
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        /*
         * ╔═══════════════════════════════════════════════════════════╗
         * ║ 构建vs开发一致性修复 (P1): manualChunks                 ║
         * ║ 把 antd / icons / react / zustand 等稳定依赖拆成独立   ║
         * ║ chunk: 1) 懒加载组件 chunk 变小, 首屏骨架屏停留时间短  ║
         * ║         2) antd 样式 chunk 稳定, 降低"打包后样式乱"    ║
         * ║         3) 业务代码与框架代码完全分离                   ║
         * ╚═══════════════════════════════════════════════════════════╝
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // 判断顺序: 越专用越先匹配, 避免 monaco → antd → react 循环
          if (id.includes('/monaco-editor/') || id.includes('/@monaco-editor/')) return 'vendor-monaco';
          if (id.includes('/antd/') || id.includes('/@ant-design/')) return 'vendor-antd';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('/zustand/')) return 'vendor-zustand';
          if (id.includes('/framer-motion/')) return 'vendor-framer';
          if (id.includes('/axios/') || id.includes('/socket.io-client/')) return 'vendor-net';
          if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/rehype-') || id.includes('/react-virtuoso/')) return 'vendor-md';
          return 'vendor-other';
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
    esbuildOptions: { target: 'es2022' },
    /*
     * ╔═════════════════════════════════════════════════════════════╗
     * ║ 构建vs开发一致性修复 (P1): optimizeDeps.include          ║
     * ║ dev 模式下提前打包 antd/cssinjs/icons/react，避免 HMR   ║
     * ║ 动态转换导致"开发模式即时样式 vs 构建后静态样式"差异    ║
     * ╚═════════════════════════════════════════════════════════════╝
     */
    include: [
      'react', 'react-dom',
      'antd', '@ant-design/cssinjs', '@ant-design/icons', '@ant-design/icons-svg',
      'antd/locale/zh_CN',
      'zustand',
      'axios',
      'framer-motion',
    ],
  },
  worker: {
    format: 'es',
  },
  clearScreen: false,
});
