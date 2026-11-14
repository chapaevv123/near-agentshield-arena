import {actionCreators} from '@near-js/transactions';
import {account,rpc,NEW_VAULT_CODE_HASH} from './near.ts';
import {currentMeteorSession} from './near-login.ts';
import {connectedId} from './wallet.ts';
import {runtimeCall} from './runtime-api.ts';

export const VAULT_WASM_SHA256='A91E8AF4C4BBC0606A778479FFF42889B87235202701CEEDB2DEF22409A2A992';
export const VAULT_WASM_BYTES=231_759;
const EMPTY_CODE_HASH='11111111111111111111111111111111';
const YOCTO=10n**24n;
const DEPLOY_GAS=100_000_000_000_000n;
const PLANNING_GAS=300_000_000_000_000n;
const HISTORIC_ACCOUNTS=new Set(['openroom8315.testnet','agentshield-vault-8315.testnet','agentshield-agent-8315.testnet']);
const ACCOUNT=/^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function verifyDedicatedVaultKeys(keys:{public_key:string;access_key:{permission:unknown}}[],signedKey:string):void {
  if(keys?.length!==1||keys[0].public_key!==signedKey||
     keys[0].access_key?.permission!=='FullAccess')
    throw new Error('Dedicated Vault must have exactly the owner-signed FullAccess key and no other access keys');
}

export type VaultDeployPreview={accountId:string;agentId:string;ownerPublicKey:string;wasm:Uint8Array;sha256:string;
  codeStorageYocto:string;requiredYocto:string;balanceYocto:string;storagePriceYocto:string;gasPriceYocto:string;
  init:{owner:string;agent:string;max_payment:string;window_limit:string;approval_threshold:string;window_ns:number;agent_expires_at_ns:string}};

type FinalDeploymentTx={final_execution_status:string;status:Record<string,unknown>;
  transaction:{hash:string;signer_id:string;receiver_id:string;actions:Record<string,unknown>[]};
  receipts_outcome?:{outcome:{status:Record<string,unknown>}}[]};

export async function assertDeploymentIdentity(accountId:string,token:string){
  const wallet=currentMeteorSession();
  if(!wallet||wallet.identifier.accountId!==accountId||connectedId()!==accountId)
    throw new Error('Meteor account changed. Sign out of the other account and review deployment again.');
  const me=await runtimeCall<{kind:string;account_id:string;expires_at:number}>('/auth/me',token);
  if(me.kind!=='NEP413_ACCOUNT_SESSION'||me.account_id!==accountId||me.expires_at<=Date.now()/1000)
    throw new Error('Authenticated NEP-413 account changed. Sign in and review deployment again.');
  // getAllAccounts is a stored inventory, not the signer selected for this action.
  // getAccount without network fallback resolves only the NEP-413 authenticated target.
  const selected=await wallet.sdk.getAccount({blockchain:'near',network:'testnet',accountId});
  if(!selected||selected.identifier.blockchain!=='near'||selected.identifier.network!=='testnet'||
     selected.identifier.accountId!==accountId||selected.connection.executionTarget!=='v1_web'||
     !Array.isArray(selected.publicKeys)||selected.publicKeys.length!==0)
    throw new Error('Authenticated Vault account is unavailable as a keyless Meteor Web Testnet signer. Select the Vault account in Meteor and sign in again.');
  return wallet;
}

function decodeBase64(value:unknown):Uint8Array{
  if(typeof value!=='string')throw new Error('Finalized transaction action is malformed');
  return Uint8Array.from(atob(value),char=>char.charCodeAt(0));
}

