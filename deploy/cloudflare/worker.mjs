// Read-only cloud API. No signing key, broadcast route, or control-plane import.
const CONTRACT='agentshield-arena-v2-stage2.testnet';
const CODE_HASH='4f4xhV9UKijpuBxyu9rhjFQ8wrC5nv6XQYCAZ82XqwgA';
const GENESIS='FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
const RPC='https://test.rpc.fastnear.com';
const FRONTEND='https://near-agentshield-arena.vercel.app';
const ACCOUNT=/^(?:(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet|[0-9a-f]{64})$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const BASE58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const enc=new TextEncoder();
const err=(code,status=400)=>new Response(JSON.stringify({error:code}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const ok=(value)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'no-store'}});
const now=()=>Math.floor(Date.now()/1000);
const csp="default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://test.rpc.fastnear.com https://testnet-rpc.intea.rs https://mc.meteorwallet.app wss://mc.meteorwallet.app; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
function secure(response,request){const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');headers.set('Content-Security-Policy',csp);headers.set('Strict-Transport-Security','max-age=31536000');if(new URL(request.url).pathname.startsWith('/mvp-api/')){headers.append('Vary','Origin');if(request.headers.get('origin')===FRONTEND)headers.set('Access-Control-Allow-Origin',FRONTEND);}return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
function bytes64(value){if(typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('BAD_BASE64');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function b64(bytes){return btoa(String.fromCharCode(...bytes));}
function base58(value){let n=0n;for(const c of value){const digit=BASE58.indexOf(c);if(digit<0)throw Error('BAD_KEY');n=n*58n+BigInt(digit);}let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const body=n?Uint8Array.from(hex.match(/../g),s=>parseInt(s,16)):new Uint8Array();const zero=value.match(/^1*/)[0].length;return Uint8Array.from([...new Uint8Array(zero),...body]);}
function u32(n){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;}
function borshString(s){const b=enc.encode(s);return Uint8Array.from([...u32(b.length),...b]);}
async function sha(bytes){return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));}
async function hexSha(bytes){return Array.from(await sha(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
async function digest(message,nonce,recipient){return sha(Uint8Array.from([...u32(2147484061),...borshString(message),...nonce,...borshString(recipient),0]));}
async function rpc(method,params){try{const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'agentshield-cloud',method,params}),signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('RPC_UNAVAILABLE');const body=await response.json();if(body.error||!body.result)throw Error('RPC_UNAVAILABLE');return body.result;}catch{throw Error('RPC_UNAVAILABLE');}}
async function pinned(){const [status,account]=await Promise.all([rpc('status',[]),rpc('query',{request_type:'view_account',finality:'final',account_id:CONTRACT})]);if(status.chain_id!=='testnet'||status.genesis_hash!==GENESIS||account.code_hash!==CODE_HASH)throw Error('CHAIN_MISMATCH');}
async function view(method,args){const result=await rpc('query',{request_type:'call_function',finality:'final',account_id:CONTRACT,method_name:method,args_base64:b64(enc.encode(JSON.stringify(args)))});return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result)));}
function originOf(request){const u=new URL(request.url);if(u.protocol!=='https:'&&u.hostname!=='localhost'&&u.hostname!=='127.0.0.1')throw Error('HTTPS_REQUIRED');const claimed=request.headers.get('origin');if(claimed&&claimed!==u.origin&&claimed!==FRONTEND)throw Error('ORIGIN_MISMATCH');return claimed||u.origin;}
async function bodyOf(request){if(Number(request.headers.get('content-length')||0)>4096)throw Error('BODY_TOO_LARGE');const reader=request.body?.getReader();if(!reader)throw Error('BODY_INVALID');const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error('BODY_TOO_LARGE');}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}
async function session(request,env,origin){const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];if(!token)throw Error('AUTH_REQUIRED');const row=await env.DB.prepare('SELECT owner, origin, expires_at, revoked FROM sessions WHERE token_hash=?').bind(await hexSha(enc.encode(token))).first();if(!row||row.origin!==origin||row.revoked||row.expires_at<=now())throw Error('AUTH_REQUIRED');return row.owner;}
async function rateLimit(request,env,scope,limit){const bucket=Math.floor(now()/60),subject=await hexSha(enc.encode(request.headers.get('CF-Connecting-IP')||'unknown'));const result=await env.DB.prepare('INSERT INTO rate_limits(bucket,scope,subject_hash,hits) VALUES(?,?,?,1) ON CONFLICT(bucket,scope,subject_hash) DO UPDATE SET hits=hits+1 WHERE hits<?').bind(bucket,scope,subject,limit).run();if(result.meta.changes!==1)throw Error('RATE_LIMITED');if(scope==='auth')await env.DB.prepare('DELETE FROM rate_limits WHERE bucket<?').bind(bucket-1440).run();}
async function api(request,env,path){const origin=originOf(request),method=request.method,recipient=new URL(origin).host;
  if(path==='/mvp-api/health'&&method==='GET'){if(!env.DB)throw Error('D1_UNAVAILABLE');return ok({mode:'READ_ONLY',network:'testnet',contract:CONTRACT,executor:'BLOCKED'});}
  if(!env.DB)throw Error('D1_UNAVAILABLE');
  await rateLimit(request,env,'api',90);
  if(path==='/mvp-api/auth/challenge'||path==='/mvp-api/auth/verify')await rateLimit(request,env,'auth',6);
  if(path==='/mvp-api/auth/challenge'&&method==='POST'){
    const {account_id:owner}=await bodyOf(request);if(!ACCOUNT.test(owner))throw Error('ACCOUNT_INVALID');
    const nonce=crypto.getRandomValues(new Uint8Array(32)),expires_at=now()+300;
    const message=`AgentShield Arena cloud login\nDomain: agentshield.cloud.readonly.v1\nNetwork: testnet\nGenesis: ${GENESIS}\nAccount: ${owner}\nOrigin: ${origin}\nExpires: ${expires_at}\nRead-only access. No transaction or access key requested.`;
    await env.DB.prepare('INSERT INTO challenges(nonce_hash,owner,message,recipient,origin,expires_at,used) VALUES(?,?,?,?,?,?,0)').bind(await hexSha(nonce),owner,message,recipient,origin,expires_at).run();
    return ok({account_id:owner,message,nonce:b64(nonce),recipient,expires_at});
  }
  if(path==='/mvp-api/auth/verify'&&method==='POST'){
    const proof=await bodyOf(request);if(Object.keys(proof).sort().join(',')!=='account_id,nonce,public_key,signature')throw Error('PROOF_FIELDS');
    const nonce=bytes64(proof.nonce),signature=bytes64(proof.signature),key=String(proof.public_key||'');
    if(nonce.length!==32||signature.length!==64||!ACCOUNT.test(proof.account_id)||!key.startsWith('ed25519:'))throw Error('PROOF_INVALID');
    const keyBytes=base58(key.slice(8));if(keyBytes.length!==32)throw Error('PROOF_INVALID');
    const hash=await hexSha(nonce),challenge=await env.DB.prepare('SELECT * FROM challenges WHERE nonce_hash=?').bind(hash).first();
    if(!challenge||challenge.used||challenge.expires_at<=now()||challenge.owner!==proof.account_id||challenge.origin!==origin||challenge.recipient!==recipient)throw Error('CHALLENGE_INVALID');
    await pinned();const keys=(await rpc('query',{request_type:'view_access_key_list',finality:'final',account_id:proof.account_id})).keys;
    if(!keys?.some(k=>k.public_key===key&&k.access_key?.permission==='FullAccess'))throw Error('OWNER_KEY_NOT_FINAL');
    let valid=false;try{const cryptoKey=await crypto.subtle.importKey('raw',keyBytes,{name:'Ed25519'},false,['verify']);valid=await crypto.subtle.verify('Ed25519',cryptoKey,signature,await digest(challenge.message,nonce,recipient));}catch{throw Error('SIGNATURE_UNAVAILABLE');}
    if(!valid)throw Error('SIGNATURE_INVALID');
    const claim=await env.DB.prepare('UPDATE challenges SET used=1 WHERE nonce_hash=? AND used=0 AND expires_at>?').bind(hash,now()).run();
    if(claim.meta.changes!==1)throw Error('CHALLENGE_REPLAY');
    const token=b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''),expires_at=now()+1800;
    await env.DB.prepare('INSERT INTO sessions(token_hash,owner,origin,public_key,expires_at,revoked) VALUES(?,?,?,?,?,0)').bind(await hexSha(enc.encode(token)),proof.account_id,origin,key,expires_at).run();
    return ok({token,account_id:proof.account_id,expires_at,classification:'NEP413_ACCOUNT_VERIFIED'});
  }
  const owner=await session(request,env,origin);
  if(path==='/mvp-api/auth/logout'&&method==='POST'){const token=request.headers.get('authorization').slice(7);await env.DB.prepare('UPDATE sessions SET revoked=1 WHERE token_hash=? AND owner=?').bind(await hexSha(enc.encode(token)),owner).run();return ok({ok:true});}
  if(path==='/mvp-api/agent/shared'&&method==='GET'){
    const agent=env.SHARED_EXECUTOR_ACCOUNT,public_key=env.SHARED_EXECUTOR_PUBLIC_KEY;
    if(!agent||!public_key)return ok({owner,executor:null});
    if(!ACCOUNT.test(agent)||!public_key.startsWith('ed25519:'))throw Error('EXECUTOR_CONFIG_INVALID');
    await pinned();const keys=(await rpc('query',{request_type:'view_access_key_list',finality:'final',account_id:agent})).keys;
    const permission=keys?.find(k=>k.public_key===public_key)?.access_key?.permission?.FunctionCall;
    if(!permission||permission.receiver_id!==CONTRACT||!permission.allowance||
       BigInt(permission.allowance)>50000000000000000000000n||permission.method_names?.length!==2||
       !['request_payment','execute_payment'].every(m=>permission.method_names.includes(m)))throw Error('EXECUTOR_KEY_NOT_RESTRICTED');
    return ok({owner,executor:{agent,public_key}});
  }
  if(path==='/mvp-api/agent/status'&&method==='GET')return ok({owner,status:'BLOCKED_CLOUD_EXECUTOR'});
  if(path==='/mvp-api/preflight'&&method==='POST'){
    const input=await bodyOf(request),recipientId=input.recipient,amount=String(input.amount||'');
    if(!ACCOUNT.test(recipientId)||!/^[1-9][0-9]{0,40}$/.test(amount))throw Error('PREFLIGHT_INPUT');
    await pinned();const [vault,policy]=await Promise.all([view('get_vault',{owner}),view('get_policy_snapshot',{owner,recipient:recipientId})]);
    let reason='ALLOW';const n=BigInt(amount),at=BigInt(Date.now())*1000000n;
    if(!vault||!policy)reason='VAULT_OR_POLICY_MISSING';
    else if(Number(policy.policy_version)!==Number(vault[5]))reason='POLICY_CHANGED';
    else if(!vault[3]||vault[3]!==policy.agent||BigInt(vault[4])<=at||BigInt(policy.agent_expires_at_ns)<=at)reason='AGENT_GRANT_INACTIVE';
    else if(!policy.recipient_allowed)reason='RECIPIENT_DENIED';
    else if(n>BigInt(vault[0]))reason='INSUFFICIENT_VAULT_BALANCE';
    else if(n>BigInt(policy.max_payment))reason='PAYMENT_LIMIT';
    else if(BigInt(policy.spent)+BigInt(policy.reserved)+n>BigInt(policy.window_limit))reason='WINDOW_LIMIT';
    else if(n>BigInt(policy.approval_threshold))reason='EXTRA_APPROVAL_REQUIRED';
    return ok({classification:'POLICY_PREFLIGHT',owner,recipient:recipientId,amount,reason,allowed:reason==='ALLOW',policy_version:policy?.policy_version??null,contract_execution:false});
  }
  if(path==='/mvp-api/history/observe'&&method==='POST'){
    const {id}=await bodyOf(request);if(!ID.test(id))throw Error('PAYMENT_ID_INVALID');await pinned();
    const authorization=await view('get_payment_authorization',{owner,id});if(!authorization)throw Error('AUTHORIZATION_NOT_FINAL');
    await env.DB.prepare('INSERT OR IGNORE INTO observed_payments(owner,payment_id,observed_at) VALUES(?,?,?)').bind(owner,id,now()).run();return ok({owner,id,observed:true});
  }
  if(path==='/mvp-api/history'&&method==='GET'){
    await pinned();const rows=await env.DB.prepare('SELECT payment_id FROM observed_payments WHERE owner=? ORDER BY observed_at DESC LIMIT 16').bind(owner).all();
    const payments=[];for(const row of rows.results){const detail=await view('get_payment_details',{owner,id:row.payment_id});if(detail)payments.push({contract:CONTRACT,owner,id:row.payment_id,agent:null,recipient:detail[2],amount:detail[1],policy_version:detail[3],authorization_hash:null,state:['REQUESTED','AWAITING_APPROVAL','APPROVED','PENDING','SETTLED_CHAIN_STATE','FAILED','AUTHORIZED'][detail[0]]||'UNKNOWN',request_hash:null,execute_hash:null,updated_at:0});}
    return ok({owner,payments,classification:'FINAL_CHAIN_VIEW_NOT_RECEIPT_PROOF',source:'owner_observed_ids'});
  }
  return err('CLOUD_EXECUTOR_DISABLED',403);
}
export default {async fetch(request,env){try{const path=new URL(request.url).pathname;let response;if(path.startsWith('/mvp-api/')&&request.method==='OPTIONS'){originOf(request);const method=request.headers.get('access-control-request-method');const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);if(!['GET','POST'].includes(method)||requested.some(x=>!['authorization','content-type'].includes(x)))throw Error('CORS_PREFLIGHT_DENIED');response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});}else if(path==='/app'||path==='/app/'||path.startsWith('/app/'))response=await env.ASSETS.fetch(new Request(new URL('/app/index.html',request.url),request));else if(path.startsWith('/mvp-api/'))response=await api(request,env,path);else response=await env.ASSETS.fetch(request);return secure(response,request);}catch(error){const code=error instanceof Error?error.message:'UNAVAILABLE';const status=code==='AUTH_REQUIRED'?401:code==='ORIGIN_MISMATCH'?403:code==='RATE_LIMITED'?429:code==='RPC_UNAVAILABLE'||code==='CHAIN_MISMATCH'||code==='D1_UNAVAILABLE'||code==='SIGNATURE_UNAVAILABLE'?503:400;return secure(err(code,status),request);}}};
