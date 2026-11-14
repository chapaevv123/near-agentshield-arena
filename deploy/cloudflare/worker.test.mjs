import {test,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import worker from './worker.mjs';

const origin='https://arena.example';
const genesis='FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
const code='4f4xhV9UKijpuBxyu9rhjFQ8wrC5nv6XQYCAZ82XqwgA';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
function base58(bytes){let value=BigInt('0x'+Buffer.from(bytes).toString('hex'));let out='';while(value){out=alphabet[Number(value%58n)]+out;value/=58n;}return out;}
const key='ed25519:'+base58(publicKey.export({format:'der',type:'spki'}).subarray(-32));
const h=(bytes)=>createHash('sha256').update(bytes).digest('hex');
let network='testnet';
const u32=(n)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const str=(s)=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)]);
const db={challenges:new Map(),sessions:new Map(),observed:new Map(),rates:new Map(),prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){if(sql.startsWith('SELECT * FROM challenges'))return db.challenges.get(args[0])??null;if(sql.startsWith('SELECT owner, origin'))return db.sessions.get(args[0])??null;throw Error(sql);},async run(){if(sql.startsWith('INSERT INTO rate_limits')){const id=args.slice(0,3).join(':');const hits=db.rates.get(id)||0;if(hits>=args[3])return {meta:{changes:0}};db.rates.set(id,hits+1);return {meta:{changes:1}};}if(sql.startsWith('DELETE FROM rate_limits')){for(const key of db.rates.keys())if(Number(key.split(':')[0])<args[0])db.rates.delete(key);return {meta:{changes:1}};}if(sql.startsWith('INSERT INTO challenges')){db.challenges.set(args[0],{nonce_hash:args[0],owner:args[1],message:args[2],recipient:args[3],origin:args[4],expires_at:args[5],used:0});return {meta:{changes:1}};}if(sql.startsWith('UPDATE challenges')){const row=db.challenges.get(args[0]);if(!row||row.used||row.expires_at<=args[1])return {meta:{changes:0}};row.used=1;return {meta:{changes:1}};}if(sql.startsWith('INSERT INTO sessions')){db.sessions.set(args[0],{owner:args[1],origin:args[2],public_key:args[3],expires_at:args[4],revoked:0});return {meta:{changes:1}};}if(sql.startsWith('UPDATE sessions')){const row=db.sessions.get(args[0]);if(row&&row.owner===args[1])row.revoked=1;return {meta:{changes:1}};}if(sql.startsWith('INSERT OR IGNORE')){db.observed.set(args[0]+':'+args[1],{owner:args[0],payment_id:args[1],observed_at:args[2]});return {meta:{changes:1}};}throw Error(sql);},async all(){if(sql.startsWith('SELECT payment_id'))return {results:[...db.observed.values()].filter(x=>x.owner===args[0]).map(x=>({payment_id:x.payment_id}))};throw Error(sql);}};}};
beforeEach(()=>db.rates.clear());
const env={DB:db,ASSETS:{fetch:async()=>new Response('asset')}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async (_url,init)=>{const {method,params}=JSON.parse(init.body);let result;
  if(method==='status')result={chain_id:network,genesis_hash:genesis};
  else if(params.request_type==='view_account')result={code_hash:code};
  else if(params.request_type==='view_access_key_list')result={keys:[{public_key:key,access_key:{permission:'FullAccess'}}]};
  else if(params.request_type==='call_function'){const args=JSON.parse(Buffer.from(params.args_base64,'base64'));
    let value=null;
    if(params.method_name==='get_vault')value=['100','0','0','shared.testnet',String(BigInt(Date.now()+60000)*1000000n),1];
    if(params.method_name==='get_policy_snapshot')value={agent:'shared.testnet',agent_expires_at_ns:String(BigInt(Date.now()+60000)*1000000n),recipient_allowed:args.recipient==='allowed.testnet',max_payment:'10',window_limit:'20',spent:'0',reserved:'0',approval_threshold:'5',policy_version:'1'};
    if(params.method_name==='get_payment_authorization'&&args.id==='pay1')value=[6,'shared.testnet','allowed.testnet','1',1,'9999999999999999999'];
    if(params.method_name==='get_payment_details'&&args.id==='pay1')value=[6,'1','allowed.testnet',1,0];
    result={result:[...Buffer.from(JSON.stringify(value))]};}
  return new Response(JSON.stringify({result}),{headers:{'content-type':'application/json'}});
};
after(()=>{globalThis.fetch=originalFetch;});
async function call(path,body,token,method=body?'POST':'GET',host=origin){const response=await worker.fetch(new Request(host+path,{method,headers:{...(body?{'content-type':'application/json',origin:host}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);return [response.status,await response.json()];}
async function login(owner='alice.testnet'){
  const [status,challenge]=await call('/mvp-api/auth/challenge',{account_id:owner});assert.equal(status,200);
  const nonce=Buffer.from(challenge.nonce,'base64');const digest=createHash('sha256').update(Buffer.concat([u32(2147484061),str(challenge.message),nonce,str(challenge.recipient),Buffer.from([0])])).digest();
  const signature=sign(null,digest,privateKey).toString('base64');
  return {challenge,proof:{account_id:owner,public_key:key,signature,nonce:challenge.nonce}};
}
test('NEP-413 owner proof, altered owner, replay and cloud scope',async()=>{
  const {proof}=await login();assert.equal((await call('/mvp-api/auth/verify',{...proof,account_id:'bob.testnet'}))[0],400);
  const [status,session]=await call('/mvp-api/auth/verify',proof);assert.equal(status,200);
  assert.equal((await call('/mvp-api/auth/verify',proof))[0],400);
  assert.equal((await call('/mvp-api/history',undefined,session.token))[1].owner,'alice.testnet');
  assert.equal((await call('/mvp-api/history/observe',{id:'missing'},session.token))[0],400);
  assert.equal((await call('/mvp-api/history/observe',{id:'pay1'},session.token))[0],200);
  assert.equal((await call('/mvp-api/history',undefined,session.token))[1].payments[0].state,'AUTHORIZED');
  assert.equal((await call('/mvp-api/payments/pay1/execute',{},session.token))[0],403);
  assert.equal((await call('/mvp-api/agent/shared',undefined,session.token))[1].executor,null);
  assert.equal((await call('/mvp-api/preflight',{recipient:'blocked.testnet',amount:'1'},session.token))[1].reason,'RECIPIENT_DENIED');
  assert.equal((await call('/mvp-api/preflight',{recipient:'allowed.testnet',amount:'11'},session.token))[1].reason,'PAYMENT_LIMIT');
  assert.equal((await call('/mvp-api/preflight',{recipient:'allowed.testnet',amount:'1'},session.token))[1].classification,'POLICY_PREFLIGHT');
  assert.equal((await call('/mvp-api/auth/logout',{},session.token))[0],200);
  assert.equal((await call('/mvp-api/history',undefined,session.token))[0],401);
});
test('expired challenge and origin mismatch deny',async()=>{
  const {proof}=await login('bob.testnet');db.challenges.get(h(Buffer.from(proof.nonce,'base64'))).expires_at=0;
  assert.equal((await call('/mvp-api/auth/verify',proof))[0],400);
  const fresh=await login('bob.testnet');assert.equal((await call('/mvp-api/auth/verify',fresh.proof,undefined,'POST','https://evil.example'))[0],400);
});
test('signature tampering, wrong network and concurrent replay deny',async()=>{
  const invalid=await login('carol.testnet');
  assert.equal((await call('/mvp-api/auth/verify',{...invalid.proof,signature:Buffer.alloc(64).toString('base64')}))[1].error,'SIGNATURE_INVALID');
  network='mainnet';
  assert.equal((await call('/mvp-api/auth/verify',invalid.proof))[1].error,'CHAIN_MISMATCH');
  network='testnet';
  const two=await Promise.all([call('/mvp-api/auth/verify',invalid.proof),call('/mvp-api/auth/verify',invalid.proof)]);
  assert.deepEqual(two.map(x=>x[0]).sort(),[200,400]);
});
test('approved Vercel origin gets scoped CORS and NEP-413 recipient',async()=>{
  const frontend='https://near-agentshield-arena.vercel.app';
  const preflight=await worker.fetch(new Request(origin+'/mvp-api/auth/challenge',{method:'OPTIONS',headers:{origin:frontend,'access-control-request-method':'POST','access-control-request-headers':'content-type, authorization'}}),env);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),frontend);
  const challengeResponse=await worker.fetch(new Request(origin+'/mvp-api/auth/challenge',{method:'POST',headers:{origin:frontend,'content-type':'application/json'},body:JSON.stringify({account_id:'vercel.testnet'})}),env);
  assert.equal(challengeResponse.status,200);
  assert.equal(challengeResponse.headers.get('access-control-allow-origin'),frontend);
  const challenge=await challengeResponse.json();
  assert.equal(challenge.recipient,'near-agentshield-arena.vercel.app');
  assert.match(challenge.message,/Origin: https:\/\/near-agentshield-arena\.vercel\.app/);
  const denied=await worker.fetch(new Request(origin+'/mvp-api/auth/challenge',{method:'OPTIONS',headers:{origin:'https://evil.example','access-control-request-method':'POST'}}),env);
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('access-control-allow-origin'),null);
});
test('security headers, foreign-origin denial, rate limit and RPC outage',async()=>{
  const asset=await worker.fetch(new Request(origin+'/app'),env);
  assert.equal(asset.headers.get('x-content-type-options'),'nosniff');
  assert.match(asset.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const noDb=await worker.fetch(new Request(origin+'/mvp-api/health'),{ASSETS:env.ASSETS});
  assert.equal(noDb.status,503);
  const cross=await worker.fetch(new Request(origin+'/mvp-api/auth/challenge',{method:'POST',headers:{origin:'https://other.example'},body:'{}'}),env);
  assert.equal(cross.status,403);assert.equal(cross.headers.get('access-control-allow-origin'),null);
  const oversized=await worker.fetch(new Request(origin+'/mvp-api/auth/challenge',{method:'POST',headers:{origin},body:'x'.repeat(5000)}),env);
  assert.equal(oversized.status,400);assert.deepEqual(await oversized.json(),{error:'BODY_TOO_LARGE'});
  let limited=false;for(let i=0;i<10;i++){const [status]=await call('/mvp-api/auth/challenge',{account_id:'rate.testnet'});if(status===429){limited=true;break;}}
  assert.equal(limited,true);
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('private network detail');};
  try{const response=await worker.fetch(new Request(origin+'/mvp-api/auth/verify',{method:'POST',headers:{origin,'CF-Connecting-IP':'198.51.100.24'},body:'{}'}),env);assert.equal(response.status,400);const session=await loginWithIp();const outage=await worker.fetch(new Request(origin+'/mvp-api/auth/verify',{method:'POST',headers:{origin,'CF-Connecting-IP':'198.51.100.25'},body:JSON.stringify(session.proof)}),env);assert.equal(outage.status,503);assert.deepEqual(await outage.json(),{error:'RPC_UNAVAILABLE'});}finally{globalThis.fetch=original;}
});
async function loginWithIp(){const response=await worker.fetch(new Request(origin+'/mvp-api/auth/challenge',{method:'POST',headers:{origin,'CF-Connecting-IP':'198.51.100.25'},body:JSON.stringify({account_id:'outage.testnet'})}),env);const challenge=await response.json();const nonce=Buffer.from(challenge.nonce,'base64');const digest=createHash('sha256').update(Buffer.concat([u32(2147484061),str(challenge.message),nonce,str(challenge.recipient),Buffer.from([0])])).digest();return {proof:{account_id:'outage.testnet',public_key:key,signature:sign(null,digest,privateKey).toString('base64'),nonce:challenge.nonce}};}
