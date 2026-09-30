/**
 * Optional nationwide fallback sourced from StormScope's normalized camera
 * corpus. The dataset is MIT-licensed and geographically sharded; OpenGravel
 * fetches the small index, then only shards whose bbox intersects the current
 * map view. This is a fallback, not the first choice over live state adapters.
 */

import type { LngLat, MapLayerBounds } from "@/application/map-layers";
import type { ProviderContext } from "@/server/map-layers/providers";
import { createExactOriginPolicy, fetchPinnedCameraUrl } from "@/server/traffic-cameras/url-security";
import type { TrafficCameraRecord } from "@/server/traffic-cameras/registry";

const DEFAULT_BASE =
  "https://raw.githubusercontent.com/SysAdminDoc/StormScope/master/data/";
const INDEX_TTL_MS = 15 * 60_000;
const SHARD_TTL_MS = 60 * 60_000;
const MAX_SHARD_CACHE = 32;
// Shards are ID-ordered rather than spatially partitioned, so their bounding
// boxes overlap. A normal 1.6° × 1.0° OpenGravel view can legitimately touch
// ~15 shards in the Northeast; this cap still prevents an accidental full-corpus
// fanout while allowing bounded viewport fallback to work.
const MAX_SHARDS_PER_VIEW = 24;
const STORMSCOPE_SOURCE = "https://github.com/SysAdminDoc/StormScope";

interface StormScopeShard {
  readonly id: string;
  readonly path: string;
  readonly bbox: readonly [number, number, number, number];
}

interface StormScopeIndex {
  readonly camera_schema_version: number;
  readonly generated_at: string;
  readonly total: number;
  readonly shards: readonly StormScopeShard[];
}

let indexCache: { readonly base: string; readonly expiresAt: number; readonly value: StormScopeIndex } | null = null;
const shardCache = new Map<string, { readonly expiresAt: number; readonly value: readonly unknown[] }>();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function httpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function bbox(value: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(finite);
  if (numbers.some((entry) => entry === null)) return null;
  return numbers as [number, number, number, number];
}

function intersects(view: MapLayerBounds, box: readonly [number, number, number, number]): boolean {
  return view.west <= box[2] && view.east >= box[0] && view.south <= box[3] && view.north >= box[1];
}

function inside(view: MapLayerBounds, point: LngLat): boolean {
  return point[0] >= view.west && point[0] <= view.east && point[1] >= view.south && point[1] <= view.north;
}

export function stormScopeBaseUrl(env: ProviderContext["env"]): URL {
  const configured = env["STORMSCOPE_CAMERA_BASE_URL"]?.trim();
  const base = new URL(configured || DEFAULT_BASE);
  if (base.protocol !== "https:" || base.username !== "" || base.password !== "" || base.port !== "" || base.search !== "" || base.hash !== "") {
    throw new Error("StormScope requires an exact HTTPS data directory");
  }
  // Apply the same configuration validation as media relays; address validation
  // and pinning are performed for every actual registry request below.
  createExactOriginPolicy([base.origin]);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

async function fetchJson(context: ProviderContext, url: URL): Promise<unknown> {
  const base = stormScopeBaseUrl(context.env);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error("StormScope registry resource escaped its data directory");
  }
  const response = await fetchPinnedCameraUrl(createExactOriginPolicy([base.origin]), url, {
    headers: {
      accept: "application/json",
      "user-agent": "OpenGravel/0.1 personal route planner (traffic camera fallback)",
    },
    signal: context.signal,
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`StormScope camera registry ${response.status}`); }
  return response.json();
}

export function parseStormScopeIndex(payload: unknown): StormScopeIndex {
  const body = record(payload);
  const rawShards = body?.["shards"];
  if (
    body === null ||
    finite(body["camera_schema_version"]) !== 2 ||
    !Array.isArray(rawShards)
  ) {
    throw new Error("Unsupported StormScope camera index");
  }

  const shards = rawShards.flatMap((entry): StormScopeShard[] => {
    const item = record(entry);
    const id = text(item?.["id"]);
    const path = text(item?.["path"]);
    const bounds = bbox(item?.["bbox"]);
    if (id === null || path === null || bounds === null) return [];
    if (!/^camera-shards\/[A-Za-z0-9_-]+\.json(?:\?[A-Za-z0-9._~%=&-]*)?$/.test(path)) {
      throw new Error("StormScope shard path must stay in camera-shards");
    }
    return [{ id, path, bbox: bounds }];
  });
  if (shards.length === 0) throw new Error("StormScope camera index has no shards");
  return {
    camera_schema_version: 2,
    generated_at: text(body["generated_at"]) ?? "",
    total: finite(body["total"]) ?? 0,
    shards,
  };
}

