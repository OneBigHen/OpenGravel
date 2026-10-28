import type { Coordinate } from "../../../src/domain/ride/types";
import { haversine } from "../../../src/domain/geometry/analysis";
import { textTag, type OsmFeature } from "./osm-input";
import { osmSource } from "./features";
import { cellKeys } from "./spatial";
import type { CatalogPlace, CatalogDifficulty } from "./rich-types";
import type { HikeRecord } from "./types";

type Ring = readonly (readonly [number,number])[];
type Polygon = readonly Ring[];
function insideRing(p: Coordinate, ring: Ring): boolean {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i]!, b=ring[j]!;
    if ((a[1]>p.lat)!==(b[1]>p.lat) && p.lon < (b[0]-a[0])*(p.lat-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function insidePolygon(p: Coordinate, polygon: Polygon): boolean {
  return !!polygon[0] && insideRing(p,polygon[0]) && !polygon.slice(1).some(ring => insideRing(p,ring));
}
const place = (f: OsmFeature): CatalogPlace => ({name:textTag(f.properties,"name")!,source:osmSource(f.properties),
  ...(textTag(f.properties,"wikipedia") ? {wikipedia:textTag(f.properties,"wikipedia")!} : {}),
  ...(textTag(f.properties,"wikidata") ? {wikidata:textTag(f.properties,"wikidata")!} : {})});
interface Park { place: CatalogPlace; polygons: readonly Polygon[]; area: number }
export function contextIndex(features: readonly OsmFeature[]) {
  const parks = new Map<string,Park[]>();
  const towns: { place: CatalogPlace; point: Coordinate }[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    if (!textTag(f.properties,"name")) continue;
    const id=osmSource(f.properties).recordId;
    if (seen.has(id)) continue;
    seen.add(id);
    const g=f.geometry as {type?:string;coordinates?:unknown} | null;
    if (!g) continue;
    if (["city","town","village"].includes(String(f.properties.place)) && g.type === "Point") {
      const [lon,lat]=g.coordinates as [number,number];
      towns.push({place:place(f),point:{lon,lat}});
    }
    if (!["protected_area","national_park"].includes(String(f.properties.boundary)) && !["park","nature_reserve"].includes(String(f.properties.leisure))) continue;
    const polygons = g.type === "Polygon" ? [g.coordinates as Polygon] : g.type === "MultiPolygon" ? g.coordinates as Polygon[] : [];
    const points=polygons.flatMap(poly => poly[0] ?? []);
    if (!points.length) continue;
    const west=Math.min(...points.map(p=>p[0])),east=Math.max(...points.map(p=>p[0])),south=Math.min(...points.map(p=>p[1])),north=Math.max(...points.map(p=>p[1]));
    const park={place:place(f),polygons,area:(east-west)*(north-south)};
    for (const key of cellKeys({lon:west,lat:south},{lon:east,lat:north})) {
      const bucket=parks.get(key) ?? []; bucket.push(park); parks.set(key,bucket);
    }
  }
  return { parks,towns };
}
export function trailContext(lines: readonly (readonly Coordinate[])[], index: ReturnType<typeof contextIndex>) {
  const shares = new Map<Park,number>();
  let length=0;
  for (const line of lines) for(let i=1;i<line.length;i++) {
    const a=line[i-1]!, b=line[i]!, distance=haversine(a,b), steps=Math.max(1,Math.ceil(distance/250));
    length+=distance;
    for(let s=0;s<steps;s++) {
      const t=(s+.5)/steps, point={lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t};
      for (const park of index.parks.get(cellKeys(point,point)[0]!) ?? []) {
        if(park.polygons.some(poly => insidePolygon(point,poly))) shares.set(park,(shares.get(park) ?? 0)+distance/steps);
      }
    }
  }
  const park=[...shares].filter(([,n])=> length>0 && n/length>=.5).sort((a,b)=>a[0].area-b[0].area || a[0].place.name.localeCompare(b[0].place.name))[0];
  const start=lines[0]?.[0];
  const nearest=start ? index.towns.map(t=>({...t,distance:haversine(start,t.point)})).sort((a,b)=>a.distance-b.distance || a.place.name.localeCompare(b.place.name))[0] : undefined;
  return { park:park ? {...park[0].place,sampledShare:Math.round(park[1]/length*100)/100} : null, nearestTown:nearest && nearest.distance<=50000 ? {...nearest.place,distanceMeters:Math.round(nearest.distance)} : null };
}
export function catalogDifficulty(hike: Pick<HikeRecord,"sacScale"|"lengthMeters"|"elevationGainMeters"|"elevationMeasuredShare"> & Partial<Pick<HikeRecord,"officialDifficulty"|"sources">>): CatalogDifficulty | null {
  if(hike.officialDifficulty) return {label:hike.officialDifficulty,basis:"official",sourceUrl:hike.sources?.find(s=>s.sourceId!=="osm")?.url ?? "https://www.usa.gov/government-works"};
  if(hike.sacScale) return {label:hike.sacScale.replaceAll("_"," "),basis:"osm",sourceUrl:"https://wiki.openstreetmap.org/wiki/Key:sac_scale"};
  const gain=hike.elevationGainMeters;
  if(gain===null || !Number.isFinite(gain) || gain<0 || hike.lengthMeters<=0 || hike.elevationMeasuredShare<1) return null;
  const score=Math.sqrt(2*gain*3.280839895*hike.lengthMeters/1609.344);
  return {label:score<50?"Easiest":score<100?"Moderate":score<150?"Moderately strenuous":score<200?"Strenuous":"Very strenuous",basis:"derived",score:Math.round(score*10)/10,method:"sqrt(2 × gain_ft × distance_miles)",sourceUrl:"https://www.nps.gov/shen/planyourvisit/how-to-determine-hiking-difficulty.htm"};
}
