/**
 * Offline truth is deliberately a matrix, not one readiness flag.
 *
 * This module only evaluates facts supplied by the application/runtime seam. It
 * never assumes that a saved ride, a browser cache, or a provider declaration
 * implies another capability.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

export const OFFLINE_CAPABILITIES = [
  "plan.route",
  "plan.replan",
  "nav.guidance",
  "nav.reroute",
  "explore.browse",
  "library.read",
  "weather.live",
  "traffic.live",
  "import.export",
] as const;

export type OfflineCapability = (typeof OFFLINE_CAPABILITIES)[number];

export type OfflineCapabilityState =
  | { readonly state: "available"; readonly reason?: string }
  | { readonly state: "degraded"; readonly reason: string }
  | { readonly state: "requires_network"; readonly reason: string };

export type CapabilityMatrix = Readonly<Record<OfflineCapability, OfflineCapabilityState>>;

export type CachePresence = "present" | "absent" | "unknown";

/** A cache fact must carry enough information to distinguish fresh from stale. */
export interface OfflineCacheFact {
  readonly presence: CachePresence;
  readonly cachedAt?: string;
  readonly maxAgeMs?: number;
}

export type ServiceWorkerState = "controlled" | "registered" | "absent" | "unknown";

export interface ServiceWorkerFact {
  readonly state: ServiceWorkerState;
}

export interface OfflineProviderFact {
  readonly state: "available" | "degraded" | "unavailable";
  readonly reason: string | null;
}

export interface OfflineLocalCapabilityFact {
  readonly state: "available" | "degraded" | "unavailable";
  readonly reason: string | null;
}

export interface OfflineRuntimeFacts {
  readonly now: string;
  readonly networkOnline: boolean;
  readonly serviceWorker: ServiceWorkerFact;
  readonly caches: {
    readonly appShell: OfflineCacheFact;
    readonly routeGeometry: OfflineCacheFact;
    readonly routeInstructions: OfflineCacheFact;
    readonly mapTiles: OfflineCacheFact;
    readonly routeData: OfflineCacheFact;
    readonly exploreCatalog: OfflineCacheFact;
    readonly offlineGraph: OfflineCacheFact;
  };
  readonly local: {
    readonly library: OfflineLocalCapabilityFact;
    readonly importExport: OfflineLocalCapabilityFact;
  };
  readonly providers: {
    readonly weather: OfflineProviderFact;
    readonly traffic: OfflineProviderFact;
  };
}

