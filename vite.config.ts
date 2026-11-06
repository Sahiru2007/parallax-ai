import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/artifacts/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
  },
  preview: {
    port: 1421,
    strictPort: true,
    host: '127.0.0.1',
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    },
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2022', assetsInlineLimit: 0 },
})
