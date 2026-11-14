import '../polyfills.ts';
import {runtimeCall} from './runtime-api.ts';
import type {MeteorConnect} from '@meteorwallet/sdk';
import type {WalletAccount} from './wallet.ts';

type Challenge={account_id:string;message:string;nonce:string;recipient:string;expires_at:number};
type Session={token:string;account_id:string;expires_at:number;classification:string};
type Identifier={blockchain:'near';network:'testnet';accountId:string};
export type LoginStep='WALLET CONNECTED'|'SIGNATURE REQUIRED'|'AUTHENTICATING';
let activeWallet:{sdk:MeteorConnect;identifier:Identifier;publicKey:string}|null=null;
export function currentMeteorSession(){return activeWallet;}
export function clearMeteorSession(){activeWallet=null;}

export function decodeNonce(value:string):Uint8Array {
  const raw=atob(value);
  if(raw.length!==32)throw new Error('Invalid server challenge nonce');
  return Uint8Array.from(raw,char=>char.charCodeAt(0));
}

export function normalizeMeteorSignature(signed:{accountId:string;publicKey:{toString():string};signature:Uint8Array}){
  const publicKey=signed.publicKey.toString();
  if(!publicKey.startsWith('ed25519:')||signed.signature.length!==64)
    throw new Error('Meteor returned an unsupported NEP-413 key or signature');
  let binary='';for(const byte of signed.signature)binary+=String.fromCharCode(byte);
  return {account_id:signed.accountId,public_key:publicKey,signature:btoa(binary)};
}

export async function loginWithNear(onStep?:(step:LoginStep,accountId:string)=>void):Promise<Session>{
  const walletModule=await import('./wallet.ts');
  const existing=await walletModule.connectedWallet();
  let sdk:import('@meteorwallet/sdk').MeteorConnect;
  let account:WalletAccount;
  if(existing){({sdk,account}=existing);}else{
    const {MeteorConnect,webpage_local_storage}=await import('@meteorwallet/sdk');
    sdk=new MeteorConnect();sdk.setLoggingLevel('none');
    await sdk.initialize({storage:webpage_local_storage,mobileBridge:{enabled:false}});
    const connect=await sdk.createAction({id:'near::sign_in',input:{target:{blockchain:'near',network:'testnet'}}});
    account=await connect.promptForExecution() as WalletAccount;
  }
  if(account.identifier.blockchain!=='near'||account.identifier.network!=='testnet'||
     account.connection.executionTarget!=='v1_web'||account.publicKeys.length!==0){
    throw new Error('Keyless Meteor Web Testnet account required');
  }
  if(!existing)walletModule.adoptWallet(sdk,account);
  const accountId=account.identifier.accountId;
  onStep?.('WALLET CONNECTED',accountId);
  const challenge=await runtimeCall<Challenge>('/auth/challenge','','POST',{account_id:accountId});
  if(challenge.account_id!==accountId)throw new Error('Challenge account mismatch');
  if(challenge.expires_at<=Date.now()/1000)throw new Error('Login challenge expired before wallet signing. Start sign-in again.');
  onStep?.('SIGNATURE REQUIRED',accountId);
  const sign=await sdk.createAction({id:'near::sign_message',input:{target:account.identifier,
    messageParams:{message:challenge.message,recipient:challenge.recipient,nonce:decodeNonce(challenge.nonce)}}});
  const signed=await sign.promptForExecution();
  onStep?.('AUTHENTICATING',accountId);
  if(signed.accountId!==accountId)throw new Error('Signed account mismatch');
  const normalized=normalizeMeteorSignature(signed);
  const session=await runtimeCall<Session>('/auth/verify','','POST',{
    ...normalized,nonce:challenge.nonce,
  });
  if(session.account_id!==accountId)throw new Error('Verified account mismatch');
  activeWallet={sdk,identifier:account.identifier as Identifier,publicKey:normalized.public_key};
  return session;
}
