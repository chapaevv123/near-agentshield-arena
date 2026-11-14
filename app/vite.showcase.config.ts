import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'showcase',
  define: { global: 'globalThis', 'process.env.DEFAULT_FINALITY': '"near-final"' },
  resolve: {alias: {
    buffer: fileURLToPath(new URL('./node_modules/buffer/index.js', import.meta.url)),
    util: fileURLToPath(new URL('../tools/meteor-tx-preview/src/util-shim.mjs', import.meta.url)),
    mustache: fileURLToPath(new URL('./node_modules/mustache/mustache.mjs', import.meta.url)),
  }},
  build: { outDir: '../dist-showcase', emptyOutDir: true, sourcemap: false,
    rollupOptions: {input: ['showcase/index.html']} },
  server: { host: '127.0.0.1', port: 4182 },
  preview: { host: '127.0.0.1', port: 4182,
    allowedHosts: process.env.AGENTSHIELD_STAGING_HOST ? [process.env.AGENTSHIELD_STAGING_HOST] : [],
    proxy: {'/mvp-api': {target: 'http://127.0.0.1:8787', changeOrigin: false}},
    headers: {
      'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin',
      'X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self' https://test.rpc.fastnear.com https://testnet-rpc.intea.rs https://mc.meteorwallet.app wss://mc.meteorwallet.app; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    } },
});
