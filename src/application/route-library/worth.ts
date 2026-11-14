import { qualityWord, typeWord } from "./row-words";
import type { LibraryPoi, RideDetail, RideFact } from "./types";

/**
 * What a library ride's page says about whether it is worth the trip, built
 * only from what the pack holds. A fact the source did not give is left off the
 * list or said as unknown; a source's claim always reads "the source says";
 * the library's score is called the library's score.
 */

export interface WorthLine {
  readonly key: string;
  readonly label: string;
  readonly text: string;
  /** Where the claim comes from, when the pack names it. */
  readonly note?: string;
}

export interface WorthStops {
  readonly key: "fuel" | "camping" | "lodging" | "pois";
  readonly label: string;
  readonly names: readonly string[];
}

export interface Worth {
  /** "Standout" or "Great ride"; null for anything scored lower (no claim is made). */
  readonly quality: string | null;
  /** "Twisty", "Dirt · Big trip" and so on. */
  readonly type: string;
  /** The library's own words for the score, as stored. */
  readonly reason: string | null;
  /** Before you go: surface, track, legal. */
  readonly truth: readonly WorthLine[];
  /** Season, permits and difficulty, only the ones the source gave. */
  readonly goodToKnow: readonly WorthLine[];
  readonly stops: readonly WorthStops[];
  readonly notes: RideDetail["notes"];
  readonly alsoOn: RideDetail["alsoOn"];
}

const SURFACE: Readonly<Record<"paved" | "unpaved" | "mixed", string>> = {
  paved: "Paved, the source says",
  unpaved: "Unpaved, the source says",
  mixed: "Paved and unpaved, the source says",
};

const LEGAL: Readonly<Record<string, string>> = {
  "public-roads": "Public roads, the source says",
  "designated-ohv": "Designated off-highway vehicle area, the source says",
  mixed: "Public roads and designated trails, the source says",
  "street-licensed-only": "Street-licensed bikes only, the source says",
};

function noteOf(fact: RideFact<unknown>): { readonly note?: string } {
  return fact.source === null || fact.source === "" ? {} : { note: fact.source };
}

function trackText(track: RideDetail["track"]): string {
  if (track.availability === "none") return "The source has no track to follow.";
  if (track.availability === "link") return "The source keeps the track; this page links to it.";
  const parts: string[] = [];
  if (track.rough) parts.push("A rough track: it skips or jumps, so use it as a guide.");
  else parts.push(track.year === null ? "Track age unknown." : `Track from ${track.year}.`);
  if (track.old && !track.rough && track.year !== null) parts.push("Check roads first.");
  if (track.mismatch) parts.push("Its length does not match the length the source gives.");
  return parts.join(" ");
}

function stopsOf(list: readonly LibraryPoi[], key: WorthStops["key"], label: string): readonly WorthStops[] {
  return list.length === 0 ? [] : [{ key, label, names: list.map((poi) => poi.name) }];
}

export function worthOf(detail: RideDetail): Worth {
  const { facts, track } = detail;
  const legalText = facts.legal.value === null ? null : (LEGAL[facts.legal.value] ?? `${facts.legal.quote ?? facts.legal.value}, the source says`);
  const truth: WorthLine[] = [
    { key: "surface", label: "Surface", text: facts.surface.value === null ? "Surface unknown" : SURFACE[facts.surface.value], ...noteOf(facts.surface) },
    { key: "track", label: "Track", text: trackText(track) },
    ...(legalText === null ? [] : [{ key: "legal", label: "Riding here", text: legalText, ...noteOf(facts.legal) }]),
  ];
  const quoted = (key: string, label: string, fact: RideFact<string>): readonly WorthLine[] =>
    fact.value === null ? [] : [{ key, label, text: `${fact.quote ?? fact.value}`, ...noteOf(fact) }];
  return {
    quality: qualityWord(detail.score),
    type: typeWord({ t: detail.type, k: detail.kind }),
    reason: detail.scoreReason === null || detail.scoreReason.trim() === "" ? null : detail.scoreReason.trim(),
    truth,
    goodToKnow: [...quoted("season", "Season", facts.season), ...quoted("permits", "Permits", facts.permits), ...quoted("difficulty", "Difficulty", facts.difficulty)],
    stops: [...stopsOf(detail.stops.fuel, "fuel", "Fuel"), ...stopsOf(detail.stops.camping, "camping", "Camping"), ...stopsOf(detail.stops.lodging, "lodging", "Lodging"), ...stopsOf(detail.stops.pois, "pois", "Places to see")],
    notes: detail.notes,
    alsoOn: detail.alsoOn,
  };
}
