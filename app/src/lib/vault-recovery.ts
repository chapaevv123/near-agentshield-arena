import {account,rpc,NEW_VAULT_CODE_HASH} from './near.ts';
import {VAULT_WASM_BYTES,VAULT_WASM_SHA256} from './vault-deploy.ts';
import type {deploymentReview} from './vault-deploy.ts';

export type DeploymentStatus='READY_FOR_WALLET_REVIEW'|'USER_CANCELLED'|'WALLET_OUTCOME_UNKNOWN'|
  'TRANSACTION_FAILED'|'DEPLOYMENT_CONFIRMED'|'DEPLOYMENT_VERIFICATION_FAILED';
export type PendingDeployment={accountId:string;agentId:string;hash?:string;startedAt:number;
  review?:Awaited<ReturnType<typeof deploymentReview>>;ownerPublicKey?:string;
  cancelEvidence?:'METEOR_USER_CANCELLED'};
const KEY='agentshield-pending-vault';
const AUDIT_KEY='agentshield-deployment-audit';
const EMPTY='11111111111111111111111111111111';

export function pendingDeployment():PendingDeployment|null{
  try{
    let durable:string|null=null;
    try{durable=localStorage.getItem(KEY);}catch{}
    const raw=durable??sessionStorage.getItem(KEY);
    if(!raw)return null;
    if(!durable)try{localStorage.setItem(KEY,raw);}catch{}
    const value=JSON.parse(raw) as Partial<PendingDeployment>;
    if(typeof value.accountId!=='string'||typeof value.agentId!=='string')return null;
    return {accountId:value.accountId,agentId:value.agentId,
      hash:typeof value.hash==='string'?value.hash:undefined,
      startedAt:typeof value.startedAt==='number'?value.startedAt:0,
      review:value.review,ownerPublicKey:value.ownerPublicKey,
      cancelEvidence:value.cancelEvidence==='METEOR_USER_CANCELLED'?value.cancelEvidence:undefined};
  }catch{return null;}
}
export function savePending(value:PendingDeployment){
  const raw=JSON.stringify(value);
  sessionStorage.setItem(KEY,raw);
  localStorage.setItem(KEY,raw);
}
export function clearPending(){
  try{localStorage.removeItem(KEY);}catch{}
  sessionStorage.removeItem(KEY);
}
export function isMeteorCancellation(error:unknown):boolean{
  if(!(error instanceof Error)||error.name!=='MeteorActionError')return false;
  const reason=(error as Error&{_reason?:{endTags?:unknown}})._reason;
  return Array.isArray(reason?.endTags)&&reason.endTags.includes('USER_CANCELLED');
}
export function classifyDeploymentError(error:unknown,hash?:string):DeploymentStatus{
  if(hash)return 'DEPLOYMENT_VERIFICATION_FAILED';
  if(isMeteorCancellation(error))return 'USER_CANCELLED';
  return 'WALLET_OUTCOME_UNKNOWN';
}
export function recordDeploymentAudit(accountId:string,event:string,details:Record<string,string>={}){
  try{
    const prior=JSON.parse(localStorage.getItem(AUDIT_KEY)??'[]') as unknown;
    const entries=Array.isArray(prior)?prior.slice(-49):[];
    entries.push({at:new Date().toISOString(),accountId,event,details});
    localStorage.setItem(AUDIT_KEY,JSON.stringify(entries));
  }catch{/* Audit storage failure must not grant deployment permission. */}
}
export function deploymentAudit(accountId:string){
  try{const entries=JSON.parse(localStorage.getItem(AUDIT_KEY)??'[]') as unknown;
    return Array.isArray(entries)?entries.filter(item=>item?.accountId===accountId):[];
  }catch{return [];}
}

type RecoveryTx={final_execution_status:string;status:Record<string,unknown>;
  transaction?:{hash?:string;signer_id?:string;receiver_id?:string;actions?:Record<string,unknown>[]};
  receipts_outcome?:{outcome:{status:Record<string,unknown>}}[]};
