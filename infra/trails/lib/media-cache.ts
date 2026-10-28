import { readdirSync,readFileSync,statSync } from 'node:fs';
import {join} from 'node:path';
import type {CommonsPage} from './media';
export interface WikiEntity {descriptions?:{en?:{value:string}};sitelinks?:{enwiki?:{title:string}}}
export interface WikiExtract {text:string;title:string;revision?:number}
/** Index successful responses by record, so a changed batch never loses credits. */
export function readMediaCache(directory:string) {
 const photos=new Map<number,CommonsPage>(),entities=new Map<string,WikiEntity>(),extracts=new Map<string,WikiExtract>(),aliases=new Map<string,string>();
 const files=readdirSync(directory).filter(f=>f.endsWith('.json')).map(name=>({name,mtime:statSync(join(directory,name)).mtimeMs})).sort((a,b)=>a.mtime-b.mtime || a.name.localeCompare(b.name));
 for(const {name} of files) {
  try {
   const body=JSON.parse(readFileSync(join(directory,name),'utf8')) as {entities?:Record<string,WikiEntity>;query?:{pages?:(CommonsPage & {title:string;extract?:string;lastrevid?:number})[];redirects?:{from:string;to:string}[];normalized?:{from:string;to:string}[]}};
   for(const [id,entity] of Object.entries(body.entities ?? {}))entities.set(id,entity);
   for(const page of body.query?.pages ?? []) {
    if(page.pageid && page.imageinfo)photos.set(page.pageid,page);
    if(page.extract)extracts.set(page.title,{text:page.extract,title:page.title,revision:page.lastrevid});
   }
   for(const link of [...(body.query?.redirects ?? []),...(body.query?.normalized ?? [])])aliases.set(link.from,link.to);
  } catch { /* An interrupted response file is not a successful record. */ }
 }
 for(const [from,to] of aliases) {
  let target=to;const seen=new Set([from]);
  while(aliases.has(target) && !seen.has(target)){seen.add(target);target=aliases.get(target)!;}
  const extract=extracts.get(target);if(extract)extracts.set(from,extract);
 }
 return {photos,entities,extracts};
}
