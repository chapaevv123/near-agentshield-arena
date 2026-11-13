import { defineConfig } from 'vite';

export default defineConfig({
  root: 'showcase',
  build: { outDir: '../dist-showcase', emptyOutDir: true, sourcemap: false },
  server: { host: '127.0.0.1', port: 4182 },
  preview: { host: '127.0.0.1', port: 4182 },
});
