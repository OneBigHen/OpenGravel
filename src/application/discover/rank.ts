/**
 * OpenGravel-owned, deterministic discovery ranking. No LLM, and it never
 * touches road or route ranking. Signals: how rare and worth-a-stop the kind
 * of place is, how complete what we can show about it is, how sure the
 * sources are, the rider's chosen categories, and how far out of the way it is.
 */

import type { DiscoverCategory, InterestingPlace } from "./types";

/** How worth a stop each kind of place usually is (a prior, not a verdict). */
const CATEGORY_PRIOR: Readonly<Record<DiscoverCategory, number>> = {
  waterfall: 1,
  ruins: 0.95,
  quirky: 0.9,
  bridge: 0.9,
  viewpoint: 0.85,
  scenic: 0.7,
  event: 0.6,
  history: 0.6,
  museum: 0.6,
  architecture: 0.55,
  nature: 0.5,
  "public-art": 0.45,
  roadside: 0.4,
  recreation: 0.35,
  camping: 0.3,
};

export interface RankContext {
  /** The rider's chosen categories; a match lifts a place. */
  readonly preferred?: readonly DiscoverCategory[];
  /** Near/destination queries: the search radius, for the proximity term. */
  readonly radiusMeters?: number;
}

function completeness(place: InterestingPlace): number {
  let value = 0;
  if (place.description !== null && place.description.length >= 40) value += 0.35;
  if (place.image !== null) value += 0.3;
  if (place.wikidataId !== null) value += 0.2;
  if (Object.keys(place.facts).length > 0) value += 0.15;
  return value;
}

export function discoveryScore(place: InterestingPlace, context: RankContext = {}): number {
  const prior = Math.max(...place.categories.map((category) => CATEGORY_PRIOR[category]), CATEGORY_PRIOR[place.category]);
  const preferred = context.preferred?.some((category) => place.categories.includes(category)) === true ? 0.6 : 0;
  const multiSource = new Set(place.provenance.map((entry) => entry.sourceId)).size > 1 ? 0.15 : 0;
  let cost = 0;
  if (place.detourMinutes !== undefined) cost = Math.min(1.2, place.detourMinutes / 25);
  else if (place.distanceMeters !== undefined && context.radiusMeters !== undefined && context.radiusMeters > 0) {
    cost = Math.min(1, place.distanceMeters / context.radiusMeters) * 0.8;
  }
  return prior + 0.7 * completeness(place) + 0.5 * place.confidence + preferred + multiSource - cost;
}

/** Each earlier pick of the same kind lowers the next one's score by this. */
const REPEAT_PENALTY = 0.35;

/**
 * Best first, but varied: a row of six look-alike historic houses hides the
 * waterfall at seventh. Greedy: pick the best remaining score after a penalty
 * for how many of its kind are already picked. Deterministic (ties by id).
 */
export function rankPlaces(places: readonly InterestingPlace[], context: RankContext = {}): readonly InterestingPlace[] {
  const remaining = [...places]
    .map((place) => ({ place, score: discoveryScore(place, context) }))
    .sort((left, right) => right.score - left.score || left.place.id.localeCompare(right.place.id));
  const picked: InterestingPlace[] = [];
  const seen = new Map<string, number>();
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    remaining.forEach((entry, index) => {
      const adjusted = entry.score - REPEAT_PENALTY * (seen.get(entry.place.category) ?? 0);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    });
    const [chosen] = remaining.splice(bestIndex, 1);
    picked.push(chosen!.place);
    seen.set(chosen!.place.category, (seen.get(chosen!.place.category) ?? 0) + 1);
  }
  return picked;
}
