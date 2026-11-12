import { describe, expect, it } from 'vitest';
import { winTieLoss, winTieLossV3 } from '../../../scripts/scorecard/scoring';

const SHARE = 0.023924;
const baseline = { minutes: 100, goodMiles: 2, busyShare: 0.1 };
const route = { minutes: 110, goodMiles: 3, goodShare: 0.03, busyShare: 0.15, trustFailures: [] as string[] };

describe('rule v3: curvy A-to-B judged on share', () => {
  const curvy = { mode: 'curvy' as const };
  it('wins on share and 1.5 times fastest, without the +3 miles v2 asks for', () => {
    expect(winTieLoss(curvy, route, baseline, SHARE).verdict).toBe('Tie');
    expect(winTieLossV3(curvy, route, baseline, SHARE).verdict).toBe('Win');
  });
  it('ties when the share is under the frozen bar', () => expect(winTieLossV3(curvy, { ...route, goodShare: 0.023 }, baseline, SHARE).verdict).toBe('Tie'));
  it('ties when under 1.5 times fastest', () => expect(winTieLossV3(curvy, { ...route, goodMiles: 2.99 }, baseline, SHARE).verdict).toBe('Tie'));
  it('keeps trust, time and fewer-good-miles losses', () => {
    expect(winTieLossV3(curvy, { ...route, trustFailures: ['sand'] }, baseline, SHARE).verdict).toBe('Loss');
    expect(winTieLossV3(curvy, { ...route, minutes: 135.01 }, baseline, SHARE).verdict).toBe('Loss');
    expect(winTieLossV3(curvy, { ...route, goodMiles: 1.9 }, baseline, SHARE).verdict).toBe('Loss');
  });
  it('keeps the busy test', () => expect(winTieLossV3(curvy, { ...route, busyShare: 0.21 }, baseline, SHARE).verdict).toBe('Tie'));
  it('ties when busy evidence is unavailable', () => expect(winTieLossV3(curvy, { ...route, busyShare: null }, baseline, SHARE).verdict).toBe('Tie'));
});

describe('rule v3: dirt A-to-B is unchanged', () => {
  const gravel = { mode: 'gravel' as const };
  const dirtRoute = { ...route, goodMiles: 9, goodShare: 0.4 };
  const dirtBase = { ...baseline, goodMiles: 6 };
  it('still needs 1.5 times and +3 miles', () => {
    expect(winTieLossV3(gravel, dirtRoute, dirtBase, SHARE).verdict).toBe('Win');
    expect(winTieLossV3(gravel, { ...dirtRoute, goodMiles: 8.99 }, dirtBase, SHARE).verdict).toBe('Tie');
    expect(winTieLossV3(gravel, { ...dirtRoute, goodMiles: 3.5 }, { ...dirtBase, goodMiles: 2 }, SHARE).verdict).toBe('Tie');
    expect(winTieLossV3({ mode: 'dual-sport' }, dirtRoute, dirtBase, SHARE).verdict).toBe(winTieLoss({ mode: 'dual-sport' }, dirtRoute, dirtBase, SHARE).verdict);
  });
});

describe('rule v3: loops with a rider line', () => {
  const loop = { mode: 'gravel' as const, loopMinutes: 100 };
  const base = { minutes: 100, goodMiles: 5, busyShare: 0.1 };
  const rider = { goodMiles: 20, goodShare: 0.25 };
  const mine = { minutes: 100, goodMiles: 28, goodShare: 0.26, busyShare: 0.1, trustFailures: [] as string[] };
  it('v2 ties under the flat 35% share, v3 wins at par with the rider', () => {
    expect(winTieLoss(loop, mine, base).verdict).toBe('Tie');
    expect(winTieLossV3(loop, mine, base, SHARE, rider).verdict).toBe('Win');
  });
  it('par needs both miles and share', () => {
    expect(winTieLossV3(loop, { ...mine, goodMiles: 19.9 }, base, SHARE, rider).verdict).toBe('Tie');
    expect(winTieLossV3(loop, { ...mine, goodShare: 0.24 }, base, SHARE, rider).verdict).toBe('Tie');
  });
  it('a shorter loop with a higher share but fewer miles than the rider does not win', () => {
    expect(winTieLossV3(loop, { ...mine, goodMiles: 12, goodShare: 0.3 }, base, SHARE, rider).verdict).toBe('Tie');
  });
  it('par also needs 1.5 times the fastest loop', () => {
    expect(winTieLossV3(loop, { ...mine, goodMiles: 22 }, { ...base, goodMiles: 15 }, SHARE, rider).verdict).toBe('Tie');
  });
  it('without a rider line, a loop is judged as in v2', () => {
    expect(winTieLossV3(loop, mine, base, SHARE, null).verdict).toBe('Tie');
    expect(winTieLossV3(loop, { ...mine, goodShare: 0.36 }, base, SHARE, null).verdict).toBe('Win');
    expect(winTieLossV3({ mode: 'curvy', loopMinutes: 100 }, { ...mine, goodShare: 0.03 }, base, SHARE, null).verdict).toBe('Win');
  });
  it('par still respects trust and the busy test', () => {
    expect(winTieLossV3(loop, { ...mine, trustFailures: ['sand'] }, base, SHARE, rider).verdict).toBe('Loss');
    expect(winTieLossV3(loop, { ...mine, busyShare: 0.3 }, base, SHARE, rider).verdict).toBe('Tie');
  });
});
