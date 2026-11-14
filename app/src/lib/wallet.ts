import '../polyfills.ts';
import { actionCreators } from '@near-js/transactions';
import { account, readPayment, readState, rpc, VAULT } from './near.ts';
import type { Payment, Policy } from './types.ts';
import { verifyFinalFunctionCall } from './tx.ts';
import { assertSigningRole, promptAuthorized } from './wallet-auth.ts';
import type { FinalTx } from './tx.ts';

export type WalletAccount = {identifier:{blockchain:'near';network:'testnet';accountId:string};connection:{executionTarget:string};publicKeys:unknown[]};
const TESTNET_ACCOUNT=/^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/;
let sdkPromise: Promise<import('@meteorwallet/sdk').MeteorConnect>|null=null;
let active:WalletAccount|null=null;
export async function connectedWallet(){return active?{sdk:await connector(),account:active}:null;}
export function adoptWallet(sdk:import('@meteorwallet/sdk').MeteorConnect,selected:WalletAccount){
  sdkPromise=Promise.resolve(sdk);active=selected;
  globalThis.dispatchEvent?.(new CustomEvent('agentshield-wallet-connected',{detail:selected.identifier.accountId}));
}

async function connector() {
  if (!sdkPromise) sdkPromise=(async()=>{
    const {MeteorConnect,webpage_local_storage}=await import('@meteorwallet/sdk');
    const sdk=new MeteorConnect(); sdk.setLoggingLevel('none');
    await sdk.initialize({storage:webpage_local_storage,mobileBridge:{enabled:false}});
    return sdk;
  })();
  try {return await sdkPromise;} catch(error) {sdkPromise=null;throw error;}
}

async function keys(id:string):Promise<string[]> {
  const result=await rpc<{keys:{public_key:string}[]}>('query',{request_type:'view_access_key_list',finality:'final',account_id:id});
  return result.keys.map(k=>k.public_key).sort();
}

export async function connect():Promise<string> {
  const sdk=await connector();
  const action=await sdk.createAction({id:'near::sign_in',input:{target:{blockchain:'near',network:'testnet'}}});
  const selected=await action.promptForExecution() as WalletAccount;
  if (selected?.identifier?.blockchain!=='near'||selected.identifier.network!=='testnet'||selected.connection?.executionTarget!=='v1_web') throw new Error('Meteor Web Testnet account required');
  if (!Array.isArray(selected.publicKeys)||selected.publicKeys.length!==0) throw new Error('App access key requested; connection rejected');
  const id=selected.identifier.accountId;
  if(!TESTNET_ACCOUNT.test(id))throw new Error('Valid NEAR Testnet account required');
  const chain=await rpc<{chain_id:string}>('status',[]);
  if (chain.chain_id!=='testnet') throw new Error('RPC network mismatch');
  await account(id);
  // Connection identifies a wallet only. NEP-413 proves identity; Vault access is checked separately.
  active=selected;
  globalThis.dispatchEvent?.(new CustomEvent('agentshield-wallet-connected',{detail:id}));
  return id;
}

export async function disconnect():Promise<void> {
  if(!active)return;
  const selected=active;
  const sdk=await connector();
  const action=await sdk.createAction({id:'near::sign_out',input:{target:selected.identifier}});
  await action.promptForExecution();
  active=null;
  globalThis.dispatchEvent?.(new Event('agentshield-wallet-disconnected'));
}
export function connectedId():string|null {return active?.identifier.accountId??null;}

