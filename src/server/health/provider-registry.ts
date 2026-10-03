/** Operator-only facts projected into the existing public, secrets-free health
 * contract. Configuration is not reachability: unprobed connectors stay unknown.
 * Artifact checks are read-only and never change routing/provider composition.
 */
import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { isPublicMapboxToken } from "@/infrastructure/map/basemap";
import { advisorTransportSettingsFromEnv } from "@/infrastructure/advisor/config";
import { offlineRegionRoot, readActiveManifest, isSafeRegionId } from "@/server/offline/region-files";
import { nwsAlertsProvider, overpassProvider, tomtomIncidentsProvider, tomtomStopsProvider } from "@/server/map-layers/providers";
import { trafficCamerasProvider, relevantTrafficCameraAdapters } from "@/server/map-layers/traffic-cameras";
import { roadAuthoritySourcesFromEnv } from "@/server/planning/road-authority";
import { isSpotifyClientId } from "@/server/spotify/config";
import { keyFromConfig } from "@/server/spotify/crypto";

export type ProviderEnv = Readonly<Record<string, string | undefined>>;
export type ProviderStatus = "ok" | "unknown" | "missing" | "unavailable" | "unconfigured" | "disabled";
export type ProviderAuthority = "regulatory" | "operational" | "community" | "derived" | "enrichment";

export interface ProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly authority: ProviderAuthority;
  readonly required: boolean;
  readonly features: readonly string[];
  readonly facets: readonly string[];
  readonly coverage: string;
  readonly provenance: { readonly sourceId: string; readonly sourceLabel: string };
  readonly failureBehavior: string;
  /** Names only; no values, addresses or filesystem paths. */
  readonly configurationKeys: readonly string[];
  readonly artifact: "sqlite" | "json-index" | "offline-manifests" | null;
  readonly canHardGateRouting: boolean;
  readonly visibleOnMap: boolean;
  readonly offlineCapable: boolean;
  /** null means no common source freshness policy has been established. */
  readonly ttlMs: number | null;
  /** Existing query cache policies, not source-data freshness promises. */
  readonly cacheTtls: Readonly<Record<string, number>>;
  readonly caveat: string;
}

export interface ProviderState extends ProviderDescriptor {
  readonly configured: boolean;
  readonly status: ProviderStatus;
  readonly evidence: "configuration" | "artifact" | "probe";
  readonly lastSuccess: string | null;
  readonly lastFailureCategory: "missing-artifact" | "invalid-artifact" | "unreadable-artifact" | "router-unreachable" | "router-unhealthy" | null;
  readonly activeSources: readonly string[];
  readonly freshness: "unknown";
}

const FAILURE_BEHAVIOR: Readonly<Record<string, string>> = {
  graphhopper: "Bounded routing failure; existing hosted fallback may be attempted. Never fabricate route geometry.",
  "graphhopper-hosted": "Unavailable or exhausted fallback leaves the existing primary routing path and error behavior intact.",
  photon: "Location search reports unavailable; no fabricated search results.",
  valhalla: "No production adapter or fallback is composed.",
  tomtom: "Traffic stays unknown; stop and incident layers report unavailable independently.",
  nws: "Weather and alerts remain unknown/unavailable, never clear-weather evidence.",
  "curvature-db": "Production queries gracefully return no catalogue evidence; missing health is distinct from an empty query.",
  "gravel-atlas": "Production queries gracefully return no corridor evidence; missing health is distinct from an empty query.",
  places: "Places capability remains unavailable; no invented events or places.",
  "discover-osm": "Discover source returns unavailable when the index is absent; other sources remain independent.",
  wikimedia: "Discovery/enrichment may be unavailable or partial; source failures never establish road facts.",
  overpass: "Map access/enrichment layers report unavailable; absence never establishes access rights.",
  "traffic-cameras": "Partial state failures retain other adapters; all relevant failures report unavailable. Playback remains separately gated.",
  "road-authority": "Missing source evidence stays unknown; the existing route policy retains authority over eligibility.",
  spotify: "Auth/playback failure affects only music; navigation and recording continue.",
  "mapbox-token": "Existing basemap resolution chooses its documented fallback or unavailable mode; no token is exposed here.",
  "offline-regions": "Invalid active manifests are omitted from region listings; missing tiles fail download explicitly.",
  advisor: "Optional advice is disabled/unavailable; core planning and riding stay independent.",
  jev: "Optional classification fails closed to existing deterministic evaluation; no geometry or access authority.",
};

