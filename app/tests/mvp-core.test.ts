import test from 'node:test';
import assert from 'node:assert/strict';
import {MVP_CONTRACT,exactNear,ownerPreflight,authorizeArgs,verifyFinalCall,
  verifyAuthorization,recordKey,pendingKey,type Vault,type PolicySnapshot} from '../src/lib/mvp-core.ts';

const owner='b-owner.testnet',agent='b-agent.testnet',recipient='vendor.testnet';
const vault:Vault=['100000000000000000000000','0','10000000000000000000000',agent,'9999999999999999999',3];
const policy:PolicySnapshot={policy_version:'3',agent,agent_expires_at_ns:vault[4],
  max_payment:'50000000000000000000000',window_limit:'100000000000000000000000',
  approval_threshold:'25000000000000000000000',window_ns:'600000000000',
  window_id:'1',spent:'0',reserved:'0',recipient_allowed:true};
test('owner B preflight uses B Vault, exact amounts and B agent',()=>{
  const amount=exactNear('0.001');
  ownerPreflight({owner,agent,recipient,amount,vault,policy,nowNs:1n});
  assert.equal(amount.toString(),'1000000000000000000000');
  for(const change of [
    {owner:'a-owner.testnet',agent:'a-agent.testnet'},
    {owner,agent,policy:{...policy,recipient_allowed:false}},
    {owner,agent,policy:{...policy,agent_expires_at_ns:'0'}},
    {owner,agent,amount:exactNear('0.2')},
    {owner,agent,policy:{...policy,spent:policy.window_limit}},
  ])assert.throws(()=>ownerPreflight({owner,agent,recipient,amount,vault,policy,nowNs:1n,...change}));
});
test('exact owner authorization is one-use scoped and cannot match substituted recipient',()=>{
  const args=authorizeArgs('ag-unique',agent,recipient,exactNear('0.001'),'3',100n);
  assert.deepEqual(args,{id:'ag-unique',agent,recipient,amount:'1000000000000000000000',policy_version:3,expires_at_ns:'100'});
  assert.equal(verifyAuthorization([6,agent,recipient,args.amount,3,'100'],args),true);
  assert.equal(verifyAuthorization([6,agent,'attacker.testnet',args.amount,3,'100'],args),false);
  assert.equal(verifyAuthorization([0,agent,recipient,args.amount,3,'100'],args),false);
  assert.notEqual(recordKey(owner),recordKey('a-owner.testnet'));
  assert.notEqual(pendingKey(owner),pendingKey('a-owner.testnet'));
  assert.throws(()=>authorizeArgs('',agent,recipient,1n,'3',100n));
});
test('FINAL call requires exact signer, receiver, method, args, gas and successful receipts',()=>{
  const args={owner,id:'ag-unique'};
  const encoded=btoa(JSON.stringify(args));
  const tx={final_execution_status:'FINAL',status:{SuccessValue:''},
    transaction:{hash:'hash',signer_id:agent,receiver_id:MVP_CONTRACT,
      actions:[{FunctionCall:{method_name:'execute_payment',args:encoded,gas:'100000000000000',deposit:'0'}}]},
    transaction_outcome:{outcome:{status:{SuccessReceiptId:'receipt'}}},
    receipts_outcome:[{outcome:{status:{SuccessValue:''}}}]};
  const expected={hash:'hash',signer:agent,method:'execute_payment',args,gas:100_000_000_000_000n,deposit:0n};
  assert.equal(verifyFinalCall(tx,expected),true);
  assert.equal(verifyFinalCall({...tx,transaction:{...tx.transaction,signer_id:owner}},expected),false);
  assert.equal(verifyFinalCall({...tx,receipts_outcome:[{outcome:{status:{Failure:{}}}}]},expected),false);
  assert.equal(verifyFinalCall(tx,{...expected,args:{owner:'a-owner.testnet',id:'ag-unique'}}),false);
});
