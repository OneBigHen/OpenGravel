#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFeatureFile } from "./lib/osm-input";
import { mergeOfficial, recordFromFeature, trailLines, type OfficialInput } from "./lib/official";
import { insidePolygon } from "./lib/context";
import { geometryLines } from "./lib/features";
import { createDemSource } from "./lib/dem";
import { measureTrail } from "./lib/elevation";
import type { HikeCatalog, TrailFeatureCollection, TrailSource } from "./lib/types";

async function main() {
  const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];
  const base=value("--base"),sourceDir=value("--sources"),out=value("--out"),demCache=value("--dem-cache");
  if(!args.includes('--base')||!args.includes('--sources')||!args.includes('--out')||!base||!sourceDir||!out) throw new Error('--base DIR --sources DIR --out DIR [--dem-cache DIR]');
  if(resolve(base)===resolve(out))throw new Error('base and output must differ');
  const catalog=JSON.parse(readFileSync(join(base,'hikes.json'),'utf8')) as HikeCatalog;
  const collection=JSON.parse(readFileSync(join(base,'trails.geojson'),'utf8')) as TrailFeatureCollection;
  const inputs:OfficialInput[]=[];
  const states = JSON.parse(readFileSync(join(sourceDir,'states.geojson'),'utf8')) as {features:{geometry:{type:string;coordinates:unknown}}[]};
  const polygons = states.features.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates as unknown[]) as Parameters<typeof insidePolygon>[1][];
  for(const id of ['dcnr','nps','usfs','njdep'] as const) {
    const manifest=JSON.parse(readFileSync(join(sourceDir,id,'manifest.json'),'utf8')) as {url:string;licence:string;licenceUrl:string};
    const source:TrailSource={sourceId:id,recordId:'',sourceLabel:id==='dcnr'?'PA DCNR via PA Open Data':id==='nps'?'National Park Service':id==='usfs'?'USDA Forest Service':'NJDEP Geographic Information System (GIS)',url:manifest.url,licence:manifest.licence,licenceUrl:manifest.licenceUrl,metadataUrl:`/data-attribution/trails/${id}/manifest.json`};
    inputs.push({source,features:(await readFeatureFile(join(sourceDir,id+'.geojson'))).filter(f => geometryLines(f.geometry).some(line => line.some(p => polygons.some(poly => insidePolygon(p,poly))))),metadata:JSON.parse(readFileSync(join(sourceDir,id,'layer.json'),'utf8')) as OfficialInput['metadata']});
  }
  const merged=mergeOfficial(collection.features,inputs);
  const dem=demCache?createDemSource({cacheDir:demCache,zoom:12,log:console.error}):null;
  const features=[];
  for(const f of merged.features) {
    if(dem && f.properties.elevationMeasuredShare!==1) {
      const p=f.properties;
      const measurements=await measureTrail({id:f.id,lines:trailLines(f),lengthMeters:p.lengthMeters,attributes:p,sources:p.sources,conflicts:p.conflicts,trailheads:p.trailheads},dem,12);
      features.push({...f,properties:{...p,...measurements}});
    } else features.push(f);
    if(features.length%1000===0)console.error(`agency DEM: ${features.length}/${merged.features.length}`);
  }
  const previous=new Map(catalog.hikes.map(h=>[h.id,h]));
  const hikes=features.map(f=>recordFromFeature(f,previous.get(f.id)));
  const bySource:Record<string,number>={};
  hikes.forEach(h=>new Set(h.sources.map(s=>s.sourceId)).forEach(id=>bySource[id]=(bySource[id]??0)+1));
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'trails.geojson'),JSON.stringify({type:'FeatureCollection',features})+'\n');
  writeFileSync(join(out,'hikes.json'),JSON.stringify({version:1,counts:{trails:hikes.length,bySource,withTrailhead:hikes.filter(h=>h.trailheadCount>0).length,merged:hikes.filter(h=>h.sources.length>1).length},hikes})+'\n');
  writeFileSync(join(out,'official-stats.json'),JSON.stringify(merged.stats,null,2)+'\n');
  for(const id of ['dcnr','nps','usfs','njdep']) {
    const dest=join('public/data-attribution/trails',id);mkdirSync(dest,{recursive:true});cpSync(join(sourceDir,id),dest,{recursive:true});
    cpSync(join(sourceDir,id),join(out,'sources',id),{recursive:true});
  }
  console.error(JSON.stringify(merged.stats));
}
if(process.argv[1] && resolve(process.argv[1]).endsWith('infra/trails/merge-official.ts')) void main().catch((e:unknown)=>{console.error(e);process.exitCode=1;});
