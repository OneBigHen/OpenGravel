/**
 * Place search as the rider experiences it: one query, one list.
 *
 * Photon answers "where is this name" and always will. A rider asking "Wawa Jim
 * Thorpe", "gas near Lehighton" or "Blue Mountain Ski" is asking something
 * Photon cannot answer, so the query is split (`place-query`) and the "where"
 * half — a town after "near"/"in", or the trailing words of the query — is
 * resolved through Photon to a coordinate. That coordinate (or the rider's own
 * bias point) becomes the centre of a TomTom POI search, whose rows lead the
 * merged list.
 *
 * The providers fail independently: TomTom failing or timing out leaves the
 * Photon answers exactly as they were, and Photon failing still returns POI
 * answers when TomTom has them. Only when both fail does the handler report
 * search unavailable, which is what it did before.
 */

import type { PlaceMatch } from "@/application/geocoding/place-search";
import { mergePlaceResults } from "@/application/geocoding/place-merge";
import { parsePlaceQuery, PLACE_CATEGORIES, type ParsedPlaceQuery } from "@/application/geocoding/place-query";
import { withoutTrailingUsState } from "@/application/geocoding/us-states";
import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";
import type { PhotonGeocoder } from "@/infrastructure/geocoding/photon";
import type { TomTomPlaceSearch } from "@/infrastructure/geocoding/tomtom";

/** Resolving a town the rider named must not cost more than a few candidates. */
const PLACE_RESOLUTION_LIMIT = 3;

export type PlaceSearchFunction = (
  query: string,
  bias: Coordinate | undefined,
  signal: AbortSignal,
) => Promise<PlaceMatch[]>;

export interface PlaceSearchEngineOptions {
  readonly photon: Pick<PhotonGeocoder, "search">;
  /** TomTom POI answers; absent when the deployment has no key. */
  readonly tomtom?: TomTomPlaceSearch;
}

function normalizedName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Is this geocoded name the place the rider typed ("Jim Thorpe, PA" for "Jim Thorpe")? */
export function nameMatchesTypedText(typed: string, name: string): boolean {
  const expected = normalizedName(typed);
  const actual = normalizedName(name);
  if (expected === "" || actual === "") return false;
  return expected === actual || normalizedName(withoutTrailingUsState(typed)) === actual;
}

function nearest(places: readonly PlaceMatch[], bias: Coordinate | undefined): PlaceMatch | null {
  if (places.length === 0) return null;
  if (bias === undefined) return places[0] ?? null;
  return places.reduce((best, place) =>
    haversine(bias, place.coordinate) < haversine(bias, best.coordinate) ? place : best,
  );
}

/**
 * The coordinate of the town the rider named, or `null` when the name does not
 * come back as a place. A name that does not match is not used: the search then
 * happens around the rider, which is what they meant by typing it.
 */
async function resolvePlace(
  photon: Pick<PhotonGeocoder, "search">,
  text: string,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<Coordinate | null> {
  const places = await photon.search(text, {
    limit: PLACE_RESOLUTION_LIMIT,
    ...(bias === undefined ? {} : { bias }),
    signal,
  });
  const matching = places.filter((place) => nameMatchesTypedText(text, place.name));
  return nearest(matching, bias)?.coordinate ?? null;
}

interface PoiTarget {
  readonly center: Coordinate;
  /** What to look for; narrower than the query when a trailing town resolved. */
  readonly term: string;
}

async function centerFor(
  photon: Pick<PhotonGeocoder, "search">,
  parsed: ParsedPlaceQuery,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<PoiTarget | null> {
  // The named town decides where to look, but it is a hint: a geocoder that
  // cannot resolve it must not take the POI answers down with it.
  try {
    if (parsed.place !== null) {
      const named = await resolvePlace(photon, parsed.place, bias, signal);
      if (named !== null) return { center: named, term: parsed.term };
    }
    for (const candidate of parsed.placeCandidates) {
      const resolved = await resolvePlace(photon, candidate.place, bias, signal);
      if (resolved !== null) return { center: resolved, term: candidate.term };
    }
  } catch {
    // Fall through to the rider's own point.
  }
  return bias === undefined ? null : { center: bias, term: parsed.term };
}

async function tomtomPlaces(
  photon: Pick<PhotonGeocoder, "search">,
  tomtom: TomTomPlaceSearch,
  parsed: ParsedPlaceQuery,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<PlaceMatch[]> {
  const center = await centerFor(photon, parsed, bias, signal);
  if (center === null) return [];
  // A trailing town can leave a category behind ("gas Lehighton"), which is
  // then looked up as that category rather than as a text search.
  const category = PLACE_CATEGORIES.get(center.term.toLowerCase()) ?? parsed.category;
  const categoryId = category?.tomtomCategoryId ?? undefined;
  return tomtom.search({
    ...(categoryId === undefined ? { query: category?.query ?? center.term } : {}),
    ...(categoryId === undefined ? {} : { categoryId }),
    center: center.center,
    signal,
  });
}

async function settled<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

/**
 * Compose the deployment's place search. Both sources are asked at once; a
 * failure in one is that provider's own answer being empty, never the search's.
 */
export function createPlaceSearchEngine(options: PlaceSearchEngineOptions): PlaceSearchFunction {
  const { photon, tomtom } = options;
  return async (query, bias, signal) => {
    const parsed = parsePlaceQuery(query);
    const photonAnswer = settled(
      photon.search(query, { ...(bias === undefined ? {} : { bias }), signal }),
      null,
    );
    const poiAnswer = tomtom === undefined
      ? Promise.resolve([] as PlaceMatch[])
      : settled(tomtomPlaces(photon, tomtom, parsed, bias, signal), [] as PlaceMatch[]);
    const [photonPlaces, poiPlaces] = await Promise.all([photonAnswer, poiAnswer]);
    if (photonPlaces === null && poiPlaces.length === 0) {
      // Nothing answered. The handler turns this into one fixed "unavailable".
      throw new Error("Place search is unavailable");
    }
    return mergePlaceResults(poiPlaces, photonPlaces ?? [], bias);
  };
}
