#!/usr/bin/env node
/** Union matching OSM IDs across state extracts without bridging geometry gaps. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {Coordinate} from '../../src/domain/ride/types';
import type {HikeCatalog,TrailFeature,TrailFeatureCollection} from './lib/types';
import {assembleLines,geometrySignature,linesLengthMeters} from './lib/geometry';
import {trailLines,recordFromFeature} from './lib/official';
import {createDemSource} from './lib/dem';
import {measureTrail} from './lib/elevation';
import {withAttribution} from './lib/licence';
import {segments} from './lib/spatial';

const key=(p:Coordinate)=>`${p.lon.toFixed(7)},${p.lat.toFixed(7)}`;
export function unionTrailLines(primary:readonly (readonly Coordinate[])[],additional:readonly (readonly Coordinate[])[]):Coordinate[][] {
  const edgeKey=(a:Coordinate,b:Coordinate)=>[key(a),key(b)].sort().join('|');
  const seen=new Set(segments(primary).map(([a,b])=>edgeKey(a,b)));
  const retained=primary.map(line=>[...line]);
  for(const line of additional) {
    let run:Coordinate[]=[];
    const flush=()=>{if(run.length>=2)retained.push(run);run=[];};
    for(let i=1;i<line.length;i++) {
      const a=line[i-1]!,b=line[i]!;
      if(seen.has(edgeKey(a,b))){flush();continue;}
      if(!run.length)run.push(a);
      run.push(b);
    }
    flush();
    // Mark after reading the whole part: intentional return legs within a
    // part remain repeated, preserving length and out-and-back geometry.
    for(const [a,b] of segments([line]))seen.add(edgeKey(a,b));
  }
  return assembleLines(retained);
}
async function main() {
  const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];
  const dirs=args.flatMap((v,i)=>v==='--input'&&args[i+1]?[args[i+1]!]:[]),out=value('--out'),demCache=value('--dem-cache');
  if(dirs.length<2||!out||!demCache||!args.includes('--out')||!args.includes('--dem-cache'))throw new Error('--input DIR --input DIR --out DIR --dem-cache DIR');
  if(dirs.some(dir=>resolve(dir)===resolve(out)))throw new Error('output must differ from inputs');
  const merged=new Map<string,TrailFeature>();
  let shared=0,changed=0;
  const dem=createDemSource({cacheDir:demCache,zoom:12,log:console.error});
  for(const dir of dirs) {
    const collection=JSON.parse(readFileSync(join(dir,'trails.geojson'),'utf8')) as TrailFeatureCollection;
    for(const incoming of collection.features) {
      const feature={...incoming,properties:withAttribution(incoming.properties)},old=merged.get(feature.id);
      if(!old){merged.set(feature.id,feature);continue;}
      shared++;
      const lines=unionTrailLines(trailLines(old),trailLines(feature));
      const different=geometrySignature(lines)!==geometrySignature(trailLines(old));
      const p=old.properties,sourceMap=new Map([...p.sources,...feature.properties.sources].map(s=>[`${s.sourceId}:${s.recordId}`,s]));
      const heads=new Map([...p.trailheads,...feature.properties.trailheads].map(h=>[h.sources.map(s=>s.recordId).join('|'),h]));
      const combined:TrailFeature={...old,geometry:lines.length===1?{type:'LineString',coordinates:lines[0]!.map(p=>[p.lon,p.lat] as const)}:{type:'MultiLineString',coordinates:lines.map(line=>line.map(p=>[p.lon,p.lat] as const))},properties:{...p,lengthMeters:Math.round(linesLengthMeters(lines)),sources:[...sourceMap.values()],trailheads:[...heads.values()]}};
      if(different){changed++;const q=combined.properties;const measurement=await measureTrail({id:feature.id,lines,attributes:q,sources:q.sources,conflicts:q.conflicts,trailheads:q.trailheads,lengthMeters:q.lengthMeters},dem,12);merged.set(feature.id,{...combined,properties:{...q,...measurement}});}else merged.set(feature.id,combined);
    }
  }
  const features=[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id)),hikes=features.map(f=>recordFromFeature(f));
  const bySource:Record<string,number>={};hikes.forEach(h=>new Set(h.sources.map(s=>s.sourceId)).forEach(id=>bySource[id]=(bySource[id]??0)+1));
  const catalog:HikeCatalog={version:1,counts:{trails:hikes.length,bySource,withTrailhead:hikes.filter(h=>h.trailheadCount).length,merged:hikes.filter(h=>h.sources.length>1).length},hikes};
  mkdirSync(out,{recursive:true});writeFileSync(join(out,'hikes.json'),JSON.stringify(catalog)+'\n');writeFileSync(join(out,'trails.geojson'),JSON.stringify({type:'FeatureCollection',features})+'\n');
  const stats={inputs:dirs,sharedIds:shared,unionedGeometries:changed,trails:hikes.length};writeFileSync(join(out,'combine-stats.json'),JSON.stringify(stats,null,2)+'\n');console.error(stats);
}
if(process.argv[1]&&resolve(process.argv[1]).endsWith('infra/trails/combine-catalogs.ts'))void main().catch((e:unknown)=>{console.error(e);process.exitCode=1;});
