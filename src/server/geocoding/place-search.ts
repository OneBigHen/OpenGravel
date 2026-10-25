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
 * Two rider expectations shape the edges of that: the town the rider named
 * stays a row of its own even when no business answers, and a brand is looked
 * for around the town first but then for the nearest branch anywhere, because
 * the closest Wawa or Sheetz is often in the next town. A two-word query that
 * matches nothing as typed ("Sheetz Lehighton") is retried once with its
 * trailing word as the town, so two real words never answer with an empty list.
 *
 * The other edge is the query that is already a place's whole name. "Hawk
 * Mountain Sanctuary" is not "Hawk Mountain" near a town called "Sanctuary":
 * when the whole query comes back as a place's own name, no trailing words are
 * geocoded as a town at all, so the sanctuary cannot be ranked under a
 * namesake town on the other side of the country. The guessed town, when one is
 * used, is only ever a hint after the rows the rider's term actually found.
 *
 * The providers fail independently: TomTom failing or timing out leaves the
 * Photon answers exactly as they were, and Photon failing still returns POI
 * answers when TomTom has them. Only when both fail does the handler report
 * search unavailable, which is what it did before.
 */

import type { PlaceMatch } from "@/application/geocoding/place-search";
import { mergePlaceResults } from "@/application/geocoding/place-merge";
import { parsePlaceQuery, PLACE_CATEGORIES, matchesWholeQuery, type ParsedPlaceQuery } from "@/application/geocoding/place-query";
import { withoutTrailingUsState } from "@/application/geocoding/us-states";
import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";
import type { PhotonGeocoder } from "@/infrastructure/geocoding/photon";
import type { TomTomPlaceRequest, TomTomPlaceSearch } from "@/infrastructure/geocoding/tomtom";

/** Resolving a town the rider named must not cost more than a few candidates. */
const PLACE_RESOLUTION_LIMIT = 3;

/**
 * How far from the town the rider named a POI may be and still be the answer.
 *
 * A brand's nearest branch is often in the next town: the closest Wawa to Jim
 * Thorpe, Pennsylvania is roughly 20 mi away, and the closest Sheetz to
 * Lehighton is in a neighbouring town too. Refusing those because they are
 * outside the town's own neighbourhood answers a question nobody asked, so a
 * town-scoped search that finds nothing inside the default radius asks once
 * more for the nearest ones instead.
 */
export const PLACE_NEAREST_REACH_METERS = 80_000;

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
 * The place the town name resolves to, or `null` when it does not come back as
 * a place. A name that does not match is not used: the search then happens
 * around the rider, which is what they meant by typing it. The resolved place
 * is also kept as a row, so the town the rider named is never lost.
 */
