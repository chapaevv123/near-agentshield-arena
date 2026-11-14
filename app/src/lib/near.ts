import type { Account, Payment, Policy } from './types';

export const RPC = (import.meta as ImportMeta & {env?:{VITE_NEAR_RPC?:string}}).env?.VITE_NEAR_RPC || 'https://test.rpc.fastnear.com';
export const TESTNET_GENESIS='FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
export const HISTORIC_VAULT = 'agentshield-vault-8315.testnet';
export let VAULT = HISTORIC_VAULT;
let expectedOwner = 'openroom8315.testnet';
export function setVaultContext(vault:string,owner:string){
  VAULT=vault||HISTORIC_VAULT;
  expectedOwner=owner||'openroom8315.testnet';
}
export const EXPECTED_CODE_HASH = 'C3rQmShHDfvcArXcAY6P1RcopVWM1ApkrF4am4g5cJbg';
export const NEW_VAULT_CODE_HASH = 'CPAuxkw9L3pVmzRPm4MT52LfusLCLrAtAFBgnMQuzwc5';
const encoder = new TextEncoder();

export async function rpc<T>(method:string, params:unknown):Promise<T> {
  const response = await fetch(RPC, {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:'agentshield-app',method,params}),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json() as {result?:T;error?:{message?:string;data?:string}};
  if (body.error) throw new Error(`RPC: ${body.error.message ?? 'unknown error'}`);
  if (body.result === undefined) throw new Error('RPC returned no result');
  return body.result;
}

function base64(value:unknown):string {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary=''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function view<T>(method:string,args:object={},vaultId=VAULT):Promise<T> {
  const result = await rpc<{result:number[]}>('query',{request_type:'call_function',finality:'final',account_id:vaultId,method_name:method,args_base64:base64(args)});
  if (!Array.isArray(result.result)) throw new Error(`Invalid ${method} view response`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

export async function account(id:string):Promise<Account> {
  return rpc<Account>('query',{request_type:'view_account',finality:'final',account_id:id});
}

export async function readState():Promise<{policy:Policy;vault:Account;chain:string}> {
  const vaultId=VAULT,owner=expectedOwner;
  const [status, vault, policy] = await Promise.all([
    rpc<{chain_id:string}>('status',[]), account(vaultId), view<Policy>('get_policy',{},vaultId)]);
  if (status.chain_id !== 'testnet') throw new Error(`Unexpected chain ${status.chain_id}`);
  if (vault.code_hash !== (vaultId===HISTORIC_VAULT?EXPECTED_CODE_HASH:NEW_VAULT_CODE_HASH)) throw new Error('Deployed code hash differs from audited contract');
  if (policy.owner !== owner || !Number.isSafeInteger(policy.version)) throw new Error('Unexpected policy owner or version');
  return {policy,vault,chain:status.chain_id};
}

export async function readPayment(id:string):Promise<Payment|null> {
  if (!/^[\x21-\x7e]{1,64}$/.test(id)) throw new Error('Payment ID must be 1–64 printable ASCII characters');
  return view<Payment|null>('get_payment',{id});
}

export async function readCurrentUsage(windowNs:number):Promise<{window_id:number;settled:string;reserved:string}> {
  const block=await rpc<{header:{timestamp_nanosec:string}}>('block',{finality:'final'});
  const windowId=BigInt(block.header.timestamp_nanosec)/BigInt(windowNs);
  if (windowId>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Window ID exceeds safe JSON integer range');
  return view('get_usage',{window_id:Number(windowId)});
}

export function nearAmount(yocto:string):string {
  const n=BigInt(yocto); const whole=n/10n**24n; const fraction=(n%10n**24n).toString().padStart(24,'0').slice(0,6).replace(/0+$/,'');
  return `${whole}${fraction?'.'+fraction:''}`;
}

export function parseNear(input:string):bigint {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,24})?$/.test(input)) throw new Error('Enter an exact NEAR amount with at most 24 decimals');
  const [whole,fraction='']=input.split('.'); return BigInt(whole)*10n**24n+BigInt(fraction.padEnd(24,'0'));
}
