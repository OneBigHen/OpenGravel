/**
 * Stable road identity and lineage (07-ROAD-INTELLIGENCE §3; Task 6.2).
 *
 * A road entity is deliberately smaller than a routing graph edge. Its identity
 * is made from the rider-facing normalized name, the road class, and endpoint
 * cells. Geometry fingerprints live on the entity as spans; they are evidence
 * for reconciliation, not a reason to silently replace an entity. In
 * particular, a renamed or split road receives a new id and an explicit
 * lineage link.
 *
 * This file is a pure domain module: no framework, storage, clock, randomness,
 * or provider imports.
 */

import type { Coordinate } from "../ride/types";
import { asRoadEntityId, type RoadEntityId } from "../ride/ids";
import { deepFreeze } from "../util/freeze";

/** Common road classes. Adapters may carry a more specific class string. */
export type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "service"
  | "track"
  | "unknown"
  | (string & {});

/** Why a new entity remains linked to an older one. */
export type RoadLineageReason =
  | "renamed"
  | "split"
  | "merged"
  | "graph-update"
  | "identity-correction"
  | (string & {});

export interface RoadLineageEntry {
  readonly parentId?: RoadEntityId;
  readonly reason: RoadLineageReason;
}

/** A geometry fingerprint for one observed routable span. */
export type RoadGeometryFingerprint = string;

export interface RoadEntity {
  readonly id: RoadEntityId;
  readonly name: string;
  readonly normalizedName: string;
  readonly class: RoadClass;
  readonly lineage: readonly RoadLineageEntry[];
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly spans: readonly RoadGeometryFingerprint[];
  readonly evidenceRefs: readonly string[];
}

export interface RoadIdentityInput {
  readonly name: string;
  readonly class: RoadClass;
  /** At least two positions; only the first and last become identity cells. */
  readonly endpoints: readonly Coordinate[];
}

export interface RoadEntityInput extends RoadIdentityInput {
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly spans?: readonly RoadGeometryFingerprint[];
  readonly evidenceRefs?: readonly string[];
  readonly lineage?: readonly RoadLineageEntry[];
}

export interface RoadNameNormalizationTables {
  /** Adapter-specific aliases. Keys and values are normalized before use. */
  readonly aliases?: Readonly<Record<string, string>>;
}

/** One degree cell is too broad for parallel-road identity; this is about 11 m. */
export const ROAD_ENDPOINT_CELL_DEGREES = 0.0001;

/** The built-in spellings that are safe across road-name adapters. */
export const DEFAULT_ROAD_NAME_ALIASES: Readonly<Record<string, string>> = deepFreeze({
  "pa route": "pa",
  pennsylvania: "pa",
  "pennsylvania route": "pa",
  "pennsylvania state route": "pa",
  "state route": "route",
  "state highway": "route",
  highway: "route",
  hwy: "route",
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  parkway: "pkwy",
  turnpike: "tpke",
} as Record<string, string>);

function basicName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function applyWordAliases(value: string, aliases: Readonly<Record<string, string>>): string {
  const words = value.split(" ").filter(Boolean);
  const output: string[] = [];
  let index = 0;
  while (index < words.length) {
    const one = words[index]!;
    const two = index + 1 < words.length ? `${one} ${words[index + 1]}` : "";
    const three = index + 2 < words.length ? `${two} ${words[index + 2]}` : "";
    const match = (three.length > 0 ? aliases[three] : undefined)
      ?? (two.length > 0 ? aliases[two] : undefined)
      ?? aliases[one];
    if (match !== undefined) {
      output.push(...basicName(match).split(" "));
      index += three.length > 0 && aliases[three] !== undefined
        ? 3
        : two.length > 0 && aliases[two] !== undefined
          ? 2
          : 1;
    } else {
      output.push(one);
      index += 1;
    }
  }
  return output.join(" ");
}

/**
 * Normalizes names without erasing meaningful road identity. The default table
 * handles common suffixes and route-reference spellings; an adapter can add a
 * locally authoritative alias table without changing the domain algorithm.
 */
export function normalizeRoadName(
  name: string,
  tables: RoadNameNormalizationTables = {},
): string {
  const configured: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...DEFAULT_ROAD_NAME_ALIASES,
    ...(tables.aliases ?? {}),
  })) {
    configured[basicName(key)] = basicName(value);
  }
  return applyWordAliases(basicName(name), configured);
}

function normalizeClass(value: RoadClass): string {
  return basicName(value);
}

