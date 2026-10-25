/**
 * Ride-interest points on the map (OGV#13): reuses the places pill/dot
 * layer rather than a second renderer — a dot at low zoom (icon-only while
 * moving), a named pill once the rider is close enough to have stopped
 * (OGV-D-274's existing zoom split). Nearest-ahead points read as more
 * prominent, the same "live" emphasis a happy-hour pin gets right now.
 *
 * What the ride map puts in that layer at all is `rideMapInterestPoints`: gas,
 * and the pin the rider opened — not every landmark the sheet can tell them
 * about.
 */

import { asPlaceId, type PlaceScene, type PlaceTone } from "@/application/places";

import type { AheadRideInterestPoint } from "./ahead-of-rider";
import type { RideInterestFilter, RideInterestPoint } from "./types";

export interface RideInterestSceneOptions {
  /** A `RideInterestPoint.id`, compared before it is cast to the renderer's branded `PlaceId`. */
  readonly selectedId?: string | null;
  /** Cap on pins; farther-ahead points are thinned first (`ahead` is nearest-first). */
  readonly maxPins?: number;
}

export interface RideMapInterestOptions {
  /** The point the rider opened: its pin stays on the map wherever it sits. */
  readonly selectedId?: string | null;
  /** The sheet's own filter; `"off"` means no pins, however useful gas is. */
  readonly filter: RideInterestFilter;
}

export const DEFAULT_RIDE_INTEREST_MAX_PINS = 60;

/**
 * Which ride-interest points the ride map draws at all: gas, and the one the
 * rider opened. A landmark's name and mileage reads well in the sheet's
 * "coming up" row, where a rider looks on purpose; as a pill pinned over the
 * line — a museum, a gallery, 0.9 mi each — it was the clutter a rider reported
 * on a 61 mi loop. Gas is the one thing along the road a rider needs marked
 * without asking; the rest is a tap away in the sheet.
 */
export function rideMapInterestPoints(
  points: readonly RideInterestPoint[],
  options: RideMapInterestOptions,
): readonly RideInterestPoint[] {
  const selectedId = options.selectedId ?? null;
  if (options.filter === "off" && selectedId === null) return [];
  return points.filter((point) => point.id === selectedId || point.kind === "fuel");
}

function toneFor(aheadMiles: number): PlaceTone {
  if (aheadMiles <= 0.5) return "live";
  if (aheadMiles <= 3) return "soon";
  return "quiet";
}

function milesText(miles: number): string {
  return miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
}

export function buildRideInterestScene(
  ahead: readonly AheadRideInterestPoint[],
  options: RideInterestSceneOptions = {},
): readonly PlaceScene[] {
  const selectedId = options.selectedId ?? null;
  return ahead.slice(0, options.maxPins ?? DEFAULT_RIDE_INTEREST_MAX_PINS).map((entry) => {
    const tone = toneFor(entry.aheadMiles);
    const selected = entry.point.id === selectedId;
    return {
      id: asPlaceId(entry.point.id),
      kind: entry.point.kind,
      coordinate: entry.point.coordinate,
      pill: `${entry.point.name} · ${milesText(entry.aheadMiles)} mi`,
      tone,
      priority: (tone === "live" ? 300 : tone === "soon" ? 200 : 100) + (selected ? 1000 : 0),
      selected,
    };
  });
}
