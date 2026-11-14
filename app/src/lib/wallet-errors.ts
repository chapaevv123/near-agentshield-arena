export function connectionError(error:unknown):string {
  const message=error instanceof Error?error.message:String(error);
  if (/popup.{0,40}block|block.{0,40}popup|pop-up.{0,40}block|block.{0,40}pop-up|window\.open.{0,40}(?:null|block)|failed to open (?:the )?(?:wallet )?(?:popup|pop-up)/i.test(message)) {
    return 'Meteor popup was blocked by the browser. Allow popups for this site, then retry Connect.';
  }
  if (/user.{0,30}(?:reject|cancel|declin)|(?:reject|cancel|declin).{0,30}user/i.test(message)) {
    return 'Meteor connection was cancelled in the wallet. No transaction was submitted.';
  }
  return message;
}
