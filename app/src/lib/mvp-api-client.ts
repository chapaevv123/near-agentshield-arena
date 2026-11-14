export type AgentPayment={contract:string;owner:string;id:string;agent:string;recipient:string;
  amount:string;policy_version:number;authorization_hash:string;state:string;
  request_hash:string|null;execute_hash:string|null;updated_at:number};
export type AgentSession={token:string;account_id:string;expires_at:number};

const workerUrl=import.meta.env.VITE_AGENTSHIELD_WORKER_URL?.trim().replace(/\/$/,'')||'';
const apiOrigin=/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(workerUrl)?workerUrl:'';

export async function mvpApi<T>(path:string,method:'GET'|'POST',body?:Record<string,unknown>,
  session?:AgentSession|null):Promise<T>{
  if(!/^\/(healthz?|preflight|auth\/(challenge|verify|logout)|history(?:\/observe)?|agent\/(reservation|shared|status|provisioning(?:\/(prepare|finalize|retire|intent\/(challenge|submit)|key-removal(?:\/finalize)?))?)|payments(?:\/[a-zA-Z0-9_-]+(?:\/(request|execute|reconcile))?)?)$/.test(path))
    throw new Error('Invalid local agent API path');
  const response=await fetch(apiOrigin+'/mvp-api'+path,{method,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000),
    headers:{...(method==='POST'?{'Content-Type':'application/json'}:{}),
      ...(session?{Authorization:`Bearer ${session.token}`}:{})},
    ...(method==='POST'?{body:JSON.stringify(body??{})}:{})});
  let payload:unknown;
  try{payload=await response.json();}catch{throw new Error('Cloud API is unavailable');}
  if(!response.ok)throw new Error(`Agent API ${response.status}: ${String((payload as {error?:string})?.error??'UNKNOWN')}`);
  return payload as T;
}
