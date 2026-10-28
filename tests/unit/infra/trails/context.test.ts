import { describe,it,expect } from "vitest";
import { insidePolygon,contextIndex,trailContext,catalogDifficulty } from "../../../../infra/trails/lib/context";
const outer = [[0,0],[2,0],[2,2],[0,2],[0,0]] as const;
describe("trail context", () => {
  it("respects polygon holes", () => {
    expect(insidePolygon({lon:.2,lat:.2},[outer,[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]]])).toBe(true);
    expect(insidePolygon({lon:1,lat:1},[outer,[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]]])).toBe(false);
  });
  it("uses length samples rather than a park's bounding box, and includes attributed town distance", () => {
    const index=contextIndex([
      {properties:{name:"Park","@type":"way","@id":1,leisure:"park"},geometry:{type:"Polygon",coordinates:[[[-75,40],[-74.99,40],[-74.99,40.01],[-75,40.01],[-75,40]]]}},
      {properties:{name:"Outer State Park","@type":"way","@id":3,leisure:"park"},geometry:{type:"Polygon",coordinates:[[[-75.01,39.99],[-74.98,39.99],[-74.98,40.02],[-75.01,40.02],[-75.01,39.99]]]}},
      {properties:{name:"Town","@type":"node","@id":2,place:"town"},geometry:{type:"Point",coordinates:[-75,40]}}
    ]);
    const result=trailContext([[{lon:-74.999,lat:40.001},{lon:-74.999,lat:40.009}]],index);
    expect(result.park).toMatchObject({name:"Park",sampledShare:1,source:{licence:"ODbL 1.0"}});
    expect(result.parkNames).toEqual(["Park","Outer State Park"]);
    expect(result.parks).toHaveLength(2);
    expect(result.nearestTown?.name).toBe("Town");
    expect(trailContext([[{lon:-75.001,lat:40.001},{lon:-75.001,lat:40.009}]],index).park?.name).toBe("Outer State Park");
  });
  it("preserves OSM ratings and withholds derived ratings for unknown or partial gain", () => {
    const h={sacScale:null,lengthMeters:16093.44,elevationGainMeters:670.56,elevationMeasuredShare:1};
    expect(catalogDifficulty(h)).toMatchObject({label:"Very strenuous",score:209.8,basis:"derived"});
    expect(catalogDifficulty({...h,sacScale:"mountain_hiking"})).toMatchObject({basis:"osm",label:"mountain hiking"});
    expect(catalogDifficulty({...h,elevationGainMeters:null})).toBeNull();
    expect(catalogDifficulty({...h,elevationMeasuredShare:.99})).toBeNull();
    expect(catalogDifficulty({...h,officialDifficultyCode:"2"})).toBeNull();
    expect(catalogDifficulty({...h,sacScale:"hiking",officialDifficulty:"Difficult"})).toMatchObject({basis:"official",label:"Difficult"});
  });
});
