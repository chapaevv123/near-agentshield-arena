import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeMeteorSignature} from '../src/lib/near-login.ts';

test('MOCKED Meteor NEP-413 signature is serialized for server verification',()=>{
  const bytes=Uint8Array.from({length:64},(_,index)=>index);
  const normalized=normalizeMeteorSignature({accountId:'alice.testnet',
    publicKey:{toString:()=> 'ed25519:MOCK_PUBLIC_KEY'},signature:bytes});
  assert.deepEqual(normalized,{account_id:'alice.testnet',public_key:'ed25519:MOCK_PUBLIC_KEY',
    signature:Buffer.from(bytes).toString('base64')});
  assert.throws(()=>normalizeMeteorSignature({accountId:'alice.testnet',
    publicKey:{toString:()=> 'secp256k1:MOCK'},signature:bytes}),/unsupported/);
});
