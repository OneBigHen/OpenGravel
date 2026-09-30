/**
 * Provider-neutral traffic-camera records and state adapters.
 *
 * The map layer consumes one shape regardless of whether a state publishes
 * GeoJSON, JSON, a 511 list endpoint, or a documented keyed API. Each adapter
 * is responsible only for discovery/media metadata; map filtering happens in
 * the aggregate layer provider.
 */

import { createCipheriv } from "node:crypto";

import type { LngLat, MapLayerBounds } from "@/application/map-layers";
import {
  PA511_CCTV_URL,
  loadPa511CameraCatalog,
} from "@/server/map-layers/pa511-cameras";
import type { ProviderContext } from "@/server/map-layers/providers";

export type TrafficCameraState = "PA" | "NJ" | "NY" | "DE" | "MD" | "VA" | "WV" | "OH";

export interface TrafficCameraRecord {
  readonly id: string;
  readonly state: TrafficCameraState;
  readonly provider: string;
  readonly name: string;
  readonly detail: string | null;
  readonly coordinates: LngLat;
  readonly previewUrl: string | null;
  readonly playbackUrl: string | null;
  readonly sourceHref: string;
  readonly videoAvailable: boolean;
}

export interface TrafficCameraAdapter {
  readonly state: TrafficCameraState;
  readonly bounds: MapLayerBounds;
  readonly label: string;
  readonly requiresKey?: string;
  load(context: ProviderContext): Promise<readonly TrafficCameraRecord[]>;
}

const USER_AGENT = "OpenGravel/0.1 personal route planner (traffic cameras)";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function point(lon: unknown, lat: unknown): LngLat | null {
  const x = finite(lon);
  const y = finite(lat);
  return x === null || y === null || Math.abs(x) > 180 || Math.abs(y) > 90 ? null : [x, y];
}

function absolute(value: unknown, base: string): string | null {
  const raw = text(value);
  if (raw === null) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function join(parts: readonly (string | null)[]): string | null {
  const usable = parts.filter((part): part is string => part !== null && part !== "");
  return usable.length === 0 ? null : usable.join(" · ");
}

async function json(
  context: ProviderContext,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await context.fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(init.headers ?? {}),
    },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`traffic camera source ${response.status}`);
  return response.json();
}

export function parseDelawareCameras(payload: unknown): readonly TrafficCameraRecord[] {
  const cameras = record(payload)?.["videoCameras"];
  if (!Array.isArray(cameras)) throw new Error("DelDOT camera response malformed");
  return cameras.flatMap((entry): TrafficCameraRecord[] => {
    const camera = record(entry);
    const urls = record(camera?.["urls"]);
    const coordinates = point(camera?.["lon"], camera?.["lat"]);
    const id = camera === null ? null : text(camera["id"]) ?? (camera["id"] === undefined ? null : String(camera["id"]));
    if (camera === null || id === null || coordinates === null || camera["enabled"] !== true || text(camera["status"]) !== "Active") return [];
    const hls = absolute(urls?.["m3u8s"], "https://deldot.gov/");
    return [{
      id,
      state: "DE",
      provider: "DelDOT",
      name: text(camera["title"]) ?? "Delaware traffic camera",
      detail: "DelDOT · active",
      coordinates,
      previewUrl: absolute(urls?.["jpg"] ?? urls?.["image"], "https://deldot.gov/"),
      playbackUrl: hls,
      sourceHref: "https://deldot.gov/map/",
      videoAvailable: hls !== null,
    }];
  });
}

