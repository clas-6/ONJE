import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4181,
    strictPort: true,
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
})
