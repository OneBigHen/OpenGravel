import { expect, it } from 'vitest';
import manifest from '../../scorecard/rides.json';
import { decodeCatalogPolyline } from '../../../src/application/explore/catalog-build';
import { haversine } from '../../../src/domain/geometry/analysis';

it('freezes two 20-ride sets with disjoint catalog tracks and corpus pairs', () => {
  for (const rides of [manifest.tuning, manifest.holdout]) {
    expect(rides).toHaveLength(20);
    expect(new Set(rides.map(r => r.requestId)).size).toBe(20);
    expect(rides.filter(r => r.source === 'catalog')).toHaveLength(12);
    expect(rides.filter(r => r.source === 'benchmark')).toHaveLength(4);
    expect(rides.filter(r => r.source === 'corpus')).toHaveLength(4);
    const dirtCatalog = rides.filter(r => r.source === 'catalog' && r.mode !== 'curvy');
    expect(dirtCatalog).toHaveLength(6);
    for (const ride of dirtCatalog) expect(ride).toHaveProperty('loopMinutes');
    for (const ride of rides) {
      expect(ride.requestId).toContain('scorecard:v1:');
      expect(ride).toHaveProperty('start');
      expect('end' in ride || 'loopMinutes' in ride).toBe(true);
      if ('riderTrack' in ride && ride.riderTrack) {
        const track = decodeCatalogPolyline(ride.riderTrack.geometryPolyline);
        expect(track.length).toBeGreaterThan(2);
        expect(haversine(track[0]!, ride.start)).toBeLessThan(1);
      }
    }
  }
  const tuning = new Set(manifest.tuning.filter(r => r.source !== 'benchmark').map(r => r.id));
  expect(manifest.holdout.filter(r => r.source !== 'benchmark').some(r => tuning.has(r.id))).toBe(false);
  expect(new Set([...manifest.tuning, ...manifest.holdout].map(r => r.requestId)).size).toBe(40);
});
