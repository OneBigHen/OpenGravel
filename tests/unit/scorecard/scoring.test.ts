import { describe, expect, it } from 'vitest';
import { winTieLoss } from '../../../scripts/scorecard/scoring';
import { deadEndSpurs, uTurns, riderMatch } from '../../../scripts/scorecard/geometry';

const baseline = { minutes: 100, goodMiles: 6, busyShare: 0.1 };
const good = { minutes: 135, goodMiles: 9, goodShare: 0.4, busyShare: 0.2, trustFailures: [] as string[] };
describe('master plan section 5', () => {
  it('wins exactly at all A-to-B boundaries', () => expect(winTieLoss({ mode: 'gravel' }, good, baseline).verdict).toBe('Win'));
  it.each([
    [{ ...good, goodMiles: 8.99 }, 'Tie'],
    [{ ...good, minutes: 135.01 }, 'Loss'],
    [{ ...good, busyShare: 0.201 }, 'Tie'],
    [{ ...good, goodMiles: 5.99 }, 'Loss'],
    [{ ...good, trustFailures: ['sand'] }, 'Loss'],
    [{ ...good, busyShare: null }, 'Tie'],
  ])('handles threshold or trust change %#', (route, expected) => expect(winTieLoss({ mode: 'gravel' }, route, baseline).verdict).toBe(expected));
  it('requires both relative and absolute gains', () => {
    expect(winTieLoss({ mode: 'curvy' }, { ...good, goodMiles: 3 }, { ...baseline, goodMiles: 1 }).verdict).toBe('Tie');
    expect(winTieLoss({ mode: 'curvy' }, { ...good, goodMiles: 23 }, { ...baseline, goodMiles: 20 }).verdict).toBe('Tie');
  });
  it('uses loop share and a relative 15% time tolerance', () => {
    expect(winTieLoss({ mode: 'gravel', loopMinutes: 100 }, { ...good, minutes: 115, goodShare: 0.35 }, baseline).verdict).toBe('Win');
    expect(winTieLoss({ mode: 'curvy', loopMinutes: 100 }, { ...good, minutes: 85, goodShare: 0.25 }, baseline).verdict).toBe('Win');
    expect(winTieLoss({ mode: 'gravel', loopMinutes: 100 }, { ...good, minutes: 85, goodShare: 0.349 }, baseline).verdict).toBe('Tie');
    expect(winTieLoss({ mode: 'curvy', loopMinutes: 100 }, { ...good, minutes: 84.99 }, baseline).verdict).toBe('Loss');
  });
});
const p = (meters: number, north = 0) => ({ lat: 40 + north / 111195, lon: -77 + meters / (111195 * Math.cos(40 * Math.PI / 180)) });
describe('geometric retraced spurs', () => {
  it('detects a 500m out-and-back once despite unequal vertex spacing', () => expect(deadEndSpurs([p(0), p(150), p(500), p(420), p(0), p(-500)])).toBe(1));
  it('detects a branch just over 300 m', () => expect(deadEndSpurs([p(0), p(302), p(0), p(-500)])).toBe(1));
  it('does not count a short branch, straight line, loop, or hairpin', () => {
    expect(deadEndSpurs([p(0), p(250), p(0)])).toBe(0);
    expect(deadEndSpurs([p(0), p(1000)])).toBe(0);
    expect(deadEndSpurs([p(0), p(500), p(500, 500), p(0, 500), p(0)])).toBe(0);
    expect(deadEndSpurs([p(0), p(500), p(500, 80), p(0, 80)])).toBe(0);
  });
  it('does not treat returning to the start as a spur by itself', () => expect(deadEndSpurs([p(0), p(400, 400), p(800), p(0)])).toBe(0));
});
it('counts explicit U-turns, not left/right hairpins', () => expect(uTurns([{ maneuver: 'left' }, { maneuver: 'uturn' }, {}, { maneuver: 'uturn' }])).toBe(2));
it('rider match uses distance samples and does not reward unrelated roads', () => {
  expect(riderMatch([p(0), p(1000)], [p(0), p(1000)])).toBe(1);
  expect(riderMatch([p(0), p(1000)], [p(0, 200), p(1000, 200)])).toBe(0);
});
