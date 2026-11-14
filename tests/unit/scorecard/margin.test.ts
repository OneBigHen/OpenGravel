import { describe, expect, it } from 'vitest';
import { THIN_MARGIN, unmeasuredMargin, winMargin } from '../../../scripts/scorecard/margin';
import { winTieLossV3 } from '../../../scripts/scorecard/scoring';

const SHARE = 0.023924;
const baseline = { minutes: 100, goodMiles: 2, busyShare: 0.1 };
const route = { minutes: 110, goodMiles: 3, goodShare: 0.0245, busyShare: 0.15, trustFailures: [] as string[] };

describe('item c: margin behind rule v3', () => {
  it('does not change rule v3: a thin win is still a Win', () => {
    const curvy = { mode: 'curvy' as const };
    expect(winTieLossV3(curvy, route, baseline, SHARE).verdict).toBe('Win');
    const margin = winMargin(curvy, route, baseline, SHARE);
    expect(margin.thin).toBe(true);
    expect(margin.aboveBar).toBeCloseTo(0, 6);
    expect(margin.bar).toBe('1.5 times fastest good miles');
  });
  it('marks a curvy A-to-B win thin when the share is within 10% of the frozen bar', () => {
    const curvy = { mode: 'curvy' as const };
    const mileTight = winMargin(curvy, { ...route, goodMiles: 3.05, goodShare: SHARE * 1.5 }, baseline, SHARE);
    expect(mileTight.bar).toBe('1.5 times fastest good miles');
    expect(mileTight.thin).toBe(true);
    const shareTight = winMargin(curvy, { ...route, goodMiles: 4, goodShare: SHARE * (1 + THIN_MARGIN - 0.01) }, baseline, SHARE);
    expect(shareTight.bar).toBe('2.39% Curvy bend share');
    expect(shareTight.thin).toBe(true);
  });
  it('does not mark a curvy A-to-B win thin when both bars have 10% room', () => {
    const curvy = { mode: 'curvy' as const };
    const margin = winMargin(curvy, { ...route, goodMiles: 4.5, goodShare: SHARE * (1 + THIN_MARGIN + 0.01) }, baseline, SHARE);
    expect(margin.thin).toBe(false);
    expect(margin.aboveBar).toBeGreaterThanOrEqual(THIN_MARGIN);
  });
  it('marks a dirt A-to-B win thin on either the 1.5x or the +3 miles bar', () => {
    const gravel = { mode: 'gravel' as const };
    const dirtBase = { ...baseline, goodMiles: 2 };
    const thinMiles = winMargin(gravel, { ...route, goodMiles: 5.1, goodShare: 0.3 }, dirtBase, SHARE);
    expect(thinMiles.bar).toBe('3 more good miles than fastest');
    expect(thinMiles.thin).toBe(true);
    const comfortable = winMargin(gravel, { ...route, goodMiles: 6, goodShare: 0.3 }, dirtBase, SHARE);
    expect(comfortable.thin).toBe(false);
  });
  it('marks a loop win thin when it only just clears the dirt share bar', () => {
    const loop = { mode: 'gravel' as const, loopMinutes: 120 };
    const loopBase = { minutes: 120, goodMiles: 5, busyShare: 0.1 };
    const margin = winMargin(loop, { minutes: 120, goodMiles: 20, goodShare: 0.355, busyShare: 0.15 }, loopBase, SHARE);
    expect(margin.bar).toBe('35.00% dirt share');
    expect(margin.thin).toBe(true);
  });
  it('a curvy loop uses the frozen Curvy bar, not the flat dirt 35%', () => {
    const loop = { mode: 'curvy' as const, loopMinutes: 120 };
    const loopBase = { minutes: 120, goodMiles: 5, busyShare: 0.1 };
    const margin = winMargin(loop, { minutes: 120, goodMiles: 20, goodShare: SHARE * 1.05, busyShare: 0.15 }, loopBase, SHARE);
    expect(margin.bar).toBe('2.39% Curvy bend share');
    expect(margin.thin).toBe(true);
  });
  it('uses the roomiest passing loop path, so a comfortable par win is not thin', () => {
    const loop = { mode: 'gravel' as const, loopMinutes: 120 };
    const loopBase = { minutes: 120, goodMiles: 5, busyShare: 0.1 };
    const rider = { goodMiles: 15, goodShare: 0.2 };
    const margin = winMargin(loop, { minutes: 120, goodMiles: 30, goodShare: 0.26, busyShare: 0.15 }, loopBase, SHARE, rider);
    expect(margin.thin).toBe(false);
  });
  it('marks a par win thin when it only just clears the rider line', () => {
    const loop = { mode: 'gravel' as const, loopMinutes: 120 };
    const loopBase = { minutes: 120, goodMiles: 5, busyShare: 0.1 };
    const rider = { goodMiles: 20, goodShare: 0.25 };
    const margin = winMargin(loop, { minutes: 120, goodMiles: 20.2, goodShare: 0.2505, busyShare: 0.15 }, loopBase, SHARE, rider);
    expect(margin.thin).toBe(true);
    expect(margin.bar).toBe("the rider's good share");
  });
  it('has an explicit empty margin for a planning failure', () => {
    expect(unmeasuredMargin()).toEqual({ aboveBar: null, thin: false, bar: null, detail: [] });
  });
});
