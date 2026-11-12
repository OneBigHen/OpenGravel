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

type RiderBar = Pick<Measurement, 'goodMiles' | 'goodShare'>;

/**
 * Scorecard rule v3 (routing master plan section 2). Same as `winTieLoss` (v2) except two gain tests:
 * - A curvy A-to-B ride is judged like a curvy loop: good share at or above the frozen rider bar and
 *   at least 1.5 times the fastest route's good miles. Dirt A-to-B keeps "1.5 times and +3 miles".
 * - A loop that has a measured rider line also wins at par with it: at least the rider's good miles AND
 *   at least the rider's good share, and at least 1.5 times the fastest loop's good miles.
 * Trust, time budget, "not fewer than fastest" and the busy test are unchanged. v2 stays printed beside it.
 */
export function winTieLossV3(ride: Pick<Ride, 'loopMinutes' | 'mode'>, route: Pick<Measurement, 'minutes' | 'goodMiles' | 'goodShare' | 'busyShare' | 'trustFailures'>, baseline: Pick<Measurement, 'minutes' | 'goodMiles' | 'busyShare'>, curvyLoopShare: number, riderLine: RiderBar | null = null): { verdict: 'Win' | 'Tie' | 'Loss'; reasons: string[] } {
  const v2 = winTieLoss(ride, route, baseline, curvyLoopShare);
  if (v2.verdict === 'Loss') return v2;
  if (route.busyShare === null || baseline.busyShare === null) return v2;
  const busyOK = route.busyShare <= baseline.busyShare + 0.1 + 1e-9;
  const isLoop = ride.loopMinutes !== undefined;
  const oneAndHalf = route.goodMiles + 1e-9 >= baseline.goodMiles * 1.5;
  let gainOK: boolean;
  if (!isLoop && ride.mode === 'curvy') gainOK = route.goodShare + 1e-9 >= curvyLoopShare && oneAndHalf;
  else if (!isLoop) gainOK = oneAndHalf && route.goodMiles - baseline.goodMiles + 1e-9 >= 3;
  else {
    const share = route.goodShare + 1e-9 >= (ride.mode === 'curvy' ? curvyLoopShare : 0.35);
    const par = riderLine !== null && route.goodMiles + 1e-9 >= riderLine.goodMiles && route.goodShare + 1e-9 >= riderLine.goodShare && oneAndHalf;
    gainOK = share || par;
  }
  return busyOK && gainOK ? { verdict: 'Win', reasons: [] } : { verdict: 'Tie', reasons: [!busyOK ? 'Busy share more than 10 points worse' : 'Good miles below win threshold'] };
}