export async function verifyDeploymentTransaction(tx:FinalDeploymentTx,hash:string,preview:VaultDeployPreview){
  if(tx.final_execution_status!=='FINAL'||tx.transaction?.hash!==hash||
     tx.transaction.signer_id!==preview.accountId||tx.transaction.receiver_id!==preview.accountId||
     !('SuccessValue' in tx.status||'SuccessReceiptId' in tx.status))
    throw new Error('Deployment outcome is unverified; inspect transaction before retrying');
  if(!Array.isArray(tx.receipts_outcome)||tx.receipts_outcome.length===0||
     tx.receipts_outcome.some(item=>!item.outcome?.status||
       !('SuccessValue' in item.outcome.status||'SuccessReceiptId' in item.outcome.status)))
    throw new Error('Finalized deployment receipt failed or is missing');
  const actions=tx.transaction.actions;
  if(!Array.isArray(actions)||actions.length!==2)throw new Error('Finalized deployment action count mismatch');
  const deploy=actions[0]?.DeployContract as {code?:unknown}|undefined;
  const call=actions[1]?.FunctionCall as {method_name?:string;args?:unknown;gas?:string;deposit?:string}|undefined;
  if(!deploy||!call||call.method_name!=='new'||String(call.gas)!==DEPLOY_GAS.toString()||String(call.deposit)!=='0')
    throw new Error('Finalized deployment action mismatch');
  const code=decodeBase64(deploy.code);
  const codeCopy=new Uint8Array(code.length);codeCopy.set(code);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',codeCopy));
  const codeHash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(code.length!==VAULT_WASM_BYTES||codeHash!==VAULT_WASM_SHA256)throw new Error('Finalized deployment code mismatch');
  let args:unknown;
  try{args=JSON.parse(new TextDecoder().decode(decodeBase64(call.args)));}catch{throw new Error('Finalized deployment init is malformed');}
  if(JSON.stringify(args)!==JSON.stringify(preview.init))throw new Error('Finalized deployment init mismatch');
}

export function buildVaultDeploymentActions(preview:VaultDeployPreview){
  const expiry=BigInt(preview.init.agent_expires_at_ns),now=BigInt(Date.now())*1_000_000n;
  if(preview.accountId!==preview.init.owner||preview.agentId!==preview.init.agent||preview.accountId===preview.agentId||
     preview.sha256!==VAULT_WASM_SHA256||preview.wasm.length!==VAULT_WASM_BYTES||
     expiry<=now+5n*60n*1_000_000_000n||expiry>now+30n*24n*60n*60n*1_000_000_000n)
    throw new Error('Reviewed deployment identity or artifact mismatch');
  return [actionCreators.deployContract(preview.wasm),
    actionCreators.functionCall('new',preview.init,DEPLOY_GAS,0n)];
}

export async function deploymentReview(preview:VaultDeployPreview){
  const actions=buildVaultDeploymentActions(preview);
  const code=actions[0].deployContract?.code;
  const call=actions[1].functionCall;
  if(!code||!call)throw new Error('Deployment payload is malformed');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(code)));
  const sha256=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(sha256!==VAULT_WASM_SHA256||code.length!==VAULT_WASM_BYTES)
    throw new Error('Deployment payload WASM differs from audited artifact');
  const init=JSON.parse(new TextDecoder().decode(call.args)) as VaultDeployPreview['init'];
  if(JSON.stringify(init)!==JSON.stringify(preview.init))throw new Error('Deployment payload initialization changed');
  return {network:'NEAR Testnet',signer:preview.accountId,target:preview.accountId,
    wasmBytes:code.length,sha256,actions:['DeployContract','FunctionCall(new)'],init,
    gas:call.gas.toString(),deposit:call.deposit.toString(),
    balanceYocto:preview.balanceYocto,codeStorageYocto:preview.codeStorageYocto,
    requiredYocto:preview.requiredYocto,gasPriceYocto:preview.gasPriceYocto};
}

export async function verifiedVaultWasm():Promise<Uint8Array>{
  const response=await fetch('/contracts/agentshield_contract.wasm',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Verified Vault WASM is unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==VAULT_WASM_BYTES)throw new Error('Vault WASM size mismatch');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hex=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(hex!==VAULT_WASM_SHA256)throw new Error('Vault WASM SHA-256 mismatch');
  return bytes;
}

