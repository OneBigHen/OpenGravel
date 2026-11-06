import {describe,it,expect} from 'vitest';
import {unionTrailLines} from '../../../../infra/trails/combine-catalogs';
const a={lon:-75,lat:40},b={lon:-75,lat:40.01},c={lon:-75,lat:40.02},d={lon:-75,lat:40.03};
describe('state extract union',()=>{
 it('deduplicates shared edges and joins only matching vertices',()=>{
  expect(unionTrailLines([[a,b,c]],[[b,c,d]])).toEqual([[a,b,c,d]]);
  expect(unionTrailLines([[a,b]],[[c,d]])).toEqual([[a,b],[c,d]]);
 });
 it('keeps intentional repeated legs in the original route',()=>{
  expect(unionTrailLines([[a,b,a]],[[a,b]])).toEqual([[a,b,a]]);
  expect(unionTrailLines([[a,b]],[[b,c,d,c,b]])).toEqual([[a,b,c,d,c,b]]);
 });
});
