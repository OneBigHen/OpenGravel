import type { Row } from './types';

/** On the tuning set 10 of the 12 rides with a rider track must pass. Other sizes scale the same ratio. */
export const YARDSTICK_REQUIRED_OF_12 = 10;

export interface YardstickRide { id: string; label: string; riderGoodMiles: number | null; fastestGoodMiles: number | null; beats: boolean }
export interface YardstickResult {
  tracked: number;
  beats: number;
  required: number;
  passed: boolean;
  rides: YardstickRide[];
  message: string;
}

/**
 * Is the measure telling a rider's hand-picked line from the plain fastest road?
 * If the good-miles measure cannot do that on at least 10 of 12 rides, it is not
 * measuring fun, so the run fails. A ride with no measurable rider line counts as a miss.
 */
export function yardstickCheck(rows: readonly Pick<Row, 'ride' | 'riderLine' | 'fastest'>[]): YardstickResult {
  const tracked = rows.filter(row => row.ride.riderTrack);
  const rides = tracked.map(row => {
    const riderGoodMiles = row.riderLine?.goodMiles ?? null;
    const fastestGoodMiles = row.fastest?.goodMiles ?? null;
    return { id: row.ride.id, label: row.ride.label, riderGoodMiles, fastestGoodMiles, beats: riderGoodMiles !== null && fastestGoodMiles !== null && riderGoodMiles > fastestGoodMiles + 1e-9 };
  });
  const beats = rides.filter(r => r.beats).length;
  const required = Math.ceil(tracked.length * YARDSTICK_REQUIRED_OF_12 / 12);
  const passed = tracked.length > 0 && beats >= required;
  const misses = rides.filter(r => !r.beats).map(r => r.label);
  const message = passed
    ? `Yardstick OK: the rider's own line beats fastest on good miles on ${beats} of ${tracked.length} tracked rides (needs ${required}).`
    : `YARDSTICK FAILED: the rider's own line beats fastest on good miles on only ${beats} of ${tracked.length} tracked rides (needs ${required}). `
      + `The measure cannot tell a rider's favourite road from the fastest route, so it is not measuring fun and no win on this scorecard can be trusted yet.`
      + `${misses.length ? ` Missed: ${misses.join('; ')}.` : ''}`;
  return { tracked: tracked.length, beats, required, passed, rides, message };
}
