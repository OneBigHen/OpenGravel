/**
 * How answers from more than one place source become one list.
 *
 * Two providers can now answer a search: Photon (places and addresses) and
 * TomTom (nearby businesses, when the deployment has a key). The rider sees one
 * list, so the list needs rules that are about the rider's geography rather than
 * about either provider:
 *
 * - **Distance sanity.** A rider searching from Jim Thorpe, Pennsylvania does
 *   not mean Utah. When the answers include something within 300 km, farther
 *   answers are noise (a name match somewhere else) and are dropped. When
 *   *nothing* is close, the far answers are all there is: "Tokyo" from
 *   Pennsylvania must still be findable, so they stay.
 * - **Nearest first, when relevance is otherwise similar.** The list is
 *   stable-sorted into distance bands, so a 5 km coffee shop precedes a 120 km
 *   namesake without disturbing the provider's own relevance order inside a
 *   band.
 * - **One place, one row.** The same business is usually in both providers;
 *   the same name within 200 m is one place, and the first source's version
 *   wins (POI answers lead, because they are what a brand query asked for).
 *
 * Nothing here promotes a provider fact to a different claim: the rows keep
 * their own `provider` and coordinates.
 */

import type { PlaceMatch } from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";

/** An answer this far away is not part of *this* search when a nearer one exists. */
export const PLACE_SEARCH_DISTANCE_LIMIT_METERS = 300_000;

/** The same name this close is the same place. */
export const PLACE_DUPLICATE_METERS = 200;

/** Distance bands, nearest first; a provider's relevance order holds inside one. */
const DISTANCE_BANDS_METERS: readonly number[] = [
  50_000,
  150_000,
  PLACE_SEARCH_DISTANCE_LIMIT_METERS,
];

/** How many rows one search returns. */
export const PLACE_RESULT_LIMIT = 8;

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function samePlaceName(left: string, right: string): boolean {
  const first = normalizedName(left);
  const second = normalizedName(right);
  return first !== "" && first === second;
}

function distanceBand(distance: number): number {
  const index = DISTANCE_BANDS_METERS.findIndex((limit) => distance <= limit);
  return index === -1 ? DISTANCE_BANDS_METERS.length : index;
}

/** Drop answers beyond the distance limit, but only when a nearer answer exists. */
export function applyDistanceSanity(
  places: readonly PlaceMatch[],
  bias: Coordinate | undefined,
): PlaceMatch[] {
  if (bias === undefined) return [...places];
  const distances = places.map((place) => haversine(bias, place.coordinate));
  if (!distances.some((distance) => distance <= PLACE_SEARCH_DISTANCE_LIMIT_METERS)) {
    return [...places];
  }
  return places.filter((_place, index) => {
    const distance = distances[index] ?? Number.NaN;
    return distance <= PLACE_SEARCH_DISTANCE_LIMIT_METERS;
  });
}

/**
 * One list from two ranked answers: `primary` first (the POI answers the query
 * asked for), then `secondary`, deduplicated, distance-checked and band-ordered.
 */
export function mergePlaceResults(
  primary: readonly PlaceMatch[],
  secondary: readonly PlaceMatch[],
  bias: Coordinate | undefined,
): PlaceMatch[] {
  const kept: PlaceMatch[] = [];
  for (const place of [...primary, ...secondary]) {
    const duplicate = kept.some(
      (existing) =>
        samePlaceName(existing.name, place.name) &&
        haversine(existing.coordinate, place.coordinate) <= PLACE_DUPLICATE_METERS,
    );
    if (!duplicate) kept.push(place);
  }
  const nearby = applyDistanceSanity(kept, bias);
  if (bias === undefined) return nearby.slice(0, PLACE_RESULT_LIMIT);
  return nearby
    .map((place, index) => ({ place, index, band: distanceBand(haversine(bias, place.coordinate)) }))
    .sort((left, right) => left.band - right.band || left.index - right.index)
    .map(({ place }) => place)
    .slice(0, PLACE_RESULT_LIMIT);
}
