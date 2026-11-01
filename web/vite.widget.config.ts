import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds the embeddable widget as one self-contained IIFE: dist/widget.js
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: 'src/widget/index.tsx', name: 'ElaraWidget', formats: ['iife'], fileName: () => 'widget.js' },
  },
})
