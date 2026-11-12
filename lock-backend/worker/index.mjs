import {randomHex,sha256,hmac,equalHex,requestCanonical,commandCanonical,encryptSecret,decryptSecret} from './crypto.mjs';
import {page} from './ui.mjs';

const APP='https://egorslepov175-hash.github.io/spacego/';
const reId=/^d_[a-f0-9]{32}$/;
const reToken=/^[a-f0-9]{64}$/;
const now=()=>Math.floor(Date.now()/1000);
class Fault extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new Fault(status,message);};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function identity(request){const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');if(!id||!email)fail(401,'Войдите в аккаунт SPACEGO.');return {id,email:email.toLowerCase()};}
function isOwner(user,env){return (env.OWNER_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(user.email);}
function owner(request,env){const user=identity(request);if(!isOwner(user,env))fail(403,'Требуется аккаунт владельца.');return user;}
async function body(request,limit=4096){if(Number(request.headers.get('content-length')||0)>limit)fail(413,'Слишком большой запрос.');const reader=request.body?.getReader();if(!reader)return {text:'',data:{}};let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail(413,'Слишком большой запрос.');}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let data;try{data=JSON.parse(text||'{}');}catch{fail(400,'Некорректный JSON.');}if(!data||Array.isArray(data)||typeof data!=='object')fail(400,'Ожидается JSON-объект.');return {text,data};}
async function rate(db,scope,maximum,seconds){const stamp=now();const row=await db.prepare(`INSERT INTO rate_limits(scope,window_started,count) VALUES(?,?,1) ON CONFLICT(scope) DO UPDATE SET count=CASE WHEN window_started<=? THEN 1 ELSE count+1 END,window_started=CASE WHEN window_started<=? THEN ? ELSE window_started END RETURNING count`).bind(scope,stamp,stamp-seconds,stamp-seconds,stamp).first();if(row.count>maximum)fail(429,'Слишком много запросов. Подождите.');}
const audit=(db,event,deviceId=null,userId=null,commandId=null)=>db.prepare('INSERT INTO audit(id,device_id,user_id,event,command_id,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),deviceId,userId,event,commandId,now()).run();
function publicDevice(d){return {id:d.id,name:d.name,enabled:Boolean(d.enabled),online:Boolean(d.last_seen&&d.last_seen>=now()-12),last_seen:d.last_seen,pulse_ms:d.pulse_ms,registered:Boolean(d.secret_cipher),qr_revision:d.qr_revision};}
const eligible=(b,t=now())=>Boolean(b&&b.approved&&b.paid&&!b.revoked&&b.starts_at<=t&&t<b.ends_at);
async function ownedDevice(db,id,user){const d=await db.prepare('SELECT * FROM devices WHERE id=? AND owner_id=?').bind(id,user.id).first();if(!d)fail(404,'Устройство не найдено.');return d;}
async function authenticateDevice(request,env,raw){const id=request.headers.get('x-spacego-device'),ts=request.headers.get('x-spacego-time'),nonce=request.headers.get('x-spacego-nonce'),sig=request.headers.get('x-spacego-signature');if(!reId.test(id||'')||!/^\d{10}$/.test(ts||'')||!reToken.test(nonce||'')||!reToken.test(sig||''))fail(401,'Неверная подпись устройства.');if(Math.abs(now()-Number(ts))>30)fail(401,'Часы устройства не синхронизированы.');const d=await env.DB.prepare('SELECT * FROM devices WHERE id=? AND enabled=1').bind(id).first();if(!d?.secret_cipher)fail(401,'Устройство не зарегистрировано или отключено.');const key=await decryptSecret(d.secret_cipher,env.DEVICE_KEY_ENCRYPTION_SECRET);const path=new URL(request.url).pathname;const expected=await hmac(key,requestCanonical(request.method,path,ts,nonce,await sha256(raw)));if(!equalHex(sig,expected))fail(401,'Неверная подпись устройства.');try{await env.DB.batch([env.DB.prepare('INSERT INTO request_nonces(device_id,nonce,expires_at) VALUES(?,?,?)').bind(id,nonce,now()+65),env.DB.prepare('DELETE FROM request_nonces WHERE device_id=? AND expires_at<?').bind(id,now())]);}catch{fail(409,'Повторный запрос устройства.');}return {device:d,key};}

async function api(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method,db=env.DB;
 if(path==='/api/health'&&method==='GET')return json({ok:true,service:'SPACEGO Smart Lock QR Edition',protocol:1});
 if(!db)fail(503,'Серверная база данных не подключена.');
 if(path==='/api/me'&&method==='GET'){const u=identity(request);return json({id:u.id,email:u.email,owner:isOwner(u,env)});}
 if(path==='/api/device/register'&&method==='POST'){
  await rate(db,'registration:'+request.headers.get('cf-connecting-ip'),20,60);
  const {data:b}=await body(request);if(!reToken.test(b.enrollment_code||'')||!reToken.test(b.device_secret||'')||!reToken.test(b.registration_id||''))fail(400,'Неверные данные регистрации.');
  const hash=await sha256(b.enrollment_code),secretHash=await sha256(b.device_secret);const d=await db.prepare('SELECT * FROM devices WHERE enrollment_hash=? AND enrollment_expires>? AND enabled=1').bind(hash,now()).first();if(!d)fail(401,'Код подключения истёк или отозван.');
  if(d.secret_cipher&&(d.registration_id!==b.registration_id||d.secret_hash!==secretHash))fail(409,'Код уже использован другим устройством.');
  if(!d.secret_cipher){if(!reToken.test(env.DEVICE_KEY_ENCRYPTION_SECRET||''))fail(503,'Сервер не настроен.');const cipher=await encryptSecret(b.device_secret,env.DEVICE_KEY_ENCRYPTION_SECRET);const changed=await db.prepare('UPDATE devices SET secret_cipher=?,secret_hash=?,registration_id=? WHERE id=? AND secret_cipher IS NULL RETURNING id').bind(cipher,secretHash,b.registration_id,d.id).first();if(!changed)fail(409,'Регистрация уже выполняется. Повторите тот же запрос.');await audit(db,'device_registered',d.id);}
  return json({device_id:d.id,qr_url:`${env.PUBLIC_APP_URL||APP}#device/${d.id}`,protocol:1,poll_after_ms:2000});
 }
 if(path==='/api/device/poll'&&method==='POST'){
  const {text,data:b}=await body(request);const {device:d,key}=await authenticateDevice(request,env,text);if(!reToken.test(b.boot_id||'')||!reToken.test(b.challenge||''))fail(400,'Некорректный challenge.');await rate(db,'poll:'+d.id,50,60);
  const t=now();await db.batch([db.prepare('UPDATE devices SET last_seen=?,boot_id=? WHERE id=?').bind(t,b.boot_id,d.id),db.prepare("UPDATE commands SET status=CASE WHEN status='delivered' THEN 'uncertain' ELSE 'expired' END WHERE device_id=? AND status IN ('queued','delivered') AND expires_at<=?").bind(d.id,t)]);
  // A delivered command is NEVER returned again, even if the acknowledgement is lost.
  const c=await db.prepare(`SELECT c.* FROM commands c JOIN bookings b ON b.id=c.booking_id WHERE c.device_id=? AND c.status='queued' AND c.expires_at>? AND b.approved=1 AND b.paid=1 AND b.revoked=0 AND b.starts_at<=? AND b.ends_at>? ORDER BY c.seq LIMIT 1`).bind(d.id,t,t,t).first();
  if(!c)return json({command:null,server_time:t,poll_after_ms:2000});
  const claimed=await db.prepare("UPDATE commands SET status='delivered',delivered_at=?,boot_id=? WHERE id=? AND status='queued' AND expires_at>? AND EXISTS(SELECT 1 FROM devices WHERE id=commands.device_id AND enabled=1) AND EXISTS(SELECT 1 FROM bookings WHERE id=commands.booking_id AND approved=1 AND paid=1 AND revoked=0 AND starts_at<=? AND ends_at>?) RETURNING id").bind(t,b.boot_id,c.id,t,t,t).first();if(!claimed)return json({command:null,server_time:t,poll_after_ms:2000});
  const command={v:1,device_id:d.id,command_id:c.id,seq:c.seq,issued_at:c.issued_at,expires_at:c.expires_at,pulse_ms:c.pulse_ms,boot_id:b.boot_id,challenge:b.challenge};command.signature=await hmac(key,commandCanonical(command));await audit(db,'command_delivered',d.id,c.user_id,c.id);return json({command,server_time:t,poll_after_ms:2000});
 }
 if(path==='/api/device/ack'&&method==='POST'){
  const {text,data:b}=await body(request);const {device:d}=await authenticateDevice(request,env,text);if(!['executed','rejected'].includes(b.result)||typeof b.command_id!=='string'||!Number.isSafeInteger(b.seq))fail(400,'Некорректное подтверждение.');
  const c=await db.prepare('SELECT * FROM commands WHERE id=? AND device_id=?').bind(b.command_id,d.id).first();if(!c||c.seq!==b.seq||c.boot_id!==b.boot_id)fail(404,'Команда не найдена.');if(['executed','rejected'].includes(c.status))return json({ok:true,status:c.status});
  const updated=await db.prepare("UPDATE commands SET status=?,acknowledged_at=? WHERE id=? AND status IN ('delivered','uncertain') RETURNING id").bind(b.result,now(),c.id).first();if(updated)await audit(db,'command_'+b.result,d.id,c.user_id,c.id);return json({ok:true,status:b.result});
 }
 const match=path.match(/^\/api\/devices\/(d_[a-f0-9]{32})(?:\/(open|bookings|commands))?(?:\/([a-f0-9-]{36}))?$/);
 if(match){
  const [,id,action,commandId]=match,d=await db.prepare('SELECT * FROM devices WHERE id=? AND enabled=1').bind(id).first();if(!d)fail(404,'Устройство не найдено или отключено.');
  if(!action&&method==='GET')return json(publicDevice(d));
  const user=identity(request);
  if(action==='bookings'&&method==='GET')return json({bookings:(await db.prepare('SELECT * FROM bookings WHERE device_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30').bind(id,user.id).all()).results});
  if(action==='bookings'&&method==='POST'){
   await rate(db,'bookings:'+user.id,15,3600);const {data:b}=await body(request);const start=Math.floor(Date.parse(b.start)/1000),end=Math.floor(Date.parse(b.end)/1000);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<now()-60||end<=start||end-start>30*86400)fail(400,'Укажите корректное время аренды, не более 30 дней.');
   const booking={id:crypto.randomUUID(),device_id:id,user_id:user.id,user_email:user.email,starts_at:start,ends_at:end,approved:0,paid:0,revoked:0,created_at:now()};await db.prepare('INSERT INTO bookings(id,device_id,user_id,user_email,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(booking.id,id,user.id,user.email,start,end,booking.created_at).run();await audit(db,'booking_requested',id,user.id);return json({booking},201);
  }
  if(action==='open'&&method==='POST'){
   const idem=request.headers.get('idempotency-key');if(!/^[a-f0-9-]{36}$/.test(idem||''))fail(400,'Нужен Idempotency-Key UUID.');
   const previous=await db.prepare('SELECT id,device_id,status FROM commands WHERE user_id=? AND idempotency_key=?').bind(user.id,idem).first();if(previous){if(previous.device_id!==id)fail(409,'Ключ запроса уже использован.');return json({command_id:previous.id,status:previous.status,reused:true},202);}
   await rate(db,'opens:'+user.id,12,60);const t=now();const b=await db.prepare('SELECT * FROM bookings WHERE device_id=? AND user_id=? AND approved=1 AND paid=1 AND revoked=0 AND starts_at<=? AND ends_at>? ORDER BY ends_at LIMIT 1').bind(id,user.id,t,t).first();if(!eligible(b,t))fail(403,'Нет действующей оплаченной и подтверждённой брони.');if(!d.last_seen||d.last_seen<t-12)fail(503,'Устройство не на связи. Открытие запрещено.');
   // The reservation, cooldown and sequence are rechecked together in one SQL statement.
   const ticket=await db.prepare(`UPDATE devices SET next_seq=next_seq+1,cooldown_until=? WHERE id=? AND enabled=1 AND cooldown_until<=? AND last_seen>=? AND EXISTS(SELECT 1 FROM bookings WHERE id=? AND approved=1 AND paid=1 AND revoked=0 AND starts_at<=? AND ends_at>?) RETURNING next_seq,pulse_ms`).bind(t+15,id,t,t-12,b.id,t,t).first();if(!ticket)fail(429,'Повторное открытие временно ограничено.');
   const c={id:crypto.randomUUID(),seq:ticket.next_seq,expires:Math.min(t+12,b.ends_at)};await db.prepare('INSERT INTO commands(id,device_id,booking_id,user_id,idempotency_key,seq,issued_at,expires_at,pulse_ms) VALUES(?,?,?,?,?,?,?,?,?)').bind(c.id,id,b.id,user.id,idem,c.seq,t,c.expires,ticket.pulse_ms).run();await audit(db,'open_requested',id,user.id,c.id);return json({command_id:c.id,status:'queued'},202);
  }
  if(action==='commands'&&commandId&&method==='GET'){const c=await db.prepare('SELECT id,status,expires_at,acknowledged_at FROM commands WHERE id=? AND device_id=? AND user_id=?').bind(commandId,id,user.id).first();if(!c)fail(404,'Команда не найдена.');if(['queued','delivered'].includes(c.status)&&c.expires_at<=now())c.status=c.status==='delivered'?'uncertain':'expired';return json(c);}
  fail(405,'Метод не поддерживается.');
 }
 if(path.startsWith('/api/owner/')){
  const user=owner(request,env);
  if(path==='/api/owner/devices'&&method==='GET')return json({devices:(await db.prepare('SELECT * FROM devices WHERE owner_id=? ORDER BY created_at DESC').bind(user.id).all()).results.map(publicDevice)});
  if(path==='/api/owner/devices'&&method==='POST'){
   const {data:b}=await body(request);const name=String(b.name||'').trim(),pulse=Number(b.pulse_ms||800);if(!name||name.length>80||!Number.isInteger(pulse)||pulse<100||pulse>5000)fail(400,'Название до 80 знаков, импульс 100–5000 мс.');const id='d_'+randomHex(16),code=randomHex();await db.prepare('INSERT INTO devices(id,owner_id,name,pulse_ms,enrollment_hash,enrollment_expires,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,user.id,name,pulse,await sha256(code),now()+900,now()).run();return json({device_id:id,enrollment_code:code,expires_at:now()+900,qr_url:`${env.PUBLIC_APP_URL||APP}#device/${id}`},201);
  }
  if(path==='/api/owner/bookings'&&method==='GET')return json({bookings:(await db.prepare('SELECT b.*,d.name AS device_name FROM bookings b JOIN devices d ON b.device_id=d.id WHERE d.owner_id=? ORDER BY b.created_at DESC LIMIT 100').bind(user.id).all()).results});
  const decision=path.match(/^\/api\/owner\/bookings\/([a-f0-9-]{36})$/);
  if(decision&&method==='PATCH'){
   const b=await db.prepare('SELECT b.* FROM bookings b JOIN devices d ON b.device_id=d.id WHERE b.id=? AND d.owner_id=?').bind(decision[1],user.id).first();if(!b)fail(404,'Бронь не найдена.');const {data:changes}=await body(request);if(!['approve','revoke','mark_paid'].includes(changes.action))fail(400,'Неизвестное действие.');
   if(changes.action==='approve'){const updated=await db.prepare('UPDATE bookings SET approved=1 WHERE id=? AND revoked=0 AND NOT EXISTS(SELECT 1 FROM bookings other WHERE other.device_id=? AND other.id<>? AND other.approved=1 AND other.revoked=0 AND other.starts_at<? AND other.ends_at>?) RETURNING id').bind(b.id,b.device_id,b.id,b.ends_at,b.starts_at).first();if(!updated)fail(409,'Интервал занят или доступ отозван.');}
   else if(changes.action==='revoke'){await db.batch([db.prepare('UPDATE bookings SET revoked=1 WHERE id=?').bind(b.id),db.prepare("UPDATE commands SET status='revoked' WHERE booking_id=? AND status='queued'").bind(b.id)]);}else await db.prepare('UPDATE bookings SET paid=1 WHERE id=? AND revoked=0').bind(b.id).run();await audit(db,'booking_'+changes.action,b.device_id,user.id);return json({ok:true});
  }
  const deviceAction=path.match(/^\/api\/owner\/devices\/(d_[a-f0-9]{32})\/(disable|enroll|audit)$/);
  if(deviceAction){const [,id,action]=deviceAction;await ownedDevice(db,id,user);if(action==='audit'&&method==='GET')return json({events:(await db.prepare('SELECT event,command_id,created_at FROM audit WHERE device_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all()).results});
   if(action==='disable'&&method==='POST'){await db.batch([db.prepare('UPDATE devices SET enabled=0 WHERE id=?').bind(id),db.prepare("UPDATE commands SET status='revoked' WHERE device_id=? AND status='queued'").bind(id)]);return json({ok:true});}
   if(action==='enroll'&&method==='POST'){const code=randomHex();await db.batch([db.prepare('UPDATE devices SET secret_cipher=NULL,secret_hash=NULL,registration_id=NULL,enrollment_hash=?,enrollment_expires=?,last_seen=NULL,enabled=1 WHERE id=?').bind(await sha256(code),now()+900,id),db.prepare("UPDATE commands SET status='revoked' WHERE device_id=? AND status='queued'").bind(id)]);return json({device_id:id,enrollment_code:code,expires_at:now()+900});}
  }
  fail(404,'Метод не найден.');
 }
 fail(404,'Метод не найден.');
}

export default {async fetch(request,env){
 const url=new URL(request.url);let response;
 try{
  if(url.pathname.startsWith('/api/')){if(!['GET','POST','PATCH'].includes(request.method))fail(405,'Метод не поддерживается.');const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail(403,'Запросы управления разрешены только с сайта доступа.');response=await api(request,env);}
  else if(request.method==='GET'&&(url.pathname==='/'||url.pathname==='/owner'||/^\/access\/d_[a-f0-9]{32}$/.test(url.pathname))){const user=request.headers.get('oai-authenticated-user-id');response=new Response(page({path:url.pathname,signedIn:Boolean(user),appUrl:env.PUBLIC_APP_URL||APP}),{headers:{'content-type':'text/html; charset=utf-8'}});}
  else if(url.pathname==='/logo.jpg')response=await fetch('https://egorslepov175-hash.github.io/spacego/assets/spacego-logo.jpg');
  else response=json({error:'Не найдено.'},404);
 }catch(error){response=json({error:error instanceof Fault?error.message:'Сервис временно недоступен. Открытие запрещено.'},error instanceof Fault?error.status:503);}
 const headers=new Headers(response.headers);headers.set('cache-control','no-store');headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','no-referrer');headers.set('x-frame-options','DENY');headers.set('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return new Response(response.body,{status:response.status,headers});
}};
