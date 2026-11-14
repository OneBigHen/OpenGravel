import { decodeLine, splitSegments } from "./geometry";
import { FLAG, type IndexRow } from "./types";

/**
 * The phone's side of the national ride library: fetch the manifest, then the
 * versioned index once (the browser's own cache does the rest), and filter and
 * sort it in memory. Lines come one state at a time, only for states in view.
 */

export interface LibraryManifest {
  readonly version: string;
  readonly builtAt: string;
  readonly rides: number;
  readonly located: number;
  readonly withLine: number;
  readonly states: Readonly<Record<string, number>>;
}

export interface LibraryIndex {
  readonly version: string;
  readonly precision: number;
  readonly sources: readonly string[];
  readonly stateCounts: Readonly<Record<string, number>>;
  readonly rows: readonly IndexRow[];
}

/** One drawn line: its parts as [lon, lat] pairs (a trail bundle has many parts). */
export type LinePart = readonly (readonly [number, number])[];
export type StateLines = ReadonlyMap<string, readonly LinePart[]>;

export interface RouteLibrary {
  readonly version: string;
  readonly rows: readonly IndexRow[];
  readonly sources: readonly string[];
  readonly stateCounts: Readonly<Record<string, number>>;
  /** One state's lines, fetched once and kept; `null` when they could not be fetched. */
  linesFor(state: string): Promise<StateLines | null>;
}

/** The chips, in the order a rider sees them. `trips` is the Big trips flag, not a type. */
export const LIBRARY_CHIPS = ["twisty", "scenic", "dirt", "trails", "trips"] as const;
export type LibraryChip = (typeof LIBRARY_CHIPS)[number];

export const LIBRARY_CHIP_LABEL: Readonly<Record<LibraryChip, string>> = {
  twisty: "Twisty",
  scenic: "Scenic",
  dirt: "Dirt",
  trails: "Trails",
  trips: "Big trips",
};

export interface ViewBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface RowFilter {
  readonly types?: readonly LibraryChip[];
  readonly standoutOnly?: boolean;
  readonly bounds?: ViewBounds;
}

export function hasLine(row: IndexRow): boolean {
  return (row.f & FLAG.line) !== 0;
}

function matchesChip(row: IndexRow, chip: LibraryChip): boolean {
  switch (chip) {
    case "twisty": return row.t === "twisty";
    case "scenic": return row.t === "scenic";
    case "dirt": return row.t === "dirt";
    case "trails": return row.t === "trail";
    case "trips": return row.k === "trip";
  }
}

function inBounds(row: IndexRow, bounds: ViewBounds): boolean {
  if (row.p === null) return false;
  const [lat, lon] = row.p;
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

/** Rows that pass every filter. Several chips mean "any of these". */
export function filterRows(rows: readonly IndexRow[], filter: RowFilter): readonly IndexRow[] {
  const { types, standoutOnly, bounds } = filter;
  if ((types === undefined || types.length === 0) && standoutOnly !== true && bounds === undefined) return rows;
  const out: IndexRow[] = [];
  for (const row of rows) {
    if (standoutOnly === true && row.q < 5) continue;
    if (types !== undefined && types.length > 0 && !types.some((chip) => matchesChip(row, chip))) continue;
    if (bounds !== undefined && !inBounds(row, bounds)) continue;
    out.push(row);
  }
  return out;
}

function kmBetween(origin: readonly [number, number], point: readonly [number, number]): number {
  const radians = Math.PI / 180;
  const dLat = (point[0] - origin[0]) * radians;
  const dLon = (point[1] - origin[1]) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(origin[0] * radians) * Math.cos(point[0] * radians) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Best first: our score, then rides that have a line, then (when the rider's
 * place is known, as [lat, lon]) the nearer start, then the name so the order
 * never shuffles between renders. A ride with no place is last among equals.
 */
export function sortBest(rows: readonly IndexRow[], origin?: readonly [number, number]): readonly IndexRow[] {
  const away = new Map<string, number>();
  if (origin !== undefined) for (const row of rows) away.set(row.id, row.p === null ? Infinity : kmBetween(origin, row.p));
  return [...rows].sort((a, b) =>
    b.q - a.q
    || Number(hasLine(b)) - Number(hasLine(a))
    || (origin === undefined ? 0 : (away.get(a.id) ?? Infinity) - (away.get(b.id) ?? Infinity))
    || a.n.localeCompare(b.n)
    || a.id.localeCompare(b.id));
}

/** How many rides sit in each state under the current filters (a multi-state ride counts in each). */
export function countByState(rows: readonly IndexRow[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of rows) for (const state of row.st) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}

/** The parts of one stored line as [lon, lat] pairs. Bad text gives no parts, never a throw. */
export function lineParts(stored: string): readonly LinePart[] {
  const parts: LinePart[] = [];
  for (const text of splitSegments(stored)) {
    try {
      const points = decodeLine(text).map((point) => [point.lon, point.lat] as const);
      if (points.length >= 2) parts.push(points);
    } catch {
      // A damaged part is skipped; the ride's other parts still draw.
    }
  }
  return parts;
}

function parseIndex(value: unknown): LibraryIndex | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["version"] !== "string" || !Array.isArray(record["rows"]) || !Array.isArray(record["sources"])) return null;
  return {
    version: record["version"],
    precision: typeof record["precision"] === "number" ? record["precision"] : 5,
    sources: record["sources"] as readonly string[],
    stateCounts: (record["stateCounts"] ?? {}) as Readonly<Record<string, number>>,
    rows: record["rows"] as readonly IndexRow[],
  };
}

type Fetcher = (input: string) => Promise<Response>;

/**
 * Loads the library. `null` means it is off (no manifest, or any step failing):
 * Explore then renders exactly as it did before the library existed.
 */
export async function loadRouteLibrary(fetcher: Fetcher = (input) => fetch(input)): Promise<RouteLibrary | null> {
  try {
    const manifestResponse = await fetcher("/api/route-library/manifest");
    if (!manifestResponse.ok) return null;
    const manifest = await manifestResponse.json() as Partial<LibraryManifest>;
    if (typeof manifest.version !== "string") return null;
    const indexResponse = await fetcher(`/api/route-library/${encodeURIComponent(manifest.version)}/index.json`);
    if (!indexResponse.ok) return null;
    const index = parseIndex(await indexResponse.json());
    if (index === null || index.rows.length === 0) return null;
    const lines = new Map<string, Promise<StateLines | null>>();
    return {
      version: index.version,
      rows: index.rows,
      sources: index.sources,
      stateCounts: index.stateCounts,
      linesFor(state: string): Promise<StateLines | null> {
        const known = lines.get(state);
        if (known !== undefined) return known;
        const pending = (async (): Promise<StateLines | null> => {
          try {
            const response = await fetcher(`/api/route-library/${encodeURIComponent(index.version)}/lines/${encodeURIComponent(state)}.json`);
            if (!response.ok) return null;
            const body = await response.json() as { readonly lines?: readonly (readonly [string, string])[] };
            const byId = new Map<string, readonly LinePart[]>();
            for (const [id, stored] of body.lines ?? []) {
              const parts = lineParts(stored);
              if (parts.length > 0) byId.set(id, parts);
            }
            return byId;
          } catch {
            return null;
          }
        })();
        lines.set(state, pending);
        // A failed state may be asked for again; a good one is kept for the session.
        void pending.then((result) => { if (result === null) lines.delete(state); });
        return pending;
      },
    };
  } catch {
    return null;
  }
}
