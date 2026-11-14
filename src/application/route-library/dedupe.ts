/**
 * Package L2a: finding the same road (or the same trip) listed more than once.
 *
 * Careful by design. Two rides are one card only when
 *  - both have a real line and the two lines lie on top of each other
 *    (most of each line is within 60 m of the other, and the lengths agree), or
 *  - one of them has no line, the names say the same thing (same numbers, same
 *    words), they share a state, their boxes mostly overlap and any miles both
 *    sides state agree.
 * Parallel roads, one road that is much longer than another, and the same name
 * in a different state are all left as separate cards. A duplicate left alone
 * costs a rider a second card; a wrong merge hides a road.
 */
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import type { LibraryBounds } from "./types";

export const DEDUPE = {
  /** A point of one line counts as "on" the other when it is within this many meters. */
  onLineMeters: 60,
  /** Share of each line that must be on the other. */
  coverage: 0.93,
  /** Longer line over shorter line; beyond this it is a different ride (or a "part of"). */
  lengthRatio: 1.2,
  /** Ends of a line that is not a loop: the worse end may be this far from its twin... */
  endsMeters: 2000,
  /** Two pages of one site: the ends must be this close. */
  sameSiteEndsMeters: 1500,
  /** ...or this share of the shorter line, whichever is more. */
  endsShare: 0.05,
  /** Lines shorter than this are matched by name and box instead. */
  minLineMeters: 800,
  /** Box rule: overlap area over combined area. */
  boxOverlap: 0.75,
  /** Box rule for names that differ but share a road number or place word: boxes this alike... */
  tightBox: 0.9,
  /** ...and stated miles this close. */
  tightMiles: 1.08,
  /** Box rule: stated miles must agree within this ratio. */
  milesRatio: 1.25,
  /** Most members one card may take; a larger group is reported for a human look. */
  maxGroup: 12,
  /** A box wider than this many degrees is a long trip and is never box-matched. */
  maxBoxDegrees: 3,
} as const;

export interface DedupeItem {
  readonly id: string;
  readonly name: string;
  /** The site that lists it. Two pages of one site with different names are different rides unless their lines say otherwise. */
  readonly source: string;
  readonly states: readonly string[];
  /** The ride's real line, when we have one we trust; bundles and rough tracks pass `null`. A function is called when needed, so thousands of lines are never in memory at once. */
  readonly line: readonly Coordinate[] | (() => readonly Coordinate[]) | null;
  readonly bounds: LibraryBounds | null;
  readonly miles: number | null;
}

export type MatchMethod = "line" | "box";

export interface DedupePair {
  readonly a: string;
  readonly b: string;
  readonly method: MatchMethod;
  /** Line rule: the lower of the two coverage shares. Box rule: the box overlap. */
  readonly score: number;
  readonly detail: string;
}

export interface DedupeResult {
  /** Groups of two or more ids, each sorted, groups sorted by first id. */
  readonly groups: readonly (readonly string[])[];
  readonly pairs: readonly DedupePair[];
  /** Groups that grew past the cap. They are not merged. */
  readonly oversized: readonly (readonly string[])[];
}

const STOP_WORDS = new Set(["the", "of", "and", "to", "via", "in", "a", "an", "at", "on", "for", "from", "with", "by"]);
const WORD_FORMS: Readonly<Record<string, string>> = {
  highway: "hwy",
  hwy: "hwy",
  route: "rt",
  rte: "rt",
  rt: "rt",
  road: "rd",
  rd: "rd",
  mountain: "mtn",
  mountains: "mtn",
  mtn: "mtn",
  mtns: "mtn",
  mount: "mt",
  mt: "mt",
  street: "st",
  st: "st",
  county: "co",
  co: "co",
  state: "st",
  united: "us",
  u: "us",
};

