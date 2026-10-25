/**
 * Even thinning for a live ride's trail.
 *
 * A live ride can accumulate 20,000 points, and a follower on a phone must not
 * download that to draw a line. Thinning keeps the shape of the route and loses
 * only detail: the first and last points always survive (the last one is where
 * the rider *is*), and the rest are taken at an even stride. A point that is
 * dropped is dropped; nothing is interpolated, so a thinned trail is always a
 * subset of what the rider actually reported.
 */

/**
 * `items`, or at most `max` of them taken at even intervals.
 *
 * `max` is clamped to at least one. When the list already fits it is returned
 * as-is, so a short ride's trail is never resampled for no reason.
 */
export function thinEvenly<T>(items: readonly T[], max: number): readonly T[] {
  const limit = Math.max(1, Math.floor(max));
  if (items.length <= limit) return items;
  if (limit === 1) return items.slice(-1);
  const last = items.length - 1;
  const kept: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    const at = Math.round((index * last) / (limit - 1));
    const item = items[at];
    if (item !== undefined) kept.push(item);
  }
  return kept;
}
