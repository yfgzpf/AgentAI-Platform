import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789',
          changeOrigin: true,
        },
        '/ws': {
          target: env.VITE_GATEWAY_WS_URL || 'ws://127.0.0.1:18789',
          ws: true,
        },
      },
    },
  }
})
