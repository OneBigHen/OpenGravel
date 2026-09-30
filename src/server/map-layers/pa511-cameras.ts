/**
 * Pennsylvania 511 camera catalogue adapter.
 *
 * This intentionally talks to the same public 511PA camera page that a rider
 * can open in a browser. It is opt-in for self-hosted/personal deployments so
 * the public OpenGravel demo never turns into a scraper. The provider only
 * enumerates metadata and still-image URLs; tokenized HLS playback is a
 * separate concern documented in docs/traffic-cameras.md.
 */

import type { InfoFeature, LngLat, MapLayerBounds } from "@/application/map-layers";

import type { LayerProvider, ProviderContext } from "./providers";

export const PA511_ORIGIN = "https://www.511pa.com";
export const PA511_CCTV_URL = `${PA511_ORIGIN}/cctv`;
const PAGE_SIZE = 250;
const CATALOG_TTL_MS = 5 * 60_000;
export const PA511_USER_AGENT = "OpenGravel/0.1 personal route planner (traffic camera layer)";

export interface Pa511Session {
  readonly cookie: string;
  readonly verificationToken: string;
}

export interface Pa511Camera {
  readonly id: string;
  readonly imageId: string;
  readonly name: string;
  readonly roadway: string | null;
  readonly county: string | null;
  readonly coordinates: LngLat;
  readonly imageUrl: string | null;
  readonly videoUrl: string | null;
}

export interface Pa511CameraPage {
  readonly total: number;
  readonly cameras: readonly Pa511Camera[];
}

let catalogCache: { readonly expiresAt: number; readonly cameras: readonly Pa511Camera[] } | null = null;

export function clearPa511CameraCache(): void {
  catalogCache = null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function absolute511Url(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value, PA511_ORIGIN).toString();
  } catch {
    return null;
  }
}

function coordinateFromCamera(camera: Record<string, unknown>): LngLat | null {
  const latLng = record(camera["latLng"]);
  const geography = record(latLng?.["geography"]);
  const wkt = text(geography?.["wellKnownText"]);
  const match = wkt?.match(/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i);
  if (match === undefined || match === null) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

export function parsePa511CameraPage(payload: unknown): Pa511CameraPage {
  const body = record(payload);
  const data = body?.["data"];
  const total = body?.["recordsTotal"];
  if (!Array.isArray(data) || !finite(total)) throw new Error("511PA camera response is malformed");

  const cameras = data.flatMap((entry): Pa511Camera[] => {
    const camera = record(entry);
    const images = Array.isArray(camera?.["images"]) ? camera["images"] : [];
    const image = record(images[0]);
    const coordinates = camera === null ? null : coordinateFromCamera(camera);
    if (camera === null || image === null || coordinates === null || image["disabled"] === true || image["blocked"] === true) return [];

    const id = String(camera["id"] ?? "");
    const imageId = String(image["id"] ?? "");
    if (id === "" || imageId === "") return [];

    const roadway = text(camera["roadway"]);
    const location = text(camera["location"]);
    const cameraName = text(camera["cameraName"]);
    const county = text(camera["county"]);
    const imageUrl = absolute511Url(text(image["imageUrl"]));
    const videoUrl = image["videoDisabled"] === true ? null : absolute511Url(text(image["videoUrl"]));

    return [{
      id,
      imageId,
      name: location ?? cameraName ?? roadway ?? "Traffic camera",
      roadway,
      county,
      coordinates,
      imageUrl,
      videoUrl,
    }];
  });

  return { total, cameras };
}

function getSetCookies(headers: Headers): readonly string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values !== undefined && values.length > 0) return values;
  const combined = headers.get("set-cookie");
  return combined === null ? [] : [combined];
}

