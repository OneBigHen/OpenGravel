/**
 * Saved places and recents (NV-02), local-first until accounts sync (NV-01).
 *
 * Every pick from search becomes a recent; a star on a chosen start or
 * destination saves it. An empty search box offers Home, then saved places,
 * then recents; a typed query offers the ones whose name starts a word with
 * it, ahead of the geocoder. Places are identified by where they are (≈10 m),
 * not by provider id, so the same café picked twice is one entry.
 */

import type { PlaceMatch } from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";

export const MAX_RECENT_PLACES = 8;
export const MAX_SAVED_PLACES = 50;

export interface PlaceMemory {
  readonly saved: readonly PlaceMatch[];
  readonly recents: readonly PlaceMatch[];
}

export const EMPTY_PLACE_MEMORY: PlaceMemory = { saved: [], recents: [] };

/** The device's memory as a store React can subscribe to; `read` is referentially stable between writes. */
export interface PlaceMemoryStore {
  read(): PlaceMemory;
  record(place: PlaceMatch): void;
  toggleSaved(place: PlaceMatch): void;
  subscribe(listener: () => void): () => void;
}

export type RememberedKind = "home" | "saved" | "recent";

export interface RememberedPlace {
  readonly kind: RememberedKind;
  readonly place: PlaceMatch;
}

/** ≈10 m: two picks this close are the same place. */
export function placeKey(coordinate: Coordinate): string {
  return `${coordinate.lat.toFixed(4)},${coordinate.lon.toFixed(4)}`;
}

function without(list: readonly PlaceMatch[], coordinate: Coordinate): PlaceMatch[] {
  const key = placeKey(coordinate);
  return list.filter((entry) => placeKey(entry.coordinate) !== key);
}

export function recordRecent(memory: PlaceMemory, place: PlaceMatch): PlaceMemory {
  return {
    saved: memory.saved,
    recents: [place, ...without(memory.recents, place.coordinate)].slice(0, MAX_RECENT_PLACES),
  };
}

export function isSaved(memory: PlaceMemory, coordinate: Coordinate): boolean {
  const key = placeKey(coordinate);
  return memory.saved.some((entry) => placeKey(entry.coordinate) === key);
}

export function toggleSaved(memory: PlaceMemory, place: PlaceMatch): PlaceMemory {
  if (isSaved(memory, place.coordinate)) {
    return { saved: without(memory.saved, place.coordinate), recents: memory.recents };
  }
  return { saved: [place, ...memory.saved].slice(0, MAX_SAVED_PLACES), recents: memory.recents };
}

function matches(place: PlaceMatch, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [place.name, place.label, place.context].some((text) =>
    text.toLowerCase().split(/[\s,]+/).some((word) => word.startsWith(needle)) ||
    text.toLowerCase().startsWith(needle),
  );
}

/**
 * What the search box offers from memory: Home first, then saved, then
 * recents, each place once. `limit` caps the list (an empty box shows more
 * than a typed one, where the geocoder's answers also need room).
 */
export function rememberedPlaces(
  memory: PlaceMemory,
  home: PlaceMatch | null,
  query: string,
  limit: number,
): RememberedPlace[] {
  const out: RememberedPlace[] = [];
  const seen = new Set<string>();
  const add = (kind: RememberedKind, place: PlaceMatch): void => {
    const key = placeKey(place.coordinate);
    if (seen.has(key) || out.length >= limit) return;
    if (!(matches(place, query) || (kind === "home" && "home".startsWith(query.trim().toLowerCase())))) return;
    seen.add(key);
    out.push({ kind, place });
  };
  if (home !== null) add("home", home);
  memory.saved.forEach((place) => add("saved", place));
  memory.recents.forEach((place) => add("recent", place));
  return out;
}

function isPlaceMatch(value: unknown): value is PlaceMatch {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  const coordinate = entry["coordinate"] as Record<string, unknown> | undefined;
  return (
    typeof entry["id"] === "string" &&
    typeof entry["label"] === "string" && entry["label"].length <= 200 &&
    typeof entry["name"] === "string" && entry["name"].length <= 200 &&
    typeof entry["context"] === "string" && entry["context"].length <= 200 &&
    typeof entry["provider"] === "string" &&
    typeof coordinate === "object" && coordinate !== null &&
    typeof coordinate["lat"] === "number" && Math.abs(coordinate["lat"]) <= 90 &&
    typeof coordinate["lon"] === "number" && Math.abs(coordinate["lon"]) <= 180
  );
}

/** Reads a stored memory; anything malformed is dropped entry by entry. */
export function parsePlaceMemory(value: unknown): PlaceMemory {
  if (typeof value !== "object" || value === null) return EMPTY_PLACE_MEMORY;
  const record = value as Record<string, unknown>;
  const list = (entries: unknown, max: number): PlaceMatch[] =>
    Array.isArray(entries) ? entries.filter(isPlaceMatch).slice(0, max) : [];
  return {
    saved: list(record["saved"], MAX_SAVED_PLACES),
    recents: list(record["recents"], MAX_RECENT_PLACES),
  };
}
