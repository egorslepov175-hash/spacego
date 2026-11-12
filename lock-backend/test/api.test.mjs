import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {database} from './db.mjs';
import {randomHex,hmac,sha256,requestCanonical,commandCanonical} from '../worker/crypto.mjs';
const ORIGIN='https://lock.example.test',OWNER={id:'owner',email:'owner@example.test'},RENTER={id:'renter',email:'renter@example.test'};
const sec=()=>Math.floor(Date.now()/1000);
async function fixture(){
 const env={DB:database(),OWNER_EMAILS:OWNER.email,DEVICE_KEY_ENCRYPTION_SECRET:'ab'.repeat(32),PUBLIC_APP_URL:'https://app.example.test/'};
 async function call(path,{method='GET',data,user,headers={}}={}){const h=new Headers(headers);if(user){h.set('oai-authenticated-user-id',user.id);h.set('oai-authenticated-user-email',user.email)}const response=await worker.fetch(new Request(ORIGIN+path,{method,headers:h,...(data===undefined?{}:{body:JSON.stringify(data)})}),env);return {status:response.status,body:await response.json()};}
 const setup=await call('/api/owner/devices',{method:'POST',user:OWNER,data:{name:'Ворота макета',pulse_ms:800}});assert.equal(setup.status,201);
 const id=setup.body.device_id,key=randomHex(),regid=randomHex(),code=setup.body.enrollment_code,boot=randomHex();
 const registration=()=>call('/api/device/register',{method:'POST',data:{enrollment_code:code,device_secret:key,registration_id:regid}});
 assert.equal((await registration()).status,200);
 async function signed(path,data,{nonce=randomHex(),stamp=String(sec()),signature,raw}={}){const text=raw??JSON.stringify(data);const sig=signature??await hmac(key,requestCanonical('POST',path,stamp,nonce,await sha256(text)));const req=new Request(ORIGIN+path,{method:'POST',headers:{'x-spacego-device':id,'x-spacego-time':stamp,'x-spacego-nonce':nonce,'x-spacego-signature':sig},body:text});const response=await worker.fetch(req,env);return {status:response.status,body:await response.json()};}
 const poll=(extra={})=>signed('/api/device/poll',{boot_id:boot,challenge:randomHex(),...extra});
 async function booking({start=sec()-1,end=sec()+3600,user=RENTER}={}){const r=await call('/api/devices/'+id+'/bookings',{method:'POST',user,data:{start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString(),paid:true,approved:true}});assert.equal(r.status,201);return r.body.booking.id;}
 const decide=(booking,action,user=OWNER)=>call('/api/owner/bookings/'+booking,{method:'PATCH',user,data:{action}});
 async function valid(){const b=await booking();await decide(b,'approve');await decide(b,'mark_paid');await poll();return b;}
 const open=(idem=crypto.randomUUID(),user=RENTER)=>call('/api/devices/'+id+'/open',{method:'POST',user,data:{},headers:{'idempotency-key':idem}});
 return {env,call,id,key,regid,code,boot,registration,signed,poll,booking,decide,valid,open};
}