/** Words and numbers of a ride name, lowercase, without accents, punctuation or filler. */
export function nameTokens(name: string): readonly string[] {
  const plain = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bu\.s\./g, "us")
    .replace(/&/g, " and ")
    .replace(/([a-z])-(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens: string[] = [];
  for (const raw of plain.split(" ")) {
    if (raw === "" || STOP_WORDS.has(raw)) continue;
    const token = WORD_FORMS[raw] ?? raw;
    if (token === "us" && tokens.at(-1) === "us") continue;
    tokens.push(token);
  }
  // "US Highway 220" and "US 220" are one road: the filler between the shield and the number goes.
  return tokens.filter((token, index) => !((token === "hwy" || token === "rt") && /^\d+$/.test(tokens[index + 1] ?? "")));
}

/**
 * True when two names say the same thing: every number in one is in the other, and
 * the word sets are equal, or the shorter (two words at least) sits wholly inside the longer and
 * they share at least half of all their words. One differing word ("NH" against "Vermont") is not alike.
 */
export function sameName(a: string, b: string): boolean {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return false;
  const numbers = (tokens: ReadonlySet<string>): string => [...tokens].filter((token) => /\d/.test(token)).sort().join(",");
  if (numbers(left) !== numbers(right)) return false;
  const shared = [...left].filter((token) => right.has(token)).length;
  if (shared === left.size && shared === right.size) return true;
  const smaller = Math.min(left.size, right.size);
  const union = left.size + right.size - shared;
  return smaller >= 2 && shared === smaller && shared / union >= 0.5;
}

const GENERIC = new Set(["loop", "tour", "ride", "rd", "scenic", "byway", "byways", "drive", "trail", "trails", "route", "rt", "hwy", "north", "south", "east", "west", "county", "co", "st", "mtn", "mt", "valley", "river", "lake", "park", "best", "day", "run", "trip", "motorcycle", "road", "roads", "highway", "national", "state", "forest", "ridge", "creek"]);

/** A word or road number both names carry that says which road it is (not "loop", not a state code). */
export function sharedPlaceWord(a: string, b: string): string | null {
  const right = new Set(nameTokens(b));
  for (const token of nameTokens(a)) {
    if (!right.has(token) || GENERIC.has(token)) continue;
    if (/^\d{2,}$/.test(token) || (/^[a-z]{4,}$/.test(token))) return token;
  }
  return null;
}

interface Prepared {
  readonly item: DedupeItem;
  readonly lengthM: number;
  /** The line, or `null` when the ride has none worth comparing. */
  readonly line: (() => readonly Coordinate[]) | null;
}

function lengthOf(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) total += haversine(line[index - 1]!, line[index]!);
  return total;
}

/** Points along a line no further apart than `step` meters, in local meters about `origin`. */
function resample(line: readonly Coordinate[], step: number, origin: Coordinate): { x: number; y: number }[] {
  const mPerLat = 111_320;
  const mPerLon = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const toXY = (point: Coordinate) => ({ x: (point.lon - origin.lon) * mPerLon, y: (point.lat - origin.lat) * mPerLat });
  const out: { x: number; y: number }[] = [];
  let previous = toXY(line[0]!);
  out.push(previous);
  for (let index = 1; index < line.length; index += 1) {
    const next = toXY(line[index]!);
    const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
    const pieces = Math.max(1, Math.ceil(distance / step));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const t = piece / pieces;
      out.push({ x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t });
    }
    previous = next;
  }
  return out;
}

function cellKey(x: number, y: number, size: number): number {
  return Math.floor(x / size) * 1_000_003 + Math.floor(y / size);
}

/** Share of `probe` points that have a `dense` point within `meters`. */
function coverage(probe: readonly { x: number; y: number }[], dense: readonly { x: number; y: number }[], meters: number): number {
  const size = meters;
  const grid = new Map<number, { x: number; y: number }[]>();
  for (const point of dense) {
    const key = cellKey(point.x, point.y, size);
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [point]);
    else list.push(point);
  }
  let covered = 0;
  for (const point of probe) {
    const cx = Math.floor(point.x / size);
    const cy = Math.floor(point.y / size);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx += 1) {
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        const list = grid.get((cx + dx) * 1_000_003 + (cy + dy));
        if (list === undefined) continue;
        for (const other of list) {
          if (Math.hypot(other.x - point.x, other.y - point.y) <= meters) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) covered += 1;
  }
  return covered / probe.length;
}

