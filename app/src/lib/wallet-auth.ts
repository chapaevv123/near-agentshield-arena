const ownerMethods=new Set(['set_agent','set_agent_authorization','set_recipient','set_limits','set_paused','approve_payment','emergency_stop']);
const agentMethods=new Set(['request_payment','execute_payment']);

export function assertSigningRole(method:string,role:'owner'|'agent'):void {
  if(!(role==='owner'?ownerMethods:agentMethods).has(method))throw new Error(`Method ${method} is not available to the ${role} wallet`);
}

export async function promptAuthorized<T>(method:string,role:'owner'|'agent',prompt:()=>Promise<T>):Promise<T> {
  assertSigningRole(method,role);
  return prompt();
}
