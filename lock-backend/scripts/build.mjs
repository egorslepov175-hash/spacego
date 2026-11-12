import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=['crypto.mjs','ui.mjs','index.mjs'];
// The Worker has no npm dependencies; produce one self-contained ES module.
let code='';for(const file of files){let text=await fs.readFile(path.join(root,'worker',file),'utf8');text=text.replace(/^import .*? from '\.\/[^']+';\r?\n/gm,'');if(file!=='index.mjs')text=text.replace(/\bexport (?=(?:const|function|async function|class)\b)/g,'');code+=text+'\n';}
await fs.mkdir(path.join(root,'dist/server'),{recursive:true});await fs.mkdir(path.join(root,'dist/.openai'),{recursive:true});await fs.writeFile(path.join(root,'dist/server/index.js'),code);await fs.copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));console.log('Built self-contained Worker');
