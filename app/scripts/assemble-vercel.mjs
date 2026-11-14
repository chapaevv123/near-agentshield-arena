import {cp,copyFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const source=resolve(root,'dist-mvp');
const target=resolve(root,'dist-showcase');
await stat(resolve(source,'mvp.html'));
await cp(resolve(source,'assets'),resolve(target,'assets'),{recursive:true,force:true});
await mkdir(resolve(target,'app'),{recursive:true});
await copyFile(resolve(source,'mvp.html'),resolve(target,'app','index.html'));
console.log('VERCEL_APP_ASSEMBLED: real Vault workspace at /app/');