function decoded(value:unknown):Uint8Array|null{
  if(typeof value!=='string')return null;
  try{return Uint8Array.from(atob(value),char=>char.charCodeAt(0));}catch{return null;}
}
export async function matchesPendingDeploymentTx(tx:RecoveryTx,pending:PendingDeployment):Promise<boolean>{
  if(!pending.hash||!pending.review||pending.review.sha256!==VAULT_WASM_SHA256||
     tx.transaction?.hash!==pending.hash||tx.transaction.signer_id!==pending.accountId||
     tx.transaction.receiver_id!==pending.accountId||tx.transaction.actions?.length!==2)return false;
  const actions=tx.transaction.actions;
  const deploy=actions[0]?.DeployContract as {code?:unknown}|undefined;
  const call=actions[1]?.FunctionCall as {method_name?:unknown;args?:unknown;gas?:unknown;deposit?:unknown}|undefined;
  if(!deploy||!call||call.method_name!=='new'||String(call.gas)!==pending.review.gas||
     String(call.deposit)!==pending.review.deposit)return false;
  const wasm=decoded(deploy.code),args=decoded(call.args);
  if(!wasm||wasm.length!==VAULT_WASM_BYTES||!args)return false;
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(wasm)));
  const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(hash!==VAULT_WASM_SHA256)return false;
  try{return JSON.stringify(JSON.parse(new TextDecoder().decode(args)))===JSON.stringify(pending.review.init);}
  catch{return false;}
}

export async function reconcilePending(pending:PendingDeployment):Promise<{
  status:DeploymentStatus;message:string;codeHash:string;transaction?:unknown}>{
  const state=await account(pending.accountId);
  if(state.code_hash!==EMPTY&&state.code_hash!==NEW_VAULT_CODE_HASH)
    return {status:'DEPLOYMENT_VERIFICATION_FAILED',message:'Different contract code is present. Do not deploy again.',codeHash:state.code_hash};
  if(!pending.hash&&pending.cancelEvidence==='METEOR_USER_CANCELLED'&&state.code_hash===EMPTY)
    return {status:'USER_CANCELLED',message:'Meteor returned USER_CANCELLED and finalized account has no contract code. Start a fresh preflight.',codeHash:state.code_hash};
  if(!pending.hash)
    return {status:'WALLET_OUTCOME_UNKNOWN',message:state.code_hash===EMPTY?
      'No contract code at finality, but no verified cancellation or transaction hash is available. Obtain a transaction hash from Meteor history for finalized reconciliation, or a new wallet-generated cancellation result. Retry remains blocked.':
      'Vault code appeared, but its transaction and initialization are unverified. Do not deploy again.',codeHash:state.code_hash};
  try{
    const tx=await rpc<RecoveryTx>(
      'tx',{tx_hash:pending.hash,sender_account_id:pending.accountId,wait_until:'FINAL'});
    if(tx.final_execution_status!=='FINAL')return {status:'WALLET_OUTCOME_UNKNOWN',message:'Transaction has not reached finality.',codeHash:state.code_hash,transaction:tx};
    const success=('SuccessValue' in tx.status||'SuccessReceiptId' in tx.status)&&
      Array.isArray(tx.receipts_outcome)&&tx.receipts_outcome.length>0&&
      tx.receipts_outcome.every(item=>item.outcome&&('SuccessValue' in item.outcome.status||'SuccessReceiptId' in item.outcome.status));
    if(!success){
      const explicitFailure='Failure' in tx.status||
        tx.receipts_outcome?.some(item=>item.outcome?.status&&'Failure' in item.outcome.status)===true;
      if(!explicitFailure)
        return {status:'WALLET_OUTCOME_UNKNOWN',message:'Finalized transaction has no conclusive receipt outcome. Retry remains blocked.',codeHash:state.code_hash,transaction:tx};
      if(state.code_hash!==EMPTY||!await matchesPendingDeploymentTx(tx,pending))
        return {status:'WALLET_OUTCOME_UNKNOWN',message:'The failed transaction does not match the saved Vault deployment payload. Retry remains blocked.',codeHash:state.code_hash,transaction:tx};
      return {status:'TRANSACTION_FAILED',message:'The exact deployment transaction failed at finality and no contract code exists. Start a fresh preflight.',codeHash:state.code_hash,transaction:tx};
    }
    return {status:'DEPLOYMENT_VERIFICATION_FAILED',message:state.code_hash===EMPTY?
      'Finalized transaction reports success, but Vault code is absent. Do not retry.':
      'Vault code exists; verify exact transaction, policy and grant before registration.',codeHash:state.code_hash,transaction:tx};
  }catch{
    return {status:'WALLET_OUTCOME_UNKNOWN',message:'Transaction status could not be read. Keep deployment blocked and retry read-only reconciliation.',codeHash:state.code_hash};
  }
}