async function loadIndex(context: ProviderContext): Promise<StormScopeIndex> {
  const now = Date.now();
  const base = stormScopeBaseUrl(context.env).toString();
  if (indexCache !== null && indexCache.base === base && indexCache.expiresAt > now) return indexCache.value;
  const value = parseStormScopeIndex(await fetchJson(context, new URL("cameras.index.json", base)));
  indexCache = { base, expiresAt: now + INDEX_TTL_MS, value };
  return value;
}

async function loadShard(
  context: ProviderContext,
  shard: StormScopeShard,
): Promise<readonly unknown[]> {
  const url = new URL(shard.path, stormScopeBaseUrl(context.env)).toString();
  const now = Date.now();
  const cached = shardCache.get(url);
  if (cached !== undefined && cached.expiresAt > now) return cached.value;
  const payload = await fetchJson(context, new URL(url));
  if (!Array.isArray(payload)) throw new Error("StormScope camera shard malformed");
  if (shardCache.size >= MAX_SHARD_CACHE) {
    const oldest = shardCache.keys().next().value;
    if (oldest !== undefined) shardCache.delete(oldest);
  }
  shardCache.set(url, { expiresAt: now + SHARD_TTL_MS, value: payload });
  return payload;
}

export function parseStormScopeCamera(entry: unknown): TrafficCameraRecord | null {
  const item = record(entry);
  if (item === null || text(item["source"]) !== "dot") return null;
  const lat = finite(item["lat"]);
  const lon = finite(item["lon"]);
  const rawId = item["id"];
  const id = typeof rawId === "number" && Number.isInteger(rawId) ? String(rawId) : text(rawId);
  if (lat === null || lon === null || id === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const health = text(item["health"]) ?? "unknown";
  const status = text(item["status"]) ?? "Unknown";
  if (health === "offline" || status === "Offline") return null;

  const type = text(item["type"]);
  const media = httpsUrl(item["url"]);
  const sourceHref = httpsUrl(item["source_url"]) ?? STORMSCOPE_SOURCE;
  const provider = text(item["provider"]) ?? text(item["ingestion_source"]) ?? "StormScope DOT registry";
  const state = text(item["state"]) ?? "US";
  const cadence = finite(item["refresh_cadence_seconds"]);

  const previewUrl = type === "image" || type === "mjpeg" ? media : null;
  // A registry row is discovery metadata, not a trusted live-media origin.
  // Keep the official camera link until its provider has a qualified relay.
  const playbackUrl = null;
  if (previewUrl === null && playbackUrl === null && sourceHref === STORMSCOPE_SOURCE) return null;

  return {
    id: `stormscope-${id}`,
    state,
    provider,
    name: text(item["name"]) ?? "Traffic camera",
    detail: [provider, state, health === "healthy" ? "verified" : health]
      .filter((part) => part !== "")
      .join(" · "),
    coordinates: [lon, lat],
    previewUrl,
    playbackUrl,
    sourceHref,
    videoAvailable: playbackUrl !== null,
    refreshSeconds: previewUrl === null ? null : cadence ?? 15,
  };
}

export async function loadStormScopeCameras(
  bounds: MapLayerBounds,
  context: ProviderContext,
): Promise<readonly TrafficCameraRecord[]> {
  if (context.env["STORMSCOPE_CAMERAS_ENABLED"] !== "1") return [];
  const index = await loadIndex(context);
  const shards = index.shards.filter((shard) => intersects(bounds, shard.bbox));
  if (shards.length > MAX_SHARDS_PER_VIEW) {
    throw new Error("StormScope shard fanout exceeded safe view limit");
  }
  const rows = (await Promise.all(shards.map((shard) => loadShard(context, shard)))).flat();
  const cameras = rows
    .map(parseStormScopeCamera)
    .filter((camera): camera is TrafficCameraRecord => camera !== null)
    .filter((camera) => inside(bounds, camera.coordinates));

  const deduped = new Map<string, TrafficCameraRecord>();
  for (const camera of cameras) deduped.set(camera.id, camera);
  return [...deduped.values()];
}

export function clearStormScopeCameraCache(): void {
  indexCache = null;
  shardCache.clear();
}
