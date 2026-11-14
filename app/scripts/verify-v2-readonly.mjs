// Read-only Testnet ABI check. No wallet, signing, or broadcast calls.
const rpc='https://test.rpc.fastnear.com';
const contract='agentshield-arena-v2-stage2.testnet';
const owner='safeibis9110.testnet';
const expectedCode='4f4xhV9UKijpuBxyu9rhjFQ8wrC5nv6XQYCAZ82XqwgA';
const expectedGenesis='FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';

async function query(method,params){
  const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:'agentshield-lite-readonly',method,params}),
    signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(`RPC_HTTP_${response.status}`);
  const payload=await response.json();
  if(payload.error||!payload.result)throw Error('RPC_RESULT_UNAVAILABLE');
  return payload.result;
}
async function view(method,args){
  const bytes=new TextEncoder().encode(JSON.stringify(args));
  const args_base64=Buffer.from(bytes).toString('base64');
  const result=await query('query',{request_type:'call_function',finality:'final',account_id:contract,method_name:method,args_base64});
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result)));
}
const [network,account]=await Promise.all([
  query('status',[]),
  query('query',{request_type:'view_account',finality:'final',account_id:contract}),
]);
if(network.chain_id!=='testnet'||network.genesis_hash!==expectedGenesis||account.code_hash!==expectedCode)
  throw Error('VAULT_V2_PIN_MISMATCH');
const [vault,policy]=await Promise.all([
  view('get_vault',{owner}),
  view('get_policy_snapshot',{owner,recipient:owner}),
]);
if(!Array.isArray(vault)||vault.length!==6||!policy||String(policy.policy_version)!==String(vault[5]))
  throw Error('VAULT_V2_ABI_MISMATCH');
console.log(`VAULT_V2_READONLY_PASS contract=${contract} owner=${owner} policy_version=${vault[5]}`);