export async function previewVaultDeployment(accountId:string,agentId:string,token:string):Promise<VaultDeployPreview>{
  if(!ACCOUNT.test(accountId)||!ACCOUNT.test(agentId)||!accountId.endsWith('.testnet')||!agentId.endsWith('.testnet')||
     accountId===agentId||HISTORIC_ACCOUNTS.has(accountId)||HISTORIC_ACCOUNTS.has(agentId))
    throw new Error('Use a new dedicated Testnet wallet account and a separate agent account');
  const wallet=await assertDeploymentIdentity(accountId,token);
  const wasm=await verifiedVaultWasm();
  const [status,vault,agent,keys,storage,protocol,gas]=await Promise.all([
    rpc<{chain_id:string}>('status',[]),account(accountId),account(agentId),
    rpc<{keys:{public_key:string;access_key:{permission:unknown}}[]}>('query',
      {request_type:'view_access_key_list',finality:'final',account_id:accountId}),
    rpc<{values:unknown[]}>('query',{request_type:'view_state',finality:'final',
      account_id:accountId,prefix_base64:'',limit:1}),
    rpc<{chain_id:string;runtime_config:{storage_amount_per_byte:string}}>('EXPERIMENTAL_protocol_config',{finality:'final'}),
    rpc<{gas_price:string}>('gas_price',[null]),
  ]);
  if(status.chain_id!=='testnet'||protocol.chain_id!=='testnet')throw new Error('NEAR RPC is not Testnet');
  if(vault.code_hash!==EMPTY_CODE_HASH)throw new Error('This account already has contract code; use a fresh dedicated account');
  if(!Array.isArray(storage.values)||storage.values.length!==0)
    throw new Error('Dedicated account has existing contract state; use a fresh account');
  if(agent.code_hash!==EMPTY_CODE_HASH)throw new Error('Use a fresh agent account without contract code');
  verifyDedicatedVaultKeys(keys.keys,wallet.publicKey);
  await assertDeploymentIdentity(accountId,token);
  const storagePrice=BigInt(protocol.runtime_config.storage_amount_per_byte),gasPrice=BigInt(gas.gas_price);
  if(storagePrice<=0n||gasPrice<=0n)throw new Error('Invalid live protocol pricing');
  const codeStorage=BigInt(wasm.length)*storagePrice;
  const required=codeStorage+20n*YOCTO/100n+PLANNING_GAS*gasPrice;
  if(BigInt(vault.amount)<required)throw new Error('Vault needs more Testnet NEAR: code storage, 0.2 NEAR state buffer and gas');
  return {accountId,agentId,ownerPublicKey:wallet.publicKey,wasm,sha256:VAULT_WASM_SHA256,
    codeStorageYocto:codeStorage.toString(),requiredYocto:required.toString(),
    balanceYocto:vault.amount,storagePriceYocto:storagePrice.toString(),gasPriceYocto:gasPrice.toString(),
    init:{owner:accountId,agent:agentId,max_payment:'10000000000000000000000',
      window_limit:'20000000000000000000000',approval_threshold:'5000000000000000000000',window_ns:600_000_000_000,
      agent_expires_at_ns:(BigInt(Date.now()+7*24*60*60*1000)*1_000_000n).toString()}};
}

