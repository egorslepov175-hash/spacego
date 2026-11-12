const te=new TextEncoder();
export const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function unhex(value){if(typeof value!=='string'||!/^([a-f0-9]{2})+$/.test(value))throw new Error('Invalid hexadecimal value');return Uint8Array.from(value.match(/../g),x=>parseInt(x,16));}
export const randomHex=(n=32)=>hex(crypto.getRandomValues(new Uint8Array(n)));
export const sha256=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(value))));
export async function hmac(secret,text){const key=await crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,te.encode(text))));}
export function equalHex(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export const requestCanonical=(method,path,timestamp,nonce,bodyHash)=>`SG-REQ-1\n${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
export const commandCanonical=c=>`SG-CMD-1\n${c.device_id}\n${c.command_id}\n${c.seq}\n${c.issued_at}\n${c.expires_at}\n${c.pulse_ms}\n${c.boot_id}\n${c.challenge}`;
export async function encryptSecret(secret,master){const iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey('raw',unhex(master),'AES-GCM',false,['encrypt']);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode('SPACEGO-DEVICE-KEY-v1')},key,te.encode(secret));return `${hex(iv)}.${hex(new Uint8Array(cipher))}`;}
export async function decryptSecret(cipher,master){const [iv,data]=cipher.split('.');const key=await crypto.subtle.importKey('raw',unhex(master),'AES-GCM',false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(iv),additionalData:te.encode('SPACEGO-DEVICE-KEY-v1')},key,unhex(data)));}
