import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hmac,sha256,requestCanonical,commandCanonical} from '../worker/crypto.mjs';
const vector=JSON.parse(fs.readFileSync(new URL('./protocol-vectors.json',import.meta.url),'utf8'));
test('command signature and canonical bytes match independent Python fixtures',async()=>{assert.equal(commandCanonical(vector.command),vector.command_canonical);assert.equal(await hmac(vector.test_key,commandCanonical(vector.command)),vector.command_signature);});
test('exact request body and canonical bytes match independent Python fixtures',async()=>{const c=requestCanonical('POST','/api/device/poll','1794470400','ef'.repeat(32),await sha256(vector.request_body));assert.equal(c,vector.request_canonical);assert.equal(await hmac(vector.test_key,c),vector.request_signature);});
