/**
 * What a rider's screen sends when it starts a live link, beyond their name.
 *
 * Two things travel with a link and both are the rider's own data: the line they
 * planned to ride (so a follower sees the road ahead, not just the dot), and the
 * finish time they expect. Keeping the projection here — one pure function,
 * tested without a browser — means the panel, the API and the follower page
 * cannot disagree about what was shared.
 *
 * The line is thinned before it goes: the server refuses more than 5,000
 * positions, the route store holds far more than that for a long ride, and a
 * follower's phone draws a line rather than an archive. Evenly spaced points keep
 * the shape (the corners the pen and the router drew) while dropping the
 * survey-grade detail nobody can see at map zoom.
 */

import type { LiveRouteGeometry } from "@/domain/live/types";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The most positions one live share carries. Below the server's ceiling on
 * purpose, so a long ride is thinned here rather than refused there — and well
 * below it because the follower page re-reads the whole snapshot on every poll
 * (10 s), so every extra position is paid for again while the page is open.
 */
export const LIVE_SHARE_ROUTE_POINTS = 1_000;

/** A line a follower's map can draw, or `null` when there is no line to draw. */
export function shareRouteGeometry(
  line: readonly Coordinate[],
  maxPoints: number = LIVE_SHARE_ROUTE_POINTS,
): LiveRouteGeometry | null {
  if (line.length < 2) return null;
  const limit = Math.max(2, Math.floor(maxPoints));
  if (line.length <= limit) return { segments: [line.map((point) => ({ lon: point.lon, lat: point.lat }))] };
  const step = (line.length - 1) / (limit - 1);
  const kept: Coordinate[] = [];
  for (let index = 0; index < limit; index += 1) {
    const point = line[Math.round(index * step)];
    if (point !== undefined) kept.push({ lon: point.lon, lat: point.lat });
  }
  return { segments: [kept] };
}
