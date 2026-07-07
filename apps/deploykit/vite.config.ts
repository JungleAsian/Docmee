import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite builds the Tauri webview frontend (src/ui). The Node-side orchestrator
// (src/main.ts and src/steps/*) is compiled separately by tsc and never bundled
// into the browser bundle.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist-web', target: 'es2022' },
})