export function parseMarylandCameras(payload: unknown): readonly TrafficCameraRecord[] {
  const cameras = record(payload)?.["data"];
  if (!Array.isArray(cameras)) throw new Error("Maryland CHART camera response malformed");
  return cameras.flatMap((entry): TrafficCameraRecord[] => {
    const camera = record(entry);
    const coordinates = point(camera?.["lon"], camera?.["lat"]);
    const id = camera === null ? null : text(camera["id"]) ?? (camera["id"] === undefined ? null : String(camera["id"]));
    if (
      camera === null ||
      id === null ||
      coordinates === null ||
      text(camera["commMode"]) !== "ONLINE" ||
      text(camera["opStatus"]) !== "OK"
    ) return [];

    const publicVideo = absolute(camera["publicVideoURL"], "https://chart.maryland.gov/");
    const cctvIp = text(camera["cctvIp"]);
    const hls = cctvIp === null ? null : absolute(`https://${cctvIp}/rtplive/${encodeURIComponent(id)}/playlist.m3u8`, "https://chart.maryland.gov/");
    const route = join([text(camera["routePrefix"]), text(camera["routeNumber"]), text(camera["routeSuffix"])]);
    return [{
      id,
      state: "MD",
      provider: "Maryland CHART",
      name: text(camera["description"]) ?? text(camera["name"]) ?? "Maryland traffic camera",
      detail: join([route, "CHART · online"]),
      coordinates,
      previewUrl: null,
      playbackUrl: hls,
      sourceHref: publicVideo ?? "https://chart.maryland.gov/TrafficCameras/GetTrafficCameras",
      videoAvailable: hls !== null || publicVideo !== null,
    }];
  });
}

export function parseVirginiaCameras(payload: unknown): readonly TrafficCameraRecord[] {
  const features = record(payload)?.["features"];
  if (!Array.isArray(features)) throw new Error("VDOT camera response malformed");
  return features.flatMap((entry): TrafficCameraRecord[] => {
    const feature = record(entry);
    const properties = record(feature?.["properties"]);
    const geometry = record(feature?.["geometry"]);
    const coords = Array.isArray(geometry?.["coordinates"]) ? geometry["coordinates"] : [];
    const coordinates = point(coords[0], coords[1]);
    const id = properties === null ? null : text(properties["id"]) ?? (properties["id"] === undefined ? null : String(properties["id"]));
    if (
      properties === null ||
      id === null ||
      coordinates === null ||
      properties["active"] !== true ||
      properties["problem_stream"] === true
    ) return [];
    const stream = absolute(properties["https_url"], "https://511.vdot.virginia.gov/");
    return [{
      id,
      state: "VA",
      provider: "VDOT 511",
      name: text(properties["description"]) ?? text(properties["name"]) ?? "Virginia traffic camera",
      detail: "VDOT 511 · active",
      coordinates,
      previewUrl: absolute(properties["image_url"] ?? properties["thumbnail"], "https://511.vdot.virginia.gov/"),
      playbackUrl: stream,
      sourceHref: "https://511.vdot.virginia.gov/",
      videoAvailable: stream !== null,
    }];
  });
}

export function parseWestVirginiaCameras(payload: unknown): readonly TrafficCameraRecord[] {
  const features = record(payload)?.["features"];
  if (!Array.isArray(features)) throw new Error("WV511 camera response malformed");
  return features.flatMap((entry): TrafficCameraRecord[] => {
    const feature = record(entry);
    const properties = record(feature?.["properties"]);
    const geometry = record(feature?.["geometry"]);
    const coords = Array.isArray(geometry?.["coordinates"]) ? geometry["coordinates"] : [];
    const coordinates = point(coords[0], coords[1]);
    const rawId = properties?.["statewide_id"] ?? properties?.["md5"];
    const id = rawId === undefined || rawId === null ? null : String(rawId);
    if (
      properties === null ||
      id === null ||
      coordinates === null ||
      finite(properties["is_stream"]) !== 1 ||
      finite(properties["available"]) !== 1
    ) return [];
    const rawUrl = text(properties["url"])?.replace("sfstest.roadsummary.com", "vtc3.roadsummary.com") ?? null;
    const stream = absolute(rawUrl, "https://wv511.org/");
    return [{
      id,
      state: "WV",
      provider: "WV511",
      name: text(properties["descriptive_location"]) ?? text(properties["name"]) ?? `West Virginia camera ${id}`,
      detail: "WV511 · streaming",
      coordinates,
      previewUrl: absolute(properties["image_url"] ?? properties["thumbnail"], "https://wv511.org/"),
      playbackUrl: stream,
      sourceHref: "https://wv511.org/",
      videoAvailable: stream !== null,
    }];
  });
}

