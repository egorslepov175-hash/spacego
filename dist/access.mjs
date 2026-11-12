import {rentalStatus} from './domain.mjs';
import {publicDeviceLink} from './smart-locks.mjs';

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
 Object.assign(booking.accessRequest,{status:decision,decidedAt:new Date(now).toISOString(),token:null});
 return booking.accessRequest;
}
export function accessPayload(booking,profile,baseURL,now=Date.now()) {
 return publicDeviceLink(booking?.snapshot?.lockDeviceId,baseURL);
}
export function validatePass(booking,profile,token,now=Date.now()) {
 return {valid:false,reason:'Старый демонстрационный пропуск не открывает устройство. Отсканируйте публичный QR на экране ESP32: доступ проверяется сервером по вашему аккаунту и действующей брони.'};
}
