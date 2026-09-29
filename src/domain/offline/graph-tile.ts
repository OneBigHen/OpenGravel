/**
 * Offline road-graph tiles and region manifests (schema v2), ported from
 * SwitchBack `src/lib/offline/v2-contracts.ts`. The wire format is unchanged so
 * the regions SwitchBack already built (PA, NJ) serve as they are.
 *
 * Pure: no network, storage or workers. Validators take `unknown` and never
 * throw; corrupt input is `false`.
 */

export const OFFLINE_GRAPH_SCHEMA = 2 as const;

/** Wire coordinates stay tuples: a tile holds tens of thousands of them. */
export type GraphPosition = readonly [longitude: number, latitude: number];

export interface OfflineBounds {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export type OfflineAccessState = "permitted" | "designated" | "discouraged" | "forbidden";

export type OfflineRoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "unclassified"
  | "residential"
  | "track"
  | "path"
  | "service";

export type OfflineSurface =
  | "asphalt"
  | "concrete"
  | "gravel"
  | "dirt"
  | "paved"
  | "unpaved"
  | "ground"
  | "unknown";

export type OfflineSmoothness = "excellent" | "good" | "intermediate" | "bad" | "very_bad" | "horrible";

export type OfflineTrackType = "grade1" | "grade2" | "grade3" | "grade4" | "grade5";

/** The four primitive costs a built edge carries; profiles blend them. */
export interface OfflineProfileWeights {
  readonly quick: number;
  readonly twisty: number;
  readonly scenic: number;
  readonly adventure: number;
}

export interface OfflineTurnRestriction {
  readonly incomingEdgeId: string;
  readonly viaNodeId: string;
  readonly outgoingEdgeId: string;
  readonly restriction: "no_turn" | "only_turn";
  readonly sourceRelationId?: string;
}

export interface OfflineGraphNode {
  readonly id: string;
  readonly coordinate: GraphPosition;
}

export interface OfflineGraphEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /** Ordered polyline of at least two positions. */
  readonly geometry: readonly GraphPosition[];
  /** Decimal OSM way id; a string keeps the wire format JSON-safe. */
  readonly osmWayId: string;
  readonly motorcycleAccess: OfflineAccessState;
  readonly access: OfflineAccessState;
  readonly roadClass: OfflineRoadClass;
  readonly surface: OfflineSurface;
  readonly smoothness?: OfflineSmoothness;
  readonly trackType?: OfflineTrackType;
  readonly maxSpeedKph?: number;
  readonly profileWeights: OfflineProfileWeights;
  /** Provenance of anything the build inferred (e.g. "inferred_surface"). */
  readonly uncertainty: readonly string[];
}

export interface OfflineGraphTile {
  readonly schemaVersion: typeof OFFLINE_GRAPH_SCHEMA;
  readonly tileId: string;
  readonly bounds: OfflineBounds;
  readonly nodes: readonly OfflineGraphNode[];
  readonly edges: readonly OfflineGraphEdge[];
  readonly turnRestrictions: readonly OfflineTurnRestriction[];
}

export interface OfflineRegionTileEntry {
  readonly tileId: string;
  readonly bounds: OfflineBounds;
  readonly bytes: number;
  readonly sha256: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

export interface OfflineRegionManifest {
  readonly schemaVersion: typeof OFFLINE_GRAPH_SCHEMA;
  readonly regionId: string;
  readonly regionName: string;
  /** Immutable, content-addressed release id. */
  readonly version: string;
  readonly compression: "gzip-json";
  readonly buildDate: string;
  readonly sourceDataDate: string;
  readonly snapshotUrl: string;
  readonly sourceUrl: string;
  readonly bounds: OfflineBounds;
  /** Hash of the ordered `tileId:sha256` inventory. */
  readonly checksums: { readonly inventorySha256: string };
  readonly attribution: string;
  readonly tiles: readonly OfflineRegionTileEntry[];
  readonly tileByteTotal: number;
}

const ACCESS_STATES: readonly OfflineAccessState[] = ["permitted", "designated", "discouraged", "forbidden"];
const ROAD_CLASSES: readonly OfflineRoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "track",
  "path",
  "service",
];
const SURFACES: readonly OfflineSurface[] = [
  "asphalt",
  "concrete",
  "gravel",
  "dirt",
  "paved",
  "unpaved",
  "ground",
  "unknown",
];
const SMOOTHNESS: readonly OfflineSmoothness[] = ["excellent", "good", "intermediate", "bad", "very_bad", "horrible"];
const TRACK_TYPES: readonly OfflineTrackType[] = ["grade1", "grade2", "grade3", "grade4", "grade5"];
const HEX64 = /^[0-9a-fA-F]{64}$/;
const DECIMAL_ID = /^(0|[1-9][0-9]*)$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(value: unknown, set: readonly T[]): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