/** Both ends of one line against both ends of the other, in the better direction. */
function endsGapMeters(a: readonly Coordinate[], b: readonly Coordinate[]): number {
  const sa = a[0]!;
  const ea = a.at(-1)!;
  const sb = b[0]!;
  const eb = b.at(-1)!;
  return Math.min(Math.max(haversine(sa, sb), haversine(ea, eb)), Math.max(haversine(sa, eb), haversine(ea, sb)));
}

function isLoop(line: readonly Coordinate[], lengthM: number): boolean {
  return haversine(line[0]!, line.at(-1)!) <= 0.1 * lengthM;
}

function boxOf(prepared: Prepared): LibraryBounds | null {
  return prepared.item.bounds;
}

function overlapShare(a: LibraryBounds, b: LibraryBounds): number {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (east <= west || north <= south) return 0;
  const area = (box: LibraryBounds): number => (box.east - box.west) * (box.north - box.south);
  const inter = (east - west) * (north - south);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

function boxesTouch(a: LibraryBounds, b: LibraryBounds): boolean {
  const slack = 0.003; // about 300 m, so two lines 60 m apart never miss each other by a box edge
  return a.west <= b.east + slack && b.west <= a.east + slack && a.south <= b.north + slack && b.south <= a.north + slack;
}

function judge(left: Prepared, right: Prepared): DedupePair | null {
  const [a, b] = left.item.id < right.item.id ? [left, right] : [right, left];
  if (a.line !== null && b.line !== null && a.lengthM >= DEDUPE.minLineMeters && b.lengthM >= DEDUPE.minLineMeters) {
    const [shorter, longer] = a.lengthM <= b.lengthM ? [a, b] : [b, a];
    const ratio = longer.lengthM / shorter.lengthM;
    if (ratio > DEDUPE.lengthRatio) return null;
    const shortLine = shorter.line!();
    const longLine = longer.line!();
    const origin = shortLine[0]!;
    const shortDense = resample(shortLine, 25, origin);
    const longDense = resample(longLine, 25, origin);
    const shortProbe = resample(shortLine, 100, origin);
    const longProbe = resample(longLine, 100, origin);
    const shortOnLong = coverage(shortProbe, longDense, DEDUPE.onLineMeters);
    if (shortOnLong < DEDUPE.coverage) return null;
    const longOnShort = coverage(longProbe, shortDense, DEDUPE.onLineMeters);
    if (longOnShort < DEDUPE.coverage) return null;
    const score = Math.min(shortOnLong, longOnShort);
    const gap = endsGapMeters(shortLine, longLine);
    const loops = isLoop(shortLine, shorter.lengthM) || isLoop(longLine, longer.lengthM);
    if (!loops && gap > Math.max(DEDUPE.endsMeters, DEDUPE.endsShare * shorter.lengthM)) return null;
    // Two pages of one site are usually two real rides (the next section of a road). Merge them only
    // when the names share a road number or place and the lines end where the other ends.
    if (a.item.source === b.item.source) {
      if (sharedPlaceWord(a.item.name, b.item.name) === null && !sameName(a.item.name, b.item.name)) return null;
      if (!loops && gap > DEDUPE.sameSiteEndsMeters) return null;
    }
    return {
      a: a.item.id,
      b: b.item.id,
      method: "line",
      score: Math.round(score * 1000) / 1000,
      detail: `shorter line ${(shortOnLong * 100).toFixed(0)}% on the longer, longer ${(longOnShort * 100).toFixed(0)}% on the shorter, lengths ${(shorter.lengthM / 1609.344).toFixed(1)} and ${(longer.lengthM / 1609.344).toFixed(1)} mi, ${loops ? "a loop" : `ends ${Math.round(gap)} m apart`}`,
    };
  }
  // Two real lines that did not match are different rides, however alike their names.
  if (a.line !== null && b.line !== null && a.lengthM >= DEDUPE.minLineMeters && b.lengthM >= DEDUPE.minLineMeters) return null;
  const boxA = boxOf(a);
  const boxB = boxOf(b);
  if (boxA === null || boxB === null) return null;
  if (!a.item.states.some((state) => b.item.states.includes(state))) return null;
  const share = overlapShare(boxA, boxB);
  const milesA = a.item.miles;
  const milesB = b.item.miles;
  const ratio = milesA !== null && milesB !== null && milesA > 0 && milesB > 0 ? Math.max(milesA, milesB) / Math.min(milesA, milesB) : null;
  if (sameName(a.item.name, b.item.name)) {
    if (share < DEDUPE.boxOverlap) return null;
    if (ratio !== null && ratio > DEDUPE.milesRatio) return null;
  } else {
    // Names that differ but name the same road number or place: only when box and miles are nearly identical.
    const word = sharedPlaceWord(a.item.name, b.item.name);
    if (a.item.source === b.item.source) return null;
    if (word === null || share < DEDUPE.tightBox || ratio === null || ratio > DEDUPE.tightMiles) return null;
  }
  return {
    a: a.item.id,
    b: b.item.id,
    method: "box",
    score: Math.round(share * 1000) / 1000,
    detail: `${sameName(a.item.name, b.item.name) ? "same name" : `shared word "${sharedPlaceWord(a.item.name, b.item.name)}"`}, shared state, boxes overlap ${(share * 100).toFixed(0)}%${milesA !== null && milesB !== null ? `, ${milesA.toFixed(1)} and ${milesB.toFixed(1)} mi` : ""}`,
  };
}

/** The cells (0.25 degrees) a box touches; `null` for a box too wide to compare. */
function cellsOf(bounds: LibraryBounds): string[] | null {
  if (bounds.east - bounds.west > DEDUPE.maxBoxDegrees || bounds.north - bounds.south > DEDUPE.maxBoxDegrees) return null;
  const cells: string[] = [];
  const pad = 0.003;
  for (let x = Math.floor((bounds.west - pad) * 4); x <= Math.floor((bounds.east + pad) * 4); x += 1) {
    for (let y = Math.floor((bounds.south - pad) * 4); y <= Math.floor((bounds.north + pad) * 4); y += 1) cells.push(`${x},${y}`);
  }
  return cells;
}

export function findSameRoad(items: readonly DedupeItem[]): DedupeResult {
  const prepared: Prepared[] = items.map((item) => {
    if (item.line === null) return { item, line: null, lengthM: 0 };
    const load = typeof item.line === "function" ? item.line : () => item.line as readonly Coordinate[];
    const points = load();
    if (points.length < 2) return { item, line: null, lengthM: 0 };
    // Only the length is kept; the line is decoded again when a pair needs it.
    return { item, line: load, lengthM: lengthOf(points) };
  });
  const grid = new Map<string, number[]>();
  prepared.forEach((entry, index) => {
    if (entry.item.bounds === null) return;
    const cells = cellsOf(entry.item.bounds);
    if (cells === null) return;
    for (const cell of cells) {
      const list = grid.get(cell);
      if (list === undefined) grid.set(cell, [index]);
      else list.push(index);
    }
  });
  const tried = new Set<string>();
  const pairs: DedupePair[] = [];
  for (const members of grid.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = prepared[members[i]!]!;
        const right = prepared[members[j]!]!;
        const key = left.item.id < right.item.id ? `${left.item.id}\n${right.item.id}` : `${right.item.id}\n${left.item.id}`;
        if (tried.has(key)) continue;
        tried.add(key);
        if (left.item.id === right.item.id) continue;
        if (!boxesTouch(left.item.bounds!, right.item.bounds!)) continue;
        const pair = judge(left, right);
        if (pair !== null) pairs.push(pair);
      }
    }
  }
  pairs.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const pair of pairs) {
    const rootA = find(pair.a);
    const rootB = find(pair.b);
    if (rootA !== rootB) parent.set(rootB < rootA ? rootA : rootB, rootB < rootA ? rootB : rootA);
  }
  const byRoot = new Map<string, string[]>();
  for (const id of new Set(pairs.flatMap((pair) => [pair.a, pair.b]))) {
    const root = find(id);
    const list = byRoot.get(root);
    if (list === undefined) byRoot.set(root, [id]);
    else list.push(id);
  }
  const all = [...byRoot.values()].map((members) => members.sort()).sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
  return {
    groups: all.filter((members) => members.length <= DEDUPE.maxGroup),
    pairs,
    oversized: all.filter((members) => members.length > DEDUPE.maxGroup),
  };
}
