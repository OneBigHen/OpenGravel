import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../scorecard/rides.json';
import { FROZEN_CURVY_THRESHOLD } from '../../../scripts/scorecard/frozen-threshold';
import { curvyLoopThreshold, CURVY_THRESHOLD_FRACTION, freezeCurvyThreshold, median, renderFrozenThreshold, riderCurvyShares } from '../../../scripts/scorecard/threshold';
import type { Measurement, Ride } from '../../../scripts/scorecard/types';

describe('curvy loop threshold maths', () => {
  it('is 75% of the median rider-line share', () => {
    expect(CURVY_THRESHOLD_FRACTION).toBe(0.75);
    expect(median([0.5, 0.1, 0.3])).toBe(0.3);
    expect(median([0.1, 0.2, 0.3, 0.4])).toBe(0.25);
    expect(curvyLoopThreshold([0.1, 0.2, 0.4, 0.6, 0.8])).toBe(0.3);
    expect(() => median([])).toThrow();
  });
  it('takes shares only from Curvy rides that have a measured rider line', () => {
    const ride = (id: string, mode: Ride['mode'], tracked: boolean): Ride => ({ id, label: id, source: 'catalog', mode, requestId: id, start: { lat: 40, lon: -77 }, ...(tracked ? { riderTrack: { catalogId: id, geometryPolyline: '' } } : {}) });
    const line = (goodShare: number) => ({ goodShare }) as Measurement;
    const shares = riderCurvyShares([
      { ride: ride('a', 'curvy', true), riderLine: line(0.3) },
      { ride: ride('b', 'curvy', true), riderLine: null },
      { ride: ride('c', 'gravel', true), riderLine: line(0.9) },
      { ride: ride('d', 'curvy', false), riderLine: line(0.5) },
    ]);
    expect(shares).toEqual({ a: 0.3 });
  });
  it('renders a source file that round-trips to the same numbers', () => {
    const frozen = freezeCurvyThreshold('abc', { x: 0.2, y: 0.4, z: 0.6 });
    expect(frozen).toMatchObject({ median: 0.4, threshold: 0.3 });
    const text = renderFrozenThreshold(frozen);
    expect(text).toContain('"x": 0.2');
    expect(text).toContain('threshold: 0.3,');
  });
});

describe('the frozen curvy threshold', () => {
  it('was set for exactly this manifest (editing rides.json forces a deliberate re-freeze)', () => {
    const sha = createHash('sha256').update(readFileSync('tests/scorecard/rides.json', 'utf8')).digest('hex');
    expect(FROZEN_CURVY_THRESHOLD.manifestSha256).toBe(sha);
  });
  it('recomputes from the stored rider shares: 75% of their median', () => {
    const shares = Object.values(FROZEN_CURVY_THRESHOLD.riderShares);
    expect(FROZEN_CURVY_THRESHOLD.median).toBeCloseTo(median(shares), 6);
    expect(FROZEN_CURVY_THRESHOLD.threshold).toBeCloseTo(0.75 * median(shares), 6);
    expect(FROZEN_CURVY_THRESHOLD.threshold).toBe(curvyLoopThreshold(shares));
  });
  it('comes from the tracked Curvy rides of the tuning set only, never the hold-out', () => {
    const tuningCurvy = manifest.tuning.filter(r => r.mode === 'curvy' && 'riderTrack' in r && r.riderTrack).map(r => r.id).sort();
    expect(Object.keys(FROZEN_CURVY_THRESHOLD.riderShares).sort()).toEqual(tuningCurvy);
    expect(tuningCurvy).toHaveLength(6);
    for (const r of manifest.holdout) expect(FROZEN_CURVY_THRESHOLD.riderShares).not.toHaveProperty(r.id);
  });
  it('is a sane share between 0 and 1', () => {
    expect(FROZEN_CURVY_THRESHOLD.threshold).toBeGreaterThan(0);
    expect(FROZEN_CURVY_THRESHOLD.threshold).toBeLessThan(1);
  });
});
