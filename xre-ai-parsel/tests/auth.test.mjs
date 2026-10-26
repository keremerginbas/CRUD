import test from 'node:test';
import assert from 'node:assert/strict';
import {authConfig, checkPassword, issueSession, verifySession} from '../server/auth.mjs';

test('şifre yoksa giriş kapalı, varsa açık',()=>{
 assert.equal(authConfig({}).enabled,false);
 const c=authConfig({APP_PASSWORD:'x'});assert.equal(c.enabled,true);assert.ok(c.secret.length>=32);
});
test('şifre karşılaştırma',()=>{
 assert.equal(checkPassword('Deneme-123','Deneme-123'),true);
 assert.equal(checkPassword('deneme-123','Deneme-123'),false);
 assert.equal(checkPassword(undefined,'x'),false);
 assert.equal(checkPassword('a'.repeat(500),'x'),false);
});
test('oturum imzası, süre ve sahtecilik',()=>{
 const now=Date.UTC(2026,9,26);
 const t=issueSession('s1',now);
 assert.equal(verifySession(t,'s1',now),true);
 assert.equal(verifySession(t,'s2',now),false,'başka sır');
 assert.equal(verifySession(t,'s1',now+8*24*3600e3),false,'süresi dolmuş');
 const [payload,mac]=t.split('.');
 const forged=Buffer.from(JSON.stringify({exp:9999999999})).toString('base64url')+'.'+mac;
 assert.equal(verifySession(forged,'s1',now),false,'değiştirilmiş içerik');
 assert.equal(verifySession('',  's1',now),false);assert.equal(verifySession('a.b','s1',now),false);
 assert.ok(payload);
});
