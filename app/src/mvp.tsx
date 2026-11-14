import './polyfills';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {actionCreators} from '@near-js/transactions';
import {MeteorConnect,webpage_local_storage} from '@meteorwallet/sdk';
import {account,rpc,view} from './lib/near';
import {isMeteorCancellation} from './lib/vault-recovery';
import {decodeNonce,normalizeMeteorSignature} from './lib/near-login';
import {mvpApi,type AgentSession,type AgentPayment} from './lib/mvp-api-client';
import {checkedControlPlan,checkedControlIntent,type ProvisioningPlan,type ProvisioningStatus} from './lib/agent-provisioning';
import {ACCOUNT,MVP_CODE_HASH,MVP_CONTRACT,MVP_GENESIS,STORAGE_DEPOSIT,GAS,
  exactNear,displayNear,ownerPreflight,authorizeArgs,verifyFinalCall,verifyAuthorization,
  DEMO_OWNER,DEMO_AGENT,DEMO_RECIPIENT,DEMO_AMOUNT,validDemoId,verifyDemoTransfer,
  recordKey,pendingKey,type Vault,type PolicySnapshot,type PaymentAuthorization,
  type PaymentDetails,type PaymentRecord,type FinalTx} from './lib/mvp-core';
import './mvp.css';

type WalletAccount={identifier:{blockchain:'near';network:'testnet';accountId:string};
  connection:{executionTarget:string};publicKeys:unknown[]};
type Pending={method:string;args:Record<string,unknown>;deposit:string;gas:string;hash:string|null;
  before_vault:Vault|null;before_recipient?:string;created_at:string};