export type SignedResult={hash:string;final:boolean;payment?:Payment|null;policy?:Policy;warning?:string};
export async function signCall(method:string,args:Record<string,unknown>,role:'owner'|'agent',expectedVersion:number):Promise<SignedResult> {
  assertSigningRole(method,role);
  const receiver=VAULT;
  const signer=active?.identifier.accountId;
  if (!signer) throw new Error('Connect Meteor Web first');
  const before=await readState();
  if (before.policy.version!==expectedVersion) throw new Error('Policy changed; review fresh values before signing');
  if (signer!==before.policy[role]) throw new Error(`Connected account is not the on-chain ${role}`);
  if (before.policy.emergency_stop && method!=='emergency_stop') throw new Error('Emergency stop active');
  if (role==='agent' && before.policy.paused) throw new Error('Treasury paused');
  if (method==='request_payment') {
    if (await readPayment(String(args.id))) throw new Error('Payment ID already exists on chain');
  }
  const beforeKeys=await keys(signer);
  const sdk=await connector();
  const accountHandle=await sdk.getAccount({blockchain:'near',network:'testnet',accountId:signer});
  if (!accountHandle||accountHandle.connection.executionTarget!=='v1_web'||accountHandle.publicKeys.length!==0) throw new Error('Keyless Meteor Web account unavailable');
  if(VAULT!==receiver)throw new Error('Selected Vault changed; review the transaction again');
  const action=await sdk.createAction({id:'near::sign_transactions',input:{target:accountHandle.identifier,
    transactions:[{receiverId:receiver,actions:[actionCreators.functionCall(method,args,method==='execute_payment'?100_000_000_000_000n:50_000_000_000_000n,0n)]}],useFunctionCallKey:false}});
  // The SDK prompt signs and broadcasts. The caller must invoke this only after explicit review.
  const output=await promptAuthorized(method,role,()=>action.promptForExecution());
  const hash=output[0]?.transaction?.hash;
  if (!hash) throw new Error('Wallet returned no hash; inspect wallet history before retrying');
  const tx=await rpc<FinalTx>('tx',{tx_hash:hash,sender_account_id:signer,wait_until:'FINAL'});
  const gas=(method==='execute_payment'?100_000_000_000_000n:50_000_000_000_000n).toString();
  const final=tx.transaction.hash===hash&&verifyFinalFunctionCall(tx,signer,receiver,method,args,gas);
  if(VAULT!==receiver)return {hash,final:false,warning:'Selected Vault changed after wallet prompt; inspect FINAL receipt before continuing.'};
  const afterKeys=await keys(signer);
  if (JSON.stringify(beforeKeys)!==JSON.stringify(afterKeys)) return {hash,final:false,warning:'Signer access-key inventory changed; inspect account before retrying.'};
  if (!final) return {hash,final:false,warning:'FINAL transaction or receipt check failed. Inspect explorer before retrying.'};
  const policy=await readState().then(x=>x.policy);
  const payment=(method==='request_payment'||method==='approve_payment'||method==='execute_payment')?await readPayment(String(args.id)):undefined;
  let stateMatches=true;
  if (role==='owner'&&method!=='approve_payment') stateMatches=policy.version===expectedVersion+1;
  if (method==='set_recipient') stateMatches=stateMatches&&policy.recipients.includes(String(args.recipient))===args.allowed;
  if (method==='set_agent') stateMatches=stateMatches&&policy.agent===args.agent&&
    (before.policy.agent_expires_at_ns===undefined||policy.agent_expires_at_ns==='0');
  if (method==='set_agent_authorization') stateMatches=stateMatches&&policy.agent_expires_at_ns===args.expires_at_ns;
  if (method==='set_paused') stateMatches=stateMatches&&policy.paused===args.paused;
  if (method==='set_limits') stateMatches=stateMatches&&policy.max_payment===args.max_payment&&policy.window_limit===args.window_limit&&policy.approval_threshold===args.approval_threshold&&policy.window_ns===args.window_ns;
  if (method==='emergency_stop') stateMatches=stateMatches&&policy.emergency_stop&&policy.paused;
  if (method==='request_payment') stateMatches=!!payment&&payment.id===args.id&&payment.recipient===args.recipient&&payment.amount===args.amount&&payment.policy_version===expectedVersion;
  if (method==='approve_payment') stateMatches=!!payment&&payment.status==='APPROVED'&&payment.approved_by===signer;
  if (method==='execute_payment') stateMatches=!!payment&&payment.status==='SETTLED';
  return {hash,final:final&&stateMatches,policy,payment,warning:stateMatches?undefined:'FINAL transaction observed but expected contract state was not confirmed; inspect before retrying.'};
}
