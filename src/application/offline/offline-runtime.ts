/** Browser/application seam for offline truth.
 *
 * The browser facts here are observations only. In particular, a missing tile
 * URL resolver does not become "all tiles cached" and a saved route does not
 * become an offline graph.
 */

import {
  buildCapabilityMatrix,
  buildCorridorPackManifest,
  cacheFactState,
  routeLengthMeters,
  routeReadiness,
  type CapabilityMatrix,
  type CorridorPackManifest,
  type OfflineCacheFact,
  type OfflineProviderFact,
  type OfflineRuntimeFacts,
  type RouteReadiness,
  type ServiceWorkerFact,
} from "@/domain/offline/capabilities";
import type { Coordinate } from "@/domain/ride/types";

export interface OfflineRouteRuntimeInput {
  readonly rideId: string;
  readonly routeRevision: number;
  readonly geometry: readonly Coordinate[];
  readonly pack?: CorridorPackManifest | null;
  readonly instructionsAvailable?: boolean;
}

export interface BrowserOfflineRuntimeOptions {
  readonly now?: string;
  readonly route?: OfflineRouteRuntimeInput | null;
  readonly tileUrlFor?: (tile: CorridorPackManifest["tiles"][number]) => string;
  readonly weather?: OfflineProviderFact;
  readonly traffic?: OfflineProviderFact;
}

export interface OfflineRuntimeSnapshot {
  readonly facts: OfflineRuntimeFacts;
  readonly matrix: CapabilityMatrix;
  readonly readiness: RouteReadiness | null;
}

function nowIso(value?: string): string {
  return value ?? new Date().toISOString();
}

function cacheAge(response: Response): string | undefined {
  const value = response.headers.get("x-og-cached-at");
  return value === null || !Number.isFinite(Date.parse(value)) ? undefined : value;
}

async function cachedUrl(url: string, maxAgeMs: number): Promise<OfflineCacheFact> {
  if (typeof caches === "undefined") return { presence: "unknown", maxAgeMs };
  try {
    const response = await caches.match(url);
    if (response === undefined) return { presence: "absent", maxAgeMs };
    const cachedAt = cacheAge(response);
    return cachedAt === undefined
      ? { presence: "present", maxAgeMs }
      : { presence: "present", cachedAt, maxAgeMs };
  } catch {
    return { presence: "unknown", maxAgeMs };
  }
}

async function serviceWorkerFact(): Promise<ServiceWorkerFact> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { state: "absent" };
  try {
    if (navigator.serviceWorker.controller !== null) return { state: "controlled" };
    const registrations = await navigator.serviceWorker.getRegistrations();
    return { state: registrations.length === 0 ? "absent" : "registered" };
  } catch {
    return { state: "unknown" };
  }
}

function providerFact(value: OfflineProviderFact | undefined, label: string): OfflineProviderFact {
  return value ?? { state: "unavailable", reason: `${label} has no cached live result.` };
}

function localCapability(
  available: boolean,
  label: string,
): { readonly state: "available" | "unavailable"; readonly reason: string | null } {
  return available
    ? { state: "available", reason: null }
    : { state: "unavailable", reason: `${label} is not supported by this browser.` };
}

function routeCache(
  route: OfflineRouteRuntimeInput | null | undefined,
  now: string,
): OfflineCacheFact {
  return route !== null && route !== undefined && route.geometry.length >= 2
    ? { presence: "present", cachedAt: now, maxAgeMs: 5 * 60 * 1000 }
    : { presence: "absent", maxAgeMs: 5 * 60 * 1000 };
}

function pieceState(
  route: OfflineRouteRuntimeInput,
  state: ReturnType<typeof cacheFactState>,
  kind: "route-geometry" | "route-data" | "routing-graph" | "instructions",
  lengthMeters: number,
) {
  return {
    ref: `${kind}:${route.rideId}:${route.routeRevision}`,
    kind,
    lengthMeters,
    state,
  } as const;
}