export function parseOhioCameras(payload: unknown): readonly TrafficCameraRecord[] {
  const body = record(payload);
  const results = body?.["Results"] ?? body?.["results"];
  if (!Array.isArray(results)) throw new Error("OHGO camera response malformed");
  return results.flatMap((entry): TrafficCameraRecord[] => {
    const camera = record(entry);
    const coordinates = point(camera?.["Longitude"] ?? camera?.["longitude"], camera?.["Latitude"] ?? camera?.["latitude"]);
    const rawId = camera?.["Id"] ?? camera?.["id"];
    const id = rawId === undefined || rawId === null ? null : String(rawId);
    const views = camera === null
      ? []
      : Array.isArray(camera["CameraViews"]) ? camera["CameraViews"] : Array.isArray(camera["cameraViews"]) ? camera["cameraViews"] : [];
    if (camera === null || id === null || coordinates === null) return [];
    return views.flatMap((rawView, index): TrafficCameraRecord[] => {
      const view = record(rawView);
      if (view === null) return [];
      const preview = absolute(view["LargeUrl"] ?? view["largeUrl"] ?? view["SmallUrl"] ?? view["smallUrl"], "https://ohgo.com/");
      if (preview === null) return [];
      return [{
        id: `${id}-${index}`,
        state: "OH",
        provider: "OHGO",
        name: text(camera["Description"] ?? camera["description"]) ?? text(camera["Location"] ?? camera["location"]) ?? "Ohio traffic camera",
        detail: join([text(camera["Location"] ?? camera["location"]), text(view["Direction"] ?? view["direction"]), "OHGO"]),
        coordinates,
        previewUrl: preview,
        playbackUrl: null,
        sourceHref: "https://ohgo.com/",
        videoAvailable: false,
      }];
    });
  });
}

interface Dot511CameraOptions {
  readonly state: "NY";
  readonly origin: string;
  readonly provider: string;
  readonly sourceHref: string;
  readonly columns: readonly Record<string, unknown>[];
  readonly order: readonly Record<string, unknown>[];
}

function setCookies(headers: Headers): readonly string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values !== undefined && values.length > 0) return values;
  const combined = headers.get("set-cookie");
  return combined === null ? [] : [combined];
}

