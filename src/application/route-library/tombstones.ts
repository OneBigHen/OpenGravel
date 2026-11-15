/**
 * Removed rides: the small record that lets an old link answer
 * "this ride was removed" instead of a bare 404, and the rules that carry
 * those records from one pack to the next.
 *
 * `<library>/tombstones.json` is the deliberate list (a takedown, or the
 * library session saying a record is gone). A pack also keeps the removals it
 * noticed by itself: a card that was in the previous pack and is not in this
 * one. Neither list may ever be turned back into a live ride by accident.
 */
import type { Tombstone } from "./types";

/** The same shape the ride endpoints accept. */
export const RIDE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads `tombstones.json` (a bare array, or `{ "removed": [...] }`).
 * Malformed entries fail the build: a silent skip could leave a bad listing live.
 */
export function parseTombstones(value: unknown, where = "tombstones.json"): readonly Tombstone[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value["removed"])
      ? value["removed"]
      : null;
  if (list === null) throw new Error(`${where}: expected an array of removed rides, or an object with a "removed" array`);
  const seen = new Set<string>();
  const entries = list.map((entry, index): Tombstone => {
    const at = `${where}[${index}]`;
    if (!isRecord(entry)) throw new Error(`${at}: must be an object`);
    const { id, removedAt, reason } = entry;
    if (typeof id !== "string" || !RIDE_ID.test(id)) throw new Error(`${at}: id must be a ride id`);
    if (seen.has(id)) throw new Error(`${at}: ${id} appears twice`);
    seen.add(id);
    if (typeof removedAt !== "string" || !Number.isFinite(Date.parse(removedAt))) throw new Error(`${at}: removedAt must be a date`);
    if (typeof reason !== "string" || reason.trim() === "") throw new Error(`${at}: reason is required`);
    return { id, removedAt, reason: reason.trim() };
  });
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export interface TombstoneMerge {
  /** The deliberate list from the library folder; it wins over everything else. */
  readonly deliberate: readonly Tombstone[];
  /** The previous pack's table, so a removal survives rebuilds. */
  readonly carried: readonly Tombstone[];
  /** Card ids in the previous pack. A card that disappeared earns a tombstone. */
  readonly previousIds: readonly string[];
  /** Card ids packed now. */
  readonly currentIds: readonly string[];
  /** Ids dropped because their source is hidden by policy this build. */
  readonly withdrawn?: readonly string[];
  /** The build time, used as the removal date for a newly noticed removal. */
  readonly removedAt: string;
}

/**
 * The pack's tombstone list. A deliberate entry always wins. A carried entry
 * is dropped when its ride is live again and was not deliberately removed, so
 * a returning record is never blocked by history. A previous card that is gone
 * now, and has no entry, is recorded with the build date.
 */
export function mergeTombstones(input: TombstoneMerge): readonly Tombstone[] {
  const deliberate = new Map(input.deliberate.map((entry) => [entry.id, entry]));
  const current = new Set(input.currentIds);
  const merged = new Map<string, Tombstone>();
  for (const entry of input.carried) {
    if (current.has(entry.id) && !deliberate.has(entry.id)) continue;
    merged.set(entry.id, entry);
  }
  for (const entry of deliberate.values()) merged.set(entry.id, entry);
  const withdrawn = new Set(input.withdrawn ?? []);
  for (const id of input.previousIds) {
    if (current.has(id) || merged.has(id)) continue;
    merged.set(id, {
      id,
      removedAt: input.removedAt,
      reason: withdrawn.has(id) ? "withdrawn by its source" : "no longer in the library",
    });
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Adds or replaces one deliberate removal, keeping the list sorted and unique. */
export function withTakedown(existing: readonly Tombstone[], entry: Tombstone): readonly Tombstone[] {
  const merged = new Map(existing.map((candidate) => [candidate.id, candidate]));
  merged.set(entry.id, entry);
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The file `scripts/route-library/takedown.ts` writes: a bare array, stable and readable. */
export function tombstonesJson(list: readonly Tombstone[]): string {
  return `${JSON.stringify(list, null, 2)}\n`;
}