test('public QR reveals no secret and scanning never creates an opening',async()=>{
 const f=await fixture();const page=await worker.fetch(new Request(ORIGIN+'/access/'+f.id),f.env);assert.equal(page.status,200);const info=await f.call('/api/devices/'+f.id);assert.equal(info.status,200);assert.equal(JSON.stringify(info.body).includes(f.key),false);assert.equal(f.env.DB.raw.prepare('SELECT count(*) AS n FROM commands').get().n,0);assert.equal((await f.open()).status,403);f.env.DB.close();
});
test('authentication and owner authorization cannot come from booking JSON or local profile',async()=>{
 const f=await fixture();assert.equal((await f.call('/api/devices/'+f.id+'/open',{method:'POST',data:{paid:true,approved:true},headers:{'idempotency-key':crypto.randomUUID()}})).status,401);const b=await f.booking();assert.equal((await f.decide(b,'mark_paid',RENTER)).status,403);const stored=f.env.DB.raw.prepare('SELECT * FROM bookings WHERE id=?').get(b);assert.equal(stored.paid,0);assert.equal(stored.approved,0);await f.poll();assert.equal((await f.open()).status,403);f.env.DB.close();
});
test('enrollment retries are safe, a different key cannot reuse the code',async()=>{
 const f=await fixture();assert.equal((await f.registration()).status,200);const bad=await f.call('/api/device/register',{method:'POST',data:{enrollment_code:f.code,device_secret:randomHex(),registration_id:randomHex()}});assert.equal(bad.status,409);const stored=f.env.DB.raw.prepare('SELECT secret_cipher FROM devices WHERE id=?').get(f.id);assert.equal(stored.secret_cipher.includes(f.key),false);f.env.DB.close();
});
test('forged signatures, modified bodies, expired timestamps and reused nonces are denied',async()=>{
 const f=await fixture(),b={boot_id:f.boot,challenge:randomHex()};assert.equal((await f.signed('/api/device/poll',b,{signature:'0'.repeat(64)})).status,401);assert.equal((await f.signed('/api/device/poll',b,{stamp:String(sec()-120)})).status,401);const nonce=randomHex();assert.equal((await f.signed('/api/device/poll',b,{nonce})).status,200);assert.equal((await f.signed('/api/device/poll',b,{nonce})).status,409);const sig=await hmac(f.key,requestCanonical('POST','/api/device/poll',String(sec()),randomHex(),await sha256('{}')));assert.equal((await f.signed('/api/device/poll',b,{signature:sig})).status,401);f.env.DB.close();
});
test('opening requires paid approved active booking AND recent heartbeat',async()=>{
 const f=await fixture();const b=await f.booking();await f.decide(b,'approve');await f.decide(b,'mark_paid');assert.equal((await f.open()).status,503);await f.poll();assert.equal((await f.open()).status,202);f.env.DB.close();
});
test('a future booking cannot open even after owner approval and payment',async()=>{
 const f=await fixture(),b=await f.booking({start:sec()+3600,end:sec()+7200});await f.decide(b,'approve');await f.decide(b,'mark_paid');await f.poll();assert.equal((await f.open()).status,403);f.env.DB.close();
});
test('command is authenticated for a device, boot and fresh challenge; never redelivered',async()=>{
 const f=await fixture();await f.valid();const opened=await f.open(),challenge=randomHex();assert.equal(opened.status,202);const delivered=await f.poll({challenge});assert.equal(delivered.status,200);const c=delivered.body.command;assert.equal(c.device_id,f.id);assert.equal(c.boot_id,f.boot);assert.equal(c.challenge,challenge);assert.equal(c.signature,await hmac(f.key,commandCanonical(c)));assert.equal((await f.poll()).body.command,null);const ack=await f.signed('/api/device/ack',{command_id:c.command_id,seq:c.seq,boot_id:f.boot,result:'executed'});assert.equal(ack.status,200);const status=await f.call('/api/devices/'+f.id+'/commands/'+c.command_id,{user:RENTER});assert.equal(status.body.status,'executed');assert.equal((await f.poll()).body.command,null);f.env.DB.close();
});
test('same Idempotency-Key returns one command and device cooldown blocks new keys',async()=>{
 const f=await fixture();await f.valid();const key=crypto.randomUUID(),a=await f.open(key),b=await f.open(key);assert.equal(a.body.command_id,b.body.command_id);assert.equal((await f.open()).status,429);assert.equal(f.env.DB.raw.prepare('SELECT count(*) AS n FROM commands').get().n,1);f.env.DB.close();
});
test('revocation and disabling cancel queued commands before delivery',async()=>{
 const f=await fixture();const b=await f.valid();await f.open();await f.decide(b,'revoke');assert.equal((await f.poll()).body.command,null);assert.equal((await f.open()).status,403);await f.call('/api/owner/devices/'+f.id+'/disable',{method:'POST',user:OWNER,data:{}});assert.equal((await f.poll()).status,401);f.env.DB.close();
});
test('booking ending before delivery suppresses the command',async()=>{
 const f=await fixture();const b=await f.valid();await f.open();f.env.DB.raw.prepare('UPDATE bookings SET starts_at=?,ends_at=? WHERE id=?').run(sec()-60,sec()-1,b);assert.equal((await f.poll()).body.command,null);f.env.DB.close();
});
test('concurrent owner approvals cannot confirm overlapping bookings',async()=>{
 const f=await fixture(),a=await f.booking(),b=await f.booking({user:{id:'other',email:'other@example.test'}});const results=await Promise.all([f.decide(a,'approve'),f.decide(b,'approve')]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);f.env.DB.close();
});
test('concurrent device polls deliver at most once',async()=>{
 const f=await fixture();await f.valid();await f.open();const results=await Promise.all([f.poll(),f.poll()]);assert.equal(results.filter(x=>x.body.command).length,1);f.env.DB.close();
});
test('cross-origin control, oversized requests and another user command reads are denied',async()=>{
 const f=await fixture();await f.valid();const c=await f.open();assert.equal((await f.call('/api/devices/'+f.id+'/commands/'+c.body.command_id,{user:{id:'stranger',email:'stranger@example.test'}})).status,404);assert.equal((await f.call('/api/owner/devices',{method:'POST',user:OWNER,data:{name:'x'},headers:{origin:'https://evil.example'}})).status,403);assert.equal((await f.call('/api/device/register',{method:'POST',data:{data:'x'.repeat(5000)}})).status,413);f.env.DB.close();
});