type Demo={id:string;grant_hash:string;authorize_hash:string;request_hash:string;execute_hash:string};
const demoKey='agentshield-mvp:manual-payment-v1';
function loadDemo():Demo{
  try{const row=JSON.parse(localStorage.getItem(demoKey)??'{}');
    if(row.id&& !validDemoId(row.id))throw new Error('Invalid saved demo ID');
    return {id:typeof row.id==='string'?row.id:'',grant_hash:typeof row.grant_hash==='string'?row.grant_hash:'',
      authorize_hash:typeof row.authorize_hash==='string'?row.authorize_hash:'',
      request_hash:typeof row.request_hash==='string'?row.request_hash:'',
      execute_hash:typeof row.execute_hash==='string'?row.execute_hash:''};}
  catch{return {id:'',grant_hash:'',authorize_hash:'',request_hash:'',execute_hash:''};}
}
const savedAccountKey='agentshield-mvp:last-account-v1';
const provisioningPendingKey=(owner:string)=>`agentshield-mvp:agent-creation:${owner}`;
const explorer=(hash:string)=>`https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;
const contractExplorer=`https://testnet.nearblocks.io/address/${MVP_CONTRACT}`;
const statuses=['REQUESTED','AWAITING APPROVAL','APPROVED','PENDING','SETTLED','FAILED','AUTHORIZED'];
function errorText(error:unknown){return error instanceof Error?error.message:String(error);}
function loadRecords(owner:string):PaymentRecord[]{
  try{const data=JSON.parse(localStorage.getItem(recordKey(owner))??'[]');
    return Array.isArray(data)?data.filter(x=>x&&typeof x.id==='string'&&typeof x.authorize_hash==='string'):[];}
  catch{return [];}
}
function loadPending(owner:string):Pending|null{
  try{const raw=localStorage.getItem(pendingKey(owner));return raw?JSON.parse(raw) as Pending:null;}
  catch{return {method:'UNKNOWN',args:{},deposit:'0',gas:'0',hash:null,before_vault:null,created_at:''};}
}
function App(){
  const sdkRef=useRef<MeteorConnect|null>(null);
  const inFlight=useRef(false);
  const [owner,setOwner]=useState('');const [vault,setVault]=useState<Vault|null>(null);
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('Connect Meteor Testnet to inspect your own Vault.');
  const [lastHash,setLastHash]=useState('');const [pending,setPending]=useState<Pending|null>(null);
  const [records,setRecords]=useState<PaymentRecord[]>([]);
  const [max,setMax]=useState('0.05');const [windowLimit,setWindowLimit]=useState('0.1');
  const [threshold,setThreshold]=useState('0.025');const [funds,setFunds]=useState('0.01');
  const [recipient,setRecipient]=useState('');const [agent,setAgent]=useState('');
  const [payAmount,setPayAmount]=useState('0.001');const [paymentId,setPaymentId]=useState('');
  const [policy,setPolicy]=useState<PolicySnapshot|null>(null);
  const [policyRecipient,setPolicyRecipient]=useState('');
  const [payment,setPayment]=useState<PaymentDetails|null>(null);
  const [agentSession,setAgentSession]=useState<AgentSession|null>(null);
  const [agentRows,setAgentRows]=useState<AgentPayment[]>([]);
  const [agentPublicKey,setAgentPublicKey]=useState('');
  const [sharedExecutor,setSharedExecutor]=useState<{agent:string;public_key:string}|null>(null);
  const [agentReservation,setAgentReservation]=useState<{agent:string;state:string}|null>(null);
  const [provisioning,setProvisioning]=useState<ProvisioningStatus|null>(null);
  const [keyRemoval,setKeyRemoval]=useState<{state:string;submission:{tx_hash:string}|null}|null>(null);
  const [creationPending,setCreationPending]=useState<string|null>(null);
  const [agentSignerStatus,setAgentSignerStatus]=useState('BLOCKED_NO_B_SIGNER');
  const [cloudReadOnly,setCloudReadOnly]=useState(true);
  const [cloudApiStatus,setCloudApiStatus]=useState('CHECKING');
  const [cloudDecision,setCloudDecision]=useState<{reason:string;allowed:boolean;classification:string}|null>(null);
  const [judgeDecision,setJudgeDecision]=useState<{reason:string;allowed:boolean;recipient:string;amount:string}|null>(null);
  const [demo,setDemo]=useState<Demo>(loadDemo);
  const [demoDetails,setDemoDetails]=useState<PaymentDetails|null>(null);
  const [demoRecipientBalance,setDemoRecipientBalance]=useState('');
  const [demoVaultBalance,setDemoVaultBalance]=useState('');
  const [demoVerified,setDemoVerified]=useState(false);
  const [demoAgentSeen,setDemoAgentSeen]=useState(()=>localStorage.getItem('agentshield-mvp:demo-agent-seen-v1')==='yes');
  const [demoMessage,setDemoMessage]=useState('Connect the owner in Meteor to begin. Switch to the agent only after FINAL authorization.');
  function saveDemo(next:Demo){localStorage.setItem(demoKey,JSON.stringify(next));setDemo(next);}
  useEffect(()=>{void mvpApi<{mode:string}>('/health','GET').then(status=>{
    if(status.mode==='READ_ONLY'){setCloudReadOnly(true);setCloudApiStatus('ONLINE · READ ONLY');}
    else if(status.mode==='LOCAL'){setCloudReadOnly(false);setCloudApiStatus('LOCAL');}
    else{setCloudReadOnly(true);setCloudApiStatus('UNAVAILABLE');}
  }).catch(async()=>{
    if(['localhost','127.0.0.1'].includes(location.hostname)){
      try{const local=await mvpApi<{status:string;journal:string}>('/healthz','GET');
        if(local.status==='UP'&&local.journal==='OK'){setCloudReadOnly(false);setCloudApiStatus('LOCAL');return;}}catch{}
    }
    setCloudReadOnly(true);setCloudApiStatus('UNAVAILABLE');
  });},[]);
  useEffect(()=>{if(!agentSession||!owner||agentSession.account_id!==owner)return;
    const timer=setInterval(()=>{void mvpApi<{owner:string;payments:AgentPayment[]}>('/history','GET',undefined,agentSession)
      .then(result=>{if(result.owner===owner)setAgentRows(result.payments);}).catch(()=>{});},10000);
    return()=>clearInterval(timer);},[agentSession,owner]);

  async function sdk(){if(sdkRef.current)return sdkRef.current;
    const instance=new MeteorConnect();instance.setLoggingLevel('none');
    await instance.initialize({storage:webpage_local_storage,mobileBridge:{enabled:false}});
    sdkRef.current=instance;return instance;}
  function validWallet(selected:unknown):asserts selected is WalletAccount{
    const item=selected as WalletAccount|undefined;
    if(!item||item.identifier?.blockchain!=='near'||item.identifier.network!=='testnet'||
      !ACCOUNT.test(item.identifier.accountId)||item.connection?.executionTarget!=='v1_web'||
      !Array.isArray(item.publicKeys)||item.publicKeys.length!==0)
      throw new Error('A keyless Meteor Web Testnet account is required.');
  }
  async function pinned(){
    const [network,contract]=await Promise.all([rpc<{chain_id:string;genesis_hash:string}>('status',[]),account(MVP_CONTRACT)]);
    if(network.chain_id!=='testnet'||network.genesis_hash!==MVP_GENESIS||contract.code_hash!==MVP_CODE_HASH)
      throw new Error('Testnet network or Vault v2 code hash mismatch. Transactions are disabled.');
  }
  async function selectedWallet(expected:string){
    const instance=await sdk();const selected=await instance.getAccount({blockchain:'near',network:'testnet',accountId:expected});
    validWallet(selected);
    if(selected.identifier.accountId!==expected)throw new Error('Meteor account changed. Connect again.');
    return {instance,selected};
  }
  async function refresh(who=owner){
    if(!who)return;
    await pinned();
    setJudgeDecision(null);
    const result=await view<Vault|null>('get_vault',{owner:who},MVP_CONTRACT);
    setVault(result);setRecords(loadRecords(who));setPending(loadPending(who));
    if(result?.[3])setAgent(result[3]);
    const selectedRecipient=ACCOUNT.test(recipient)?recipient:who;
    setPolicy(result?await view<PolicySnapshot|null>('get_policy_snapshot',
      {owner:who,recipient:selectedRecipient},MVP_CONTRACT):null);
    setPolicyRecipient(selectedRecipient);
  }
  useEffect(()=>{let live=true;void(async()=>{
    try{const saved=localStorage.getItem(savedAccountKey);if(!saved||!ACCOUNT.test(saved))return;
      const {selected}=await selectedWallet(saved);await pinned();if(!live)return;
      setOwner(selected.identifier.accountId);await refresh(selected.identifier.accountId);
      if(selected.identifier.accountId===DEMO_AGENT){localStorage.setItem('agentshield-mvp:demo-agent-seen-v1','yes');setDemoAgentSeen(true);}
      setCreationPending(localStorage.getItem(provisioningPendingKey(selected.identifier.accountId)));
      setMessage(`Meteor session restored for ${selected.identifier.accountId}. On-chain state refreshed.`);
    }catch(error){if(live)setMessage(`Session restore unavailable: ${errorText(error)} Connect again.`);}
  })();return()=>{live=false;};},[]);
  async function connect(){if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try{await pinned();const instance=await sdk();
      const action=await instance.createAction({id:'near::sign_in',input:{target:{blockchain:'near',network:'testnet'}}});
      const selected=await action.promptForExecution();validWallet(selected);
      const id=selected.identifier.accountId;localStorage.setItem(savedAccountKey,id);
      setOwner(id);setPayment(null);setPolicy(null);setLastHash('');await refresh(id);
      if(id===DEMO_AGENT){localStorage.setItem('agentshield-mvp:demo-agent-seen-v1','yes');setDemoAgentSeen(true);}
      setAgentSession(null);setAgentRows([]);setAgentReservation(null);setProvisioning(null);setKeyRemoval(null);setSharedExecutor(null);
      setCreationPending(localStorage.getItem(provisioningPendingKey(id)));
      setMessage(`Connected ${id}. Wallet prompts will confirm each owner transaction.`);
    }catch(error){setMessage(`Connect failed: ${errorText(error)}`);}finally{setBusy(false);inFlight.current=false;}}
  async function disconnect(){if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try{if(owner){if(agentSession?.account_id===owner)await mvpApi('/auth/logout','POST',{},agentSession).catch(()=>{});
      const {instance,selected}=await selectedWallet(owner);
      const action=await instance.createAction({id:'near::sign_out',input:{target:selected.identifier}});
      await action.promptForExecution();}
      localStorage.removeItem(savedAccountKey);setOwner('');setVault(null);setPolicy(null);setPayment(null);
      setAgentSession(null);setAgentRows([]);setAgentReservation(null);
      setProvisioning(null);setKeyRemoval(null);setSharedExecutor(null);setCreationPending(null);setRecords([]);setPending(null);setMessage('Disconnected.');
    }catch(error){setMessage(`Disconnect failed: ${errorText(error)}`);}finally{setBusy(false);inFlight.current=false;}}
  async function reconcile(existing:Pending,who=owner){
    if(!existing.hash)throw new Error('No hash saved. Inspect Meteor Activity and enter the public transaction hash before retrying.');
    await pinned();const tx=await rpc<FinalTx>('tx_status',{tx_hash:existing.hash,sender_account_id:who,wait_until:'FINAL'});
    if(!verifyFinalCall(tx,{hash:existing.hash,signer:who,method:existing.method,args:existing.args,
      gas:BigInt(existing.gas),deposit:BigInt(existing.deposit)}))
      throw new Error('Exact FINAL action or receipt graph has not been verified. Operation stays UNKNOWN.');
    if(existing.method==='authorize_payment'){
      const id=String(existing.args.id);
      const row=await view<PaymentAuthorization|null>('get_payment_authorization',{owner:who,id},MVP_CONTRACT);
      if(!verifyAuthorization(row,existing.args as ReturnType<typeof authorizeArgs>))
        throw new Error('FINAL authorization state does not match exact owner scope.');
      const list=loadRecords(who).filter(x=>x.id!==id);
      list.unshift({id,recipient:String(existing.args.recipient),amount:String(existing.args.amount),authorize_hash:existing.hash});
      localStorage.setItem(recordKey(who),JSON.stringify(list.slice(0,64)));setRecords(list.slice(0,64));
      if(agentSession?.account_id===who){void mvpApi('/history/observe','POST',{id},agentSession).catch(()=>{});}
    }else if(existing.method==='create_vault'){
      const after=await view<Vault|null>('get_vault',{owner:who},MVP_CONTRACT);
      if(!after||after[0]!=='0'||after[1]!=='0'||after[2]!==STORAGE_DEPOSIT.toString()||
        after[3]!==null||after[5]!==1)throw new Error('FINAL create_vault state mismatch.');
      const snapshot=await view<PolicySnapshot|null>('get_policy_snapshot',
        {owner:who,recipient:who},MVP_CONTRACT);
      if(!snapshot||snapshot.max_payment!==existing.args.max_payment||
        snapshot.window_limit!==existing.args.window_limit||
        snapshot.approval_threshold!==existing.args.approval_threshold||
        snapshot.window_ns!==String(existing.args.window_ns))
        throw new Error('FINAL initial policy mismatch.');
    }else if(existing.method==='set_agent'||existing.method==='set_recipient'){
      const after=await view<Vault|null>('get_vault',{owner:who},MVP_CONTRACT);
      if(!after||!existing.before_vault||after[5]!==existing.before_vault[5]+1)
        throw new Error('Policy version did not advance exactly once.');
      if(existing.method==='set_agent'&&after[3]!==existing.args.agent)throw new Error('Agent grant mismatch.');
      if(existing.method==='set_recipient'){
        const snapshot=await view<PolicySnapshot|null>('get_policy_snapshot',
          {owner:who,recipient:existing.args.recipient},MVP_CONTRACT);
        if(!snapshot||snapshot.recipient_allowed!==existing.args.allowed)throw new Error('Recipient policy mismatch.');
      }
    }else if(existing.method==='deposit'||existing.method==='withdraw'){
      const after=await view<Vault|null>('get_vault',{owner:who},MVP_CONTRACT);
      if(!after||!existing.before_vault)throw new Error('Balance reconciliation baseline is missing.');
      const before=BigInt(existing.before_vault[0]);
      const amount=existing.method==='deposit'?BigInt(existing.deposit):BigInt(String(existing.args.amount));
      const expected=existing.method==='deposit'?before+amount:before-amount;
      if(BigInt(after[0])!==expected||after[1]!==existing.before_vault[1])
        throw new Error('FINAL wallet receipt exists, but owner Vault balance did not reconcile.');
    }
    localStorage.removeItem(pendingKey(who));setPending(null);setLastHash(existing.hash);
    await refresh(who);setMessage(`${existing.method} verified FINAL: ${existing.hash}`);
  }
  async function call(method:string,args:Record<string,unknown>,deposit:bigint=0n){
    if(!owner||busy||inFlight.current)return;
    inFlight.current=true;setBusy(true);
    let promptStarted=false;
    try{
      if(!new Set(['create_vault','deposit','withdraw','set_recipient','set_agent','authorize_payment']).has(method))
        throw new Error('Only owner methods may be signed by this workspace.');
      await pinned();if(loadPending(owner))throw new Error('An earlier wallet operation is UNKNOWN. Reconcile it before another call.');
      const {instance,selected}=await selectedWallet(owner);
      const beforeVault=await view<Vault|null>('get_vault',{owner},MVP_CONTRACT);
      const action=await instance.createAction({id:'near::sign_transactions',input:{target:selected.identifier,
        transactions:[{receiverId:MVP_CONTRACT,actions:[actionCreators.functionCall(method,args,GAS,deposit)]}],useFunctionCallKey:false}});
      const marker:Pending={method,args,deposit:deposit.toString(),gas:GAS.toString(),hash:null,
        before_vault:beforeVault,created_at:new Date().toISOString()};
      localStorage.setItem(pendingKey(owner),JSON.stringify(marker));setPending(marker);
      promptStarted=true;
      const output=await action.promptForExecution();
      const hash=output[0]?.transaction?.hash;
      if(!hash)throw new Error('Wallet returned no hash. Inspect Meteor Activity before retrying.');
      const withHash={...marker,hash};localStorage.setItem(pendingKey(owner),JSON.stringify(withHash));setPending(withHash);
      await reconcile(withHash);
      return hash;
    }catch(error){
      if(promptStarted&&isMeteorCancellation(error)&&!loadPending(owner)?.hash){
        localStorage.removeItem(pendingKey(owner));setPending(null);
        setMessage(`${method}: Meteor explicitly cancelled the prompt. No transaction was submitted.`);
      }else if(!promptStarted)setMessage(`${method}: ${errorText(error)} No wallet submission was started.`);
      else setMessage(`${method}: ${errorText(error)} Outcome remains UNKNOWN until reconciled.`);
    }
    finally{setBusy(false);inFlight.current=false;}
  }
  function run(task:()=>Promise<unknown>){void task().catch(error=>setMessage(errorText(error)));}
  async function createVault(){if(vault)throw new Error('Your Vault already exists.');
    await pinned();if(await view<Vault|null>('get_vault',{owner},MVP_CONTRACT))throw new Error('Vault already exists at FINAL. Refresh.');
    const m=exactNear(max),w=exactNear(windowLimit),t=exactNear(threshold);
    if(m<=0n||w<m||t>m)throw new Error('Initial policy requires 0 < max payment ≤ window limit and threshold ≤ max payment.');
    await call('create_vault',{max_payment:m.toString(),window_limit:w.toString(),approval_threshold:t.toString(),window_ns:600_000_000_000},STORAGE_DEPOSIT);
  }
  async function updatePolicy(){if(!owner||!vault||!ACCOUNT.test(recipient))throw new Error('Connect your Vault and enter a valid Testnet recipient.');
    await call('set_recipient',{recipient,allowed:true});}
  async function setGrant(revoke=false){if(!owner||!vault)throw new Error('Your Vault is required.');
    if(!revoke&&(!ACCOUNT.test(agent)||agent===owner||agent===MVP_CONTRACT))throw new Error('Enter a separate Testnet agent account.');
    const expiry=revoke?0n:BigInt(Date.now()+24*60*60*1000)*1_000_000n;
    await call('set_agent',{agent:revoke?null:agent,expires_at_ns:expiry.toString()});}
  async function authorize(){if(!owner||!vault||!ACCOUNT.test(recipient))throw new Error('Connect your Vault and enter a valid recipient.');
    await pinned();const amount=exactNear(payAmount);
    const [snapshot,freshVault]=await Promise.all([
      view<PolicySnapshot|null>('get_policy_snapshot',{owner,recipient},MVP_CONTRACT),
      view<Vault|null>('get_vault',{owner},MVP_CONTRACT)]);
    if(!snapshot||!freshVault||Number(snapshot.policy_version)!==freshVault[5])
      throw new Error('FINAL owner policy or Vault changed. Refresh before signing.');
    setPolicy(snapshot);setPolicyRecipient(recipient);setVault(freshVault);
    ownerPreflight({owner,agent,recipient,amount,vault:freshVault,policy:snapshot,nowNs:BigInt(Date.now())*1_000_000n});
    const id=paymentId||`ag-${crypto.randomUUID().replace(/-/g,'')}`;
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error('Use letters, digits, hyphen or underscore in a payment ID.');
    const existing=await view<PaymentAuthorization|null>('get_payment_authorization',{owner,id},MVP_CONTRACT);
    if(existing)throw new Error('This payment ID already exists on chain.');
    setPaymentId(id);
    await call('authorize_payment',authorizeArgs(id,agent,recipient,amount,snapshot.policy_version,
      BigInt(Date.now()+55*60*1000)*1_000_000n));
  }
  async function checkPayment(id=paymentId){if(!owner||!id)throw new Error('Choose your payment ID.');
    await pinned();const detail=await view<PaymentDetails|null>('get_payment_details',{owner,id},MVP_CONTRACT);
    if(detail&&agentSession?.account_id===owner){void mvpApi('/history/observe','POST',{id},agentSession).catch(()=>{});}
    setPayment(detail);setPaymentId(id);setMessage(detail?`On-chain payment ${id}: ${statuses[detail[0]]??'UNKNOWN'}.`:`No on-chain payment ${id} for ${owner}.`);
  }
  async function cloudPreflight(){
    if(!agentSession||agentSession.account_id!==owner)throw new Error('Verify your wallet session first.');
    const result=await mvpApi<{reason:string;allowed:boolean;classification:string}>('/preflight','POST',
      {recipient,amount:exactNear(payAmount).toString()},agentSession);
    if(result.classification!=='POLICY_PREFLIGHT')throw new Error('Unexpected preflight classification.');
    setCloudDecision(result);setMessage(`Cloud policy preflight: ${result.reason}. This is not a contract execution result.`);
  }
  async function judgePreflight(){
    if(!owner||!vault||!ACCOUNT.test(recipient))throw new Error('Connect your Vault and enter a valid Testnet recipient.');
    await pinned();const amount=exactNear(payAmount);
    const [freshVault,snapshot]=await Promise.all([
      view<Vault|null>('get_vault',{owner},MVP_CONTRACT),
      view<PolicySnapshot|null>('get_policy_snapshot',{owner,recipient},MVP_CONTRACT)]);
    if(!freshVault||!snapshot)throw new Error('FINAL Vault policy is unavailable.');
    setVault(freshVault);setPolicy(snapshot);setPolicyRecipient(recipient);
    let reason='ALLOW';
    try{ownerPreflight({owner,agent:freshVault[3]??'',recipient,amount,vault:freshVault,policy:snapshot,nowNs:BigInt(Date.now())*1_000_000n});}
    catch(error){reason=freshVault[3]?errorText(error):'No active restricted agent grant for this Vault.';}
    setJudgeDecision({reason,allowed:reason==='ALLOW',recipient,amount:payAmount});
    setMessage(`Read-only policy estimate: ${reason}. No payment was submitted.`);
  }
  async function authenticateAgent(){
    if(!owner)throw new Error('Connect Meteor first.');
    const {instance,selected}=await selectedWallet(owner);
    const challenge=await mvpApi<{account_id:string;message:string;nonce:string;recipient:string;expires_at:number}>(
      '/auth/challenge','POST',{account_id:owner});
    if(challenge.account_id!==owner||challenge.expires_at<=Date.now()/1000)
      throw new Error('Agent login challenge is invalid or expired.');
    const action=await instance.createAction({id:'near::sign_message',input:{target:selected.identifier,
      messageParams:{message:challenge.message,recipient:challenge.recipient,nonce:decodeNonce(challenge.nonce)}}});
    const signed=await action.promptForExecution();
    if(signed.accountId!==owner)throw new Error('Wallet signed for a different owner.');
    const result=await mvpApi<AgentSession>('/auth/verify','POST',{
      ...normalizeMeteorSignature(signed),nonce:challenge.nonce});
    if(result.account_id!==owner)throw new Error('Verified agent session owner mismatch.');
    setAgentSession(result);
    const history=await mvpApi<{owner:string;payments:AgentPayment[]}>('/history','GET',undefined,result);
    if(history.owner!==owner)throw new Error('Agent history owner mismatch.');
    setAgentRows(history.payments);setMessage(`Agent session verified for ${owner}.`);
    const shared=await mvpApi<{owner:string;executor:{agent:string;public_key:string}|null}>(
      '/agent/shared','GET',undefined,result);
    if(shared.owner!==owner)throw new Error('Shared executor owner mismatch.');
    setSharedExecutor(shared.executor);
    if(shared.executor){setAgent(shared.executor.agent);setAgentPublicKey(shared.executor.public_key);}
    const signer=await mvpApi<{owner:string;status:string}>('/agent/status','GET',undefined,result)
      .catch(()=>({owner,status:'BLOCKED_STATUS_UNAVAILABLE'}));
    if(signer.owner!==owner)throw new Error('Agent signer status owner mismatch.');
    setAgentSignerStatus(signer.status);
    if(cloudReadOnly||signer.status==='BLOCKED_CLOUD_EXECUTOR'){
      setCloudReadOnly(true);setMessage('Wallet verified. Cloud API reads FINAL chain state; autonomous execution is unavailable.');
      return;
    }
    const reservation=await mvpApi<{owner:string;reservation:{agent:string;state:string}|null}>(
      '/agent/reservation','GET',undefined,result);
    if(reservation.owner!==owner)throw new Error('Agent reservation owner mismatch.');
    setAgentReservation(reservation.reservation);
    const provision=await mvpApi<ProvisioningStatus>('/agent/provisioning','GET',undefined,result);
    if(provision.owner!==owner)throw new Error('Agent provisioning owner mismatch.');
    setProvisioning(provision);
    setKeyRemoval(await mvpApi('/agent/provisioning/key-removal','GET',undefined,result));
    setCreationPending(localStorage.getItem(provisioningPendingKey(owner)));
    if(!shared.executor&&provision.state==='ACCOUNT_FINAL'&&provision.plan){setAgent(provision.plan.agent);setAgentPublicKey(provision.plan.agent_public_key);}
  }
  async function reserveAgent(){
    if(!owner||!agentSession||agentSession.account_id!==owner||!ACCOUNT.test(agent))
      throw new Error('Authenticate this owner and enter a separate Testnet agent account.');
    await selectedWallet(owner);
    const result=await mvpApi<{owner:string;reservation:{agent:string;state:string}}>(
      '/agent/reservation','POST',{agent},agentSession);
    if(result.owner!==owner||result.reservation.agent!==agent)throw new Error('Agent reservation scope mismatch.');
    setAgentReservation(result.reservation);
    setMessage(`Agent ${agent} reservation: ${result.reservation.state}. No account or key has been created.`);
  }
  async function refreshProvisioning(){
    if(!agentSession||agentSession.account_id!==owner)throw new Error('Verified owner session required.');
    const result=await mvpApi<ProvisioningStatus>('/agent/provisioning','GET',undefined,agentSession);
    if(result.owner!==owner)throw new Error('Agent provisioning owner mismatch.');
    setProvisioning(result);
    setKeyRemoval(await mvpApi('/agent/provisioning/key-removal','GET',undefined,agentSession));
    const signer=await mvpApi<{owner:string;status:string}>('/agent/status','GET',undefined,agentSession)
      .catch(()=>({owner,status:'BLOCKED_STATUS_UNAVAILABLE'}));
    if(signer.owner!==owner)throw new Error('Agent signer status owner mismatch.');
    setAgentSignerStatus(signer.status);
    if(result.state==='ACCOUNT_FINAL'&&result.plan){setAgent(result.plan.agent);setAgentPublicKey(result.plan.agent_public_key);}
    return result;
  }
  async function finalizeProvisioning(hash:string){
    if(!agentSession||agentSession.account_id!==owner||!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash))
      throw new Error('Verified owner session and exact creation hash required.');
    const result=await mvpApi<{provisioning:ProvisioningPlan}>('/agent/provisioning/finalize','POST',
      {creation_hash:hash},agentSession);
    if(result.provisioning.owner!==owner||result.provisioning.state!=='ACCOUNT_FINAL'||
      result.provisioning.creation_hash!==hash)throw new Error('FINAL agent account scope mismatch.');
    localStorage.removeItem(provisioningPendingKey(owner));setCreationPending(null);
    await refreshProvisioning();setMessage(`Agent account verified FINAL: ${hash}`);
  }
  async function prepareProvisioning(){
    if(!owner||!agentSession||agentSession.account_id!==owner||creationPending||pending)
      throw new Error('Verify the owner and reconcile pending wallet actions first.');
    await pinned();await selectedWallet(owner);
    if(!window.confirm('Request a separate restricted agent under the approved service namespace? The service control plane pays 0.05 Testnet NEAR plus gas after separate live approval. Your wallet signs no account-creation transaction.'))
      return;
    const result=await mvpApi<{plan:ProvisioningPlan}>('/agent/provisioning/prepare','POST',{},agentSession);
    const plan=result.plan;await checkedControlPlan(plan,owner);
    await signControlIntent('creation',plan);
    setProvisioning({owner,agent:plan.agent,state:plan.state,plan});
    setAgent(plan.agent);setAgentPublicKey(plan.agent_public_key);
    setMessage(`Signed exact creation intent for ${plan.agent}. Control plane verifies it independently before any transaction.`);
  }
  async function signControlIntent(purpose:'creation'|'deletion',plan:ProvisioningPlan){
    if(!agentSession||agentSession.account_id!==owner)throw new Error('Verified owner session required.');
    const payload=await mvpApi<{domain:string;network:string;genesis_hash:string;origin:string;
      recipient:string;purpose:string;tx_receiver:string;scope:Record<string,unknown>;
      request_id:string;nonce:string;expires_at:number;message:string}>(
      '/agent/provisioning/intent/challenge','POST',{purpose},agentSession);
    checkedControlIntent(payload,plan,purpose,owner,window.location.origin,MVP_GENESIS);
    const {instance,selected}=await selectedWallet(owner);
    const action=await instance.createAction({id:'near::sign_message',input:{target:selected.identifier,
      messageParams:{message:payload.message,recipient:payload.recipient,nonce:decodeNonce(payload.nonce)}}});
    const signed=await action.promptForExecution();
    if(signed.accountId!==owner)throw new Error('Control intent signed by a different owner.');
    const signature=normalizeMeteorSignature(signed);
    await mvpApi('/agent/provisioning/intent/submit','POST',{purpose,
      proof:{payload,public_key:signature.public_key,signature:signature.signature}},agentSession);
  }
  async function reconcileProvisioning(){
    if(!owner||!provisioning?.plan?.creation_hash)throw new Error('No control-plane creation hash is recorded.');
    const hash=provisioning.plan.creation_hash;
    if(!hash||!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash))
      throw new Error('Exact creation hash required; operation stays UNKNOWN.');
    await finalizeProvisioning(hash);
  }
  async function retireProvisioning(){
    if(!agentSession||agentSession.account_id!==owner||!vault||vault[3]!==null)
      throw new Error('First revoke the agent in Meteor and verify the FINAL Vault state.');
    const result=await mvpApi<{provisioning:ProvisioningPlan}>(
      '/agent/provisioning/retire','POST',{},agentSession);
    if(result.provisioning.owner!==owner||result.provisioning.state!=='REVOKED')
      throw new Error('Agent retirement was not verified.');
    const deletion=await mvpApi<{plan:ProvisioningPlan}>('/agent/provisioning/key-removal','GET',undefined,agentSession);
    if(!deletion.plan||deletion.plan.agent!==result.provisioning.agent)
      throw new Error('Exact DeleteKey plan unavailable.');
    await signControlIntent('deletion',deletion.plan);
    await refreshProvisioning();setAgentSignerStatus('BLOCKED_REVOKED');
    setMessage('Agent key retired after two-RPC FINAL Vault revocation. The isolated control plane will remove its on-chain restricted key; refresh for the FINAL result.');
  }
  async function finalizeKeyRemoval(){
    if(!agentSession||agentSession.account_id!==owner||!keyRemoval?.submission?.tx_hash||
       keyRemoval.state!=='DELETEKEY_UNKNOWN')throw new Error('No exact control-plane DeleteKey hash is pending.');
    const hash=keyRemoval.submission.tx_hash;
    const result=await mvpApi<{key_removal:{state:string;tx_hash:string}}>(
      '/agent/provisioning/key-removal/finalize','POST',{deletion_hash:hash},agentSession);
    if(result.key_removal.state!=='DELETEKEY_FINAL'||result.key_removal.tx_hash!==hash)
      throw new Error('FINAL DeleteKey verification did not match.');
    await refreshProvisioning();setMessage(`Restricted agent key removal verified FINAL: ${hash}`);
  }
  async function agentHistory(session=agentSession){
    if(!owner||!session||session.account_id!==owner)throw new Error('Verified agent session required.');
    const result=await mvpApi<{owner:string;payments:AgentPayment[]}>('/history','GET',undefined,session);
    if(result.owner!==owner)throw new Error('Agent history owner mismatch.');
    setAgentRows(result.payments);return result.payments;
  }
  async function prepareAgentPayment(){
    if(!owner||!agentSession||agentSession.account_id!==owner)throw new Error('Authenticate this wallet with the agent service.');
    await selectedWallet(owner);
    if(!agentPublicKey.startsWith('ed25519:'))throw new Error('Enter the public restricted agent key.');
    const record=loadRecords(owner).find(row=>row.id===paymentId);
    if(!record)throw new Error('First authorize this payment in Meteor and reconcile its FINAL hash.');
    const auth=await view<PaymentAuthorization|null>('get_payment_authorization',{owner,id:paymentId},MVP_CONTRACT);
    if(!auth||auth[0]!==6)throw new Error('FINAL owner authorization is absent or no longer active.');
    const result=await mvpApi<{payment:AgentPayment}>('/payments','POST',{
      id:paymentId,agent:auth[1],recipient:auth[2],amount:auth[3],policy_version:auth[4],
      public_key:agentPublicKey,authorization_hash:record.authorize_hash},agentSession);
    await agentHistory();setMessage(`Agent task ${result.payment.id}: ${result.payment.state}.`);
  }
  async function agentPhase(phase:'request'|'execute'|'reconcile'){
    if(!agentSession||agentSession.account_id!==owner||!paymentId)throw new Error('Verified owner session and payment ID required.');
    await selectedWallet(owner);
    const id=encodeURIComponent(paymentId);
    const result=await mvpApi<{error?:string;payment?:AgentPayment}>(`/payments/${id}/${phase}`,'POST',{},agentSession);
    const rows=await agentHistory();await checkPayment(paymentId);
    const row=rows.find(item=>item.id===paymentId);
    setMessage(result.error==='UNKNOWN_RECONCILE_REQUIRED'||row?.state.endsWith('_UNKNOWN')?
      `${phase.toUpperCase()}: outcome UNKNOWN. Reconcile the saved hash against FINAL RPCs; do not submit again.`:
      `${phase.toUpperCase()}: ${row?.state??'no durable payment found'}.`);
  }
  async function reconcileWithInput(){if(!owner||!pending)return;
    const hash=pending.hash||prompt('Enter the exact public Testnet transaction hash from Meteor Activity:')?.trim();
    if(!hash)throw new Error('A transaction hash is required. UNKNOWN remains locked.');
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash))throw new Error('Invalid NEAR transaction hash.');
    const next={...pending,hash};localStorage.setItem(pendingKey(owner),JSON.stringify(next));setPending(next);
    if(next.method==='request_payment'||next.method==='execute_payment')await reconcileDemoAgent(next);
    else await reconcile(next);
  }
  async function demoRead(method:string,args:Record<string,unknown>,url='https://test.rpc.fastnear.com'){
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:'manual-demo-final',method:'query',params:{request_type:'call_function',
        finality:'final',account_id:MVP_CONTRACT,method_name:method,
        args_base64:btoa(JSON.stringify(args))}}),signal:AbortSignal.timeout(15000)});
    const body=await response.json();if(!response.ok||body.error||!Array.isArray(body.result?.result))throw new Error(`FINAL ${method} unavailable`);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result))) as unknown;
  }
  async function demoTx(hash:string){
    const results:FinalTx[]=[];
    for(const url of ['https://test.rpc.fastnear.com','https://testnet-rpc.intea.rs']){
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:'manual-demo-final',method:'tx_status',
          params:{tx_hash:hash,sender_account_id:DEMO_AGENT,wait_until:'FINAL'}}),signal:AbortSignal.timeout(15000)});
      const body=await response.json();if(!response.ok||body.error||!body.result)throw new Error('Two-RPC FINAL transaction proof unavailable');
      results.push(body.result as FinalTx);
    }
    return results;
  }
  async function demoPreflight(){
    await pinned();
    const [fresh,scope]=await Promise.all([
      view<Vault|null>('get_vault',{owner:DEMO_OWNER},MVP_CONTRACT),
      view<PolicySnapshot|null>('get_policy_snapshot',{owner:DEMO_OWNER,recipient:DEMO_RECIPIENT},MVP_CONTRACT)]);
    if(!fresh||!scope)throw new Error('FINAL demo Vault or policy missing');
    ownerPreflight({owner:DEMO_OWNER,agent:DEMO_AGENT,recipient:DEMO_RECIPIENT,
      amount:DEMO_AMOUNT,vault:fresh,policy:scope,nowNs:BigInt(Date.now())*1_000_000n});
    return {fresh,scope};
  }
  async function demoGrant(){
    if(owner!==DEMO_OWNER)throw new Error(`Connect ${DEMO_OWNER} in Meteor first`);
    if(!demoAgentSeen)throw new Error(`Connect ${DEMO_AGENT} in Meteor first to confirm the account is available`);
    await pinned();const fresh=await view<Vault|null>('get_vault',{owner:DEMO_OWNER},MVP_CONTRACT);
    if(!fresh)throw new Error('Owner Vault missing at FINAL');
    if(fresh[3]===DEMO_AGENT&&BigInt(fresh[4])>BigInt(Date.now()+5*60_000)*1_000_000n)
      throw new Error('Agent grant is already active; do not renew it again');
    const expiry=BigInt(Date.now()+24*60*60_000)*1_000_000n;
    setDemoMessage('Awaiting owner signature in Meteor for a 24-hour grant.');
    const hash=await call('set_agent',{agent:DEMO_AGENT,expires_at_ns:expiry.toString()});
    if(hash){saveDemo({...demo,grant_hash:hash});setDemoMessage(`Grant verified FINAL: ${hash}`);}
    else setDemoMessage('Grant not verified. Inspect the wallet status and reconcile any UNKNOWN outcome before continuing.');
  }
  async function demoAuthorize(){
    if(owner!==DEMO_OWNER)throw new Error(`Connect ${DEMO_OWNER} in Meteor first`);
    if(demo.authorize_hash||demo.request_hash||demo.execute_hash)throw new Error('This demo payment already has a transaction; do not reuse its ID');
    const {scope}=await demoPreflight();
    const id=demo.id||`ag-demo-${crypto.randomUUID().replace(/-/g,'')}`;
    if(!validDemoId(id))throw new Error('Invalid demo payment ID');
    const existing=await view<PaymentAuthorization|null>('get_payment_authorization',{owner:DEMO_OWNER,id},MVP_CONTRACT);
    if(existing)throw new Error('Payment ID already used on chain');
    saveDemo({...demo,id});
    const args=authorizeArgs(id,DEMO_AGENT,DEMO_RECIPIENT,DEMO_AMOUNT,scope.policy_version,
      BigInt(Date.now()+55*60_000)*1_000_000n);
    setDemoMessage('Policy checked at FINAL. Awaiting owner signature in Meteor for exact 0.001 NEAR authorization.');
    const hash=await call('authorize_payment',args);
    if(hash){saveDemo({...demo,id,authorize_hash:hash});setDemoMessage(`Authorization verified FINAL: ${hash}. Switch Meteor to ${DEMO_AGENT}.`);}
    else setDemoMessage('Authorization not verified. Inspect the wallet status and reconcile any UNKNOWN outcome before continuing.');
  }
  async function reconcileDemoAgent(saved:Pending){
    if(!saved.hash||owner!==DEMO_AGENT||!demo.id)throw new Error('Agent account, payment ID and transaction hash required');
    if(saved.method!=='request_payment'&&saved.method!=='execute_payment')throw new Error('Unexpected pending agent method');
    await pinned();
    const auth=await view<PaymentAuthorization|null>('get_payment_authorization',{owner:DEMO_OWNER,id:demo.id},MVP_CONTRACT);
    if(!auth||auth[1]!==DEMO_AGENT||auth[2]!==DEMO_RECIPIENT||auth[3]!==DEMO_AMOUNT.toString())
      throw new Error('Exact owner authorization does not match this demo');
    const exactArgs=saved.method==='request_payment'?{owner:DEMO_OWNER,id:demo.id,recipient:DEMO_RECIPIENT,
      amount:DEMO_AMOUNT.toString(),policy_version:auth[4]}:{owner:DEMO_OWNER,id:demo.id};
    const exactGas=saved.method==='request_payment'?50_000_000_000_000n:GAS;
    if(JSON.stringify(saved.args)!==JSON.stringify(exactArgs)||saved.gas!==exactGas.toString()||saved.deposit!=='0')
      throw new Error('Saved pending agent call differs from exact demo scope');
    const expected={hash:saved.hash,signer:DEMO_AGENT,method:saved.method,args:exactArgs,gas:exactGas,deposit:0n};
    const transactions=await demoTx(saved.hash);
    if(!transactions.every(tx=>verifyFinalCall(tx,expected)))throw new Error('Two-RPC exact FINAL transaction/receipts not verified; outcome remains UNKNOWN');
    const details=await Promise.all(['https://test.rpc.fastnear.com','https://testnet-rpc.intea.rs'].map(url=>
      demoRead('get_payment_details',{owner:DEMO_OWNER,id:demo.id},url) as Promise<PaymentDetails|null>));
    if(saved.method==='request_payment'){
      if(!details.every(row=>row?.[0]===0&&row[1]===DEMO_AMOUNT.toString()&&row[2]===DEMO_RECIPIENT))
        throw new Error('FINAL REQUEST state mismatch; outcome remains UNKNOWN');
      saveDemo({...demo,request_hash:saved.hash});setDemoMessage(`REQUEST verified FINAL: ${saved.hash}. Review EXECUTE before signing.`);
    }else{
      if(!transactions.every((tx,i)=>verifyDemoTransfer(tx,details[i])))
        throw new Error('FINAL transfer/callback receipts or SETTLED state not verified; outcome remains UNKNOWN');
      const finalVault=await view<Vault|null>('get_vault',{owner:DEMO_OWNER},MVP_CONTRACT);
      if(!finalVault||finalVault[1]!=='0'||!saved.before_vault||
        BigInt(finalVault[0])!==BigInt(saved.before_vault[0])-DEMO_AMOUNT)
        throw new Error('FINAL Vault balance did not reconcile; outcome remains UNKNOWN');
      const recipientAccount=await account(DEMO_RECIPIENT);
      if(saved.before_recipient&&BigInt(recipientAccount.amount)<BigInt(saved.before_recipient)+DEMO_AMOUNT)
        throw new Error('FINAL recipient balance did not reconcile; outcome remains UNKNOWN');
      setDemoRecipientBalance(recipientAccount.amount);
      setDemoVaultBalance(finalVault[0]);
      setDemoVerified(true);
      saveDemo({...demo,execute_hash:saved.hash});setDemoMessage(`FINAL SETTLED 0.001 NEAR to ${DEMO_RECIPIENT}: ${saved.hash}`);
    }
    setDemoDetails(details[0]);localStorage.removeItem(pendingKey(DEMO_AGENT));setPending(null);setLastHash(saved.hash);
  }
  async function demoAgentCall(method:'request_payment'|'execute_payment'){
    if(owner!==DEMO_AGENT||!demo.id||!demo.authorize_hash||busy||inFlight.current)throw new Error(`Connect ${DEMO_AGENT} in Meteor after a verified owner authorization`);
    inFlight.current=true;setBusy(true);let promptStarted=false;
    try{
      if(loadPending(DEMO_AGENT))throw new Error('Prior agent transaction is UNKNOWN; reconcile it first');
      const {fresh,scope}=await demoPreflight();
      const auth=await view<PaymentAuthorization|null>('get_payment_authorization',{owner:DEMO_OWNER,id:demo.id},MVP_CONTRACT);
      if(!auth||auth[0]!== (method==='request_payment'?6:0)||auth[1]!==DEMO_AGENT||
        auth[2]!==DEMO_RECIPIENT||auth[3]!==DEMO_AMOUNT.toString()||auth[4]!==fresh[5]||
        BigInt(auth[5])<=BigInt(Date.now())*1_000_000n)throw new Error('FINAL one-use owner authorization is missing, stale or in the wrong state');
      if(method==='execute_payment'){
        if(!demo.request_hash)throw new Error('FINAL REQUEST hash required before EXECUTE');
        const requestArgs={owner:DEMO_OWNER,id:demo.id,recipient:DEMO_RECIPIENT,amount:DEMO_AMOUNT.toString(),policy_version:fresh[5]};
        const verified=(await demoTx(demo.request_hash)).every(tx=>verifyFinalCall(tx,{hash:demo.request_hash,
          signer:DEMO_AGENT,method:'request_payment',args:requestArgs,gas:50_000_000_000_000n,deposit:0n}));
        if(!verified)throw new Error('Exact FINAL REQUEST proof missing');
      }
      const args=method==='request_payment'?{owner:DEMO_OWNER,id:demo.id,recipient:DEMO_RECIPIENT,
        amount:DEMO_AMOUNT.toString(),policy_version:scope.policy_version}:{owner:DEMO_OWNER,id:demo.id};
      const gas=method==='request_payment'?50_000_000_000_000n:GAS;
      const {instance,selected}=await selectedWallet(DEMO_AGENT);
      const action=await instance.createAction({id:'near::sign_transactions',input:{target:selected.identifier,
        transactions:[{receiverId:MVP_CONTRACT,actions:[actionCreators.functionCall(method,args,gas,0n)]}],useFunctionCallKey:false}});
      const beforeRecipient=method==='execute_payment'?await account(DEMO_RECIPIENT):null;
      const marker:Pending={method,args,deposit:'0',gas:gas.toString(),hash:null,before_vault:fresh,
        before_recipient:beforeRecipient?.amount,created_at:new Date().toISOString()};
      localStorage.setItem(pendingKey(DEMO_AGENT),JSON.stringify(marker));setPending(marker);
      setDemoMessage(`Awaiting ${DEMO_AGENT} signature in Meteor for ${method}.`);promptStarted=true;
      const output=await action.promptForExecution();const hash=output[0]?.transaction?.hash;
      if(!hash)throw new Error('Meteor returned no hash; inspect wallet Activity before retrying');
      const withHash={...marker,hash};localStorage.setItem(pendingKey(DEMO_AGENT),JSON.stringify(withHash));setPending(withHash);
      setDemoMessage(`${method} pending FINAL: ${hash}`);await reconcileDemoAgent(withHash);
    }catch(error){
      if(promptStarted&&isMeteorCancellation(error)&&!loadPending(DEMO_AGENT)?.hash){
        localStorage.removeItem(pendingKey(DEMO_AGENT));setPending(null);
        setDemoMessage(`${method}: explicitly cancelled in Meteor; no transaction submitted.`);
      }else setDemoMessage(`${method}: ${errorText(error)} ${promptStarted?'Outcome UNKNOWN until reconciled.':'No wallet submission started.'}`);
    }finally{setBusy(false);inFlight.current=false;}
  }
  async function demoStatus(){
    if(!demo.id)throw new Error('No demo payment ID saved');
    await pinned();const row=await view<PaymentDetails|null>('get_payment_details',{owner:DEMO_OWNER,id:demo.id},MVP_CONTRACT);
    setDemoVerified(false);setDemoDetails(row);
    const savedAuth=loadRecords(DEMO_OWNER).find(item=>item.id===demo.id)?.authorize_hash;
    if(savedAuth&&!demo.authorize_hash)saveDemo({...demo,authorize_hash:savedAuth});
    setDemoMessage(row?`FINAL chain status: ${statuses[row[0]]??'UNKNOWN'}. Verify the exact EXECUTE receipts before claiming settlement.`:'No payment with this ID at FINAL.');
  }
  async function demoVerifyResult(){
    if(!demo.id||!demo.execute_hash)throw new Error('Exact EXECUTE hash and payment ID required');
    await pinned();const args={owner:DEMO_OWNER,id:demo.id};
    const txs=await demoTx(demo.execute_hash);
    const details=await Promise.all(['https://test.rpc.fastnear.com','https://testnet-rpc.intea.rs'].map(url=>
      demoRead('get_payment_details',args,url) as Promise<PaymentDetails|null>));
    if(!txs.every((tx,i)=>verifyFinalCall(tx,{hash:demo.execute_hash,signer:DEMO_AGENT,
      method:'execute_payment',args,gas:GAS,deposit:0n})&&verifyDemoTransfer(tx,details[i])))
      throw new Error('Two-RPC FINAL settlement and exact transfer/callback receipts do not match');
    const finalVault=await view<Vault|null>('get_vault',{owner:DEMO_OWNER},MVP_CONTRACT);
    if(!finalVault)throw new Error('FINAL owner Vault unavailable');
    const recipientAccount=await account(DEMO_RECIPIENT);
    setDemoRecipientBalance(recipientAccount.amount);setDemoVaultBalance(finalVault[0]);
    setDemoDetails(details[0]);setDemoVerified(true);
    setDemoMessage(`FINAL settlement independently verified: ${demo.execute_hash}`);
  }
  const sessionReady=!!owner&&agentSession?.account_id===owner&&agentSession.expires_at>Date.now()/1000;
  const signerReady=sessionReady&&agentSignerStatus==='CONFIGURED_APPROVAL_REQUIRED';
  const currentAgentRow=agentRows.find(row=>row.id===paymentId);
  const demoGrantActive=owner===DEMO_OWNER&&vault?.[3]===DEMO_AGENT&&BigInt(vault[4])>BigInt(Date.now())*1_000_000n;
  const agentStep=!owner?'Connect wallet':!vault?'Create Vault':!sessionReady?'Verify owner session':
    cloudReadOnly&&!sharedExecutor?'Use Vault; agent execution unavailable':
    !sharedExecutor&&provisioning?.state==='REVOKED'?'Agent retired; rotation required':
    !sharedExecutor&&provisioning?.state!=='ACCOUNT_FINAL'?'Provision separate agent':!signerReady?'Agent signer blocked':
    !vault[3]?'Grant agent':!currentAgentRow?'Authorize and register payment':
    currentAgentRow.state==='AUTHORIZED'?'Submit REQUEST':
    currentAgentRow.state==='REQUEST_FINAL'?'Submit EXECUTE':
    currentAgentRow.state.endsWith('_UNKNOWN')?'Reconcile FINAL':
    currentAgentRow.state==='SETTLED'?'Settlement verified':'Review payment state';
  return <main><header><div><div className="eyebrow">AgentShield Arena / NEAR Testnet</div><h1>My Vault</h1><p>Give an agent limited spending authority instead of full wallet access. Your account and payments stay separate from the historical proof.</p></div>
    <div>{owner?<><strong>{owner}</strong><br/><button className="secondary" disabled={busy} onClick={()=>void disconnect()}>Disconnect</button></>:
      <button disabled={busy} onClick={()=>void connect()}>Connect Meteor Wallet</button>}</div></header>
    <nav className="journey card" aria-label="Vault onboarding"><div className="eyebrow">YOUR NEXT STEP</div><strong>{agentStep}</strong><p>{cloudReadOnly?'1. Connect Meteor → 2. Create Vault with initial limits → 3. Deposit → 4. Inspect FINAL policy and activity → 5. Revoke and withdraw when applicable. Autonomous agent execution is unavailable in Lite MVP.':`1. Connect wallet → 2. Create and fund Vault → 3. Verify owner → 4. ${sharedExecutor?'Grant the restricted executor':'Provision a separate agent'} → 5. Set recipient and authorize → 6. Request, execute and verify FINAL → 7. Revoke and withdraw.`}</p>{!signerReady&&owner&&vault&&<p className="warning-text">Agent execution is blocked until a restricted key and persistent signer service are verified. Vault owner actions remain available.</p>}</nav>
    <div className="status">Wallet: <strong>{owner?'Connected':'Disconnected'}</strong> · Wallet network: <strong>NEAR Testnet</strong> · Vault state: <strong>{!owner?'Connect wallet':vault?'FINAL · ACTIVE':'No Vault at FINAL'}</strong> · Cloud API: <strong>{cloudApiStatus}</strong></div>
    <div className={`status ${pending?'warning':''}`} role="status">{busy?'Waiting for wallet or FINAL RPC… ':''}{message}
      {lastHash&&<><br/>Hash: <a href={explorer(lastHash)} target="_blank" rel="noreferrer">{lastHash}</a></>}</div>
    {pending&&<div className="status warning" role="alert">UNKNOWN {pending.method} since {pending.created_at}. {pending.hash&&<a href={explorer(pending.hash)}>View {pending.hash}</a>}
      <div><button disabled={busy} onClick={()=>run(reconcileWithInput)}>Reconcile exact FINAL transaction</button></div>
      No new wallet action is enabled until this outcome is verified.</div>}
    {creationPending&&<div className="status warning" role="alert">Agent creation outcome UNKNOWN. {creationPending!=='UNKNOWN'&&<a href={explorer(creationPending)}>View transaction</a>}
      <button disabled={busy||!sessionReady} onClick={()=>run(reconcileProvisioning)}>Reconcile exact FINAL account creation</button>
      Do not create or fund this account again until reconciliation.</div>}
    {owner&&<div className="actions"><button className="secondary" disabled={busy} onClick={()=>run(()=>refresh().then(()=>setMessage('FINAL Vault state refreshed.')))}>Refresh FINAL state</button></div>}
    {owner&&<div className="grid"><section className="card" id="my-vault"><h2>My Vault</h2>{vault?<>
      <div className="row"><span>Available</span><span>{displayNear(vault[0])} NEAR</span></div>
      <div className="row"><span>Pending</span><span>{displayNear(vault[1])} NEAR</span></div>
      <div className="row"><span>Storage reserve</span><span>{displayNear(vault[2])} NEAR</span></div>
      <div className="row"><span>Policy version</span><span>{vault[5]}</span></div>
      {policy&&<><div className="row"><span>Max payment</span><span>{displayNear(policy.max_payment)} NEAR</span></div>
      <div className="row"><span>10-minute window limit</span><span>{displayNear(policy.window_limit)} NEAR</span></div>
      <div className="row"><span>Extra approval threshold</span><span>{displayNear(policy.approval_threshold)} NEAR</span></div>
      <p>These initial spending limits cannot be edited in this Vault version.</p></>}
      <label>Amount in NEAR<input value={funds} onChange={e=>setFunds(e.target.value)}/></label>
      <button disabled={busy||!!pending} onClick={()=>run(async()=>{const n=exactNear(funds);if(n<=0n)throw new Error('Amount must be positive.');await call('deposit',{},n);})}>Deposit</button>
      <button className="secondary" disabled={busy||!!pending} onClick={()=>run(async()=>{const n=exactNear(funds);if(n<=0n||n>BigInt(vault[0]))throw new Error('Insufficient available balance.');await call('withdraw',{amount:n.toString()});})}>Withdraw</button>
    </>:<><p>No Vault for connected owner {owner} at FINAL.</p><h2>Set initial policy</h2>
      <label>Max payment NEAR<input value={max} onChange={e=>setMax(e.target.value)}/></label>
      <label>10-minute window limit NEAR<input value={windowLimit} onChange={e=>setWindowLimit(e.target.value)}/></label>
      <label>Extra approval above NEAR<input value={threshold} onChange={e=>setThreshold(e.target.value)}/></label>
      <p>Creation reserves 0.01 NEAR for storage; deposit spendable funds separately. Initial limits cannot be edited by this contract.</p>
      <button disabled={busy||!!pending||owner===DEMO_AGENT} onClick={()=>run(createVault)}>Create My Vault in Meteor</button></>}</section>
    {vault&&<><section className="card"><h2>My Policy & Agent</h2>
      <label>Allowed recipient<input value={recipient} onChange={e=>{setRecipient(e.target.value.trim());setJudgeDecision(null);}} placeholder="recipient.testnet"/></label>
      <button disabled={busy||!!pending} onClick={()=>run(updatePolicy)}>Allow recipient</button>
      <p>{sharedExecutor?'Shared restricted executor':'Separate agent account'}: {sharedExecutor?.agent??provisioning?.agent??'authenticate to derive from the approved namespace'}</p>
      <p>On-chain grant: {vault[3]??'none'}{vault[3]?` · expires ${new Date(Number(BigInt(vault[4])/1_000_000n)).toLocaleString()}`:''}. A restricted agent key must be provisioned and verified separately before execution.</p>
      <button disabled={busy||!!pending||!!creationPending||(cloudReadOnly?!sharedExecutor:!signerReady||(!sharedExecutor&&provisioning?.state!=='ACCOUNT_FINAL'))||(sharedExecutor?sharedExecutor.agent!==agent:provisioning?.agent!==agent)} onClick={()=>run(()=>setGrant())}>Grant agent for 24 hours</button>
      <button className="secondary" disabled={busy||!!pending||!vault[3]} onClick={()=>run(()=>setGrant(true))}>Revoke agent</button>
    </section><section className="card wide"><h2>New Payment</h2>
      <p>Owner signs <code>authorize_payment</code>. The manual Meteor demo below can sign agent REQUEST and EXECUTE after an active grant. Autonomous execution remains unavailable without an isolated agent service.</p>
      <label>Recipient<input value={recipient} onChange={e=>{setRecipient(e.target.value.trim());setJudgeDecision(null);}}/></label>
      <label>Amount NEAR<input value={payAmount} onChange={e=>{setPayAmount(e.target.value);setJudgeDecision(null);}}/></label>
      <label>Payment ID (generated if blank)<input value={paymentId} onChange={e=>setPaymentId(e.target.value.trim())}/></label>
      {policy&&<p>FINAL policy v{policy.policy_version}: {ACCOUNT.test(recipient)&&policyRecipient===recipient?`recipient ${policy.recipient_allowed?'allowed':'denied'}`:'refresh or authorize to check this recipient'}; max {displayNear(policy.max_payment)}; window {displayNear(policy.window_limit)} NEAR.</p>}
      <div className="judge-demo"><strong>Judge Demo · real Vault policy</strong><p>Read this owner's FINAL Vault and recipient policy, then estimate whether the entered payment meets the current limits. This sends no transaction.</p>
        <button className="secondary" disabled={busy||!!pending} onClick={()=>run(judgePreflight)}>Check payment against FINAL policy</button>
        {judgeDecision&&<p role="status"><strong>{judgeDecision.allowed?'ALLOW estimate':'DENY estimate'}</strong> · {judgeDecision.reason} · {judgeDecision.amount} NEAR to {judgeDecision.recipient}. Frontend preflight is not an on-chain contract rejection.</p>}
        <a href={contractExplorer} target="_blank" rel="noopener noreferrer">Inspect Vault v2 contract on Testnet Explorer</a></div>
      {cloudReadOnly&&<><button className="secondary" disabled={busy||!sessionReady} onClick={()=>run(cloudPreflight)}>Check FINAL on-chain policy</button>
        {cloudDecision&&<p>Policy preflight: <strong>{cloudDecision.reason}</strong>. This is a read-only estimate; only a contract transaction can enforce or reject a payment.</p>}</>}
      <button disabled={busy||!!pending||vault[3]!==agent||(!cloudReadOnly&&!signerReady)} onClick={()=>run(authorize)}>Review and authorize in Meteor</button>
      <button className="secondary" disabled={busy} onClick={()=>run(()=>checkPayment())}>Refresh payment status</button>
      {payment&&<p>On-chain: <strong>{statuses[payment[0]]??'UNKNOWN'}</strong>; {displayNear(payment[1])} NEAR to {payment[2]}.</p>}
    </section><section className="card wide"><h2>My Activity</h2><p>Payment IDs stored locally for this connected account; every displayed status is rechecked on chain.</p>
      <ul className="history">{records.map(row=><li key={row.id}><button className="secondary" disabled={busy} onClick={()=>run(()=>checkPayment(row.id))}>{row.id}</button> → {row.recipient}, {displayNear(row.amount)} NEAR · <a href={explorer(row.authorize_hash)}>authorization</a></li>)}
      {!records.length&&<li>No locally remembered payments for this owner.</li>}</ul></section></>}</div>}
    {owner&&vault&&<section className="card wide"><h2>Agent execution</h2>
      <p>{cloudReadOnly?'Sign a NEP-413 message to inspect your owner-specific FINAL chain history and policy. Autonomous REQUEST/EXECUTE is unavailable.':'Sign a NEP-413 message to access your owner-specific journal. A separate restricted key and persistent executor are required; no browser key is used. Agent account storage and gas need funding.'}</p>
      <button disabled={busy} onClick={()=>run(authenticateAgent)}>{agentSession?'Reauthenticate agent session':'Authenticate agent session'}</button>
      {sessionReady&&<>{sharedExecutor?<p>Shared restricted executor: <strong>{sharedExecutor.agent}</strong>. Revoking your Vault grant does not remove the key for other owners.</p>:cloudReadOnly?<p>No restricted executor is configured. Account creation and payment execution are unavailable in this cloud candidate.</p>:<><p>Provisioning: <strong>{provisioning?.state??'LOADING'}</strong> · {provisioning?.agent??'unknown'}</p>
        {provisioning?.state==='FUNDING_REQUIRED'&&<p>The service namespace needs funding before account creation can continue.</p>}
        {provisioning?.state==='RECOVERY_REQUIRED'&&<p>FINAL account or protected payment key verification failed. Signing is blocked until recovery is reviewed.</p>}
        {provisioning?.state==='CREATION_UNKNOWN'&&<p>Creation is pending FINAL verification. The control plane reconciles the recorded hash after restart.</p>}
        {provisioning?.state==='REVOKED'&&<p>The payment key is retired locally. DeleteKey must still be verified FINAL on chain.</p>}
        {provisioning?.plan&&<p>Service namespace {provisioning.plan.namespace} pays 0.05 Testnet NEAR plus gas after control-plane approval. Restricted key {provisioning.plan.agent_public_key} may call only <code>request_payment</code> and <code>execute_payment</code> on {MVP_CONTRACT}; allowance 0.05 NEAR. FullAccess stays in the separate control plane.</p>}
        {provisioning?.plan?.creation_hash&&<a href={explorer(provisioning.plan.creation_hash)}>{provisioning.state==='ACCOUNT_FINAL'?'FINAL account creation':'Creation submitted; FINAL pending'}</a>}
        <button disabled={busy||!!pending||!!creationPending||!['NOT_STARTED','AWAITING_CONTROL_PLANE'].includes(provisioning?.state??'')} onClick={()=>run(prepareProvisioning)}>Request separate agent</button>
        <button className="secondary" disabled={busy||provisioning?.state!=='CREATION_UNKNOWN'} onClick={()=>run(reconcileProvisioning)}>Verify exact FINAL agent creation</button>
        <button className="secondary" disabled={busy||!!pending||!!creationPending||provisioning?.state!=='ACCOUNT_FINAL'||vault[3]!==null} onClick={()=>run(retireProvisioning)}>Retire key after FINAL revoke</button>
        <p>On-chain restricted key removal: {keyRemoval?.state??'NOT_REVOKED'}.
          {keyRemoval?.submission?.tx_hash&&<a href={explorer(keyRemoval.submission.tx_hash)}>DeleteKey transaction</a>}</p>
        <button className="secondary" disabled={busy||keyRemoval?.state!=='DELETEKEY_UNKNOWN'} onClick={()=>run(finalizeKeyRemoval)}>Verify FINAL DeleteKey</button>
        <button className="secondary" disabled={busy} onClick={()=>run(refreshProvisioning)}>Refresh provisioning status</button></>}
        <p>Agent signer: {agentSignerStatus}. Reservation alone does not create or fund an account.</p>
        <button disabled={busy||!!pending||!!creationPending||!signerReady||(!sharedExecutor&&provisioning?.state!=='ACCOUNT_FINAL')||!paymentId||!agentPublicKey.startsWith('ed25519:')} onClick={()=>run(prepareAgentPayment)}>Create durable task from FINAL authorization</button>
        <button disabled={busy||!signerReady||currentAgentRow?.state!=='AUTHORIZED'} onClick={()=>run(()=>agentPhase('request'))}>Submit REQUEST once</button>
        <button disabled={busy||!signerReady||currentAgentRow?.state!=='REQUEST_FINAL'} onClick={()=>run(()=>agentPhase('execute'))}>Submit EXECUTE once</button>
        <button disabled={busy||!currentAgentRow?.state.endsWith('_UNKNOWN')} onClick={()=>run(()=>agentPhase('reconcile'))}>Reconcile FINAL</button>
        <button className="secondary" disabled={busy} onClick={()=>run(()=>agentHistory())}>Refresh my agent history</button>
        <ul className="history">{agentRows.map(row=><li key={row.id}>{row.id}: {row.state}
          {row.request_hash&&<> · REQUEST <a href={explorer(row.request_hash)}>{row.request_hash}</a></>}
          {row.execute_hash&&<> · EXECUTE <a href={explorer(row.execute_hash)}>{row.execute_hash}</a></>}
        </li>)}</ul></>}
    </section>}
    <section className="card wide" aria-label="Manual Testnet payment demo"><h2>Manual 0.001 NEAR Vault payment</h2>
      <p>Owner {DEMO_OWNER} → agent {DEMO_AGENT} → recipient {DEMO_RECIPIENT}. First connect the agent in Meteor without signing a transaction, then connect the owner. Each transaction requires a separate Meteor confirmation. This manual wallet path does not prove use of the agent's restricted FunctionCall key; cloud autonomous execution remains unavailable.</p>
      <p>Connected account: <strong>{owner||'none'}</strong>. Agent account seen in Meteor: <strong>{demoAgentSeen?'yes':'not yet'}</strong>. Payment ID: <strong>{demo.id||'created when owner authorizes'}</strong>.</p>
      <p role="status">{demoMessage}</p>
      <div className="actions">
        <button disabled={busy||!!pending||owner!==DEMO_OWNER||!demoAgentSeen||!!demo.authorize_hash} onClick={()=>run(demoGrant)}>1. Owner: Renew Agent Grant</button>
        <button disabled={busy||!!pending||!demoGrantActive||!!demo.authorize_hash} onClick={()=>run(demoAuthorize)}>2. Owner: Authorize 0.001 NEAR</button>
        <button disabled={busy||!!pending||owner!==DEMO_AGENT||!demo.authorize_hash||!!demo.request_hash} onClick={()=>run(()=>demoAgentCall('request_payment'))}>3. Agent: Request Payment</button>
        <button disabled={busy||!!pending||owner!==DEMO_AGENT||!demo.request_hash||!!demo.execute_hash} onClick={()=>run(()=>demoAgentCall('execute_payment'))}>4. Agent: Execute Payment</button>
        <button className="secondary" disabled={busy||!demo.id} onClick={()=>run(demoStatus)}>Refresh FINAL payment status</button>
        <button className="secondary" disabled={busy||!demo.execute_hash} onClick={()=>run(demoVerifyResult)}>Verify FINAL EXECUTE receipts</button>
      </div>
      {demoDetails&&<p>FINAL contract status: <strong>{statuses[demoDetails[0]]??'UNKNOWN'}</strong>; {displayNear(demoDetails[1])} NEAR to {demoDetails[2]}. Settlement proof requires the EXECUTE receipt.</p>}
      {demoVerified&&demo.execute_hash&&demoDetails?.[0]===4&&<p><strong>FINAL SETTLED</strong> · recipient {DEMO_RECIPIENT} · amount 0.001 NEAR{demoVaultBalance?` · Vault available ${displayNear(demoVaultBalance)} NEAR`:''}{demoRecipientBalance?` · recipient balance ${displayNear(demoRecipientBalance)} NEAR`:''}.</p>}
      <ul className="history">{([['Grant',demo.grant_hash],['Authorize',demo.authorize_hash],['REQUEST',demo.request_hash],['EXECUTE',demo.execute_hash]] as const).filter(([,hash])=>!!hash).map(([label,hash])=><li key={label}>{label}: <a href={explorer(hash)} target="_blank" rel="noopener noreferrer">{hash}</a></li>)}</ul>
      <p className="muted">An authorization alone is not a payment. If a wallet outcome is unknown, reconcile its exact hash above before any further signature.</p>
    </section>
    <p className="muted">Testnet only · No private keys in this site · <a href="/">Historical proof showcase</a></p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
