/**
 * Rider-facing measurement formatting (04-PLANNER-AND-WORKSPACE-UX §11).
 *
 * One owner for "how a number reads", because more than one surface shows the
 * same measurement and they must not disagree: the decision cards, the delta
 * chip, and the deterministic route explanation (`04 §13`) all print the same
 * mile and minute values. `UNKNOWN_VALUE` is the only spelling of "we do not
 * know" — a missing value never prints as `0`.
 *
 * The formatters are pure and locale-free on purpose: a rider's distance is
 * part of a deterministic explanation, so a host locale must not be able to
 * change the sentence (04 §13, `OGV-D-250`).
 */

/** What a missing measurement prints as; never `0`, never an empty cell. */
export const UNKNOWN_VALUE = "Unknown";

export const METERS_PER_MILE = 1609.344;

/** A finite, non-negative measurement; anything else is unknown. */
export function isKnownMeasurement(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** `6480 → "1 h 48 min"`, `2880 → "48 min"`, unknown stays unknown. */
export function formatDuration(seconds: number): string {
  if (!isKnownMeasurement(seconds)) return UNKNOWN_VALUE;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** `125529 → "78 mi"`, sub-10-mile values keep one decimal; unknown stays unknown. */
export function formatDistance(meters: number): string {
  if (!isKnownMeasurement(meters)) return UNKNOWN_VALUE;
  const miles = meters / METERS_PER_MILE;
  return `${miles >= 10 ? Math.round(miles) : Number(miles.toFixed(1))} mi`;
}

/** `+12 min vs Fastest`, or `null` when there is no honest delta to show. */
export function formatAddedTime(
  seconds: number,
  fastestSeconds: number,
): string | null {
  if (!isKnownMeasurement(seconds) || !isKnownMeasurement(fastestSeconds)) {
    return null;
  }
  const deltaMinutes = Math.round((seconds - fastestSeconds) / 60);
  return deltaMinutes > 0 ? `+${deltaMinutes} min vs Fastest` : null;
}
