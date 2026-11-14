import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyD1Identity} from './verify_d1_identity.mjs';

test('remote D1 identity requires exact owner-provided name and UUID',()=>{
  const right={name:'agentshield-lite',uuid:'7de64b16-19fd-4c65-85d9-458e6be4ce01'};
  assert.equal(verifyD1Identity(right),true);
  assert.equal(verifyD1Identity({...right,name:'other'}),false);
  assert.equal(verifyD1Identity({...right,uuid:'00000000-0000-0000-0000-000000000000'}),false);
  assert.equal(verifyD1Identity([right]),false);
});
