import type { TrailSource,Trailhead } from './types';
/** Upgrade pre-licence OSM/federal catalogs; never infer terms for a state source. */
export function attributeSources(sources:readonly TrailSource[]):TrailSource[] {
  return sources.map(source=>{
    const licence=source.licence ?? (source.sourceId==='osm'?'ODbL 1.0':['usfs','nps'].includes(source.sourceId)?'Public domain (US federal government)':null);
    const licenceUrl=source.licenceUrl ?? (source.sourceId==='osm'?'https://www.openstreetmap.org/copyright':['usfs','nps'].includes(source.sourceId)?'https://www.usa.gov/government-works':null);
    if(!licence || !licenceUrl)throw new Error(`Missing reviewed licence: ${source.sourceId}:${source.recordId}`);
    return {...source,licence,licenceUrl};
  });
}
export function withAttribution<T extends {readonly sources:readonly TrailSource[];readonly trailheads:readonly Trailhead[]}>(record:T) {
  return {...record,sources:attributeSources(record.sources),trailheads:record.trailheads.map(head=>({...head,sources:attributeSources(head.sources)}))};
}
