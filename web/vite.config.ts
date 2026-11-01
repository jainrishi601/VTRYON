import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backend = process.env.ELARA_API ?? 'http://localhost:8000'
const proxy = { '/api': backend, '/media': backend, '/admin': backend }

// Dev only: serve the widget entry at /widget.js so the store embeds it through a real
// <script src="/widget.js"> tag, exactly as a merchant would. The production build emits dist/widget.js.
const widgetDev = (): Plugin => ({
  name: 'elara-widget-dev',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/widget.js') return next()
      res.setHeader('Content-Type', 'text/javascript')
      res.end(`window.__ELARA_SCRIPT__ = document.currentScript; import('/src/widget/index.tsx');`)
    })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), widgetDev()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
})
