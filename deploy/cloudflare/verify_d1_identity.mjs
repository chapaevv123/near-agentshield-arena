import {pathToFileURL} from 'node:url';

const expectedName='agentshield-lite';
const expectedId='7de64b16-19fd-4c65-85d9-458e6be4ce01';

export function verifyD1Identity(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    value.name===expectedName&&(value.uuid===expectedId||value.id===expectedId);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let input='';
  for await(const chunk of process.stdin)input+=chunk;
  let info;
  try{info=JSON.parse(input);}catch{process.stderr.write('D1 identity response is not JSON\n');process.exit(1);}
  if(!verifyD1Identity(info)){process.stderr.write('Remote D1 name/UUID mismatch; stop before migration or deploy\n');process.exit(1);}
  process.stdout.write('REMOTE_D1_IDENTITY_PASS\n');
}
