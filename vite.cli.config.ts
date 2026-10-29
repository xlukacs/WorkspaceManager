import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@agent': resolve(__dirname, 'src/agent'),
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/cli'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'node20',
    ssr: resolve(__dirname, 'src/agent/main.ts'),
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        banner: '#!/usr/bin/env node'
      },
      external: (id) => id.startsWith('node:') || id === 'electron' || id === 'electron-store' || id === 'node-pty'
    }
  }
})
