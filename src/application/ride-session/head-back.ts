/**
 * Which way is the route? Off the line, the top card has to say it in one
 * glance ("Head back to Main St" / "Turn around"), so this turns the rider's
 * position, their direction of travel and the route line into one of four
 * answers. Pure: no clock, no map, no store.
 */

import type { Coordinate } from "@/domain/ride/types";

export type HeadBackGlyph = "left" | "right" | "straight" | "uturn";

export interface HeadBackDirection {
  readonly glyph: HeadBackGlyph;
  /** Straight-line metres to the nearest point of the route. */
  readonly meters: number;
}

/** More than this far from the direction of travel is "behind you". */
const TURN_AROUND_DEGREES = 120;
/** Within this of the direction of travel is "ahead". */
const AHEAD_DEGREES = 35;

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * The glyph and distance to the nearest point of `line` from `position`, given
 * the rider's heading. With no heading (stopped, or no fix of travel) the way
 * back is "straight": the card still names the road, it just cannot say left
 * or right, and it never guesses.
 */
export function headBackDirection(
  line: readonly Coordinate[],
  position: Coordinate,
  headingDegrees: number | null,
): HeadBackDirection | null {
  if (line.length < 2) return null;
  const cosLat = Math.cos((position.lat * Math.PI) / 180);
  const metersPerDegree = 111_320;
  let best: { readonly x: number; readonly y: number; readonly meters: number } | null = null;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]!;
    const b = line[index]!;
    // Metres east/north of the rider.
    const ax = (a.lon - position.lon) * cosLat * metersPerDegree;
    const ay = (a.lat - position.lat) * metersPerDegree;
    const bx = (b.lon - position.lon) * cosLat * metersPerDegree;
    const by = (b.lat - position.lat) * metersPerDegree;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const x = ax + dx * t;
    const y = ay + dy * t;
    const meters = Math.hypot(x, y);
    if (best === null || meters < best.meters) best = { x, y, meters };
  }
  if (best === null) return null;
  if (headingDegrees === null || !Number.isFinite(headingDegrees)) return { glyph: "straight", meters: best.meters };
  // Compass bearing of the route's nearest point, then relative to travel.
  const bearing = (degrees(Math.atan2(best.x, best.y)) + 360) % 360;
  const relative = ((bearing - headingDegrees + 540) % 360) - 180;
  const glyph: HeadBackGlyph =
    Math.abs(relative) > TURN_AROUND_DEGREES
      ? "uturn"
      : Math.abs(relative) <= AHEAD_DEGREES
        ? "straight"
        : relative < 0
          ? "left"
          : "right";
  return { glyph, meters: best.meters };
}
