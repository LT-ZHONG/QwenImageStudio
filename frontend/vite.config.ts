import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', ws: true, changeOrigin: true },
    },
  },
})
