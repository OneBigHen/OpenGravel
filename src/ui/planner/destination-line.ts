/**
 * What a ride is called, in one place (round 3, restructure call 3).
 *
 * A ride that carries its own name — a curated "Ride this", a saved ride, an
 * imported track — is called by that name, never "To <place>". An unnamed ride
 * is named by where it goes: "To Hawk Mountain" for a destination, "Loop from
 * Jim Thorpe" for a loop. A pin the rider did not drop, or no point at all, is
 * not a name, so it falls back to the ride's own title and then to nothing;
 * the summary prints "Your ride" rather than an invented place.
 *
 * The same rule names the one-tap save (see {@link automaticRideName}): a place
 * and a shape, for example "Rothrock loop, 53 mi".
 */
import {
  DROPPED_PIN_LABEL,
  YOUR_LOCATION_LABEL,
  NO_FINISH_LABEL,
  NO_START_LABEL,
} from "@/application/planner/planner-view-model";

const UNNAMED_PLACES: readonly string[] = [
  NO_FINISH_LABEL,
  NO_START_LABEL,
  DROPPED_PIN_LABEL,
  // "Your location" names the rider, not a place a ride could be called after.
  YOUR_LOCATION_LABEL,
  "My location",
  "From your sketch",
  "",
];

function placeName(placeLabel: string): string | null {
  const label = placeLabel.trim();
  if (UNNAMED_PLACES.includes(label)) return null;
  return label.split(",")[0]?.trim() || label;
}

export function destinationLineFor(input: {
  readonly placeLabel: string;
  readonly loopRide: boolean;
  readonly rideTitle: string | null | undefined;
}): string | null {
  const title = input.rideTitle?.trim() ?? "";
  if (title.length > 0) return title;
  const place = placeName(input.placeLabel);
  if (place === null) return null;
  return `${input.loopRide ? "Loop from" : "To"} ${place}`;
}

/** Whole miles (at least 1), or `null` when the ride's length is not measured. */
function miles(distanceMeters: number | null | undefined): number | null {
  if (distanceMeters === null || distanceMeters === undefined) return null;
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  return Math.max(1, Math.round(distanceMeters / 1609.344));
}

/**
 * The name one Save tap writes (round 3, restructure call 4): place and shape,
 * for example "Rothrock loop, 53 mi" or "To Hawk Mountain, 40 mi". A ride that
 * already has a name keeps it and gains its length once; a ride with no place
 * worth naming is "My loop" or "My ride".
 */
export function automaticRideName(input: {
  readonly rideTitle: string | null | undefined;
  readonly placeLabel: string;
  readonly loopRide: boolean;
  readonly distanceMeters?: number | null;
}): string {
  const title = input.rideTitle?.trim() ?? "";
  if (/, \d+ mi$/.test(title)) return title;
  const place = placeName(input.placeLabel);
  const base = title.length > 0
    ? title
    : place === null
      ? input.loopRide ? "My loop" : "My ride"
      : input.loopRide
        ? /\bloop$/i.test(place) ? place : `${place} loop`
        : `To ${place}`;
  const length = miles(input.distanceMeters);
  return length === null ? base : `${base}, ${length} mi`;
}