function isFiniteCoordinate(value: Coordinate): boolean {
  return Number.isFinite(value.lon)
    && value.lon >= -180
    && value.lon <= 180
    && Number.isFinite(value.lat)
    && value.lat >= -90
    && value.lat <= 90;
}

function endpointCell(coordinate: Coordinate): string {
  const lonCell = Math.floor((coordinate.lon + 180) / ROAD_ENDPOINT_CELL_DEGREES);
  const latCell = Math.floor((coordinate.lat + 90) / ROAD_ENDPOINT_CELL_DEGREES);
  return `${lonCell}:${latCell}`;
}

function endpointCells(endpoints: readonly Coordinate[]): readonly string[] {
  const first = endpoints[0];
  const last = endpoints.at(-1);
  if (first === undefined || last === undefined || !isFiniteCoordinate(first) || !isFiniteCoordinate(last)) {
    throw new Error("A road identity needs two finite endpoint coordinates.");
  }
  return [endpointCell(first), endpointCell(last)].sort();
}

/** The canonical material used by both id generation and identity comparison. */
export function roadIdentityKey(
  input: RoadIdentityInput,
  tables: RoadNameNormalizationTables = {},
): string {
  if (input.endpoints.length < 2) {
    throw new Error("A road identity needs at least two endpoint coordinates.");
  }
  const normalizedName = normalizeRoadName(input.name, tables);
  if (normalizedName.length === 0) throw new Error("A road identity needs a name.");
  return [normalizedName, normalizeClass(input.class), ...endpointCells(input.endpoints)].join("|");
}

/**
 * A deterministic 64-bit FNV-1a hash. This is an identity fingerprint, not a
 * security primitive; the canonical key remains available for diagnostics.
 */
function stableHash(value: string): string {
  let hash = 14695981039346656037n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Stable identity for a name/class/endpoints tuple. */
export function roadEntityIdFor(
  input: RoadIdentityInput,
  tables: RoadNameNormalizationTables = {},
): RoadEntityId {
  return asRoadEntityId(`road_${stableHash(roadIdentityKey(input, tables))}`);
}

/** Whether two observations describe exactly the same identity tuple. */
export function sameRoadIdentity(
  left: RoadIdentityInput,
  right: RoadIdentityInput,
  tables: RoadNameNormalizationTables = {},
): boolean {
  return roadIdentityKey(left, tables) === roadIdentityKey(right, tables);
}

/** Materializes an immutable entity; it never looks up or overwrites another entity. */
export function createRoadEntity(
  input: RoadEntityInput,
  tables: RoadNameNormalizationTables = {},
): RoadEntity {
  const normalizedName = normalizeRoadName(input.name, tables);
  return deepFreeze({
    id: roadEntityIdFor(input, tables),
    name: input.name,
    normalizedName,
    class: input.class,
    lineage: input.lineage === undefined ? [] : input.lineage.map((entry) => ({ ...entry })),
    firstSeen: input.firstSeen,
    lastSeen: input.lastSeen,
    spans: input.spans === undefined ? [] : [...new Set(input.spans)],
    evidenceRefs: input.evidenceRefs === undefined ? [] : [...new Set(input.evidenceRefs)],
  });
}

/** Creates a renamed entity with an explicit parent; the id necessarily changes. */
export function createRenamedRoadEntity(
  previous: RoadEntity,
  input: Omit<RoadEntityInput, "lineage">,
  tables: RoadNameNormalizationTables = {},
): RoadEntity {
  if (normalizeRoadName(input.name, tables) === previous.normalizedName) {
    throw new Error("A renamed road must have a different normalized name.");
  }
  if (normalizeClass(previous.class) !== normalizeClass(input.class)) {
    throw new Error("A renamed road must retain its class.");
  }
  return createRoadEntity({
    ...input,
    firstSeen: previous.firstSeen < input.firstSeen ? previous.firstSeen : input.firstSeen,
    lastSeen: previous.lastSeen > input.lastSeen ? previous.lastSeen : input.lastSeen,
    spans: [...new Set([...previous.spans, ...(input.spans ?? [])])],
    evidenceRefs: [...new Set([...previous.evidenceRefs, ...(input.evidenceRefs ?? [])])],
    lineage: [{ parentId: previous.id, reason: "renamed" }],
  }, tables);
}

/** Adds a lineage relation while preserving all other entity facts. */
export function withRoadLineage(
  entity: RoadEntity,
  entry: RoadLineageEntry,
): RoadEntity {
  return deepFreeze({ ...entity, lineage: [...entity.lineage, { ...entry }] });
}