export async function deployVaultWithWallet(preview:VaultDeployPreview,review:Awaited<ReturnType<typeof deploymentReview>>,
  token:string,onSubmitted?:(hash:string)=>void,onWalletPrompt?:()=>void):Promise<{hash:string;vault:string;code_hash:string;policy_version:number}>{
  const wallet=await assertDeploymentIdentity(preview.accountId,token);
  // Recheck all mutable values immediately before opening the wallet review.
  const fresh=await previewVaultDeployment(preview.accountId,preview.agentId,token);
  if(fresh.sha256!==preview.sha256||fresh.ownerPublicKey!==preview.ownerPublicKey||
     JSON.stringify({...fresh.init,agent_expires_at_ns:preview.init.agent_expires_at_ns})!==JSON.stringify(preview.init))
    throw new Error('Deployment preview changed; review again');
  fresh.init.agent_expires_at_ns=preview.init.agent_expires_at_ns;
  if(JSON.stringify(await deploymentReview(fresh))!==JSON.stringify(review))
    throw new Error('Deployment review is stale. Refresh and review the current balance, gas and payload.');
  const selected=await wallet.sdk.getAccount(wallet.identifier);
  if(!selected||selected.identifier.blockchain!=='near'||selected.identifier.network!=='testnet'||
     selected.identifier.accountId!==preview.accountId||selected.connection.executionTarget!=='v1_web'||
     !Array.isArray(selected.publicKeys)||selected.publicKeys.length!==0)
    throw new Error('Keyless Meteor Web account unavailable');
  await assertDeploymentIdentity(preview.accountId,token);
  const action=await wallet.sdk.createAction({id:'near::sign_transactions',input:{target:selected.identifier,
    transactions:[{receiverId:preview.accountId,actions:buildVaultDeploymentActions(fresh)}],useFunctionCallKey:false}});
  await assertDeploymentIdentity(preview.accountId,token);
  onWalletPrompt?.();
  const output=await action.promptForExecution();
  const hash=output[0]?.transaction?.hash;
  if(hash)onSubmitted?.(hash);
  if(output[0]?.transaction?.signer_id!==preview.accountId||output[0]?.transaction?.receiver_id!==preview.accountId)
    throw new Error('Meteor returned an outcome for a different signer or target. Inspect wallet history before retrying');
  if(!hash)throw new Error('Wallet returned no hash; inspect wallet activity before retrying');
  return verifyFinalizedVault(preview,hash);
}

export async function verifyFinalizedVault(preview:VaultDeployPreview,hash:string):Promise<{
  hash:string;vault:string;code_hash:string;policy_version:number}>{
  const tx=await rpc<FinalDeploymentTx>(
    'tx',{tx_hash:hash,sender_account_id:preview.accountId,wait_until:'FINAL'});
  await verifyDeploymentTransaction(tx,hash,preview);
  const state=await account(preview.accountId);
  if(state.code_hash===EMPTY_CODE_HASH)throw new Error('Finalized Vault account has no contract code; inspect wallet transaction before retrying');
  if(state.code_hash!==NEW_VAULT_CODE_HASH)throw new Error('Finalized Vault code hash mismatch');
  const keys=await rpc<{keys:{public_key:string;access_key:{permission:unknown}}[]}>('query',
    {request_type:'view_access_key_list',finality:'final',account_id:preview.accountId});
  verifyDedicatedVaultKeys(keys.keys,preview.ownerPublicKey);
  const result=await rpc<{result:number[]}>('query',{request_type:'call_function',finality:'final',account_id:preview.accountId,
    method_name:'get_policy',args_base64:'e30='});
  const policy=JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as {
    owner:string;agent:string;version:number;agent_expires_at_ns:string;
    max_payment:string;window_limit:string;approval_threshold:string;window_ns:number;
    recipients:string[];paused:boolean;emergency_stop:boolean};
  if(policy.owner!==preview.accountId||policy.agent!==preview.agentId||policy.version!==1||
     policy.agent_expires_at_ns!==preview.init.agent_expires_at_ns||
     policy.max_payment!==preview.init.max_payment||policy.window_limit!==preview.init.window_limit||
     policy.approval_threshold!==preview.init.approval_threshold||policy.window_ns!==preview.init.window_ns||
     !Array.isArray(policy.recipients)||policy.recipients.length!==0||policy.paused!==false||
     policy.emergency_stop!==false)
    throw new Error('Finalized Vault policy differs from reviewed initialization');
  return {hash,vault:preview.accountId,code_hash:state.code_hash,policy_version:policy.version};
}
