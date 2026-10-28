import {describe,it,expect} from 'vitest';
import {attributeSources} from '../../../../infra/trails/lib/licence';
describe('catalog licence migration',()=>{
 it('upgrades old OSM/federal records but refuses unreviewed state terms',()=>{
  const old={sourceId:'osm' as const,sourceLabel:'OpenStreetMap',recordId:'way/1',url:'https://www.openstreetmap.org/way/1'};
  expect(attributeSources([old])[0]).toMatchObject({licence:'ODbL 1.0',licenceUrl:'https://www.openstreetmap.org/copyright'});
  expect(()=>attributeSources([{...old,sourceId:'dcnr'}])).toThrow('Missing reviewed licence');
 });
});
