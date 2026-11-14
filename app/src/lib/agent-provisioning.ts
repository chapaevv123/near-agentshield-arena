import {PublicKey} from '@near-js/crypto';
import {ACCOUNT,MVP_CONTRACT} from './mvp-core.ts';

export type ProvisioningPlan={owner:string;agent:string;namespace:string;
  owner_public_key:string;control_public_key:string;agent_public_key:string;
  contract:string;funding_yocto:string;actions:Array<Record<string,unknown>>;
  state:string;creation_hash?:string;public_key?:string};
export type ProvisioningStatus={owner:string;agent:string|null;state:string;
  plan:ProvisioningPlan|null};

export async function namespaceAgent(owner:string,namespace:string):Promise<string>{
  if(!ACCOUNT.test(owner)||!ACCOUNT.test(namespace)||namespace.length>24)
    throw new Error('A short approved Testnet agent namespace is required.');
  const input=new TextEncoder().encode(`AgentShield-Agent-v1\0${owner}`);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',input));
  const hex=Array.from(digest.slice(0,18),byte=>byte.toString(16).padStart(2,'0')).join('');
  const agent=`ag-${hex}.${namespace}`;
  if(!ACCOUNT.test(agent)||agent.length>64)throw new Error('Agent identity exceeds NEAR account limits.');
  return agent;
}

export async function checkedControlPlan(plan:ProvisioningPlan,owner:string){
  if(!ACCOUNT.test(owner)||plan.owner!==owner||
    plan.agent!==await namespaceAgent(owner,plan.namespace)||
    plan.contract!==MVP_CONTRACT||plan.state!=='AWAITING_CONTROL_PLANE'||
    plan.funding_yocto!=='50000000000000000000000'||
    new Set([plan.owner_public_key,plan.control_public_key,plan.agent_public_key]).size!==3)
    throw new Error('Agent control-plane plan is outside the approved scope.');
  for(const value of [plan.owner_public_key,plan.control_public_key,plan.agent_public_key])
    if(PublicKey.fromString(value).toString()!==value||!value.startsWith('ed25519:'))
      throw new Error('Invalid agent or control-plane public key.');
  const exact=[{CreateAccount:{}},{Transfer:{deposit:plan.funding_yocto}},
    {AddKey:{public_key:plan.control_public_key,access_key:{nonce:0,permission:'FullAccess'}}},
    {AddKey:{public_key:plan.agent_public_key,access_key:{nonce:0,
      permission:{FunctionCall:{receiver_id:MVP_CONTRACT,
        method_names:['request_payment','execute_payment'],
        allowance:'50000000000000000000000'}}}}}];
  if(JSON.stringify(plan.actions)!==JSON.stringify(exact))
    throw new Error('Agent creation actions or restricted permissions changed.');
}

function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function checkedControlIntent(payload:Record<string,unknown>,plan:ProvisioningPlan,
  purpose:'creation'|'deletion',owner:string,origin:string,genesis:string){
  const recipient=new URL(origin).host;
  const scope=purpose==='creation'?{
    owner,agent:plan.agent,namespace:plan.namespace,owner_public_key:plan.owner_public_key,
    control_public_key:plan.control_public_key,agent_public_key:plan.agent_public_key,
    contract:plan.contract,funding_yocto:plan.funding_yocto,actions:plan.actions
  }:{owner,agent:plan.agent,namespace:plan.namespace,owner_public_key:plan.owner_public_key,
    control_public_key:plan.control_public_key,agent_public_key:plan.public_key,
    contract:plan.contract,funding_yocto:'0',actions:plan.actions};
  const exact={domain:'agentshield.control-intent.v1',network:'testnet',genesis_hash:genesis,
    origin,recipient,purpose,tx_receiver:plan.agent,scope,
    request_id:payload.request_id,nonce:payload.nonce,expires_at:payload.expires_at};
  if(Object.keys(payload).sort().join(',')!==Object.keys({...exact,message:''}).sort().join(',')||
    typeof payload.request_id!=='string'||!/^[0-9a-f]{32}$/.test(payload.request_id)||
    typeof payload.nonce!=='string'||typeof payload.expires_at!=='number'||
    payload.expires_at<=Date.now()/1000||payload.expires_at>Date.now()/1000+900||
    canonical(payload.scope)!==canonical(scope)||
    payload.message!==`AgentShield Arena control intent\n${canonical(exact)}`)
    throw new Error('Control intent differs from the reviewed agent plan.');
}
