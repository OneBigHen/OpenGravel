/**
 * One place, however many sources describe it. OSM, Wikipedia and Wikidata
 * often name the same covered bridge; it must appear once, with every source
 * in its provenance and the best of each (OSM's precise position, the
 * encyclopedia's description and licensed image).
 */

import { haversine } from "@/domain/geometry/analysis";

import type { InterestingPlace, PlaceFacts } from "./types";

const SAME_NAME_METERS = 400;
const NEAR_SIMILAR_METERS = 60;

export function normalizedName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|of|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizedName(left).split(" ").filter(Boolean));
  const b = new Set(normalizedName(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function samePlace(left: InterestingPlace, right: InterestingPlace): boolean {
  if (left.wikidataId !== null && right.wikidataId !== null) return left.wikidataId === right.wikidataId;
  const meters = haversine(left.coordinate, right.coordinate);
  if (normalizedName(left.name) === normalizedName(right.name) && meters <= SAME_NAME_METERS) return true;
  return meters <= NEAR_SIMILAR_METERS && tokenSimilarity(left.name, right.name) >= 0.6;
}

function mergeFacts(left: PlaceFacts, right: PlaceFacts): PlaceFacts {
  const heritage = [...new Set([...(left.heritage ?? []), ...(right.heritage ?? [])])];
  const instanceOf = [...new Set([...(left.instanceOf ?? []), ...(right.instanceOf ?? [])])];
  const builtYear = left.builtYear ?? right.builtYear;
  const creator = left.creator ?? right.creator;
  const elevationMeters = left.elevationMeters ?? right.elevationMeters;
  return {
    ...(builtYear === undefined ? {} : { builtYear }),
    ...(heritage.length === 0 ? {} : { heritage }),
    ...(instanceOf.length === 0 ? {} : { instanceOf }),
    ...(creator === undefined ? {} : { creator }),
    ...(elevationMeters === undefined ? {} : { elevationMeters }),
  };
}

/** `base` wins identity and position; `other` fills what `base` lacks. */
function merge(base: InterestingPlace, other: InterestingPlace): InterestingPlace {
  const wikidataId = base.wikidataId ?? other.wikidataId;
  return {
    ...base,
    id: wikidataId !== null ? `wikidata:${wikidataId}` : base.id,
    // The longer, sourced sentence reads better than a bare tag.
    description: (other.description?.length ?? 0) > (base.description?.length ?? 0) ? other.description : base.description,
    image: base.image ?? other.image,
    wikidataId,
    categories: [...new Set([...base.categories, ...other.categories])],
    facts: mergeFacts(base.facts, other.facts),
    tags: [...new Set([...base.tags, ...other.tags])],
    confidence: Math.min(1, Math.max(base.confidence, other.confidence) + 0.1),
    provenance: [...base.provenance, ...other.provenance],
  };
}

/**
 * Collapses duplicates. `positionRank(sourceId)` (lower first) decides whose
 * coordinate and name lead: OSM's mapped position before an article's pin.
 */
export function dedupePlaces(
  places: readonly InterestingPlace[],
  positionRank: (sourceId: string) => number,
): readonly InterestingPlace[] {
  const ordered = [...places].sort((left, right) =>
    positionRank(left.provenance[0]?.sourceId ?? "") - positionRank(right.provenance[0]?.sourceId ?? "") ||
    left.id.localeCompare(right.id),
  );
  const kept: InterestingPlace[] = [];
  for (const place of ordered) {
    const index = kept.findIndex((existing) => samePlace(existing, place));
    if (index === -1) kept.push(place);
    else kept[index] = merge(kept[index]!, place);
  }
  return kept;
}
