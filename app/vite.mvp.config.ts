import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  define:{global:'globalThis','process.env.DEFAULT_FINALITY':'"near-final"'},
  resolve:{alias:{
    buffer:fileURLToPath(new URL('./node_modules/buffer/index.js',import.meta.url)),
    util:fileURLToPath(new URL('../tools/meteor-tx-preview/src/util-shim.mjs',import.meta.url)),
    mustache:fileURLToPath(new URL('./node_modules/mustache/mustache.mjs',import.meta.url)),
  }},
  build:{outDir:'dist-mvp',sourcemap:false,rollupOptions:{input:'mvp.html'}},
});
