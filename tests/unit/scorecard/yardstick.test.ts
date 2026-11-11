import { describe, expect, it } from 'vitest';
import { yardstickCheck } from '../../../scripts/scorecard/yardstick';
import type { Measurement, Ride, Row } from '../../../scripts/scorecard/types';

const m = (goodMiles: number): Measurement => ({ goodMiles } as Measurement);
const tracked = (i: number): Ride => ({ id: `t${i}`, label: `Tracked ${i}`, source: 'catalog', mode: 'curvy', requestId: `r${i}`, start: { lat: 40, lon: -77 }, riderTrack: { catalogId: `t${i}`, geometryPolyline: '' } });
const untracked: Ride = { id: 'u', label: 'Untracked', source: 'corpus', mode: 'curvy', requestId: 'u', start: { lat: 40, lon: -77 } };
type Input = Pick<Row, 'ride' | 'riderLine' | 'fastest'>;
const rowsWith = (riderBeats: number, total = 12): Input[] => [
  ...Array.from({ length: total }, (_, i) => ({ ride: tracked(i), riderLine: m(i < riderBeats ? 10 : 2), fastest: m(5) })),
  { ride: untracked, riderLine: null, fastest: m(1) },
];
describe('yardstick check', () => {
  it('passes at exactly 10 of 12 and ignores rides with no rider track', () => {
    const result = yardstickCheck(rowsWith(10));
    expect(result).toMatchObject({ tracked: 12, beats: 10, required: 10, passed: true });
    expect(result.message).toContain('10 of 12');
  });
  it('fails at 9 of 12 and says why in plain words', () => {
    const result = yardstickCheck(rowsWith(9));
    expect(result.passed).toBe(false);
    expect(result.message).toContain('YARDSTICK FAILED');
    expect(result.message).toContain('not measuring fun');
    expect(result.message).toContain('Tracked 11');
  });
  it('needs the rider line to be strictly better, not equal', () => {
    const rows = rowsWith(12).map(r => ({ ...r, riderLine: m(5) }));
    expect(yardstickCheck(rows).beats).toBe(0);
  });
  it('counts an unmeasured rider line or baseline as a miss, never a pass', () => {
    const rows = rowsWith(12);
    rows[0] = { ...rows[0]!, riderLine: null };
    rows[1] = { ...rows[1]!, fastest: null };
    const result = yardstickCheck(rows);
    expect(result.beats).toBe(10);
    expect(result.rides[0]!.beats).toBe(false);
    expect(result.rides[1]!.beats).toBe(false);
  });
  it('fails when there is nothing to check', () => expect(yardstickCheck([{ ride: untracked, riderLine: null, fastest: m(1) }]).passed).toBe(false));
});
