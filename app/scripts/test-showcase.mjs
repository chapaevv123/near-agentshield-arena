import { spawn } from 'node:child_process';

const server = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', 'preview', '--config', 'vite.showcase.config.ts', '--configLoader', 'runner', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { stdio: 'ignore' });
let exit = 1;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview exited with ${server.exitCode}`);
    try { const response = await fetch('http://127.0.0.1:4182/'); if (response.ok) { ready = true; break; } } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Showcase preview did not become ready');
  const test = spawn(process.execPath, ['./node_modules/playwright/cli.js', 'test', '--config', 'playwright.showcase.config.ts'], { stdio: 'inherit' });
  exit = await new Promise((resolve) => test.on('exit', (code) => resolve(code ?? 1)));
} catch (error) { console.error(error); }
finally { server.kill(); }
process.exitCode = exit;
