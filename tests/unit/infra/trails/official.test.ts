import {describe,it,expect} from "vitest";
import {sameOfficialTrail,normalizeOfficial,mergeOfficial,recordFromFeature} from "../../../../infra/trails/lib/official";
import type {OfficialInput} from "../../../../infra/trails/lib/official";
const a=[{lon:-75,lat:40},{lon:-75,lat:40.01}], reverse=[...a].reverse();
const source={sourceId:"nps" as const,sourceLabel:"National Park Service",recordId:"",url:"https://mapservices.nps.gov/example/0",licence:"Public domain"};
const input:OfficialInput={source,features:[]};
const raw={properties:{OBJECTID:1,TRLNAME:"Official ridge",TRLUSE:"Hiking",TRLSURFACE:"Dirt",UNITNAME:"Park"},geometry:{type:"LineString",coordinates:a.map(p=>[p.lon,p.lat])}};
describe("official trail integration",()=>{
 it("uses reciprocal geometry overlap, handles reversal, rejects matching ends on different alignments",()=>{
  expect(sameOfficialTrail([a],[reverse])).toBe(true);
  expect(sameOfficialTrail([a],[[a[0]!,{lon:-74.995,lat:40.005},a[1]!]])).toBe(false);
  expect(sameOfficialTrail([a],[[{lon:-75,lat:40.004},{lon:-75,lat:40.006}]])).toBe(false);
 });
 it("keeps difficulty separate from SAC and refuses proposed or nameless records",()=>{
  expect(normalizeOfficial({...raw,properties:{...raw.properties,DIFFICULTY:"Difficult"}},input)?.attrs).toMatchObject({officialDifficulty:"Difficult",allowedUses:"Hiking"});
  expect(normalizeOfficial({...raw,properties:{...raw.properties,TRLSTATUS:"Proposed"}},input)).toBeNull();
  expect(normalizeOfficial({...raw,properties:{OBJECTID:2}},input)).toBeNull();
 });
 it("preserves OSM identity and geometry while official fields win and conflicts retain both sources",()=>{
  const initial=mergeOfficial([],[{...input,features:[raw]}]).features[0]!;
  const osm={...initial,id:"osm:way/123",properties:{...initial.properties,id:"osm:way/123",name:"OSM Ridge",fieldSources:undefined,officialEvidence:undefined,sources:[{...source,sourceId:"osm" as const,recordId:"way/123"}]}};
  const result=mergeOfficial([osm],[{...input,features:[raw]}]);
  expect(result.features).toHaveLength(1);
  expect(result.stats.nps).toMatchObject({merged:1,added:0});
  expect(result.features[0]!.id).toBe("osm:way/123");
  expect(result.features[0]!.properties.name).toBe("Official ridge");
  expect(result.features[0]!.properties.conflicts).toContainEqual({field:"name",kept:{sourceId:"nps",value:"Official ridge"},other:{sourceId:"osm",value:"OSM Ridge"}});
  expect(recordFromFeature(result.features[0]!).sources).toHaveLength(2);
 });
});
