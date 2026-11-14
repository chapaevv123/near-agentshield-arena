const url=process.env.VITE_AGENTSHIELD_WORKER_URL?.trim()||'';
const valid=/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/.test(url);
if(url&&!valid){
  process.stderr.write('Invalid VITE_AGENTSHIELD_WORKER_URL; use the approved workers.dev origin without a path.\n');
  process.exit(1);
}
