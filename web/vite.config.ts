import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 本地开发把中枢 API 代理到 wrangler dev（同源，绕开跨域 Cookie）
      '/api': 'http://localhost:8787',
    },
  },
})
