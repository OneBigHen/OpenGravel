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

/** `96 h+` reads in days: `273600 → "3 d 4 h"`; shorter spans read like {@link formatDuration}. */
export function formatLongDuration(seconds: number): string {
  if (!isKnownMeasurement(seconds) || seconds < 86_400) return formatDuration(seconds);
  const hours = Math.round(seconds / 3600);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
}

/** `4383.6 m → "14,382 ft"`: whole feet with a comma every three digits, locale-free. */
export function formatFeet(meters: number): string {
  if (!Number.isFinite(meters)) return UNKNOWN_VALUE;
  return `${String(Math.round(meters * 3.28084)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ft`;
}

/** `125529 → "78 mi"`, sub-10-mile values keep one decimal; unknown stays unknown. */
export function formatDistance(meters: number): string {
  if (!isKnownMeasurement(meters)) return UNKNOWN_VALUE;
  const miles = meters / METERS_PER_MILE;
  return `${miles >= 10 ? Math.round(miles) : Number(miles.toFixed(1))} mi`;
}

/**
 * The added time over the fastest route, in whole minutes: `0` for the fastest
 * itself, `null` when either duration is unmeasured.
 *
 * It exists beside the label so a surface that *compares* two routes (which of
 * these is quickest) reads the same number the label prints, instead of
 * parsing the sentence back into a quantity.
 */
export function addedMinutes(
  seconds: number,
  fastestSeconds: number,
): number | null {
  if (!isKnownMeasurement(seconds) || !isKnownMeasurement(fastestSeconds)) {
    return null;
  }
  return Math.max(0, Math.round((seconds - fastestSeconds) / 60));
}

/** `+12 min vs Fastest`, or `null` when there is no honest delta to show. */
export function formatAddedTime(
  seconds: number,
  fastestSeconds: number,
): string | null {
  const deltaMinutes = addedMinutes(seconds, fastestSeconds);
  return deltaMinutes === null || deltaMinutes === 0
    ? null
    : `+${deltaMinutes} min vs Fastest`;
}
