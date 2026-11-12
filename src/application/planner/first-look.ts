/**
 * The one announced swap (next round N1, DESIGN.md decision log).
 *
 * The first answer is shown as a "First look" while the full search runs. When
 * the settled pick is a different route, the swap happens once and the rider
 * is told what improved, from measured numbers only. Nothing is said when the
 * settled pick is the same route, when nothing measurable improved, or when the
 * rider already chose a route themselves.
 */

/** The measured facts of one card that the note may compare. */
export interface FirstLookFacts {
  readonly routeId: string;
  readonly distanceMeters: number;
  /** Miles of gravel or dirt, or `null` when not measured. */
  readonly unpavedMi: number | null;
  /** Miles through bends, or `null` when not measured. */
  readonly curvyMi: number | null;
}

const METERS_PER_MILE = 1609.344;

function unpavedPercent(facts: FirstLookFacts): number | null {
  if (facts.unpavedMi === null || facts.distanceMeters <= 0) return null;
  return Math.round((facts.unpavedMi * METERS_PER_MILE * 100) / facts.distanceMeters);
}

/**
 * One line naming what the settled pick improved over the first look, or
 * `null`. Dirt share is named first (it is the reason most riders choose a
 * loop here), then bend miles; a change must be at least 3 points or 1 mile
 * to be worth a sentence.
 */
export function firstLookSwapNote(first: FirstLookFacts, settled: FirstLookFacts): string | null {
  if (first.routeId === settled.routeId) return null;
  const was = unpavedPercent(first);
  const now = unpavedPercent(settled);
  if (was !== null && now !== null && now - was >= 3) return `Now ${now}% dirt, was ${was}%`;
  if (first.curvyMi !== null && settled.curvyMi !== null && settled.curvyMi - first.curvyMi >= 1) {
    return `Now ${settled.curvyMi.toFixed(1)} mi of bends, was ${first.curvyMi.toFixed(1)}`;
  }
  return null;
}