async function mapTileFact(
  route: OfflineRouteRuntimeInput | null | undefined,
  tileUrlFor: BrowserOfflineRuntimeOptions["tileUrlFor"],
  maxAgeMs: number,
): Promise<OfflineCacheFact> {
  if (route === null || route === undefined || route.pack === null || route.pack === undefined) {
    return { presence: "absent", maxAgeMs };
  }
  if (tileUrlFor === undefined) return { presence: "unknown", maxAgeMs };
  const facts = await Promise.all(route.pack.tiles.map((tile) => cachedUrl(tileUrlFor(tile), maxAgeMs)));
  if (facts.length === 0) return { presence: "unknown", maxAgeMs };
  if (facts.some((fact) => fact.presence === "unknown")) return { presence: "unknown", maxAgeMs };
  if (facts.some((fact) => fact.presence === "absent")) return { presence: "absent", maxAgeMs };
  const timestamps = facts.map((fact) => fact.cachedAt).filter((value): value is string => value !== undefined);
  return timestamps.length === facts.length
    ? { presence: "present", cachedAt: timestamps.sort()[0], maxAgeMs }
    : { presence: "present", maxAgeMs };
}

/** Read the browser's actual cache/service-worker observations and project them. */
export async function readBrowserOfflineRuntime(
  options: BrowserOfflineRuntimeOptions = {},
): Promise<OfflineRuntimeSnapshot> {
  const now = nowIso(options.now);
  const route = options.route;
  const worker = await serviceWorkerFact();
  const appShell = await cachedUrl(
    typeof location === "undefined" ? "/" : `${location.origin}/`,
    24 * 60 * 60 * 1000,
  );
  const routeGeometry = routeCache(route, now);
  const routeInstructions = route?.instructionsAvailable === true
    ? { presence: "present", cachedAt: now, maxAgeMs: 24 * 60 * 60 * 1000 } as const
    : { presence: "absent", maxAgeMs: 24 * 60 * 60 * 1000 } as const;
  const mapTiles = await mapTileFact(route, options.tileUrlFor, 24 * 60 * 60 * 1000);
  const facts: OfflineRuntimeFacts = {
    now,
    networkOnline: typeof navigator === "undefined" ? false : navigator.onLine,
    serviceWorker: worker,
    caches: {
      appShell,
      routeGeometry,
      routeInstructions,
      mapTiles,
      routeData: routeGeometry,
      exploreCatalog: { presence: "absent", maxAgeMs: 24 * 60 * 60 * 1000 },
      // No browser-side graph/download service exists in this task. Its absence
      // is a real fact and deliberately keeps planning/rerouting network-bound.
      offlineGraph: { presence: "absent", maxAgeMs: 24 * 60 * 60 * 1000 },
    },
    local: {
      // These are current-page local operations. They do not claim that a future
      // reload works unless the app shell fact above proves that separately.
      library: localCapability(typeof indexedDB !== "undefined", "Local ride storage"),
      importExport: localCapability(
        typeof Blob !== "undefined" && typeof TextEncoder !== "undefined" && typeof URL !== "undefined",
        "Import and export",
      ),
    },
    providers: {
      weather: providerFact(options.weather, "Weather"),
      traffic: providerFact(options.traffic, "Traffic"),
    },
  };
  const matrix = buildCapabilityMatrix(facts);
  if (route === null || route === undefined) return { facts, matrix, readiness: null };
  const manifest = route.pack ?? buildCorridorPackManifest({
    rideId: route.rideId,
    routeRevision: route.routeRevision,
    geometry: route.geometry,
    createdAt: now,
    dataRefs: [`route-geometry:${route.rideId}:${route.routeRevision}`],
  });
  const totalMeters = routeLengthMeters(route.geometry);
  const tileLength = manifest.tiles.length === 0 ? 0 : totalMeters / manifest.tiles.length;
  const pieces = [
    ...manifest.tiles.map((tile) => ({
      ref: `tile:${tile.z}/${tile.x}/${tile.y}`,
      kind: "map-tile" as const,
      lengthMeters: tileLength,
      state: cacheFactState(mapTiles, now),
    })),
    pieceState(route, cacheFactState(routeGeometry, now), "route-geometry", totalMeters),
    pieceState(route, cacheFactState(facts.caches.routeData, now), "route-data", totalMeters),
    pieceState(route, cacheFactState(routeInstructions, now), "instructions", totalMeters),
    pieceState(route, cacheFactState(facts.caches.offlineGraph, now), "routing-graph", totalMeters),
  ];
  return {
    facts,
    matrix,
    readiness: routeReadiness({
      now,
      rideId: route.rideId,
      routeRevision: route.routeRevision,
      manifest,
      geometry: route.geometry,
      pieces,
    }),
  };
}
