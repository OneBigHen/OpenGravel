import type { Measurement, Ride } from './types';

/** Master plan section 5. Loop share replaces the A-to-B baseline gain test. */
export function winTieLoss(ride: Pick<Ride, 'loopMinutes' | 'mode'>, route: Pick<Measurement, 'minutes' | 'goodMiles' | 'goodShare' | 'busyShare' | 'trustFailures'>, baseline: Pick<Measurement, 'minutes' | 'goodMiles' | 'busyShare'>): { verdict: 'Win' | 'Tie' | 'Loss'; reasons: string[] } {
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
    : route.goodShare + 1e-9 >= (ride.mode === 'curvy' ? 0.25 : 0.35);
  return busyOK && gainOK ? { verdict: 'Win', reasons: [] } : { verdict: 'Tie', reasons: [!busyOK ? 'Busy share more than 10 points worse' : 'Good miles below win threshold'] };
}
