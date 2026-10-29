import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Match the app build (@vitejs/plugin-react), which uses the automatic JSX runtime.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@agent': resolve(__dirname, 'src/agent'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: []
  }
})
