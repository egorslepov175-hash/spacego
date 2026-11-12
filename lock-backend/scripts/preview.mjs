import http from 'node:http';
import fs from 'node:fs';
import worker from '../worker/index.mjs';
import {database} from '../test/db.mjs';
// Development only: this file is never included in the deployed Worker.
fs.mkdirSync('.local',{recursive:true});
const env={DB:database('.local/preview.sqlite'),OWNER_EMAILS:'owner@example.test',DEVICE_KEY_ENCRYPTION_SECRET:'ab'.repeat(32),PUBLIC_APP_URL:'http://127.0.0.1:4173/'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:4180');
 if(url.pathname==='/__preview/login'){const role=url.searchParams.get('role')==='renter'?'renter':'owner';res.writeHead(302,{'set-cookie':`preview_role=${role}; Path=/; HttpOnly; SameSite=Strict`,location:role==='owner'?'/owner':'/'});res.end();return;}
 if(url.pathname==='/signin-with-chatgpt'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<h1>Локальная проверка</h1><p>Тестовые роли не входят в публикацию.</p><a href="/__preview/login?role=owner">Владелец</a> · <a href="/__preview/login?role=renter">Арендатор</a>');return;}
 const data=[];for await(const chunk of req)data.push(chunk);const headers=new Headers(req.headers);headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');
 const role=(req.headers.cookie||'').match(/preview_role=(owner|renter)/)?.[1];if(role){headers.set('oai-authenticated-user-id',role);headers.set('oai-authenticated-user-email',role+'@example.test');}
 const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(data)}:{})});
 try{const r=await worker.fetch(request,env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()))}catch{res.writeHead(500);res.end('Preview error')}
});server.listen(4180,'127.0.0.1',()=>console.log('Local lock API preview: http://127.0.0.1:4180'));