function isPosition(value: unknown): value is GraphPosition {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

export function isOfflineBounds(value: unknown): value is OfflineBounds {
  if (!isObject(value)) return false;
  const { minLon, minLat, maxLon, maxLat } = value;
  return (
    isFiniteNumber(minLon) &&
    isFiniteNumber(minLat) &&
    isFiniteNumber(maxLon) &&
    isFiniteNumber(maxLat) &&
    minLon <= maxLon &&
    minLat <= maxLat &&
    Math.abs(minLon) <= 180 &&
    Math.abs(maxLon) <= 180 &&
    Math.abs(minLat) <= 90 &&
    Math.abs(maxLat) <= 90
  );
}

export function boundsIntersect(a: OfflineBounds, b: OfflineBounds): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function isEdge(value: unknown, nodeIds: ReadonlySet<string>): value is OfflineGraphEdge {
  if (!isObject(value)) return false;
  const e = value;
  if (!isNonEmptyString(e.id)) return false;
  if (!isNonEmptyString(e.fromNodeId) || !nodeIds.has(e.fromNodeId)) return false;
  if (!isNonEmptyString(e.toNodeId) || !nodeIds.has(e.toNodeId)) return false;
  if (!Array.isArray(e.geometry) || e.geometry.length < 2 || !e.geometry.every(isPosition)) return false;
  if (typeof e.osmWayId !== "string" || !DECIMAL_ID.test(e.osmWayId)) return false;
  if (!isOneOf(e.motorcycleAccess, ACCESS_STATES) || !isOneOf(e.access, ACCESS_STATES)) return false;
  if (!isOneOf(e.roadClass, ROAD_CLASSES) || !isOneOf(e.surface, SURFACES)) return false;
  if (e.smoothness !== undefined && !isOneOf(e.smoothness, SMOOTHNESS)) return false;
  if (e.trackType !== undefined && !isOneOf(e.trackType, TRACK_TYPES)) return false;
  if (e.maxSpeedKph !== undefined && !(isFiniteNumber(e.maxSpeedKph) && e.maxSpeedKph > 0)) return false;
  const weights = e.profileWeights;
  if (
    !isObject(weights) ||
    !isNonNegative(weights.quick) ||
    !isNonNegative(weights.twisty) ||
    !isNonNegative(weights.scenic) ||
    !isNonNegative(weights.adventure)
  ) {
    return false;
  }
  return Array.isArray(e.uncertainty) && e.uncertainty.every((u) => typeof u === "string");
}

export function isOfflineGraphTile(input: unknown): input is OfflineGraphTile {
  if (!isObject(input)) return false;
  const { schemaVersion, tileId, bounds, nodes, edges, turnRestrictions } = input;
  if (schemaVersion !== OFFLINE_GRAPH_SCHEMA || !isNonEmptyString(tileId) || !isOfflineBounds(bounds)) return false;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(turnRestrictions)) return false;

  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (!isObject(n) || !isNonEmptyString(n.id) || nodeIds.has(n.id) || !isPosition(n.coordinate)) return false;
    nodeIds.add(n.id);
  }

  const edgesById = new Map<string, OfflineGraphEdge>();
  for (const e of edges) {
    if (!isEdge(e, nodeIds) || edgesById.has(e.id)) return false;
    edgesById.set(e.id, e);
  }

  // Every restriction resolves, and its via node joins the two edges.
  const signatures = new Set<string>();
  for (const r of turnRestrictions) {
    if (!isObject(r)) return false;
    const { incomingEdgeId, viaNodeId, outgoingEdgeId, restriction, sourceRelationId } = r;
    if (!isNonEmptyString(incomingEdgeId) || !isNonEmptyString(viaNodeId) || !isNonEmptyString(outgoingEdgeId)) {
      return false;
    }
    if (restriction !== "no_turn" && restriction !== "only_turn") return false;
    if (sourceRelationId !== undefined && (typeof sourceRelationId !== "string" || !DECIMAL_ID.test(sourceRelationId))) {
      return false;
    }
    if (!nodeIds.has(viaNodeId)) return false;
    const incoming = edgesById.get(incomingEdgeId);
    const outgoing = edgesById.get(outgoingEdgeId);
    if (incoming === undefined || outgoing === undefined) return false;
    const touches = (edge: OfflineGraphEdge) => edge.fromNodeId === viaNodeId || edge.toNodeId === viaNodeId;
    if (!touches(incoming) || !touches(outgoing)) return false;
    const signature = `${incomingEdgeId}|${viaNodeId}|${outgoingEdgeId}|${restriction}`;
    if (signatures.has(signature)) return false;
    signatures.add(signature);
  }
  return true;
}

