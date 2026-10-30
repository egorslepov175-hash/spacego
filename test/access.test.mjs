import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {accessStatus,requestAccess,decideAccess,accessPayload,validatePass} from '../dist/access.mjs';
const require=createRequire(import.meta.url);
const qrcode=require('../dist/assets/qrcode.js');
const jsQR=require('../assets/jsQR.cjs');
const now=Date.parse('2026-10-28T11:00Z');
const profile={name:'Тестовый арендатор',email:'renter@example.test',revision:'profile-1'};
const booking=()=>({id:'booking-1',paid:true,start:'2026-10-28T10:00Z',end:'2026-10-28T12:00Z'});
const token='00000000-0000-4000-8000-000000000001';
function approved(){const b=booking();requestAccess(b,profile,now);decideAccess(b,profile,'approved',token,now);return b;}
test('payment and complete profile are required before an access request',()=>{
 assert.throws(()=>requestAccess({...booking(),paid:false},profile,now));
 assert.throws(()=>requestAccess(booking(),null,now));
});
test('no QR or entry before explicit owner approval',()=>{
 const b=booking();assert.throws(()=>accessPayload(b,profile,'https://example.test/',now));
 requestAccess(b,profile,now);assert.equal(accessStatus(b,profile,now),'pending');
 assert.throws(()=>accessPayload(b,profile,'https://example.test/',now));
 assert.equal(validatePass(b,profile,token,now).valid,false);
});
test('approval issues a booking-specific pass and does not allow a forged token',()=>{
 const b=approved();assert.equal(accessStatus(b,profile,now),'active');
 assert.equal(validatePass(b,profile,token,now).valid,true);
 assert.equal(validatePass(b,profile,'other-token',now).valid,false);
 assert.equal(validatePass({...b,accessRequest:undefined},profile,token,now).valid,false);
});
test('a generated future pass only permits entry within the paid interval',()=>{
 const b=approved();const before=Date.parse('2026-10-28T09:00Z');
 assert.equal(accessStatus(b,profile,before),'ready');
 assert.ok(accessPayload(b,profile,'https://example.test/',before).includes('#entry/booking-1/'));
 assert.equal(validatePass(b,profile,token,before).valid,false);
 assert.equal(validatePass(b,profile,token,Date.parse(b.start)).valid,true);
 assert.equal(validatePass(b,profile,token,Date.parse(b.end)).valid,false);
});
test('changed profile, cancellation, rejection and revocation prevent entry',()=>{
 const b=approved();assert.equal(validatePass(b,{...profile,revision:'profile-2'},token,now).valid,false);
 assert.equal(validatePass({...b,cancelled:true},profile,token,now).valid,false);
 decideAccess(b,profile,'revoked',null,now);assert.equal(b.accessRequest.token,null);
 assert.equal(validatePass(b,profile,token,now).valid,false);
 requestAccess(b,profile,now);decideAccess(b,profile,'rejected',null,now);
 assert.equal(accessStatus(b,profile,now),'rejected');
});
test('profile changes invalidate a pending request; resubmission creates a fresh approval scope',()=>{
 const b=booking();requestAccess(b,profile,now);const next={...profile,revision:'profile-2'};
 assert.throws(()=>decideAccess(b,next,'approved',token,now));
 requestAccess(b,next,now);decideAccess(b,next,'approved',token,now);
 assert.equal(validatePass(b,profile,token,now).valid,false);
 assert.equal(validatePass(b,next,token,now).valid,true);
});
test('the actual QR encoder is independently decoded to the exact access URL without profile contacts',()=>{
 const b=approved(),payload=accessPayload(b,profile,'https://spacego.example/?discard=1',now);
 assert.ok(!payload.includes(profile.email));assert.ok(!payload.includes('discard'));
 const qr=qrcode(0,'M');qr.addData(payload);qr.make();
 const scale=6,margin=4,size=(qr.getModuleCount()+2*margin)*scale,data=new Uint8ClampedArray(size*size*4).fill(255);
 for(let row=0;row<qr.getModuleCount();row++)for(let col=0;col<qr.getModuleCount();col++)if(qr.isDark(row,col))for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){const i=(((row+margin)*scale+y)*size+(col+margin)*scale+x)*4;data[i]=data[i+1]=data[i+2]=0;}
 assert.equal(jsQR(data,size,size)?.data,payload);
});
