import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function database(filename=':memory:'){
 const sql=new DatabaseSync(filename);if(!sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'").get())sql.exec(fs.readFileSync(new URL('../drizzle/0000_smart_lock.sql',import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...a){return wrap(query,a)},first(){return sql.prepare(query).get(...args)||null},all(){return {results:sql.prepare(query).all(...args)}},run(){const r=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes)}}}});
 return {prepare:query=>wrap(query),batch(list){sql.exec('BEGIN');try{const result=list.map(s=>s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}},raw:sql,close:()=>sql.close()};
}
