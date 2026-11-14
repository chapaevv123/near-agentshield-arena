import assert from 'node:assert/strict';
import {test} from 'node:test';
import {connectionError} from '../src/lib/wallet-errors.ts';

test('blocked Meteor popup is explained as a browser action',()=>{
  assert.match(connectionError(new Error('Popup blocked by browser')),/Allow popups/);
  assert.doesNotMatch(connectionError(new Error('Popup blocked by browser')),/contract/i);
});

test('wallet rejection and unrelated RPC failures keep distinct causes',()=>{
  assert.match(connectionError(new Error('User rejected request')),/cancelled in the wallet/);
  assert.equal(connectionError(new Error('RPC timeout')),'RPC timeout');
});
