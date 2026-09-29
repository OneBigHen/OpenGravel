/** A rider-facing row for one provider place located along a selected route. */

import { cheapestSpecialLine } from "./place-scene";
import type { NearbyPlace, PlaceId } from "./types";
import type { StopId } from "@/domain/ride/ids";

export interface AlongRouteRow {
  readonly id: PlaceId;
  readonly mileLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly when: string;
  readonly live: boolean;
  readonly offRoute: string;
  readonly place: NearbyPlace;
}

export interface AlongRouteRowsOptions {
  readonly limit?: number;
}

function specialLine(place: NearbyPlace): string | null {
  return cheapestSpecialLine(place.specials) ?? place.specials[0] ?? null;
}

function whenFor(place: NearbyPlace): string {
  if (place.kind === "event") return place.label;
  if (place.status === "now") return `On now · until ${place.label.replace(/^Til\s+/i, "")}`;
  return `Today ${place.label}`;
}

function offRouteFor(place: NearbyPlace): string {
  if (place.offRouteMiles === null || !Number.isFinite(place.offRouteMiles)) {
    return "Distance unavailable";
  }
  return place.offRouteMiles < 0.1 ? "On your route" : `${place.offRouteMiles.toFixed(1)} mi off`;
}

function mileLabelFor(routeMile: number | null): string {
  if (routeMile === null || !Number.isFinite(routeMile)) return "Mile unavailable";
  return routeMile < 0.5 ? "At the start" : `Mile ${Math.round(routeMile)}`;
}

/** Sorts places into route order, removes duplicate ids, and hides ended events. */
export function alongRouteRows(
  places: readonly NearbyPlace[],
  options: AlongRouteRowsOptions = {},
): readonly AlongRouteRow[] {
  const ordered = places
    .map((place, sourceOrder) => ({ place, sourceOrder }))
    .filter(({ place }) => place.status !== "done")
    .sort((left, right) => {
      const leftMile = left.place.routeMile;
      const rightMile = right.place.routeMile;
      if (leftMile === null || !Number.isFinite(leftMile)) {
        return rightMile === null || !Number.isFinite(rightMile) ? left.sourceOrder - right.sourceOrder : 1;
      }
      if (rightMile === null || !Number.isFinite(rightMile)) return -1;
      return leftMile - rightMile || left.sourceOrder - right.sourceOrder;
    });
  const seen = new Set<PlaceId>();
  const rows: AlongRouteRow[] = [];

  for (const { place } of ordered) {
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    rows.push({
      id: place.id,
      mileLabel: mileLabelFor(place.routeMile),
      title: place.name,
      detail: specialLine(place) ?? place.schedule ?? place.label,
      when: whenFor(place),
      live: place.status === "now",
      offRoute: offRouteFor(place),
      place,
    });
  }

  return rows.slice(0, Math.max(0, Math.trunc(options.limit ?? 8)));
}

/** Inserts a route place before the next later stop; unknown positions append. */
export function stopInsertionForRouteMile(
  stops: readonly { readonly id: StopId; readonly routeMile: number | null }[],
  routeMile: number,
): StopId | undefined {
  if (stops.some((stop) => stop.routeMile === null || !Number.isFinite(stop.routeMile))) {
    return undefined;
  }
  return stops.find((stop) =>
    stop.routeMile !== null && Number.isFinite(stop.routeMile) && stop.routeMile > routeMile,
  )?.id;
}