const CAMERA_ORIGIN_KEYS: readonly string[] = ["PA", "NJ", "NY", "DE", "MD", "VA", "WV"].flatMap((state) => [
  `TRAFFIC_CAMERA_ALLOWED_ORIGINS_${state}`, `TRAFFIC_CAMERA_METADATA_ORIGINS_${state}`,
]);

function descriptor(
  id: string, label: string, authority: ProviderAuthority,
  features: readonly string[], configurationKeys: readonly string[], coverage: string,
  options: Partial<Pick<ProviderDescriptor, "required" | "artifact" | "canHardGateRouting" | "visibleOnMap" | "offlineCapable" | "ttlMs" | "cacheTtls">> = {},
): ProviderDescriptor {
  return { id, label, authority, features, facets: features, configurationKeys, coverage,
    provenance: { sourceId: id, sourceLabel: label }, failureBehavior: FAILURE_BEHAVIOR[id]!,
    required: false, artifact: null, canHardGateRouting: false, visibleOnMap: false,
    offlineCapable: false, ttlMs: null, cacheTtls: {},
    caveat: "Configuration does not prove availability, freshness, coverage or legal access.", ...options };
}

/** Valhalla is retained explicitly as absent, not advertised as a fallback. */
export const PROVIDER_REGISTRY: readonly ProviderDescriptor[] = [
  descriptor("graphhopper", "GraphHopper", "operational", ["route planning", "rerouting"], ["GRAPHHOPPER_URL"], "Deployed routing graph", { required: true, canHardGateRouting: true }),
  descriptor("graphhopper-hosted", "GraphHopper hosted fallback", "operational", ["bounded routing fallback"], ["GRAPHHOPPER_API_KEY", "GRAPHHOPPER_HOSTED_DAILY_BUDGET"], "Supported hosted requests", { canHardGateRouting: true }),
  descriptor("photon", "Photon", "enrichment", ["location search"], ["PHOTON_URL"], "Configured Photon index or public endpoint"),
  descriptor("valhalla", "Valhalla", "operational", [], [], "No production composition"),
  descriptor("tomtom", "TomTom", "operational", ["traffic", "incidents", "map stops"], ["TOMTOM_API_KEY", "TOMTOM_TRAFFIC_API_KEY"], "Provider coverage; minor roads may be absent", { visibleOnMap: true, cacheTtls: { "map-stops": tomtomStopsProvider.ttlMs, "map-incidents": tomtomIncidentsProvider.ttlMs } }),
  descriptor("nws", "National Weather Service", "operational", ["ride weather", "weather alerts"], ["NWS_USER_AGENT"], "US; map alerts check the viewport center", { visibleOnMap: true, cacheTtls: { "map-alerts": nwsAlertsProvider.ttlMs } }),
  descriptor("curvature-db", "Curvature catalogue", "derived", ["known curvy roads", "Great Roads layer"], ["CURVATURE_DB_PATH"], "Installed regional catalogue", { artifact: "sqlite", visibleOnMap: true }),
  descriptor("gravel-atlas", "Gravel Atlas", "community", ["known gravel corridors", "gravel layer"], ["GRAVEL_ATLAS_DB_PATH"], "Installed verified corridor catalogue", { artifact: "sqlite", visibleOnMap: true }),
  descriptor("places", "Places service", "enrichment", ["nearby events", "ride places"], ["OGV_PLACES_API_URL", "OGV_PLACES_API_KEY"], "Configured service coverage"),
  descriptor("discover-osm", "Discover OSM index", "community", ["Ride Discover"], ["OGV_DISCOVER_OSM_PLACES"], "Installed OSM extract", { artifact: "json-index" }),
  descriptor("wikimedia", "Wikimedia", "enrichment", ["Discover enrichment"], ["WIKIMEDIA_USER_AGENT"], "Geotagged Wikimedia content"),
  descriptor("overpass", "OpenStreetMap Overpass", "community", ["public land", "forest roads", "cell towers"], ["OVERPASS_URL"], "Mapped OSM objects; forest-road tags do not establish access", { visibleOnMap: true, ttlMs: overpassProvider.ttlMs, cacheTtls: { "map-layer": overpassProvider.ttlMs } }),
  descriptor("traffic-cameras", "Traffic cameras", "operational", ["traffic camera layer"], ["TRAFFIC_CAMERAS_ENABLED", "TRAFFIC_CAMERAS_STATES", "PA511_CAMERAS_ENABLED", "STORMSCOPE_CAMERAS_ENABLED", "STORMSCOPE_CAMERA_BASE_URL", "OHGO_API_KEY", "PA511_VIDEO_ENABLED", "PA511_VIDEO_PROXY_SECRET", "TRAFFIC_CAMERA_VIDEO_PROXY_SECRET", ...CAMERA_ORIGIN_KEYS], "Enabled state adapters and optional nationwide fallback", { visibleOnMap: true, ttlMs: trafficCamerasProvider.ttlMs, cacheTtls: { "map-layer": trafficCamerasProvider.ttlMs } }),
  descriptor("road-authority", "Road authority", "regulatory", ["access checks", "work-zone evidence"], ["OGV_ROAD_AUTHORITY", "OGV_ROAD_AUTHORITY_CACHE_DIR", "PTC_WZDX_API_KEY"], "USFS MVUM and participating WZDx feeds", { canHardGateRouting: true }),
  descriptor("spotify", "Spotify", "enrichment", ["web ride playback"], ["SPOTIFY_CLIENT_ID", "OGV_SPOTIFY_SESSION_KEY", "OGV_PUBLIC_ORIGIN", "OGV_SPOTIFY_ALLOWED_ORIGINS"], "Rider account and active playback device"),
  descriptor("mapbox-token", "Mapbox public token", "enrichment", ["Mapbox basemap"], ["NEXT_PUBLIC_MAPBOX_TOKEN", "NEXT_PUBLIC_OGV_BASEMAP"], "Token permissions and selected basemap", { visibleOnMap: true }),
  descriptor("offline-regions", "Offline road regions", "derived", ["offline region downloads", "offline routing"], ["OGV_OFFLINE_REGION_ROOT"], "Published region manifests", { artifact: "offline-manifests", offlineCapable: true }),
  descriptor("advisor", "Optional advisor", "enrichment", ["ride advice"], ["ADVISOR_API_KEY", "ADVISOR_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "ADVISOR_ENDPOINT", "ADVISOR_MODEL", "OPENROUTER_MODEL", "ADVISOR_FALLBACK_API_KEY", "ADVISOR_FALLBACK_ENDPOINT", "ADVISOR_FALLBACK_MODEL"], "Measured ride facts only; never geometry or access authority"),
  descriptor("jev", "Jev ride character", "derived", ["optional ride-character classification"], ["JEV_API_KEY"], "Bounded candidate classification; never access authority"),
];

function present(env: ProviderEnv, key: string): boolean { return (env[key]?.trim() ?? "") !== ""; }

function configuration(item: ProviderDescriptor, env: ProviderEnv): Pick<ProviderState, "configured" | "status" | "activeSources"> {
  let configured = false;
  let disabled = false;
  let activeSources: readonly string[] = [];
  switch (item.id) {
    case "graphhopper": case "photon": case "nws": case "wikimedia": case "overpass": configured = true; break; // Keyless/default compositions.
    case "valhalla": disabled = true; break;
    case "graphhopper-hosted": configured = present(env, "GRAPHHOPPER_API_KEY"); break;
    case "tomtom": configured = present(env, "TOMTOM_API_KEY") || present(env, "TOMTOM_TRAFFIC_API_KEY"); break;
    case "mapbox-token": configured = isPublicMapboxToken(env.NEXT_PUBLIC_MAPBOX_TOKEN); break;
    case "places": configured = present(env, "OGV_PLACES_API_URL") && present(env, "OGV_PLACES_API_KEY"); break;
    case "advisor": configured = advisorTransportSettingsFromEnv(env) !== null; break;
    case "spotify":
      // Riders can supply their own app ID. The server encryption key and an
      // allowed callback origin are still needed; no account readiness implied.
      configured = keyFromConfig(env.OGV_SPOTIFY_SESSION_KEY ?? "") !== null &&
        (present(env, "OGV_PUBLIC_ORIGIN") || present(env, "OGV_SPOTIFY_ALLOWED_ORIGINS")) &&
        (!present(env, "SPOTIFY_CLIENT_ID") || isSpotifyClientId(env.SPOTIFY_CLIENT_ID!));
      break;
    case "traffic-cameras":
      activeSources = relevantTrafficCameraAdapters({ west: -180, south: -90, east: 180, north: 90 }, env).map((adapter) => adapter.state);
      if (env.STORMSCOPE_CAMERAS_ENABLED === "1") activeSources = [...activeSources, "stormscope"];
      configured = activeSources.length > 0;
      disabled = env.TRAFFIC_CAMERAS_ENABLED !== "1" && env.PA511_CAMERAS_ENABLED !== "1" && env.STORMSCOPE_CAMERAS_ENABLED !== "1";
      break;
    case "road-authority":
      configured = env.OGV_ROAD_AUTHORITY?.trim().toLowerCase() === "on";
      disabled = !configured;
      activeSources = configured ? roadAuthoritySourcesFromEnv(env)
        .filter((source) => source.probe().available).map((source) => source.info.id) : [];
      break;
    default: configured = item.configurationKeys.some((key) => present(env, key));
  }
  return { configured, status: disabled ? "disabled" : configured ? "unknown" : "unconfigured", activeSources };
}

async function inspectArtifact(item: ProviderDescriptor, env: ProviderEnv): Promise<Pick<ProviderState, "configured" | "status" | "lastFailureCategory">> {
  const file = item.id === "offline-regions" ? offlineRegionRoot(env) : env[item.configurationKeys[0]!];
  if (!file) return { configured: false, status: "missing", lastFailureCategory: "missing-artifact" };
  try {
    const info = await stat(file);
    await access(file, constants.R_OK);
    if (item.artifact === "sqlite") {
      if (!info.isFile()) throw new Error("invalid-artifact");
      const database = new DatabaseSync(file, { readOnly: true });
      try {
        // Match the production queries without reading catalogue rows.
        database.prepare(item.id === "curvature-db"
          ? "select id, name, score, geometry, mid_lat, mid_lon from segments limit 0"
          : "select id, label, geometry, confidence, verification_status, east, west, north, south from gravel_atlas_corridors limit 0").all();
      } finally { database.close(); }
    } else if (item.artifact === "json-index") {
      if (!info.isFile()) throw new Error("invalid-artifact");
      const index = JSON.parse(await readFile(file, "utf8")) as { builtAt?: unknown; places?: unknown };
      if (typeof index?.builtAt !== "string" || !Number.isFinite(Date.parse(index.builtAt)) || !Array.isArray(index.places)) throw new Error("invalid-artifact");
      for (const place of index.places as unknown[]) {
        if (typeof place !== "object" || place === null) throw new Error("invalid-artifact");
        const entry = place as Record<string, unknown>;
        if (typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.c) || !entry.c.every((category: unknown) => typeof category === "string") ||
          !Array.isArray(entry.at) || entry.at.length !== 2 || !entry.at.every((coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate))) throw new Error("invalid-artifact");
      }
    } else {
      if (!info.isDirectory()) throw new Error("invalid-artifact");
      const regions = (await readdir(file)).filter(isSafeRegionId);
      if (regions.length === 0) return { configured: true, status: "missing", lastFailureCategory: "missing-artifact" };
      await Promise.all(regions.map((region) => readActiveManifest(region, file)));
    }
    return { configured: true, status: "ok", lastFailureCategory: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const missing = code === "ENOENT" || code === "ENOTDIR";
    return { configured: !missing, status: missing ? "missing" : "unavailable",
      lastFailureCategory: missing ? "missing-artifact" : code === "EACCES" || code === "EPERM" ? "unreadable-artifact" : "invalid-artifact" };
  }
}

export async function providerStates(env: ProviderEnv = process.env): Promise<readonly ProviderState[]> {
  return Promise.all(PROVIDER_REGISTRY.map(async (item): Promise<ProviderState> => ({
    ...item, ...configuration(item, env), evidence: item.artifact === null ? "configuration" : "artifact",
    lastSuccess: null, lastFailureCategory: null, freshness: "unknown",
    ...(item.artifact === null ? {} : await inspectArtifact(item, env)),
  })));
}
