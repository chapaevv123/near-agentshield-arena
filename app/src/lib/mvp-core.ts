export const MVP_CONTRACT='agentshield-arena-v2-stage2.testnet';
export const MVP_CODE_HASH='4f4xhV9UKijpuBxyu9rhjFQ8wrC5nv6XQYCAZ82XqwgA';
export const MVP_GENESIS='FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
export const STORAGE_DEPOSIT=10n**22n;
export const GAS=100_000_000_000_000n;
export const DEMO_OWNER='safeibis9110.testnet';
export const DEMO_AGENT='openroom8315.testnet';
export const DEMO_RECIPIENT='soundestate8404.testnet';
export const DEMO_AMOUNT=10n**21n;
export const validDemoId=(id:string)=>/^ag-demo-[0-9a-f]{32}$/.test(id);
export const ACCOUNT=/^(?:(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet|[0-9a-f]{64})$/;
export type Vault=[string,string,string,string|null,string,number];
export type PolicySnapshot={policy_version:string;agent:string|null;agent_expires_at_ns:string;
  max_payment:string;window_limit:string;approval_threshold:string;window_ns:string;
  window_id:string;spent:string;reserved:string;recipient_allowed:boolean};
export type PaymentAuthorization=[number,string,string,string,number,string];
export type PaymentDetails=[number,string,string,number,number];
export type PaymentRecord={id:string;recipient:string;amount:string;authorize_hash:string;
  request_hash?:string;execute_hash?:string};

export function exactNear(input:string):bigint{
  if(!/^(0|[1-9]\d{0,7})(\.\d{1,24})?$/.test(input))throw new Error('Enter an exact NEAR amount (up to 24 decimals).');
  const [whole,fraction='']=input.split('.');
  return BigInt(whole)*10n**24n+BigInt(fraction.padEnd(24,'0'));
}
export function displayNear(value:string):string{
  const n=BigInt(value);const fraction=(n%10n**24n).toString().padStart(24,'0').slice(0,6).replace(/0+$/,'');
  return `${n/10n**24n}${fraction?'.'+fraction:''}`;
}
export function ownerPreflight(input:{owner:string;agent:string;recipient:string;amount:bigint;
  vault:Vault;policy:PolicySnapshot;nowNs:bigint}):void{
  const {owner,agent,recipient,amount,vault,policy,nowNs}=input;
  if(!ACCOUNT.test(owner)||!ACCOUNT.test(agent)||!ACCOUNT.test(recipient)||agent===owner||recipient===MVP_CONTRACT)
    throw new Error('Invalid owner, agent or Testnet recipient.');
  if(vault[3]!==agent||policy.agent!==agent||BigInt(vault[4])<=nowNs||BigInt(policy.agent_expires_at_ns)<=nowNs)
    throw new Error('This owner has no active grant for this agent.');
  if(!policy.recipient_allowed)throw new Error('Recipient is not allowed by this owner’s policy.');
  if(amount<=0n||amount>BigInt(policy.max_payment)||amount>BigInt(vault[0]))throw new Error('Amount exceeds this Vault’s available balance or payment limit.');
  if(BigInt(policy.spent)+BigInt(policy.reserved)+amount>BigInt(policy.window_limit))
    throw new Error('Amount exceeds the current spending window.');
  if(amount>BigInt(policy.approval_threshold))
    throw new Error('This amount requires an extra approve_payment call after REQUEST.');
}
export function authorizeArgs(id:string,agent:string,recipient:string,amount:bigint,version:string,expiryNs:bigint){
  if(!/^[\x21-\x7e]{1,64}$/.test(id)||!ACCOUNT.test(agent)||!ACCOUNT.test(recipient)||amount<=0n||expiryNs<=0n)
    throw new Error('Invalid exact authorization scope.');
  const policyVersion=Number(version);
  if(!Number.isSafeInteger(policyVersion)||policyVersion<1)throw new Error('Invalid on-chain policy version.');
  return {id,agent,recipient,amount:amount.toString(),policy_version:policyVersion,expires_at_ns:expiryNs.toString()};
}
export type FinalTx={final_execution_status:string;status:Record<string,unknown>;
  transaction:{hash:string;signer_id:string;receiver_id:string;actions:Record<string,unknown>[]};
  receipts?:{receipt_id:string;predecessor_id:string;receiver_id:string;receipt?:{Action?:{actions:Record<string,unknown>[]}}}[];
  transaction_outcome?:{outcome:{status:Record<string,unknown>}};
  receipts_outcome?:{id?:string;outcome:{status:Record<string,unknown>}}[]};
export function verifyFinalCall(tx:FinalTx,expected:{hash:string;signer:string;method:string;
  args:Record<string,unknown>;gas:bigint;deposit:bigint}):boolean{
  const actions=tx.transaction?.actions;
  const call=actions?.length===1?actions[0].FunctionCall as
    {method_name?:string;args?:string;gas?:string|number;deposit?:string}|undefined:undefined;
  let decoded:unknown;
  try{decoded=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(call?.args??''),c=>c.charCodeAt(0))));}
  catch{return false;}
  const success=(s:Record<string,unknown>|undefined)=>!!s&&('SuccessValue'in s||'SuccessReceiptId'in s);
  return tx.final_execution_status==='FINAL'&&tx.transaction.hash===expected.hash&&
    tx.transaction.signer_id===expected.signer&&tx.transaction.receiver_id===MVP_CONTRACT&&
    call?.method_name===expected.method&&call.deposit===expected.deposit.toString()&&
    String(call.gas)===expected.gas.toString()&&JSON.stringify(decoded)===JSON.stringify(expected.args)&&
    success(tx.status)&&success(tx.transaction_outcome?.outcome.status)&&
    !!tx.receipts_outcome?.length&&tx.receipts_outcome.every(row=>success(row.outcome.status));
}
export function verifyAuthorization(row:PaymentAuthorization|null,args:ReturnType<typeof authorizeArgs>):boolean{
  return !!row&&row[0]===6&&row[1]===args.agent&&row[2]===args.recipient&&
    row[3]===args.amount&&row[4]===args.policy_version&&row[5]===args.expires_at_ns;
}
export function verifyDemoTransfer(tx:FinalTx,details:PaymentDetails|null):boolean{
  if(!details||details[0]!==4||details[1]!==DEMO_AMOUNT.toString()||details[2]!==DEMO_RECIPIENT)return false;
  const transfer=tx.receipts?.find(receipt=>{
    const actions=receipt.receipt?.Action?.actions;
    return receipt.predecessor_id===MVP_CONTRACT&&receipt.receiver_id===DEMO_RECIPIENT&&actions?.length===1&&
      String((actions[0].Transfer as {deposit?:string}|undefined)?.deposit)===DEMO_AMOUNT.toString();
  });
  const callback=tx.receipts?.find(receipt=>receipt.predecessor_id===MVP_CONTRACT&&
    receipt.receiver_id===MVP_CONTRACT&&receipt.receipt?.Action?.actions?.some(action=>
      (action.FunctionCall as {method_name?:string}|undefined)?.method_name==='on_transfer'));
  const succeeded=(id:string|undefined)=>!!id&&!!tx.receipts_outcome?.some(row=>row.id===id&&
    ('SuccessValue' in row.outcome.status||'SuccessReceiptId' in row.outcome.status));
  return succeeded(transfer?.receipt_id)&&succeeded(callback?.receipt_id);
}
export function recordKey(owner:string){if(!ACCOUNT.test(owner))throw new Error('Invalid owner');return `agentshield-mvp:${MVP_CONTRACT}:${owner}:payments-v1`;}
export function pendingKey(owner:string){if(!ACCOUNT.test(owner))throw new Error('Invalid owner');return `agentshield-mvp:${MVP_CONTRACT}:${owner}:pending-v1`;}