async function dot511Session(context: ProviderContext, origin: string): Promise<{ cookie: string; token: string }> {
  const response = await context.fetch(`${origin}/cctv`, {
    headers: { "user-agent": USER_AGENT },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`511 camera page ${response.status}`);
  const html = await response.text();
  const token = html.match(/<input[^>]*name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i)?.[1];
  if (token === undefined) throw new Error("511 verification token missing");
  const cookie = setCookies(response.headers).map((value) => value.split(";")[0]?.trim() ?? "").filter(Boolean).join("; ");
  if (cookie === "") throw new Error("511 session cookie missing");
  return { cookie, token };
}

function parseDot511Page(payload: unknown, options: Dot511CameraOptions): { total: number; cameras: readonly TrafficCameraRecord[] } {
  const body = record(payload);
  const data = body?.["data"];
  const total = finite(body?.["recordsTotal"]);
  if (!Array.isArray(data) || total === null) throw new Error("511 camera list malformed");
  const cameras = data.flatMap((entry): TrafficCameraRecord[] => {
    const camera = record(entry);
    const images = Array.isArray(camera?.["images"]) ? camera["images"] : [];
    const image = record(images[0]);
    const latLng = record(camera?.["latLng"]);
    const geography = record(latLng?.["geography"]);
    const wkt = text(geography?.["wellKnownText"]);
    const match = wkt?.match(/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i);
    const coordinates = match === undefined || match === null ? null : point(match[1], match[2]);
    const rawId = camera?.["id"];
    const id = rawId === undefined || rawId === null ? null : String(rawId);
    if (camera === null || image === null || coordinates === null || id === null || image["disabled"] === true || image["blocked"] === true) return [];
    const preview = absolute(image["imageUrl"], options.origin);
    const video = image["videoDisabled"] === true ? null : absolute(image["videoUrl"], options.origin);
    return [{
      id,
      state: options.state,
      provider: options.provider,
      name: text(camera["location"]) ?? text(camera["cameraName"]) ?? text(camera["roadway"]) ?? `${options.state} traffic camera`,
      detail: join([text(camera["roadway"]), text(camera["county"]), options.provider]),
      coordinates,
      previewUrl: preview,
      playbackUrl: video,
      sourceHref: options.sourceHref,
      videoAvailable: video !== null,
    }];
  });
  return { total, cameras };
}

async function loadDot511(context: ProviderContext, options: Dot511CameraOptions): Promise<readonly TrafficCameraRecord[]> {
  const session = await dot511Session(context, options.origin);
  const pageSize = 250;
  const query = (start: number, length: number) => ({
    columns: options.columns,
    order: options.order,
    start,
    length,
    search: { value: "" },
  });
  const page = async (start: number, length: number) => {
    const encoded = encodeURIComponent(JSON.stringify(query(start, length)));
    return json(context, `${options.origin}/List/GetData/Cameras?query=${encoded}&lang=en-US`, {
      headers: {
        cookie: session.cookie,
        "x-requested-with": "XMLHttpRequest",
        "__requestverificationtoken": session.token,
      },
    });
  };
  const first = parseDot511Page(await page(0, pageSize), options);
  const pages: TrafficCameraRecord[][] = [[...first.cameras]];
  for (let start = pageSize; start < first.total; start += pageSize) {
    pages.push([...parseDot511Page(await page(start, pageSize), options).cameras]);
  }
  return pages.flat();
}

const NY_OPTIONS: Dot511CameraOptions = {
  state: "NY",
  origin: "https://511ny.org",
  provider: "511NY",
  sourceHref: "https://511ny.org/cctv",
  columns: [
    { data: null, name: "" },
    { name: "sortOrder", s: true },
    { name: "region", s: true },
    { name: "county", s: true },
    { name: "roadway", s: true },
    { name: "location" },
    { data: 6, name: "" },
  ],
  order: [
    { column: 1, dir: "asc" },
    { column: 4, dir: "asc" },
  ],
};

const NJ_AES_KEY = Buffer.from("lIo3M)_83,ALC0Wz", "utf8");
const NJ_AES_IV = Buffer.from(".%A}8Qvqm23jYVc9", "utf8");

function encryptNjPublicRequest(value: unknown): string {
  const cipher = createCipheriv("aes-128-cbc", NJ_AES_KEY, NJ_AES_IV);
  return cipher.update(JSON.stringify(value), "utf8", "hex") + cipher.final("hex");
}

export function parseNewJerseyCameras(payload: unknown): readonly TrafficCameraRecord[] {
  const body = record(payload);
  const data = body?.["data"];
  if (!Array.isArray(data)) throw new Error("511NJ camera response malformed");
  return data.flatMap((entry): TrafficCameraRecord[] => {
    const camera = record(entry);
    const coordinates = point(camera?.["longitude"], camera?.["latitude"]);
    const rawId = camera?.["id"];
    const id = rawId === undefined || rawId === null ? null : String(rawId);
    const details = Array.isArray(camera?.["cameraMainDetail"]) ? camera["cameraMainDetail"] : [];
    const hls = details.map(record).find((detail) =>
      detail !== null &&
      text(detail["camera_use_flag"]) === "HLS" &&
      text(detail["url"])?.includes("xcmdata") === true);
    const stream = absolute(hls?.["url"], "https://511nj.org/");
    if (camera === null || coordinates === null || id === null || stream === null) return [];
    return [{
      id,
      state: "NJ",
      provider: "511NJ",
      name: join([text(camera["name"]), text(camera["deviceDescription"])]) ?? "New Jersey traffic camera",
      detail: "511NJ · HLS",
      coordinates,
      previewUrl: null,
      playbackUrl: stream,
      sourceHref: "https://511nj.org/camera",
      videoAvailable: true,
    }];
  });
}

async function loadNewJersey(context: ProviderContext): Promise<readonly TrafficCameraRecord[]> {
  const login = await json(context, "https://511nj.org/account/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://511nj.org",
      referer: "https://511nj.org/",
    },
    body: JSON.stringify({ encryptedData: encryptNjPublicRequest({ username: "public", password: "", role: "public" }) }),
  });
  const loginRecord = record(login);
  const nested = record(loginRecord?.["data"]);
  const token = text(nested?.["accessToken"]) ?? text(loginRecord?.["accessToken"]);
  if (token === null) throw new Error("511NJ public login returned no token");

  const cameras = await json(context, "https://511nj.org/client/trafficMap/getCameraDataByTourId", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      token: `Bearer ${token}`,
      origin: "https://511nj.org",
      referer: "https://511nj.org/camera",
    },
    body: JSON.stringify({ encryptedData: encryptNjPublicRequest({ tourId: 3 }) }),
  });
  return parseNewJerseyCameras(cameras);
}

