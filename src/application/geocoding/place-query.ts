/**
 * How a rider's search text splits into "what" and "where".
 *
 * Riders type the way they do into a maps app: a brand and a town ("Wawa Jim
 * Thorpe"), a category near a town ("gas near Lehighton"), a place name they
 * only half remember ("Blue Mountain Ski"), or a bare category meant around
 * where they are ("coffee"). Photon only answers "where is this name", so the
 * split has to happen before a provider is asked. This module is pure: it says
 * what the rider likely meant and which trailing words are worth geocoding as
 * the town; resolving those words to a coordinate is the caller's job.
 *
 * Nothing here invents a place. A category is a rider's own word mapped to one
 * provider-neutral label; an unparseable query keeps its whole text as the term
 * and is answered exactly as before.
 */

/** One rider-facing category, and how a POI provider can look it up. */
export interface PlaceCategory {
  /** The words a text search needs when the provider has no category id. */
  readonly query: string;
  /** TomTom Search category id, when this category has a stable one. */
  readonly tomtomCategoryId: string | null;
}

function category(query: string, tomtomCategoryId: string | null): PlaceCategory {
  return { query, tomtomCategoryId };
}

const GAS = category("gas station", "7311");
const COFFEE = category("coffee shop", "9376");
const FOOD = category("restaurant", "7315");
const MOTORCYCLE = category("motorcycle shop", null);
const CAMPING = category("campground", "7360");
const LODGING = category("hotel", "7314");

/** Words a rider uses for a category, normalized to lower case single spaces. */
export const PLACE_CATEGORIES: ReadonlyMap<string, PlaceCategory> = new Map<string, PlaceCategory>([
  ["gas", GAS],
  ["fuel", GAS],
  ["petrol", GAS],
  ["gas station", GAS],
  ["gas stations", GAS],
  ["fuel station", GAS],
  ["fuel stations", GAS],
  ["coffee", COFFEE],
  ["cafe", COFFEE],
  ["cafes", COFFEE],
  ["coffee shop", COFFEE],
  ["coffee shops", COFFEE],
  ["espresso", COFFEE],
  ["food", FOOD],
  ["restaurant", FOOD],
  ["restaurants", FOOD],
  ["eat", FOOD],
  ["lunch", FOOD],
  ["breakfast", FOOD],
  ["dinner", FOOD],
  ["motorcycle", MOTORCYCLE],
  ["motorcycle shop", MOTORCYCLE],
  ["motorcycle shops", MOTORCYCLE],
  ["motorcycle dealer", MOTORCYCLE],
  ["motorcycle dealers", MOTORCYCLE],
  ["motorcycle repair", MOTORCYCLE],
  ["motorbike shop", MOTORCYCLE],
  ["camping", CAMPING],
  ["campground", CAMPING],
  ["campgrounds", CAMPING],
  ["campsite", CAMPING],
  ["lodging", LODGING],
  ["hotel", LODGING],
  ["hotels", LODGING],
  ["motel", LODGING],
  ["motels", LODGING],
]);

export interface PlaceCandidate {
  /** What to look for once the trailing words turn out to be a town. */
  readonly term: string;
  /** The trailing words to try as a town name. */
  readonly place: string;
}

export interface ParsedPlaceQuery {
  /** The query as typed, with runs of whitespace collapsed. */
  readonly query: string;
  /** What to look for: "Wawa", "gas", "Blue Mountain Ski". */
  readonly term: string;
  /** The place the rider named after a preposition ("Lehighton"), or `null`. */
  readonly place: string | null;
  /** The rider's category word, when the term is one. */
  readonly category: PlaceCategory | null;
  /**
   * Trailing words that may name a town, longest first ("Wawa Jim Thorpe" →
   * one candidate for "Jim Thorpe" that leaves "Wawa" as the term). Empty when
   * the text was already split on a preposition.
   */
  readonly placeCandidates: readonly PlaceCandidate[];
}

/** "near", "in", "at" and friends are how a rider says "this is the where". */
const PLACE_CONNECTOR = /^(?<term>.*?)\s+(?:near|nearby|around|close\s+to|in|at)\s+(?<place>.+)$/i;

function normalize(text: string): string {
  return text.trim().replace(/[?]+$/, "").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return text.split(" ").filter((word) => word !== "");
}

/**
 * Split a query into the thing to find and the place to look around.
 *
 * Only words that plausibly name a town become candidates, because each one
 * costs a geocode: a two-word query splits only when its first word is a
 * category ("gas Lehighton"), so a town's own name ("Jim Thorpe") is never
 * searched as "Jim" near "Thorpe".
 */
export function parsePlaceQuery(query: string): ParsedPlaceQuery {
  const normalized = normalize(query);
  const connector = PLACE_CONNECTOR.exec(normalized);
  const split = connector?.groups ?? {};
  const term = normalize(split.term ?? normalized);
  const place = split.place === undefined ? null : normalize(split.place);
  const effectiveTerm = term === "" ? normalized : term;
  const category = PLACE_CATEGORIES.get(effectiveTerm.toLowerCase()) ?? null;

  let placeCandidates: PlaceCandidate[] = [];
  if (place === null) {
    const parts = words(effectiveTerm);
    if (parts.length >= 3) {
      const rest = (count: number): string => parts.slice(0, -count).join(" ");
      // Longest trailing name first: "Mountain Ski" before "Ski".
      placeCandidates = [
        { term: rest(2), place: parts.slice(-2).join(" ") },
        { term: rest(1), place: parts.at(-1) ?? "" },
      ];
    } else if (parts.length === 2 && PLACE_CATEGORIES.has(parts[0]!.toLowerCase())) {
      // "gas Lehighton": the rider named a category, then a town, with no "near".
      placeCandidates = [{ term: parts[0]!, place: parts[1]! }];
    }
  }

  return {
    query: normalized,
    term: effectiveTerm,
    place,
    category,
    placeCandidates,
  };
}