async function resolvePlace(
  photon: Pick<PhotonGeocoder, "search">,
  text: string,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<PlaceMatch | null> {
  const places = await photon.search(text, {
    limit: PLACE_RESOLUTION_LIMIT,
    ...(bias === undefined ? {} : { bias }),
    signal,
  });
  const matching = places.filter((place) => nameMatchesTypedText(text, place.name));
  return nearest(matching, bias);
}

interface PoiTarget {
  readonly center: Coordinate;
  /** What to look for; narrower than the query when a trailing town resolved. */
  readonly term: string;
  /** The place the rider named, when it resolved: it stays a row of its own. */
  readonly town: PlaceMatch | null;
  /** Was the town guessed from the query's trailing words rather than named? */
  readonly split: boolean;
}

/** The whole-query answers, or `null` when that provider failed. */
type WholeQueryAnswer = Promise<readonly PlaceMatch[] | null>;

async function centerFor(
  photon: Pick<PhotonGeocoder, "search">,
  parsed: ParsedPlaceQuery,
  wholeQueryAnswer: WholeQueryAnswer,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<PoiTarget | null> {
  // The named town decides where to look, but it is a hint: a geocoder that
  // cannot resolve it must not take the POI answers down with it.
  try {
    if (parsed.place !== null) {
      const named = await resolvePlace(photon, parsed.place, bias, signal);
      if (named !== null) {
        return { center: named.coordinate, term: parsed.term, town: named, split: false };
      }
    }
    // "Hawk Mountain Sanctuary" is a place's own name, and the whole-query
    // search already said so. Only then are the trailing words worth a geocode
    // as a town: otherwise the last word of every place name in the world is a
    // town called "Sanctuary", and it answers first. This is the one case that
    // waits for the whole-query answer; every other query asks both sources at
    // once.
    if (parsed.placeCandidates.length > 0) {
      const whole = (await wholeQueryAnswer) ?? [];
      const answeredAsWhole = whole.some((place) => matchesWholeQuery(parsed.query, place.name));
      if (!answeredAsWhole) {
        for (const candidate of parsed.placeCandidates) {
          const resolved = await resolvePlace(photon, candidate.place, bias, signal);
          if (resolved !== null) {
            return { center: resolved.coordinate, term: candidate.term, town: resolved, split: true };
          }
        }
      }
    }
  } catch {
    // Fall through to the rider's own point.
  }
  return bias === undefined ? null : { center: bias, term: parsed.term, town: null, split: false };
}

/** Nearest first: a widened search answers in relevance order, not distance order. */
function nearestFrom(center: Coordinate, places: readonly PlaceMatch[]): PlaceMatch[] {
  return [...places].sort(
    (left, right) => haversine(center, left.coordinate) - haversine(center, right.coordinate),
  );
}

/**
 * The POI rows for one target. A town the rider named is searched narrowly
 * first (that is the town they meant), and once more, for the nearest answers
 * anywhere, when that neighbourhood has none of them.
 */
async function poiRows(
  tomtom: TomTomPlaceSearch,
  target: PoiTarget,
  category: ParsedPlaceQuery["category"],
  signal: AbortSignal,
): Promise<PlaceMatch[]> {
  const categoryId = category?.tomtomCategoryId ?? undefined;
  const request: TomTomPlaceRequest = {
    ...(categoryId === undefined ? { query: category?.query ?? target.term } : {}),
    ...(categoryId === undefined ? {} : { categoryId }),
    center: target.center,
    signal,
  };
  const places = await tomtom.search(request);
  if (target.town === null) return places;
  // Around a town the rider named, the nearest branch is the one they want.
  if (places.length > 0) return nearestFrom(target.center, places);
  return nearestFrom(
    target.center,
    await tomtom.search({ ...request, radiusMeters: PLACE_NEAREST_REACH_METERS }),
  );
}

interface PoiAnswer {
  readonly places: readonly PlaceMatch[];
  /**
   * The town the answer resolved — the place the rider named, or the one a
   * split guessed — kept as a row even when no business answered.
   */
  readonly town: PlaceMatch | null;
  /** The term the query was reduced to by a trailing-town guess, or `null`. */
  readonly splitTerm: string | null;
}

const NO_POI_ANSWER: PoiAnswer = { places: [], town: null, splitTerm: null };

async function tomtomPlaces(
  photon: Pick<PhotonGeocoder, "search">,
  tomtom: TomTomPlaceSearch,
  parsed: ParsedPlaceQuery,
  wholeQueryAnswer: WholeQueryAnswer,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<PoiAnswer> {
  const target = await centerFor(photon, parsed, wholeQueryAnswer, bias, signal);
  if (target === null) return NO_POI_ANSWER;
  // A trailing town can leave a category behind ("gas Lehighton"), which is
  // then looked up as that category rather than as a text search.
  const category = PLACE_CATEGORIES.get(target.term.toLowerCase()) ?? parsed.category;
  // A POI outage is this provider's own empty answer; the town the rider named
  // is still a row, because Photon is what resolved it.
  const places = await settled(poiRows(tomtom, target, category, signal), [] as PlaceMatch[]);
  return { places, town: target.town, splitTerm: target.split ? target.term : null };
}

/**
 * "Sheetz Lehighton" is a brand and the town to look around, but a two-word
 * query is also the shape of a town's own name ("Jim Thorpe") — which is why
 * the whole text is asked first and the trailing word becomes a town only when
 * that found nothing at all. The split costs one geocode and one POI search,
 * and the town it resolves stays in the list beside the brand's locations, so a
 * rider who typed two real words never gets an empty answer.
 */
async function trailingTownRetry(
  photon: Pick<PhotonGeocoder, "search">,
  tomtom: TomTomPlaceSearch,
  parsed: ParsedPlaceQuery,
  bias: Coordinate | undefined,
  signal: AbortSignal,
): Promise<PoiAnswer> {
  if (parsed.place !== null || parsed.placeCandidates.length > 0) return NO_POI_ANSWER;
  const parts = parsed.query.split(" ").filter((word) => word !== "");
  if (parts.length !== 2) return NO_POI_ANSWER;
  const term = parts[0]!;
  const place = parts[1]!;
  let town: PlaceMatch | null;
  try {
    town = await resolvePlace(photon, place, bias, signal);
  } catch {
    return NO_POI_ANSWER;
  }
  if (town === null) return NO_POI_ANSWER;
  const target: PoiTarget = { center: town.coordinate, term, town, split: true };
  const places = await settled(
    poiRows(tomtom, target, PLACE_CATEGORIES.get(term.toLowerCase()) ?? null, signal),
    [] as PlaceMatch[],
  );
  return { places, town, splitTerm: term };
}

/** POI rows lead; the town the answer resolved and the place answers follow. */
function secondaryRows(town: PlaceMatch | null, photonPlaces: readonly PlaceMatch[]): PlaceMatch[] {
  return town === null ? [...photonPlaces] : [town, ...photonPlaces];
}

/**
 * A split answer's order: the rows the rider's own term found, the places named
 * after that term, then the town the parser guessed, then everything else.
 *
 * The town here was made up out of the query's last words ("Sanctuary" out of
 * "Hawk Mountain Sanctuary"), so it is a hint, not the answer: it is offered,
 * but never above the rows that answer the term the rider actually typed, and
 * the nearest-first distance bands must not lift it over them either.
 */
function rankSplitAnswer(
  term: string,
  answer: PoiAnswer,
  places: readonly PlaceMatch[],
): PlaceMatch[] {
  const tier = (place: PlaceMatch): number => {
    if (answer.places.includes(place)) return 0;
    if (matchesWholeQuery(term, place.name)) return 1;
    if (place === answer.town) return 2;
    return 3;
  };
  return places
    .map((place, index) => ({ place, index, tier: tier(place) }))
    .sort((left, right) => left.tier - right.tier || left.index - right.index)
    .map(({ place }) => place);
}

/** One answer as the rider sees it: merged, and ordered when it used a split. */
function answerRows(
  query: string,
  answer: PoiAnswer,
  photonPlaces: readonly PlaceMatch[],
  bias: Coordinate | undefined,
): PlaceMatch[] {
  const places = mergePlaceResults(
    answer.places,
    secondaryRows(answer.town, photonPlaces),
    bias,
  );
  const ranked = answer.splitTerm === null
    ? places
    : rankSplitAnswer(answer.splitTerm, answer, places);
  return placeNamedExactlyFirst(query, ranked, answer.places);
}

/** Words of a name with case, accents and punctuation set aside. */
function nameWords(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A place (not a business) named exactly what the rider typed leads the list:
 * "Jim Thorpe" is the town before "The Inn at Jim Thorpe", even though business
 * answers usually lead.
 */
function placeNamedExactlyFirst(
  query: string,
  places: readonly PlaceMatch[],
  businesses: readonly PlaceMatch[],
): PlaceMatch[] {
  const typed = nameWords(withoutTrailingUsState(query));
  if (typed === "") return [...places];
  const exact = places.find((place) => !businesses.includes(place) && nameWords(place.name) === typed);
  return exact === undefined ? [...places] : [exact, ...places.filter((place) => place !== exact)];
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
      ? Promise.resolve(NO_POI_ANSWER)
      : settled(tomtomPlaces(photon, tomtom, parsed, photonAnswer, bias, signal), NO_POI_ANSWER);
    const [photonPlaces, poi] = await Promise.all([photonAnswer, poiAnswer]);
    if (photonPlaces === null && poi.places.length === 0 && poi.town === null) {
      // Nothing answered. The handler turns this into one fixed "unavailable".
      throw new Error("Place search is unavailable");
    }
    const places = answerRows(query, poi, photonPlaces ?? [], bias);
    if (places.length > 0 || tomtom === undefined) return places;
    // Both sources answered nothing for the query as typed. That is the only
    // moment a two-word brand-and-town split is worth asking for. An unexpected
    // failure there leaves the empty answer as it is rather than becoming a 503.
    const retried = await trailingTownRetry(photon, tomtom, parsed, bias, signal)
      .catch(() => NO_POI_ANSWER);
    if (retried.places.length === 0 && retried.town === null) return places;
    return answerRows(query, retried, photonPlaces ?? [], bias);
  };
}
