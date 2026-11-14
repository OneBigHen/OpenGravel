import type { IndexRow, RideType } from "./types";

/** Plain rider words for a library ride: Standout and Great ride, never stars. */
export function qualityWord(score: number): string | null {
  if (score >= 5) return "Standout";
  if (score >= 4) return "Great ride";
  return null;
}

const TYPE_WORD: Readonly<Record<RideType, string>> = {
  twisty: "Twisty",
  scenic: "Scenic",
  dirt: "Dirt",
  trail: "Trails",
};

export function typeWord(row: Pick<IndexRow, "t" | "k">): string {
  return row.k === "trip" ? `${TYPE_WORD[row.t]} · Big trip` : TYPE_WORD[row.t];
}

/** "Standout · Twisty": the quality word when there is one, then the type. */
export function qualityAndType(row: Pick<IndexRow, "q" | "t" | "k">): string {
  const quality = qualityWord(row.q);
  return quality === null ? typeWord(row) : `${quality} · ${typeWord(row)}`;
}

export function statesWord(states: readonly string[]): string {
  return states.join(", ");
}

/** The source's name as the index carries it: only the site, so no author is claimed. */
export function creditWord(row: Pick<IndexRow, "s">, sources: readonly string[]): string | null {
  const name = sources[row.s];
  return name === undefined || name === "" ? null : `Route from ${name}`;
}

export function milesLabelInput(row: Pick<IndexRow, "mi">): number | null {
  return row.mi === null ? null : row.mi * 1.609344;
}
