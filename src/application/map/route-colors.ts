/**
 * The colour of each ride choice, one rule for the map and the sheet (PF-8).
 *
 * The chosen ride is plum. Every other choice takes one of three colours by its
 * `tint` (its index in the bundle): tint % 3 === 1 is teal, 2 is amber, 0 is sky.
 * The map paints its lines and tags with {@link alternativeTintMatch}; the
 * Compare rows paint their bar with {@link alternativeRouteColor}. Both read
 * {@link alternativeColorIndex}, so the teal line is always the teal row.
 */

/** Alternative ride colours: teal, amber, sky. None is the ride plum, the
 * rider-position blue, the twisty-layer red or the gravel brown. */
export const ALTERNATIVE_COLORS = ["#0e9488", "#d97706", "#0284c7"] as const;

/** Which of {@link ALTERNATIVE_COLORS} a choice with this tint is drawn in. */
export function alternativeColorIndex(tint: number | undefined): 0 | 1 | 2 {
  // The map coalesces a missing tint to 1; the row does the same.
  const slot = (((tint ?? 1) % 3) + 3) % 3;
  return slot === 1 ? 0 : slot === 2 ? 1 : 2;
}

/** The hex colour of an alternative ride's line. */
export function alternativeRouteColor(tint: number | undefined): string {
  return ALTERNATIVE_COLORS[alternativeColorIndex(tint)];
}

/**
 * The same rule as a MapLibre expression over a feature's `tint`, returning
 * `values[alternativeColorIndex(tint)]`.
 */
export function alternativeTintMatch<T>(values: readonly [T, T, T]): unknown[] {
  return ["match", ["%", ["coalesce", ["get", "tint"], 1], 3], 1, values[0], 2, values[1], values[2]];
}
