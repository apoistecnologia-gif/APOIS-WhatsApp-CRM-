import test from 'node:test';
import assert from 'node:assert/strict';
import {authorized,validSessionId,validJid,validOrigin,validOperationId,messageText} from '../bridge/security.mjs';
test('local API requires an exact bearer token',()=>{assert.equal(authorized('Bearer abc','abc'),true);for(const v of [undefined,'','Bearer ab','Bearer abcd','abc'])assert.equal(authorized(v,'abc'),false);});
test('session and recipient validation reject paths and unverified LID conversion',()=>{assert.throws(()=>validSessionId('../auth'));assert.throws(()=>validJid('12345@lid'));assert.equal(validJid('5511999999999@s.whatsapp.net'),'5511999999999@s.whatsapp.net');assert.throws(()=>validOperationId('x'));});
test('browser websites cannot authorize localhost requests',()=>{assert.equal(validOrigin('https://evil.example'),false);assert.equal(validOrigin('https://web.whatsapp.com'),false);assert.equal(validOrigin('chrome-extension://'+'a'.repeat(32)),true);assert.equal(validOrigin(undefined),true);});
test('history unwraps ephemeral messages and identifies native voice notes',()=>{assert.equal(messageText({ephemeralMessage:{message:{conversation:'Olá'}}}),'Olá');assert.equal(messageText({audioMessage:{ptt:true}}),'Nota de voz');});
