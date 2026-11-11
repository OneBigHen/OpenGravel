import type { Measurement, Ride } from './types';

/** Scorecard v1 asked a Curvy loop for 25% bend share, counted as raw Franco bends. */
export const V1_CURVY_LOOP_SHARE = 0.25;

/** Master plan section 5. Loop share replaces the A-to-B baseline gain test.
 * `curvyLoopShare` is the share a Curvy loop must reach: v1 used 0.25, v2 passes the
 * frozen rider-derived threshold (see threshold.ts). Gravel loops stay at 35%. */
export function winTieLoss(ride: Pick<Ride, 'loopMinutes' | 'mode'>, route: Pick<Measurement, 'minutes' | 'goodMiles' | 'goodShare' | 'busyShare' | 'trustFailures'>, baseline: Pick<Measurement, 'minutes' | 'goodMiles' | 'busyShare'>, curvyLoopShare: number = V1_CURVY_LOOP_SHARE): { verdict: 'Win' | 'Tie' | 'Loss'; reasons: string[] } {
  const reasons: string[] = [];
  if (route.trustFailures.length > 0) reasons.push(...route.trustFailures);
  const loop = ride.loopMinutes;
  const over = loop === undefined ? route.minutes > baseline.minutes * 1.35 + 1e-9 : Math.abs(route.minutes - loop) > loop * 0.15 + 1e-9;
  if (over) reasons.push(loop === undefined ? 'More than 35% slower than fastest' : 'Outside 15% of requested loop time');
  if (route.goodMiles + 1e-9 < baseline.goodMiles) reasons.push('Fewer good miles than fastest');
  if (reasons.length > 0) return { verdict: 'Loss', reasons };
  if (route.busyShare === null || baseline.busyShare === null) return { verdict: 'Tie', reasons: ['Busy-road evidence unavailable'] };
  const busyOK = route.busyShare <= baseline.busyShare + 0.1 + 1e-9;
  const gainOK = loop === undefined
    ? route.goodMiles + 1e-9 >= baseline.goodMiles * 1.5 && route.goodMiles - baseline.goodMiles + 1e-9 >= 3
    : route.goodShare + 1e-9 >= (ride.mode === 'curvy' ? curvyLoopShare : 0.35);
  return busyOK && gainOK ? { verdict: 'Win', reasons: [] } : { verdict: 'Tie', reasons: [!busyOK ? 'Busy share more than 10 points worse' : 'Good miles below win threshold'] };
}

/** The measurement as scorecard v1 saw it: Franco v1 bend miles stand in for good miles. */
export function asV1<T extends Pick<Measurement, 'goodMiles' | 'goodShare' | 'v1GoodMiles' | 'v1GoodShare'>>(m: T): T {
  return { ...m, goodMiles: m.v1GoodMiles, goodShare: m.v1GoodShare };
}
