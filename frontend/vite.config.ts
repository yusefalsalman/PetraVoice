import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so a tunnel (or a phone on the LAN) can reach the dev server.
    host: true,
    port: 5173,
    // Fail instead of silently moving to 5174 — the tunnel command points at 5173.
    strictPort: true,
    // Vite rejects unknown Host headers; allow Cloudflare Quick Tunnel URLs (*.trycloudflare.com).
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // The app calls the relative path /api, so a phone on the tunnel hits
      // https://<tunnel>/api → this proxy → the backend on this machine. Never "localhost" on the phone.
      // API contract lives in ../CLAUDE.md
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
