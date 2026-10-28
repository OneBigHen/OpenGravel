#!/usr/bin/env node
/** Resumable, cached Wikimedia metadata only. Never downloads photo originals. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { withAttribution } from "./lib/licence";
import { readFeatureFile, textTag, type OsmFeature } from './lib/osm-input';
import { osmSource } from './lib/features';
import { trailLines } from './lib/official';
import { segments,segmentMatch,SegmentGrid } from './lib/spatial';
import { commonsPhoto,type CommonsPage } from './lib/media';
import type { HikeCatalog,TrailFeatureCollection } from './lib/types';
import type { TrailDescription,TrailPhoto } from './lib/rich-types';
import type { Coordinate } from '../../src/domain/ride/types';

type Json=Record<string,unknown>;
const agent=process.env.WIKIMEDIA_USER_AGENT ?? 'OpenGravelTrailCatalog/1.0 (https://github.com/OneBigHen/OpenGravel)';
const errors:{url:string;error:string}[]=[];
const unavailableHosts=new Set<string>();
async function api(cache:string,host:string,params:Record<string,string>):Promise<Json> {
  const url=`https://${host}/w/api.php?${new URLSearchParams({action:'query',format:'json',formatversion:'2',maxlag:'5',...params})}`;
  if(unavailableHosts.has(host)){errors.push({url,error:'Host unavailable after repeated replication lag'});return {};}
  const path=join(cache,createHash('sha256').update(url).digest('hex')+'.json');
  if(existsSync(path)) return JSON.parse(readFileSync(path,'utf8')) as Json;
  for(let retry=0;retry<3;retry++) {
    try {
      const response=await fetch(url,{headers:{'User-Agent':agent,'Api-User-Agent':agent},signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const result=await response.json() as Json;
      if(result.error)throw new Error(JSON.stringify(result.error));
      writeFileSync(path,JSON.stringify(result));return result;
    } catch(e) {
      // Reduce query work when Commons signals a busy search backend. The
      // fallback limit is retained in cache/stats, never claimed exhaustive.
      if(params.gslimit==='500' && String(e).includes('cirrussearch-too-busy')) {
        const fallback=await api(cache,host,{...params,gslimit:'100'});
        if(fallback.query){const result={...fallback,ogvResultLimit:100};writeFileSync(path,JSON.stringify(result));return result;}
      }
      if(retry===2){if(String(e).includes('maxlag'))unavailableHosts.add(host);errors.push({url,error:String(e)});console.error('media request unavailable',String(e));return {};}
      await new Promise(r=>setTimeout(r,1000*(retry+1)));
    }
  }
  return {};
}
async function workers<T>(values:readonly T[],run:(value:T)=>Promise<void>) {
  let cursor=0;
  await Promise.all(Array.from({length:2},async()=>{while(cursor<values.length)await run(values[cursor++]!);}));
}
interface Subject {name:string;kind:TrailDescription['kind'];wikipedia?:string;wikidata?:string}
function wikiSubject(name:string,kind:Subject['kind'],p:Record<string,unknown>):Subject|null {
  const wikipedia=textTag(p,'wikipedia'),wikidata=textTag(p,'wikidata');
  return wikipedia || wikidata ? {name,kind,...(wikipedia?{wikipedia}:{}),...(wikidata?{wikidata}:{})} : null;
}
async function main() {
  const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];
  const base=value('--base'),out=value('--out'),cache=value('--cache');
  const paths=args.flatMap((v,i)=>v==='--context' && args[i+1]?[args[i+1]!]:[]);
  if(!args.includes('--base')||!args.includes('--out')||!args.includes('--cache')||!base||!out||!cache)throw new Error('--base DIR --out DIR --cache DIR [--context FILE]');
  if(resolve(base)===resolve(out))throw new Error('base and output must differ');
  mkdirSync(cache,{recursive:true});
  const catalog=JSON.parse(readFileSync(join(base,'hikes.json'),'utf8')) as HikeCatalog;
  const collection=JSON.parse(readFileSync(join(base,'trails.geojson'),'utf8')) as TrailFeatureCollection;
  const context:OsmFeature[]=(await Promise.all(paths.map(readFeatureFile))).flat();
  const identities=new Map(context.map(f=>[`osm:${osmSource(f.properties).recordId}`,f.properties]));
  const subjects=new Map<string,Subject[]>();
  for(const h of catalog.hikes) {
    const list:Subject[]=[];
    for(const source of h.sources) {
      const p=identities.get(`${source.sourceId}:${source.recordId}`);
      if(p){const subject=wikiSubject(h.name ?? h.ref ?? 'Trail','trail',p);if(subject)list.push(subject);}
    }
    if(h.park){const subject=wikiSubject(h.park.name,'park',{...h.park});if(subject)list.push(subject);}
    for(const f of h.features ?? [])if(['waterfall','viewpoint','peak','historic','cave'].includes(f.kind)){const subject=wikiSubject(f.name ?? f.kind,'feature',{...f});if(subject)list.push(subject);}
    subjects.set(h.id,list.slice(0,4));
  }
  const allSubjects=[...subjects.values()].flat();
  const wikidata=[...new Set(allSubjects.map(s=>s.wikidata).filter((s):s is string=>!!s && /^Q\d+$/.test(s)))].sort();
  const entities=new Map<string,{descriptions?:{en?:{value:string}};sitelinks?:{enwiki?:{title:string}}}>();
  for(let i=0;i<wikidata.length;i+=50) {
    const result=await api(cache,'www.wikidata.org',{action:'wbgetentities',ids:wikidata.slice(i,i+50).join('|'),props:'descriptions|sitelinks',languages:'en',sitefilter:'enwiki'});
    for(const [id,entity] of Object.entries((result.entities ?? {}) as Record<string,unknown>))entities.set(id,entity as NonNullable<ReturnType<typeof entities.get>>);
  }
  const titleFor=(s:Subject):string|undefined=>s.wikipedia?.startsWith('en:')?s.wikipedia.slice(3).replaceAll('_',' '):entities.get(s.wikidata ?? '')?.sitelinks?.enwiki?.title;
  const titles=[...new Set(allSubjects.map(titleFor).filter((t):t is string=>!!t))].sort();
  const extracts=new Map<string,{text:string;title:string;revision?:number}>();
  for(let i=0;i<titles.length;i+=20) {
    const result=await api(cache,'en.wikipedia.org',{titles:titles.slice(i,i+20).join('|'),prop:'extracts|info',exintro:'1',explaintext:'1',exlimit:'20',exchars:'900',redirects:'1'});
    const query=result.query as {pages?:{title:string;extract?:string;lastrevid?:number}[];redirects?:{from:string;to:string}[];normalized?:{from:string;to:string}[]} | undefined;
    for(const page of query?.pages ?? [])if(page.extract)extracts.set(page.title,{text:page.extract,title:page.title,revision:page.lastrevid});
    for(const redirect of [...(query?.redirects ?? []),...(query?.normalized ?? [])].reverse()){const target=extracts.get(redirect.to);if(target)extracts.set(redirect.from,target);}
  }
  console.error(`descriptions: ${extracts.size} Wikipedia extracts, ${entities.size} Wikidata entities`);
  const descriptions=new Map<string,TrailDescription[]>();
  for(const [id,list] of subjects) {
    const seen=new Set<string>(),result:TrailDescription[]=[];
    for(const subject of list) {
      const title=titleFor(subject),extract=title?extracts.get(title):undefined;
      const data=entities.get(subject.wikidata ?? '');
      const url=extract?`https://en.wikipedia.org/wiki/${encodeURIComponent(extract.title.replaceAll(' ','_'))}`:subject.wikidata?`https://www.wikidata.org/wiki/${subject.wikidata}`:null;
      const text=extract?.text ?? data?.descriptions?.en?.value;
      if(!url||!text||seen.has(url))continue;seen.add(url);
      result.push({subject:subject.name,kind:subject.kind,text,sourceUrl:url,author:extract?'Wikipedia contributors':'Wikidata contributors',licence:extract?'CC BY-SA 4.0':'CC0 1.0',licenceUrl:extract?'https://creativecommons.org/licenses/by-sa/4.0/':'https://creativecommons.org/publicdomain/zero/1.0/',...(extract?.revision?{revision:extract.revision}:{})});
    }
    descriptions.set(id,result);
  }
  // Each occupied 0.15° × 0.10° cell fits inside a 10 km circle, with a
  // 300 m buffer. Sample along every segment, not just each trailhead.
  const cells=new Map<string,Coordinate>();
  for(const f of collection.features)for(const [a,b] of segments(trailLines(f))) {
    const steps=Math.max(1,Math.ceil(Math.max(Math.abs(b.lon-a.lon)/.04,Math.abs(b.lat-a.lat)/.04)));
    for(let s=0;s<=steps;s++) {
      const p={lon:a.lon+(b.lon-a.lon)*s/steps,lat:a.lat+(b.lat-a.lat)*s/steps};
      const x=Math.floor(p.lon/.15),y=Math.floor(p.lat/.1),key=`${x},${y}`;
      cells.set(key,{lon:(x+.5)*.15,lat:(y+.5)*.1});
    }
  }
  const geo=new Map<number,{pageid:number;title:string;lat:number;lon:number}>();
  let searched=0,saturated=0;
  const priorities=[{lon:-75.985,lat:40.638},{lon:-76.286,lat:41.328},{lon:-75.13,lat:40.99}];
  const score=(p:Coordinate)=>Math.min(...priorities.map(c=>Math.hypot((c.lon-p.lon)*.76,c.lat-p.lat)));
  const limit=args.includes('--photo-cell-limit')?Number(value('--photo-cell-limit')):Infinity;
  if(!(limit>0))throw new Error('--photo-cell-limit must be positive');
  const searchCells=[...cells.values()].sort((a,b)=>score(a)-score(b) || a.lon-b.lon || a.lat-b.lat).slice(0,limit);
  await workers(searchCells,async p=>{
    const result=await api(cache,'commons.wikimedia.org',{list:'geosearch',gscoord:`${p.lat.toFixed(6)}|${p.lon.toFixed(6)}`,gsradius:'10000',gslimit:'500',gsnamespace:'6'});
    const pages=(result.query as {geosearch?:{pageid:number;title:string;lat:number;lon:number}[]}|undefined)?.geosearch ?? [];
    if(pages.length>=Number(result.ogvResultLimit ?? 500))saturated++;
    for(const page of pages)geo.set(page.pageid,page);
    if(++searched%50===0)console.error(`Commons search: ${searched}/${searchCells.length}`);
  });
  const photoGrid=new SegmentGrid<number>();
  for(const p of geo.values())photoGrid.add([{lon:p.lon,lat:p.lat},{lon:p.lon,lat:p.lat}],p.pageid);
  const matches=new Map<string,{id:number;distance:number}[]>();
  for(const f of collection.features) {
    const best=new Map<number,number>();
    for(const segment of segments(trailLines(f)))for(const entry of photoGrid.near(segment,300)) {
      const m=segmentMatch(segment,entry.segment);
      if(m.distance<=300 && m.distance<(best.get(entry.value) ?? Infinity))best.set(entry.value,m.distance);
    }
    matches.set(f.id,[...best].map(([id,distance])=>({id,distance})).sort((a,b)=>a.distance-b.distance || a.id-b.id).slice(0,30));
  }
  const wanted=[...new Set([...matches.values()].flat().map(m=>m.id))].sort((a,b)=>a-b);
  const photos=new Map<number,Omit<TrailPhoto,'distanceFromTrailMeters'>>();
  const batches=Array.from({length:Math.ceil(wanted.length/50)},(_,i)=>wanted.slice(i*50,i*50+50));
  await workers(batches,async batch=>{
    const result=await api(cache,'commons.wikimedia.org',{pageids:batch.join('|'),prop:'imageinfo',iiprop:'url|extmetadata|mime',iiurlwidth:'640',iiextmetadatafilter:'Artist|LicenseShortName|LicenseUrl|AttributionRequired|Attribution|UsageTerms'});
    for(const page of (result.query as {pages?:CommonsPage[]}|undefined)?.pages ?? []) {
      const g=geo.get(page.pageid ?? 0);if(!g)continue;
      const photo=commonsPhoto(page,{lon:g.lon,lat:g.lat});if(photo)photos.set(g.pageid,photo);
    }
  });
  const hikes=catalog.hikes.map(h=>{
    const chosen=(matches.get(h.id) ?? []).flatMap(m=>{const photo=photos.get(m.id);return photo?[{...photo,distanceFromTrailMeters:Math.round(m.distance)}]:[];}).slice(0,6);
    return {...withAttribution(h),descriptions:descriptions.get(h.id) ?? [],photos:chosen,...(chosen[0]?{photo:chosen[0]}:{})};
  });
  const rich=new Map(hikes.map(h=>[h.id,{descriptions:h.descriptions,photos:h.photos,photo:h.photo}]));
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'hikes.json'),JSON.stringify({...catalog,hikes})+'\n');
  writeFileSync(join(out,'trails.geojson'),JSON.stringify({...collection,features:collection.features.map(f=>({...f,properties:{...withAttribution(f.properties),...rich.get(f.id)}}))})+'\n');
  if(existsSync(join(base,'sources')))cpSync(join(base,'sources'),join(out,'sources'),{recursive:true});
  const stats={cells:cells.size,requestedCells:searchCells.length,searched,saturated,geotaggedFiles:geo.size,metadataFiles:wanted.length,usablePhotos:photos.size,trailsWithPhotos:hikes.filter(h=>h.photos.length).length,trailsWithDescriptions:hikes.filter(h=>h.descriptions.length).length,errors};
  writeFileSync(join(out,'media-stats.json'),JSON.stringify(stats,null,2)+'\n');console.error(JSON.stringify(stats));
}
if(process.argv[1] && resolve(process.argv[1]).endsWith('infra/trails/enrich-media.ts'))void main().catch((e:unknown)=>{console.error(e);process.exitCode=1;});
