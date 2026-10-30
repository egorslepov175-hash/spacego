import {rentalStatus} from './domain.mjs';

export const profileRevision = profile => profile?.revision || (profile ? JSON.stringify([profile.name,profile.email,profile.phone||'']) : null);
export function accessStatus(booking,profile,now=Date.now()) {
 if(!booking)return 'missing';
 const state=rentalStatus(booking,now);
 if(['cancelled','completed','expired'].includes(state))return 'expired';
 if(!booking.paid)return 'unpaid';
 if(!profile?.name?.trim()||!profile?.email?.trim())return 'profile';
 const request=booking.accessRequest;
 if(!request)return 'new';
 if(request.profileRevision!==profileRevision(profile))return 'changed';
 if(request.status!=='approved')return request.status;
 if(!request.token)return 'revoked';
 return state==='active'?'active':'ready';
}
export function requestAccess(booking,profile,now=Date.now()) {
 const status=accessStatus(booking,profile,now);
 if(!['new','changed','rejected','revoked'].includes(status))throw new Error(status==='profile'?'Сначала заполните имя и почту в профиле.':status==='unpaid'?'Сначала подтвердите тестовую оплату брони.':'Заявку сейчас нельзя отправить.');
 booking.accessRequest={status:'pending',profileRevision:profileRevision(profile),profile:{name:profile.name,email:profile.email,phone:profile.phone||''},requestedAt:new Date(now).toISOString(),token:null};
 return booking.accessRequest;
}
export function decideAccess(booking,profile,decision,token,now=Date.now()) {
 const current=accessStatus(booking,profile,now);
 if(!['approved','rejected','revoked'].includes(decision))throw new Error('Неизвестное решение.');
 if(decision==='revoked'?!['ready','active'].includes(current):current!=='pending')throw new Error('Заявка изменилась или срок бронирования истёк.');
 if(decision==='approved'&&(!token||token.length<24))throw new Error('Не удалось создать пропуск. Попробуйте снова.');
 Object.assign(booking.accessRequest,{status:decision,decidedAt:new Date(now).toISOString(),token:decision==='approved'?token:null});
 return booking.accessRequest;
}
export function accessPayload(booking,profile,baseURL,now=Date.now()) {
 if(!['ready','active'].includes(accessStatus(booking,profile,now)))throw new Error('QR-код появится после подтверждения профиля владельцем.');
 const url=new URL(baseURL);url.search='';url.hash=`entry/${encodeURIComponent(booking.id)}/${encodeURIComponent(booking.accessRequest.token)}`;
 return url.href;
}
export function validatePass(booking,profile,token,now=Date.now()) {
 const status=accessStatus(booking,profile,now);
 if(!booking||!token||!booking.accessRequest?.token||token!==booking.accessRequest.token)return {valid:false,reason:'Пропуск не найден или отозван.'};
 if(status==='ready')return {valid:false,reason:'Время аренды ещё не началось.'};
 if(status!=='active')return {valid:false,reason:status==='changed'?'Профиль изменён. Нужно повторное подтверждение владельца.':'Пропуск недействителен. Проверьте подтверждение и срок аренды.'};
 return {valid:true,reason:'Пропуск действителен в рамках демонстрационной аренды.'};
}
