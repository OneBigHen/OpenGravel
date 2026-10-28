import type { Coordinate } from "../../../src/domain/ride/types";
import { haversine } from "../../../src/domain/geometry/analysis";
import { classifyShape } from "../../../src/domain/hike/shape";
import { bboxOf, linesFromGeometry, linesLengthMeters } from "./geometry";
import { propertyValue } from "./external";
import type { OsmFeature } from "./osm-input";
import { SegmentGrid, segmentMatch, segments } from "./spatial";
import type { HikeRecord, TrailFeature, TrailSource } from "./types";

export function trailLines(feature: TrailFeature) { return linesFromGeometry(feature.geometry); }
function samples(lines: readonly (readonly Coordinate[])[]) {
  return segments(lines).flatMap(([a,b]) => {
    const distance=haversine(a,b), count=Math.max(1,Math.ceil(distance/30));
    return Array.from({length:count},(_,i)=>({point:{lon:a.lon+(b.lon-a.lon)*(i+.5)/count,lat:a.lat+(b.lat-a.lat)*(i+.5)/count},weight:distance/count}));
  });
}
export function overlapShare(a: readonly (readonly Coordinate[])[], b: readonly (readonly Coordinate[])[]): number {
  const grid=new SegmentGrid<null>(); for(const segment of segments(b)) grid.add(segment,null);
  let covered=0,total=0;
  for(const {point,weight} of samples(a)) {
    total+=weight;
    if([...grid.near([point,point],25)].some(({segment})=>segmentMatch([point,point],segment).distance<=25)) covered+=weight;
  }
  return total>0?covered/total:0;
}
export function sameOfficialTrail(a: readonly (readonly Coordinate[])[],b: readonly (readonly Coordinate[])[]): boolean {
  const al=linesLengthMeters(a),bl=linesLengthMeters(b);
  return Math.min(al,bl)>0 && Math.min(al,bl)/Math.max(al,bl)>=.8 && overlapShare(a,b)>=.85 && overlapShare(b,a)>=.85;
}
export interface OfficialInput { readonly source: TrailSource; readonly features: readonly OsmFeature[]; readonly metadata?: {fields?: readonly {name:string;domain?:{codedValues?:readonly {code:unknown;name:string}[]}|null}[]} }
function decoded(p:Record<string,unknown>,keys:readonly string[],input:OfficialInput):string|null {
  const raw=propertyValue(p,keys); if(raw===null || /^(unknown|unk|n\/a|not specified|null|none|-9999)$/i.test(raw)) return null;
  for(const key of keys) {
    const field=input.metadata?.fields?.find(f=>f.name.toLowerCase()===key);
    const code=field?.domain?.codedValues?.find(v=>String(v.code)===raw);
    if(code) return /^(unknown|unk|not specified)$/i.test(code.name)?null:code.name;
  }
  return raw;
}
export function normalizeOfficial(feature:OsmFeature,input:OfficialInput) {
  const p=feature.properties;
  const get=(keys:readonly string[])=>decoded(p,keys,input);
  const name=get(["trlname","trail_name","name","name01","maplabel"]);
  const status=get(["trlstatus","trail_status","status"]);
  if(status && /proposed|planned|decommissioned/i.test(status)) return null;
  const lines=linesFromGeometry(feature.geometry); if(!lines.length || !name) return null;
  const officialDifficulty=get(["trl_diff","difficulty","skill_level"]);
  let allowedUses=get(["trluse","allowed_terra_use"]);
  if(!allowedUses) {
    const uses=[["hiking_trl","Hiking"],["biking_trl","Bicycling"],["hbr_trl","Horse riding"],["type_hiking","Hiking"],["hiking","Hiking"]].flatMap(([key,label])=>/^(yes|y|1)$/i.test(get([key!]) ?? "")?[label!]:[]);
    allowedUses=uses.length?[...new Set(uses)].join(", "):null;
  }
  // Undocumented numeric USFS bit fields are evidence, not readable use claims.
  if(allowedUses && /^\d+$/.test(allowedUses)) allowedUses=null;
  const closed=status && /closed/i.test(status);
  const officialAccess=get(["opentopublic"]);
  const access=closed || /^(no|n|0)$/i.test(officialAccess ?? "") ? "no" : null;
  const attrs={access,officialStatus:status,name,ref:get(["trail_no","trailid"]),operator:get(["unitname","mgmt","operator","managing_org","admin_org"]) ?? input.source.sourceLabel,surface:get(["trlsurface","trl_srface","trail_surface","surface"]),officialDifficulty,allowedUses};
  const recordId=propertyValue(p,["objectid","featureid","globalid","fid"]); if(!recordId) throw new Error(`Official record lacks stable id: ${name}`);
  const source={...input.source,recordId,url:`${input.source.url}/query?where=${encodeURIComponent(`OBJECTID=${recordId}`)}&outFields=*&f=pjson`};
  return {attrs,source,lines};
}
export function mergeOfficial(base:readonly TrailFeature[],inputs:readonly OfficialInput[]) {
  const features:TrailFeature[]=[...base];
  const grid=new SegmentGrid<number>();
  features.forEach((f,i)=>segments(trailLines(f)).forEach(s=>grid.add(s,i)));
  const stats:Record<string,{read:number;accepted:number;merged:number;added:number}>={};
  for(const input of inputs) {
    const stat={read:input.features.length,accepted:0,merged:0,added:0};stats[input.source.sourceId]=stat;
    for(const raw of input.features) {
      const normalized=normalizeOfficial(raw,input);if(!normalized)continue;stat.accepted++;
      const {attrs,source,lines}=normalized;
      const votes=new Map<number,number>();
      for(const {point,weight} of samples(lines)) {
        const hits=new Set<number>();
        for(const entry of grid.near([point,point],25)) if(segmentMatch([point,point],entry.segment).distance<=25) hits.add(entry.value);
        for(const hit of hits) votes.set(hit,(votes.get(hit) ?? 0)+weight);
      }
      const match=[...votes].sort((a,b)=>b[1]-a[1] || features[a[0]]!.id.localeCompare(features[b[0]]!.id)).find(([i])=>sameOfficialTrail(lines,trailLines(features[i]!)));
      const evidence={source,attributes:attrs};
      if(match) {
        const index=match[0],old=features[index]!,p=old.properties;
        // First official provider with a value wins; OSM identity/geometry and
        // its DEM stay stable. Conflicts preserve the provider and prior value.
        const fieldSources={...p.fieldSources};
        const replacements:Record<string,string>={};
        const conflicts=[...p.conflicts];
        for(const [key,value] of Object.entries(attrs)) {
          if(value===null || fieldSources[key]) continue;
          replacements[key]=value;fieldSources[key]=source;
          if(key==='name'||key==='ref'||key==='operator'||key==='surface'||key==='access') {
            const prior=p[key];
            if(prior && prior!==value) conflicts.push({field:key,kept:{sourceId:source.sourceId,value},other:{sourceId:p.sources[0]?.sourceId ?? 'osm',value:prior}});
          }
        }
        const already=p.sources.some(s=>s.sourceId===source.sourceId && s.recordId===source.recordId);
        features[index]={...old,properties:{...p,...replacements,fieldSources,conflicts,sources:already?p.sources:[...p.sources,source],officialEvidence:[...(p.officialEvidence ?? []),evidence]}};
        stat.merged++;
      } else {
        const id=`${source.sourceId}:${source.recordId}`;
        const feature:TrailFeature={type:"Feature",id,geometry:lines.length===1?{type:"LineString",coordinates:lines[0]!.map(p=>[p.lon,p.lat] as const)}:{type:"MultiLineString",coordinates:lines.map(line=>line.map(p=>[p.lon,p.lat] as const))},properties:{id,...attrs,sacScale:null,trailVisibility:null,dog:null,lengthMeters:Math.round(linesLengthMeters(lines)),elevationGainMeters:null,elevationLossMeters:null,maxGradePercent:null,toblerMinutes:null,elevationMeasuredShare:0,elevationSource:null,timeMethod:null,trailheads:[],sources:[source],conflicts:[],fieldSources:Object.fromEntries(Object.keys(attrs).filter(k=>attrs[k as keyof typeof attrs]!==null).map(k=>[k,source])),officialEvidence:[evidence]}};
        const index=features.length;features.push(feature);segments(lines).forEach(s=>grid.add(s,index));stat.added++;
      }
    }
  }
  return {features,stats};
}
export function recordFromFeature(feature:TrailFeature,previous?:HikeRecord):HikeRecord {
  const lines=trailLines(feature),p=feature.properties;
  const longest=[...lines].sort((a,b)=>linesLengthMeters([b])-linesLengthMeters([a]))[0]!;
  return {...previous,...p,bbox:bboxOf(lines),start:longest[0]!,end:longest[longest.length-1]!,shape:lines.length===1?classifyShape(lines[0]!).shape:"unknown",trailheadCount:p.trailheads.length};
}
