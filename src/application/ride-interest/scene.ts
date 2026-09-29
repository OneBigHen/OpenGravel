/**
 * Ride-interest points on the map (OGV#13): reuses the places pill/dot
 * layer rather than a second renderer — a dot at low zoom (icon-only while
 * moving), a named pill once the rider is close enough to have stopped
 * (OGV-D-274's existing zoom split). Nearest-ahead points read as more
 * prominent, the same "live" emphasis a happy-hour pin gets right now.
 */

import { asPlaceId, type PlaceScene, type PlaceTone } from "@/application/places";

import type { AheadRideInterestPoint } from "./ahead-of-rider";

export interface RideInterestSceneOptions {
  /** A `RideInterestPoint.id`, compared before it is cast to the renderer's branded `PlaceId`. */
  readonly selectedId?: string | null;
  /** Cap on pins; farther-ahead points are thinned first (`ahead` is nearest-first). */
  readonly maxPins?: number;
}

export const DEFAULT_RIDE_INTEREST_MAX_PINS = 60;

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
