import {setVaultContext} from './near.ts';

export type RuntimeTask={
  id:string;goal:string;status:string;mode:string;payment_id:string;scenario_id:string|null;
  owner:string;vault_id:string;
  plan:Record<string,unknown>|null;preflight:Record<string,unknown>|null;tool_result:Record<string,unknown>|null;
  error_code:string|null;created_at:number;updated_at:number;attempts:number;
};
export type RuntimeEvent={id:number;task_id:string|null;at:number;severity:string;type:string;provenance:string;detail:Record<string,unknown>};
export type RuntimeMonitor={runtime:string;workers:number;provider:{available:boolean;model:string;error?:string};
  rpc:{available:boolean;policy_version?:number;error?:string};signer:string;task_counts:Record<string,number>;recent_events:RuntimeEvent[]};
export type RuntimeVault={account_id:string;owner:string;agent:string;code_hash:string;registered_at:number};
export type RuntimeAgentConfig={vault_id:string;owner:string;model:string;enabled:boolean|number;default_mode:'DRY_RUN'|'OWNER_APPROVAL';source?:string};
export class RuntimeApiError extends Error {
  code:string;status:number;
  constructor(code:string,status:number,message:string){super(message);this.name='RuntimeApiError';
    this.code=code;this.status=status;}
}
let activeVault='';
let activeAccount='';
export function setRuntimeAccount(accountId:string){activeAccount=accountId;}
export function getRuntimeAccount(){return activeAccount;}
export function getRuntimeVault(){return activeVault;}
export function selectRuntimeVault(accountId:string,owner=''){
  activeVault=accountId;
  setVaultContext(accountId,owner);
  globalThis.dispatchEvent?.(new Event('agentshield-vault-changed'));
}

export async function runtimeCall<T>(path:string,token='',method:'GET'|'POST'='GET',body?:Record<string,unknown>,vaultOverride?:string,timeoutMs=15000):Promise<T>{
  let response:Response;
  try{response=await fetch('/api/v1'+path,{method,headers:{
    ...(token?{Authorization:'Bearer '+token}:{}),
    ...((vaultOverride??activeVault)?{'X-AgentShield-Vault':vaultOverride??activeVault}:{}),
    ...(method==='POST'?{'Content-Type':'application/json'}:{}),
  },body:method==='POST'?JSON.stringify(body??{}):undefined,signal:AbortSignal.timeout(timeoutMs),cache:'no-store'});
  }catch(error){
    if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError'))
      throw new RuntimeApiError('RUNTIME_TIMEOUT',0,
        `AgentShield API timed out after ${Math.ceil(timeoutMs/1000)} seconds. The read-only check may still be running; retry it after checking the local launcher. No wallet transaction was sent.`);
    throw new RuntimeApiError('RUNTIME_NETWORK',0,
      'AgentShield API network connection failed. Check the local launcher and reload this page. No wallet transaction was sent.');
  }
  let payload:Record<string,unknown>;
  try{
    const contentType=response.headers.get('content-type')??'';
    if(!contentType.toLowerCase().includes('application/json'))throw new Error('Non-JSON');
    payload=await response.json() as Record<string,unknown>;
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid JSON');
  }catch{throw new RuntimeApiError('RUNTIME_INVALID_RESPONSE',response.status,
    `AgentShield API returned an invalid response (HTTP ${response.status}). Check that the local Arena launcher is running, then reload. No wallet transaction was sent.`);}
  if(!response.ok){
    const code=String(payload.error??'HTTP_ERROR');
    throw new RuntimeApiError(code,response.status,
      `AgentShield API HTTP ${response.status} [${code}]: ${String(payload.message??'Request failed')}`);
  }
  return payload as T;
}

export async function exactIntentHash(plan:Record<string,unknown>):Promise<string>{
  const ordered=Object.fromEntries(Object.entries(plan).sort(([a],[b])=>a<b?-1:a>b?1:0));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
