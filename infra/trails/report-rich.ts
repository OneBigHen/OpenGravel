#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { HikeCatalog, TrailFeatureCollection } from './lib/types';
import { listHikes } from '../../src/server/hikes/catalog';

async function main() {
  const dir=process.argv[2];if(!dir)throw new Error('report-rich.ts CATALOG_DIR');
  const catalog=JSON.parse(readFileSync(join(dir,'hikes.json'),'utf8')) as HikeCatalog;
  const collection=JSON.parse(readFileSync(join(dir,'trails.geojson'),'utf8')) as TrailFeatureCollection;
  const bySource:Record<string,number>={},sourceRecords:Record<string,Set<string>>={},featureMatches:Record<string,number>={},featureObjects:Record<string,Set<string>>={};
  const photoIds=new Set<number>(),idSet=new Set<string>();let badSources=0,badPhotos=0;
  for(const h of catalog.hikes) {
    if(idSet.has(h.id))throw new Error(`duplicate hike ${h.id}`);idSet.add(h.id);
    if(!h.sources.length)throw new Error(`unattributed hike ${h.id}`);
    for(const id of new Set(h.sources.map(s=>s.sourceId)))bySource[id]=(bySource[id]??0)+1;
    for(const s of [...h.sources,...h.trailheads.flatMap(t=>t.sources),...(h.features ?? []).map(f=>f.source)]) {
      if(!s.licence||!s.licenceUrl)badSources++;
      (sourceRecords[s.sourceId]??=new Set()).add(s.recordId);
    }
    for(const f of h.features ?? []) {
      featureMatches[f.kind]=(featureMatches[f.kind]??0)+1;(featureObjects[f.kind]??=new Set()).add(f.id);
      if(f.distanceFromTrailMeters>100 || f.distanceAlongMeters<0 || f.distanceAlongMeters>h.lengthMeters+1)throw new Error(`invalid feature offset ${h.id}:${f.id}`);
    }
    if((h.photos?.length ?? 0)>6)throw new Error(`too many photos ${h.id}`);
    for(const p of h.photos ?? []) {
      photoIds.add(p.pageId);
      if(!/^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(p.thumbnailUrl)||!p.author||!p.licence||!p.licenceUrl||!p.pageUrl||p.distanceFromTrailMeters>300)badPhotos++;
    }
  }
  if(badSources||badPhotos)throw new Error(`invalid source/photo attribution ${badSources}/${badPhotos}`);
  if(collection.features.length!==idSet.size || collection.features.some(f=>!idSet.has(f.id)))throw new Error('geometry/index mismatch');
  const payloads=[];
  for(const [name,bbox] of [['Hawk Mountain','-76.09,40.54,-75.89,40.74'],['Ricketts Glen','-76.39,41.23,-76.19,41.43'],['Delaware Water Gap','-75.23,40.89,-75.03,41.09'],['NJ northwest','-74.95,40.9,-74.45,41.35']]) {
    const response=await listHikes(new URL(`http://localhost/api/hikes?bbox=${bbox}`),join(dir,'hikes.json'));
    if(response.status!==200)throw new Error('API check failed');
    const text=JSON.stringify(response.body),body=response.body as {hikes:Record<string,unknown>[]};
    if(body.hikes.some(h=>['parks','features','photos','descriptions','officialEvidence','fieldSources','trailheads','conflicts'].some(k=>k in h)))throw new Error('detail leaked into list');
    payloads.push({area:name,records:body.hikes.length,bytes:Buffer.byteLength(text),gzipBytes:gzipSync(text).length});
  }
  const report={trails:catalog.hikes.length,bySource,uniqueSourceReferences:Object.fromEntries(Object.entries(sourceRecords).map(([k,v])=>[k,v.size])),featureMatches,totalFeatureMatches:Object.values(featureMatches).reduce((a,b)=>a+b,0),uniqueFeatureObjects:Object.fromEntries(Object.entries(featureObjects).map(([k,v])=>[k,v.size])),trailsWithFeatures:catalog.hikes.filter(h=>h.featureCount).length,trailsWithPark:catalog.hikes.filter(h=>h.park).length,trailsWithTown:catalog.hikes.filter(h=>h.nearestTown).length,difficultyByBasis:catalog.hikes.reduce<Record<string,number>>((r,h)=>{const b=h.difficulty?.basis ?? 'unknown';r[b]=(r[b]??0)+1;return r;},{}),trailsWithPhotos:catalog.hikes.filter(h=>h.photos?.length).length,photoMatches:catalog.hikes.reduce((n,h)=>n+(h.photos?.length ?? 0),0),uniquePhotos:photoIds.size,trailsWithDescriptions:catalog.hikes.filter(h=>h.descriptions?.length).length,withCompleteElevation:catalog.hikes.filter(h=>h.elevationMeasuredShare===1).length,withTrailhead:catalog.hikes.filter(h=>h.trailheadCount).length,accessRestricted:catalog.hikes.filter(h=>['no','private'].includes(h.access ?? '')).length,artifacts:Object.fromEntries(['hikes.json','trails.geojson'].map(f=>[f,{bytes:statSync(join(dir,f)).size,gzipBytes:gzipSync(readFileSync(join(dir,f))).length}])),listPayloads:payloads};
  writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
void main().catch((e:unknown)=>{console.error(e);process.exitCode=1;});
