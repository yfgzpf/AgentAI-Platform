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
  // Tauri 使用 tauri://localhost 协议, Vite dev 使用 http://localhost:5173
  // base: './' 在 Tauri 中相对路径解析不可靠 (多层路径下资源 404)
  // 改为 '/' 统一从根加载, 开发和生产行为一致
  base: '/',
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
        // ── vendor 分包策略 ───────────────────────────────────────────
        // 历史教训: 把 antd 拆散会导致 @ant-design/cssinjs 出现多实例、
        // CSS-in-JS 注入时序错乱 → Tauri WebView 样式黑屏。
        // 正确做法: antd 全家桶 (antd + @ant-design + rc-* + @rc-component)
        // 必须整包进同一个 chunk, 恰好也消除各懒组件里重复的 antd/单图标碎片。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // 注意: monaco-editor 不在这里强制分组。它带大量模块级副作用 (语言注册),
          // 一旦命名为共享 chunk, Rollup 会向所有业务 chunk 注入副作用空导入并把它
          // 提升进首屏 preload。Monaco 仅编辑器懒链使用, 返回 undefined 让其
          // 自然归入 Editor 懒 chunk, 不进首屏 vendor。
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return undefined;
          }
          // socket 长连接库独立 (聊天页外的页面不必立即加载)
          if (id.includes('socket.io') || id.includes('engine.io')) {
            return 'socket-vendor';
          }
          // antd 生态整包 — 禁止拆分 (含 cssinjs/icons/rc 底层组件)
          if (/[\\/]node_modules[\\/](?:@ant-design|antd|rc-[a-z0-9-]+|@rc-component)[\\/]/.test(id)) {
            return 'antd-vendor';
          }
          // react 核心
          if (/[\\/]node_modules[\\/](?:react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) {
            return 'react-vendor';
          }
          // markdown 渲染链路 (unified 生态, Thread 消息渲染) — 与通用 vendor 合并,
          // 避免与 vendor 互相引用产生循环 chunk
          // 其余第三方依赖 (dayjs/zustand/lucide/markdown 等)
          return 'vendor';
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    assetsInlineLimit: 4096,
    // CSS 代码分割: 让懒加载组件的 CSS 随 chunk 走
    // false 会把所有 CSS 打到一个文件, 导致生产态样式优先级与开发态不一致
    cssCodeSplit: true,
  },
});