export async function createPa511Session(context: ProviderContext): Promise<Pa511Session> {
  const response = await context.fetch(PA511_CCTV_URL, {
    headers: { "user-agent": PA511_USER_AGENT },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`511PA camera page ${response.status}`);
  const html = await response.text();
  const token = html.match(/<input[^>]*name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i)?.[1];
  if (token === undefined) throw new Error("511PA verification token was not present");

  const cookie = getSetCookies(response.headers)
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((value) => value !== "")
    .join("; ");
  if (cookie === "") throw new Error("511PA session cookie was not present");
  return { cookie, verificationToken: token };
}

function cameraQuery(start: number, length: number): Record<string, unknown> {
  return {
    columns: [
      { data: null, name: "" },
      { name: "sortOrder", s: true },
      { name: "dotDistrict", s: true },
      { name: "county", s: true },
      { name: "roadway", s: true },
      { name: "turnpikeOnly" },
      { name: "location" },
      { name: "cameraName" },
      { name: "district" },
      { data: 9, name: "" },
    ],
    order: [
      { column: 1, dir: "asc" },
      { column: 2, dir: "asc" },
    ],
    start,
    length,
    search: { value: "" },
  };
}

async function fetchPage(
  context: ProviderContext,
  session: Pa511Session,
  start: number,
  length: number,
): Promise<Pa511CameraPage> {
  const query = encodeURIComponent(JSON.stringify(cameraQuery(start, length)));
  const response = await context.fetch(`${PA511_ORIGIN}/List/GetData/Cameras?query=${query}&lang=en-US`, {
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      "user-agent": PA511_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      "__requestverificationtoken": session.verificationToken,
    },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`511PA camera catalogue ${response.status}`);
  return parsePa511CameraPage(await response.json());
}

export async function loadPa511CameraCatalog(context: ProviderContext): Promise<readonly Pa511Camera[]> {
  const now = Date.now();
  if (catalogCache !== null && catalogCache.expiresAt > now) return catalogCache.cameras;

  const session = await createPa511Session(context);
  const first = await fetchPage(context, session, 0, PAGE_SIZE);
  const pages: Pa511Camera[][] = [[...first.cameras]];
  for (let start = PAGE_SIZE; start < first.total; start += PAGE_SIZE) {
    const page = await fetchPage(context, session, start, PAGE_SIZE);
    pages.push([...page.cameras]);
  }

  const byId = new Map<string, Pa511Camera>();
  for (const camera of pages.flat()) byId.set(camera.id, camera);
  const cameras = [...byId.values()];
  catalogCache = { expiresAt: now + CATALOG_TTL_MS, cameras };
  return cameras;
}

function inside(bounds: MapLayerBounds, point: LngLat): boolean {
  return point[0] >= bounds.west && point[0] <= bounds.east && point[1] >= bounds.south && point[1] <= bounds.north;
}

function enabled(env: ProviderContext["env"]): boolean {
  return env["PA511_CAMERAS_ENABLED"] === "1";
}

export const pa511CameraProvider: LayerProvider = {
  id: "traffic-cameras",
  layers: ["traffic-cameras"],
  ttlMs: 30_000,
  async load(bounds, _layers, context) {
    if (!enabled(context.env)) throw new Error("PA511 camera layer is disabled");
    const cameras = await loadPa511CameraCatalog(context);
    return cameras
      .filter((camera) => inside(bounds, camera.coordinates))
      .map((camera): InfoFeature => {
        const hasVideo = camera.videoUrl !== null;
        const detail = [
          camera.roadway,
          camera.county === null ? null : `${camera.county} County`,
          hasVideo ? "Live video available" : "Still image",
        ].filter((part): part is string => part !== null).join(" · ");

        return {
          id: `pa511:${camera.id}`,
          layerId: "traffic-cameras",
          name: camera.name,
          detail: detail === "" ? null : detail,
          weight: hasVideo ? 1 : 0,
          geometry: { type: "Point", coordinates: camera.coordinates },
          media: {
            previewUrl: camera.imageUrl,
            playbackUrl:
              hasVideo &&
              context.env["PA511_VIDEO_ENABLED"] === "1" &&
              (context.env["PA511_VIDEO_PROXY_SECRET"]?.trim().length ?? 0) >= 24
                ? `/api/traffic-cameras/pa511/${encodeURIComponent(camera.id)}/hls`
                : null,
            sourceHref: PA511_CCTV_URL,
            refreshSeconds: camera.imageUrl === null ? null : 10,
            videoAvailable: hasVideo,
          },
        };
      });
  },
};