export interface CorridorBounds {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface CorridorTileRef {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface CorridorPackManifest {
  readonly version: 1;
  readonly rideId: string;
  readonly routeRevision: number;
  readonly createdAt: string;
  readonly bounds: CorridorBounds;
  readonly tileZoom: number;
  readonly tiles: readonly CorridorTileRef[];
  /** Opaque provider/data references; the pack has no provider implementation. */
  readonly dataRefs: readonly string[];
}

/** Runtime validation for the untrusted manifest stored beside a ride row. */
export function corridorPackManifestIsValid(value: unknown): value is CorridorPackManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const bounds = candidate["bounds"];
  const tiles = candidate["tiles"];
  const dataRefs = candidate["dataRefs"];
  if (candidate["version"] !== 1
    || typeof candidate["rideId"] !== "string"
    || typeof candidate["routeRevision"] !== "number"
    || !Number.isInteger(candidate["routeRevision"])
    || candidate["routeRevision"] < 0
    || typeof candidate["createdAt"] !== "string"
    || typeof candidate["tileZoom"] !== "number"
    || !Number.isInteger(candidate["tileZoom"])
    || candidate["tileZoom"] < 0
    || candidate["tileZoom"] > 22
    || typeof bounds !== "object"
    || bounds === null
    || Array.isArray(bounds)
    || !["minLon", "minLat", "maxLon", "maxLat"].every((key) => finite((bounds as Record<string, unknown>)[key] as number))
    || !Array.isArray(tiles)
    || !Array.isArray(dataRefs)) return false;
  return tiles.every((tile) => {
    if (typeof tile !== "object" || tile === null || Array.isArray(tile)) return false;
    const candidateTile = tile as Record<string, unknown>;
    return Number.isInteger(candidateTile["z"])
      && Number.isInteger(candidateTile["x"])
      && Number.isInteger(candidateTile["y"])
      && (candidateTile["z"] as number) >= 0
      && (candidateTile["x"] as number) >= 0
      && (candidateTile["y"] as number) >= 0;
  }) && dataRefs.every((ref) => typeof ref === "string");
}

export interface BuildCorridorPackInput {
  readonly rideId: string;
  readonly routeRevision: number;
  readonly geometry: readonly Coordinate[];
  readonly createdAt: string;
  readonly tileZoom?: number;
  readonly dataRefs?: readonly string[];
}

export type CorridorPieceKind =
  | "map-tile"
  | "route-geometry"
  | "route-data"
  | "instructions"
  | "routing-graph";

export type CorridorPieceState = "cached" | "stale" | "uncached" | "unknown";

export interface RouteReadinessPieceInput {
  readonly ref: string;
  readonly kind: CorridorPieceKind;
  /** The route length represented by this piece, never a guessed percentage. */
  readonly lengthMeters: number;
  readonly state: CorridorPieceState;
  readonly reason?: string;
}

export interface RouteReadinessPiece extends RouteReadinessPieceInput {
  readonly ready: boolean;
  readonly reason: string;
}

export interface RouteReadinessInput {
  readonly now: string;
  readonly rideId: string;
  readonly routeRevision: number;
  readonly manifest: CorridorPackManifest | null;
  readonly geometry?: readonly Coordinate[];
  readonly pieces: readonly RouteReadinessPieceInput[];
}

export interface RouteReadiness {
  readonly state: "ready" | "degraded" | "not_ready";
  readonly ready: boolean;
  /** Fresh, usable corridor length divided by total corridor length. */
  readonly coveragePercent: number;
  /** Stale corridor length divided by total corridor length. */
  readonly stalePercent: number;
  readonly pieces: readonly RouteReadinessPiece[];
  readonly reasons: readonly string[];
}

const DEFAULT_TILE_ZOOM = 12;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function tileForCoordinate(coordinate: Coordinate, zoom: number): CorridorTileRef {
  const size = 2 ** zoom;
  const normalizedLon = Math.min(179.999999999, Math.max(-180, coordinate.lon));
  const x = Math.min(size - 1, Math.max(0, Math.floor(((normalizedLon + 180) / 360) * size)));
  const latitude = Math.min(85.05112878, Math.max(-85.05112878, coordinate.lat));
  const radians = (latitude * Math.PI) / 180;
  const projectedY = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
  const y = Math.min(size - 1, Math.max(0, Math.floor(projectedY * size)));
  return { z: zoom, x, y };
}

function tileKey(tile: CorridorTileRef): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function validGeometry(geometry: readonly Coordinate[]): boolean {
  return geometry.length >= 2 && geometry.every((point) =>
    finite(point.lon) && finite(point.lat)
    && point.lon >= -180 && point.lon <= 180
    && point.lat >= -90 && point.lat <= 90,
  );
}

/** Build the durable, download-free description of a route corridor pack. */
export function buildCorridorPackManifest(input: BuildCorridorPackInput): CorridorPackManifest {
  const geometry = input.geometry;
  if (!validGeometry(geometry)) {
    throw new Error("A corridor pack needs at least two valid route coordinates.");
  }
  const tileZoom = input.tileZoom ?? DEFAULT_TILE_ZOOM;
  if (!Number.isInteger(tileZoom) || tileZoom < 0 || tileZoom > 22) {
    throw new Error("Corridor tile zoom must be an integer between 0 and 22.");
  }
  const longitudes = geometry.map((point) => point.lon);
  const latitudes = geometry.map((point) => point.lat);
  const tiles = new Map<string, CorridorTileRef>();
  for (let index = 0; index < geometry.length; index += 1) {
    const point = geometry[index];
    if (point !== undefined) {
      const tile = tileForCoordinate(point, tileZoom);
      tiles.set(tileKey(tile), tile);
    }
    const next = geometry[index + 1];
    if (point !== undefined && next !== undefined) {
      const midpoint = {
        lon: (point.lon + next.lon) / 2,
        lat: (point.lat + next.lat) / 2,
      };
      const tile = tileForCoordinate(midpoint, tileZoom);
      tiles.set(tileKey(tile), tile);
    }
  }
  return {
    version: 1,
    rideId: input.rideId,
    routeRevision: input.routeRevision,
    createdAt: input.createdAt,
    bounds: {
      minLon: Math.min(...longitudes),
      minLat: Math.min(...latitudes),
      maxLon: Math.max(...longitudes),
      maxLat: Math.max(...latitudes),
    },
    tileZoom,
    tiles: [...tiles.values()],
    dataRefs: [...(input.dataRefs ?? [])],
  };
}

function freshness(fact: OfflineCacheFact, now: string, label: string): OfflineCapabilityState {
  if (fact.presence === "absent") return { state: "requires_network", reason: `${label} is not cached.` };
  if (fact.presence === "unknown") return { state: "degraded", reason: `${label} cache state is unknown.` };
  if (fact.cachedAt === undefined) return { state: "degraded", reason: `${label} cache age is unknown.` };
  const cachedAt = Date.parse(fact.cachedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(cachedAt) || !Number.isFinite(current)) {
    return { state: "degraded", reason: `${label} cache age is invalid.` };
  }
  if (fact.maxAgeMs !== undefined && current - cachedAt > fact.maxAgeMs) {
    return { state: "degraded", reason: `${label} cache is stale.` };
  }
  return { state: "available" };
}

/** Map one cache observation to the route-piece vocabulary without optimism. */
export function cacheFactState(
  fact: OfflineCacheFact,
  now: string,
): CorridorPieceState {
  if (fact.presence === "absent") return "uncached";
  if (fact.presence === "unknown") return "unknown";
  if (fact.cachedAt === undefined) return "stale";
  const cachedAt = Date.parse(fact.cachedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(cachedAt) || !Number.isFinite(current)) return "stale";
  return fact.maxAgeMs !== undefined && current - cachedAt > fact.maxAgeMs ? "stale" : "cached";
}

function combineCacheFacts(
  facts: readonly [OfflineCacheFact, label: string][],
  now: string,
  missingReason: string,
): OfflineCapabilityState {
  const states = facts.map(([fact, label]) => freshness(fact, now, label));
  if (states.some((entry) => entry.state === "requires_network")) {
    return { state: "requires_network", reason: missingReason };
  }
  const degraded = states.find((entry) => entry.state === "degraded");
  return degraded ?? { state: "available" };
}

function shellState(facts: OfflineRuntimeFacts): OfflineCapabilityState {
  const shell = freshness(facts.caches.appShell, facts.now, "The app");
  if (facts.serviceWorker.state === "controlled" && shell.state === "available") return shell;
  if (shell.state === "requires_network") {
    return { state: "requires_network", reason: "You'll need a connection to open OpenGravel again offline." };
  }
  return {
    state: "degraded",
    reason: facts.serviceWorker.state === "controlled"
      ? shell.reason ?? "The app was not saved for offline use on this device."
      : "This browser has not saved the app for offline use.",
  };
}

function combineCapabilityStates(
  states: readonly OfflineCapabilityState[],
  networkReason: string,
): OfflineCapabilityState {
  const requiresNetwork = states.find((entry) => entry.state === "requires_network");
  if (requiresNetwork !== undefined) return { state: "requires_network", reason: networkReason };
  return states.find((entry) => entry.state === "degraded") ?? { state: "available" };
}

function localState(fact: OfflineLocalCapabilityFact): OfflineCapabilityState {
  if (fact.state === "available") return { state: "available" };
  return {
    state: "degraded",
    reason: fact.reason ?? "Could not be checked on this device.",
  };
}

function liveProviderState(fact: OfflineProviderFact, label: string): OfflineCapabilityState {
  return {
    state: "requires_network",
    reason: fact.state === "available"
      ? `${label} needs a connection.`
      : fact.reason ?? `${label} needs a connection and is not available right now.`,
  };
}

/** Derive every matrix cell from explicit runtime/cache/provider facts. */
export function buildCapabilityMatrix(facts: OfflineRuntimeFacts): CapabilityMatrix {
  const graph = freshness(facts.caches.offlineGraph, facts.now, "Offline route data");
  const geometry = freshness(facts.caches.routeGeometry, facts.now, "Route geometry");
  const instructions = freshness(facts.caches.routeInstructions, facts.now, "Turn instructions");
  const mapTiles = freshness(facts.caches.mapTiles, facts.now, "Map tiles");
  const shell = shellState(facts);
  const graphBackedPlanning = combineCapabilityStates(
    [shell, graph],
    "You'll need a connection to plan this ride; its offline data is not saved on this device yet.",
  );
  const guidance = combineCacheFacts(
    [[facts.caches.routeGeometry, "Route geometry"], [facts.caches.routeInstructions, "Turn instructions"]],
    facts.now,
    "Route geometry and instructions need the network.",
  );
  const guidanceState: OfflineCapabilityState =
    geometry.state === "requires_network"
      ? guidance
      : shell.state === "requires_network"
        ? shell
        : instructions.state === "degraded" || mapTiles.state === "degraded" || shell.state === "degraded"
          ? { state: "degraded", reason: instructions.reason ?? mapTiles.reason ?? shell.reason ?? "Guidance is partial." }
          : guidance;
  return {
    "plan.route": graphBackedPlanning,
    "plan.replan": graphBackedPlanning,
    "nav.guidance": guidanceState,
    "nav.reroute": combineCapabilityStates(
      [shell, combineCacheFacts(
        [[facts.caches.offlineGraph, "Offline route data"], [facts.caches.routeData, "Route data"]],
        facts.now,
        "This ride's route data is not saved for offline rerouting yet.",
      )],
      "You'll need a connection to reroute this ride; its offline data is not saved on this device yet.",
    ),
    "explore.browse": combineCapabilityStates(
      [shell, freshness(facts.caches.exploreCatalog, facts.now, "Explore data")],
      "You'll need a connection to browse Explore.",
    ),
    "library.read": localState(facts.local.library),
    "weather.live": liveProviderState(facts.providers.weather, "Live weather"),
    "traffic.live": liveProviderState(facts.providers.traffic, "Live traffic"),
    "import.export": localState(facts.local.importExport),
  };
}

function normalizedLength(value: number): number {
  return finite(value) && value > 0 ? value : 0;
}

function pieceReason(piece: RouteReadinessPieceInput): string {
  if (piece.reason !== undefined && piece.reason.trim() !== "") return piece.reason;
  switch (piece.state) {
    case "cached":
      return "Cached and fresh.";
    case "stale":
      return "Cached data is stale.";
    case "uncached":
      return "This corridor piece is not cached.";
    case "unknown":
      return "Cache state is unknown.";
  }
}

/**
 * Evaluate a route's corridor evidence. A missing manifest, malformed geometry,
 * unknown piece, or uncached piece is never promoted to ready.
 */
export function routeReadiness(input: RouteReadinessInput): RouteReadiness {
  const reasons = new Set<string>();
  if (input.manifest === null) reasons.add("No corridor pack manifest is stored for this route.");
  if (input.manifest !== null && (input.manifest.rideId !== input.rideId || input.manifest.routeRevision !== input.routeRevision)) {
    reasons.add("The stored corridor pack belongs to a different route revision.");
  }
  if (input.geometry !== undefined && !validGeometry(input.geometry)) {
    reasons.add("The selected route geometry is unavailable or invalid.");
  }
  const pieces = input.pieces.map((piece): RouteReadinessPiece => {
    const lengthMeters = normalizedLength(piece.lengthMeters);
    const ready = piece.state === "cached" && lengthMeters > 0;
    const reason = pieceReason(piece);
    if (!ready) reasons.add(reason);
    return { ...piece, lengthMeters, ready, reason };
  });
  const totalMeters = pieces.reduce((sum, piece) => sum + piece.lengthMeters, 0);
  const readyMeters = pieces.filter((piece) => piece.ready).reduce((sum, piece) => sum + piece.lengthMeters, 0);
  const staleMeters = pieces.filter((piece) => piece.state === "stale").reduce((sum, piece) => sum + piece.lengthMeters, 0);
  const coveragePercent = totalMeters === 0 ? 0 : clampPercent((readyMeters / totalMeters) * 100);
  const stalePercent = totalMeters === 0 ? 0 : clampPercent((staleMeters / totalMeters) * 100);
  const hasUnknownOrMissing = pieces.some((piece) => piece.state === "unknown" || piece.state === "uncached");
  const hasStale = pieces.some((piece) => piece.state === "stale");
  const manifestMatches = input.manifest !== null
    && input.manifest.rideId === input.rideId
    && input.manifest.routeRevision === input.routeRevision;
  const geometryIsValid = input.geometry === undefined || validGeometry(input.geometry);
  const ready = input.manifest !== null
    && manifestMatches
    && geometryIsValid
    && pieces.length > 0
    && pieces.every((piece) => piece.ready)
    && reasons.size === 0;
  return {
    state: ready ? "ready" : hasUnknownOrMissing || pieces.length === 0 || !manifestMatches || !geometryIsValid ? "not_ready" : hasStale ? "degraded" : "not_ready",
    ready,
    coveragePercent,
    stalePercent,
    pieces,
    reasons: [...reasons],
  };
}

/** Exposed for application adapters and tests that need stable tile labels. */
export function corridorTileKey(tile: CorridorTileRef): string {
  return tileKey(tile);
}

/** Length of the supplied route line, used by application cache adapters. */
export function routeLengthMeters(geometry: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1];
    const current = geometry[index];
    if (previous !== undefined && current !== undefined) total += Math.max(0, haversine(previous, current));
  }
  return total;
}
