import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {publicDeviceLink,smartLockUrl,renderSmartLock} from '../dist/smart-locks.mjs';
const require=createRequire(import.meta.url),qrcode=require('../dist/assets/qrcode.js'),jsQR=require('../assets/jsQR.cjs');
const id='d_'+'12'.repeat(16);
test('device QR contains only a public device route, without secrets or booking tokens',()=>{
 const link=publicDeviceLink(id,'https://example.test/spacego/?secret=discard#entry/b/old-token');assert.equal(link,'https://example.test/spacego/#device/'+id);assert.equal(smartLockUrl(id),'https://spacego-lock-api.slepovnew2.chatgpt.site/access/'+id);assert.throws(()=>publicDeviceLink('not-a-device','https://example.test/'));
});
test('a forged device route cannot inject markup or trigger opening',()=>{
 const root={innerHTML:''};renderSmartLock(root,'<img src=x onerror=alert(1)>');assert.equal(root.innerHTML.includes('<img src=x'),false);assert.equal(root.innerHTML.includes('/api/devices/'),false);assert.equal(root.innerHTML.includes('Ссылка устройства некорректна'),true);
});
test('the public QR is independently decoded to the exact device URL',()=>{
 const payload=publicDeviceLink(id,'https://egorslepov175-hash.github.io/spacego/'),qr=qrcode(0,'M');qr.addData(payload);qr.make();const scale=4,margin=4,size=(qr.getModuleCount()+margin*2)*scale,data=new Uint8ClampedArray(size*size*4).fill(255);
 for(let row=0;row<qr.getModuleCount();row++)for(let col=0;col<qr.getModuleCount();col++)if(qr.isDark(row,col))for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){const i=(((row+margin)*scale+y)*size+(col+margin)*scale+x)*4;data[i]=data[i+1]=data[i+2]=0;}
 assert.equal(jsQR(data,size,size)?.data,payload);
});
