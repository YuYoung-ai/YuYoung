import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');db.exec(readFileSync(new URL('../migrations/0001_survey.sql',import.meta.url),'utf8'));
 const wrap=(q,args=[])=>({bind(...v){return wrap(q,v);},async first(){return db.prepare(q).get(...args)||null;},async all(){return {results:db.prepare(q).all(...args)};},async run(){const info=db.prepare(q).run(...args);return {success:true,meta:{changes:info.changes}};}});
 return {raw:db,prepare:q=>wrap(q),async batch(list){db.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
