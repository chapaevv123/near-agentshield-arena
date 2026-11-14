export type FinalTx={final_execution_status:string;status:{SuccessValue?:string;SuccessReceiptId?:string;Failure?:unknown};transaction:{hash:string;signer_id:string;receiver_id:string;actions:unknown[]};receipts_outcome:{outcome:{status:{Failure?:unknown}}}[]};

export function verifyFinalFunctionCall(tx:FinalTx,signer:string,receiver:string,method:string,args:Record<string,unknown>,gas:string):boolean {
  if(tx.final_execution_status!=='FINAL'||tx.transaction.signer_id!==signer||tx.transaction.receiver_id!==receiver)return false;
  if(!Object.hasOwn(tx.status,'SuccessValue')&&!Object.hasOwn(tx.status,'SuccessReceiptId'))return false;
  if(tx.receipts_outcome.some(r=>Object.hasOwn(r.outcome.status,'Failure')))return false;
  if(tx.transaction.actions.length!==1)return false;
  const call=(tx.transaction.actions[0] as {FunctionCall?:{method_name:string;deposit:string;gas:number|string;args:string}})?.FunctionCall;
  if(!call||call.method_name!==method||call.deposit!=='0'||String(call.gas)!==gas)return false;
  try{
    const bytes=Uint8Array.from(atob(call.args),char=>char.charCodeAt(0));
    const actual=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;
    const expectedKeys=Object.keys(args).sort(),actualKeys=Object.keys(actual).sort();
    return JSON.stringify(expectedKeys)===JSON.stringify(actualKeys)&&expectedKeys.every(key=>actual[key]===args[key]);
  }catch{return false;}
}