function paRecords(context: ProviderContext): Promise<readonly TrafficCameraRecord[]> {
  return loadPa511CameraCatalog(context).then((cameras) => cameras.map((camera): TrafficCameraRecord => {
    const hasVideo = camera.videoUrl !== null;
    const relayEnabled =
      hasVideo &&
      context.env["PA511_VIDEO_ENABLED"] === "1" &&
      (context.env["PA511_VIDEO_PROXY_SECRET"]?.trim().length ?? 0) >= 24;
    return {
      id: camera.id,
      state: "PA",
      provider: "511PA / PennDOT",
      name: camera.name,
      detail: join([camera.roadway, camera.county === null ? null : `${camera.county} County`, "511PA"]),
      coordinates: camera.coordinates,
      previewUrl: camera.imageUrl,
      playbackUrl: relayEnabled ? `/api/traffic-cameras/pa511/${encodeURIComponent(camera.id)}/hls` : null,
      sourceHref: PA511_CCTV_URL,
      videoAvailable: hasVideo,
    };
  }));
}

export const TRAFFIC_CAMERA_ADAPTERS: readonly TrafficCameraAdapter[] = [
  {
    state: "PA",
    label: "511PA / PennDOT",
    bounds: { west: -80.52, south: 39.72, east: -74.69, north: 42.27 },
    load: paRecords,
  },
  {
    state: "NJ",
    label: "511NJ",
    bounds: { west: -75.56, south: 38.92, east: -73.89, north: 41.36 },
    load: loadNewJersey,
  },
  {
    state: "NY",
    label: "511NY",
    bounds: { west: -79.76, south: 40.47, east: -71.85, north: 45.02 },
    load: (context) => loadDot511(context, NY_OPTIONS),
  },
  {
    state: "DE",
    label: "DelDOT",
    bounds: { west: -75.79, south: 38.45, east: -74.98, north: 39.84 },
    load: async (context) => parseDelawareCameras(await json(context, "https://tmc.deldot.gov/json/videocamera.json", {
      headers: { origin: "https://deldot.gov", referer: "https://deldot.gov/" },
    })),
  },
  {
    state: "MD",
    label: "Maryland CHART",
    bounds: { west: -79.49, south: 37.91, east: -75.05, north: 39.73 },
    load: async (context) => parseMarylandCameras(await json(
      context,
      "https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do",
      { headers: { referer: "https://chart.maryland.gov/" } },
    )),
  },
  {
    state: "VA",
    label: "VDOT 511",
    bounds: { west: -83.68, south: 36.54, east: -75.24, north: 39.47 },
    load: async (context) => parseVirginiaCameras(await json(
      context,
      "https://511.vdot.virginia.gov/services/map/layers/map/cams",
      { headers: { referer: "https://511.vdot.virginia.gov/" } },
    )),
  },
  {
    state: "WV",
    label: "WV511",
    bounds: { west: -82.65, south: 37.20, east: -77.72, north: 40.64 },
    load: async (context) => parseWestVirginiaCameras(await json(
      context,
      "https://dev.www.511wv.cloud.ilchost.com/xml/data/js/cameras_export.geojson",
      { headers: { referer: "https://wv511.org/" } },
    )),
  },
  {
    state: "OH",
    label: "OHGO",
    requiresKey: "OHGO_API_KEY",
    bounds: { west: -84.82, south: 38.40, east: -80.52, north: 42.33 },
    load: async (context) => {
      const key = context.env["OHGO_API_KEY"]?.trim();
      if (key === undefined || key === "") throw new Error("OHGO API key missing");
      return parseOhioCameras(await json(
        context,
        `https://publicapi.ohgo.com/api/v1/cameras?api-key=${encodeURIComponent(key)}`,
      ));
    },
  },
] as const;