export function isOfflineRegionManifest(input: unknown): input is OfflineRegionManifest {
  if (!isObject(input)) return false;
  const m = input;
  if (m.schemaVersion !== OFFLINE_GRAPH_SCHEMA || m.compression !== "gzip-json") return false;
  for (const key of ["regionId", "regionName", "version", "buildDate", "sourceDataDate", "snapshotUrl", "sourceUrl", "attribution"]) {
    if (!isNonEmptyString(m[key])) return false;
  }
  if (!isOfflineBounds(m.bounds)) return false;
  if (!isObject(m.checksums) || typeof m.checksums.inventorySha256 !== "string" || !HEX64.test(m.checksums.inventorySha256)) {
    return false;
  }
  if (!Array.isArray(m.tiles) || m.tiles.length === 0) return false;

  const tileIds = new Set<string>();
  let inventoryBytes = 0;
  for (const t of m.tiles) {
    if (!isObject(t) || !isNonEmptyString(t.tileId) || tileIds.has(t.tileId)) return false;
    tileIds.add(t.tileId);
    if (!isOfflineBounds(t.bounds)) return false;
    if (!isNonNegative(t.bytes) || t.bytes <= 0) return false;
    if (typeof t.sha256 !== "string" || !HEX64.test(t.sha256)) return false;
    if (!isCount(t.nodeCount) || !isCount(t.edgeCount)) return false;
    inventoryBytes += t.bytes;
  }
  return isNonNegative(m.tileByteTotal) && m.tileByteTotal > 0 && inventoryBytes === m.tileByteTotal;
}

/** The manifest tiles a search area needs, e.g. a ride's bounds plus a margin. */
export function tilesCovering(
  manifest: Pick<OfflineRegionManifest, "tiles">,
  area: OfflineBounds,
): readonly OfflineRegionTileEntry[] {
  return manifest.tiles.filter((tile) => boundsIntersect(tile.bounds, area));
}

/**
 * The area an offline search loads for these waypoints: their box, widened by
 * a quarter of its size and at least ~5 km, so a detour around a river or a
 * ridge stays inside what is loaded. `null` when there is nothing to route.
 */
export function offlineSearchArea(waypoints: readonly { readonly lon: number; readonly lat: number }[]): OfflineBounds | null {
  if (waypoints.length < 2) return null;
  const lons = waypoints.map((p) => p.lon);
  const lats = waypoints.map((p) => p.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const padLon = Math.max(0.06, (maxLon - minLon) * 0.25);
  const padLat = Math.max(0.045, (maxLat - minLat) * 0.25);
  return { minLon: minLon - padLon, minLat: minLat - padLat, maxLon: maxLon + padLon, maxLat: maxLat + padLat };
}
