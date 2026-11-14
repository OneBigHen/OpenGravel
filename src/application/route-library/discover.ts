import { US_STATES } from "@/application/geocoding/us-states";

import { hasLine, kmBetween, LIBRARY_CHIP_LABEL, sortBest, type LibraryChip } from "./client";
import type { IndexRow } from "./types";

/**
 * How a rider finds a ride in the national library: by name, by state, near
 * them, and the best ones around a map view. Pure functions over the index the
 * phone already holds; nothing here invents a fact the index does not carry.
 */

const KM_PER_MILE = 1.609344;

/** Code to name: "NC" to "North Carolina". */
export const STATE_NAME: ReadonlyMap<string, string> = new Map(Object.entries(US_STATES).map(([name, code]) => [code, name]));

export function stateName(code: string): string {
  return STATE_NAME.get(code) ?? code;
}

/** The two-letter code for a typed state name or code ("north carolina", "nc"), else null. */
export function stateFromText(text: string): string | null {
  const word = text.trim().toLowerCase();
  if (word === "") return null;
  for (const [name, code] of Object.entries(US_STATES)) if (name.toLowerCase() === word || code.toLowerCase() === word) return code;
  return null;
}

export function milesBetween(origin: readonly [number, number], point: readonly [number, number]): number {
  return kmBetween(origin, point) / KM_PER_MILE;
}

function words(text: string): readonly string[] {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((word) => word !== "");
}

/**
 * Rides whose name or state matches every word typed: a name that starts with
 * the text first, then one that contains it, then the rest; inside each, the
 * usual best-first order. A typed state name or code lists that whole state.
 */
export function searchRows(rows: readonly IndexRow[], text: string): readonly IndexRow[] {
  const tokens = words(text);
  if (tokens.length === 0) return rows;
  const wanted = stateFromText(text);
  const phrase = tokens.join(" ");
  const tier = new Map<string, number>();
  for (const row of rows) {
    if (wanted !== null && row.st.includes(wanted)) { tier.set(row.id, 3); continue; }
    const name = words(row.n).join(" ");
    const places = row.st.flatMap((code) => [code.toLowerCase(), ...words(stateName(code))]);
    const every = tokens.every((token) => name.includes(token) || places.some((place) => place === token || (token.length >= 3 && place.startsWith(token))));
    if (every) tier.set(row.id, name.startsWith(phrase) ? 0 : name.includes(phrase) ? 1 : 2);
  }
  const found = sortBest(rows.filter((row) => tier.has(row.id)));
  return [...found].sort((a, b) => tier.get(a.id)! - tier.get(b.id)!);
}

export interface NearResult {
  readonly rows: readonly IndexRow[];
  /** The radius the rides were found in; null when there were too few and the nearest were taken instead. */
  readonly radiusMiles: number | null;
}

/**
 * Near me: rides that start within 75 mi, best first (score, then distance).
 * With fewer than five, the nearest twenty instead, nearest first.
 */
export function ridesNear(rows: readonly IndexRow[], origin: readonly [number, number], radiusMiles = 75, minimum = 5, fallback = 20): NearResult {
  const placed = rows.flatMap((row) => (row.p === null ? [] : [{ row, away: milesBetween(origin, row.p) }]));
  const inside = placed.filter((item) => item.away <= radiusMiles);
  if (inside.length >= minimum) return { rows: sortBest(inside.map((item) => item.row), origin), radiusMiles };
  return { rows: placed.sort((a, b) => a.away - b.away || a.row.id.localeCompare(b.row.id)).slice(0, fallback).map((item) => item.row), radiusMiles: null };
}

/** "12 mi away" for a ride that starts there, "About 12 mi away" when the index only knows the area. */
export function awayWords(row: IndexRow, origin: readonly [number, number] | undefined): string | null {
  if (origin === undefined || row.p === null) return null;
  const miles = milesBetween(origin, row.p);
  const rounded = miles < 10 ? Math.max(1, Math.round(miles)) : Math.round(miles / 5) * 5;
  if (row.pp === "start") return miles < 1 ? "Starts near you" : `${rounded} mi away`;
  return `About ${rounded} mi away`;
}

/** The best rides around a map view: Great ride or Standout, best score first, then the closest to the middle of the view. */
export function bestNear(rows: readonly IndexRow[], centre: readonly [number, number], count = 8): readonly IndexRow[] {
  return rows
    .filter((row) => row.q >= 4 && row.p !== null)
    .map((row) => ({ row, away: kmBetween(centre, row.p!) }))
    .sort((a, b) => b.row.q - a.row.q || Number(hasLine(b.row)) - Number(hasLine(a.row)) || a.away - b.away || a.row.id.localeCompare(b.row.id))
    .slice(0, count)
    .map((item) => item.row);
}

export interface StateTile {
  readonly code: string;
  readonly name: string;
  readonly count: number;
}

/** One tile per state that has rides, by name; a ride in two states counts in both. */
export function stateTiles(rows: readonly IndexRow[]): readonly StateTile[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const code of row.st) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, name: stateName(code), count })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface ResultsFilter {
  readonly types: readonly LibraryChip[];
  readonly standout: boolean;
  readonly state: string | undefined;
  readonly search: string;
  readonly near: boolean;
}

/** Whether the rider has narrowed the library at all: the home sections give way to a result list. */
export function narrowed(filter: ResultsFilter): boolean {
  return filter.types.length > 0 || filter.standout || filter.state !== undefined || filter.search.trim() !== "" || filter.near;
}

/** "Twisty rides in North Carolina", "Standout rides near you", "Rides matching “dragon”". */
export function resultsTitle(filter: ResultsFilter): string {
  const kinds = filter.types.map((chip) => LIBRARY_CHIP_LABEL[chip]);
  const what = kinds.length === 0 ? "" : kinds.length === 1 ? kinds[0]! : `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`;
  const lead = [filter.standout ? "Standout" : "", what].filter((part) => part !== "").join(" ");
  const noun = filter.types.length === 1 && filter.types[0] === "trips" ? "" : " rides";
  const base = lead === "" ? "Rides" : `${lead}${noun}`;
  const place = filter.near ? " near you" : filter.state === undefined ? "" : ` in ${stateName(filter.state)}`;
  const named = filter.search.trim() === "" ? "" : ` matching “${filter.search.trim()}”`;
  return `${base}${place}${named}`;
}
