/**
 * TypeScript 严格配置
 * 禁用 any 类型，提升代码质量
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    // 构建配置
    sourcemap: false, // 生产环境关闭 source map
    minify: 'esbuild',
    target: 'es2020',
    
    // 代码分割优化
    rollupOptions: {
      output: {
        // 手动分包策略
        manualChunks: {
          // React 核心
          'react-vendor': ['react', 'react-dom'],
          // Ant Design
          'antd-vendor': ['antd', '@ant-design/icons'],
          // 编辑器
          'editor-vendor': ['@monaco-editor/react', 'monaco-editor'],
          // Socket IO
          'socket-vendor': ['socket.io-client'],
        },
        // 文件名 hash
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    
    // 体积控制
    assetsInlineLimit: 4096, // 小于 4KB 的资源内联
    cssCodeSplit: true, // CSS 代码分割
  },
});
