/**
 * Animated rain radar (map-experience wave 3, item 12): RainViewer's frame list
 * and the timeline that scrubs it.
 *
 * The frame list is RainViewer's own metadata (`/public/weather-maps.json`): the
 * past frames it still serves, plus its short nowcast. This module reads that
 * payload once, in one place, and turns it into a bounded, ordered frame list —
 * the server route caches the result, the map draws one frame at a time, and the
 * timeline moves between them.
 *
 * Two rules shape everything here:
 *
 * 1. **A missing frame is not clear weather.** A list that names no usable
 *    frame throws instead of returning an empty timeline, so the surface can say
 *    "unavailable" rather than showing a dry map. The same applies to a frame
 *    that ages past the stale bound while it is on screen.
 * 2. **Only RainViewer's own timestamps are frames.** The frame time comes from
 *    the provider, never from our clock, so "2:40 PM" is the radar's valid time
 *    and not when we happened to fetch it.
 */

import type { LayerFreshness } from "./types";

/** The attribution the map and the panel both show for radar tiles. */
export const RADAR_ATTRIBUTION = "RainViewer";

/** How far back the timeline runs: roughly two hours of past frames. */
export const RADAR_PAST_SPAN_MS = 2 * 60 * 60_000;

/** How far ahead the nowcast reaches. */
export const RADAR_NOWCAST_SPAN_MS = 30 * 60_000;

/**
 * A frame older than this is out of date: RainViewer publishes a new frame
 * about every ten minutes, so two missed publications are the honest bound.
 */
export const RADAR_STALE_AFTER_MS = 20 * 60_000;

/**
 * One frame's tile suffix. RainViewer addresses a frame as
 * `<host><path>/256/{z}/{x}/{y}/<colorScheme>/<smooth>_<snow>.png`; scheme 2 is
 * its calm blue-green radar palette and `1_1` keeps smoothing and snow on.
 */
export const RADAR_TILE_SUFFIX = "256/{z}/{x}/{y}/2/1_1.png";

/** How long one frame shows while the timeline plays. */
export const RADAR_FRAME_INTERVAL_MS = 600;

/**
 * How often the browser re-reads the frame list. It matches the server's
 * five-minute cache: a faster poll would only be answered from that cache.
 */
export const RADAR_LIST_REFRESH_MS = 5 * 60_000;

/**
 * Clock-skew tolerance, in milliseconds. A client or server clock a couple of
 * minutes ahead must not turn the newest real frame into a "future" frame.
 */
const CLOCK_SKEW_MS = 2 * 60_000;

export type RadarFrameKind = "past" | "nowcast";

export interface RadarFrame {
  /** The frame's valid time, in Unix seconds — the provider's own stamp. */
  readonly time: number;
  /** The frame's tile path, e.g. `/v2/radar/1712345400`. */
  readonly path: string;
  readonly kind: RadarFrameKind;
}

/** What one frame list request answers: past frames, then nowcast, oldest first. */
export interface RadarFrameList {
  /** The tile host, without a trailing slash. */
  readonly host: string;
  readonly frames: readonly RadarFrame[];
  /**
   * RainViewer's own generation time, ISO (our read time when it omits one).
   * Nowcast frames are offsets from it, and the timeline starts at the newest
   * past frame at or before it.
   */
  readonly generatedAt: string;
}

/** The timeline's whole state: which frame shows, and whether it is playing. */
export interface RadarTimelineState {
  readonly index: number;
  readonly playing: boolean;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A tile host we will build URLs from: https, no credentials, no query, no path.
 * Anything else is refused, because a `host` that can carry a path or a query is
 * an open redirect in a tile template.
 */
function tileHost(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("RainViewer frame list has no tile host");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("RainViewer frame list has an unreadable tile host");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("RainViewer frame list has an unsafe tile host");
  }
  return url.origin;
}

/**
 * A frame path is one safe path under RainViewer's host: no scheme, no `..`, no
 * query and no fragment, so it can be concatenated into a tile template.
 */
function framePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\/[A-Za-z0-9/_-]{1,120}$/.test(value)) return null;
  if (value.includes("//") || value.includes("..")) return null;
  return value;
}

/** Reads one provider array; a malformed array is a failed read, not an empty sky. */
function readFrames(value: unknown, kind: RadarFrameKind): RadarFrame[] {
  if (!Array.isArray(value)) return [];
  const frames: RadarFrame[] = [];
  for (const entry of value) {
    const record = recordOf(entry);
    if (record === null) continue;
    const time = record["time"];
    const path = framePath(record["path"]);
    if (!finiteNumber(time) || time <= 0 || path === null) continue;
    frames.push({ time: Math.round(time), path, kind });
  }
  return frames;
}

function inWindow(frame: RadarFrame, nowMs: number): boolean {
  const at = frame.time * 1_000;
  return frame.kind === "past"
    ? at >= nowMs - RADAR_PAST_SPAN_MS && at <= nowMs + CLOCK_SKEW_MS
    : at >= nowMs - CLOCK_SKEW_MS && at <= nowMs + RADAR_NOWCAST_SPAN_MS;
}

/**
 * Parses RainViewer's `weather-maps.json` into the bounded frame list the map
 * draws: the last two hours and the next thirty minutes, oldest first, times
 * de-duplicated.
 *
 * Throws when the payload names no usable frame — an empty timeline must reach
 * the surface as "unavailable", never as "no rain".
 */
export function parseRainViewerWeatherMaps(payload: unknown, nowMs: number): RadarFrameList {
  const root = recordOf(payload);
  if (root === null) throw new Error("RainViewer frame list is not an object");
  const host = tileHost(root["host"]);
  const radar = recordOf(root["radar"]);
  if (radar === null) throw new Error("RainViewer frame list has no radar section");

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const seen = new Set<number>();
  const frames = [...readFrames(radar["past"], "past"), ...readFrames(radar["nowcast"], "nowcast")]
    .filter((frame) => inWindow(frame, now))
    .sort((left, right) => left.time - right.time)
    .filter((frame) => {
      if (seen.has(frame.time)) return false;
      seen.add(frame.time);
      return true;
    });
  if (frames.length === 0) throw new Error("RainViewer has no current radar frames");

  const generated = root["generated"];
  return {
    host,
    frames,
    generatedAt: new Date(finiteNumber(generated) && generated > 0 ? generated * 1_000 : now).toISOString(),
  };
}

/**
 * Validates what our own `/api/map-layers/radar` route already normalised, so a
 * cached or truncated proxy response cannot put a broken timeline on the map.
 */
export function isRadarFrameList(value: unknown): value is RadarFrameList {
  const root = recordOf(value);
  if (root === null) return false;
  if (typeof root["host"] !== "string" || typeof root["generatedAt"] !== "string") return false;
  if (!Number.isFinite(Date.parse(root["generatedAt"] as string))) return false;
  if (!Array.isArray(root["frames"]) || root["frames"].length === 0) return false;
  return root["frames"].every((entry) => {
    const frame = recordOf(entry);
    return frame !== null
      && finiteNumber(frame["time"])
      && frame["time"] > 0
      && framePath(frame["path"]) !== null
      && (frame["kind"] === "past" || frame["kind"] === "nowcast");
  });
}

/** The raster tile template for one frame, as MapLibre wants it. */
export function radarTileTemplate(host: string, path: string): string {
  return `${host}${path}/${RADAR_TILE_SUFFIX}`;
}

/**
 * The frame that reads as "now": the newest past frame at or before `nowMs`,
 * or the first frame when the provider's newest past frame is in the future
 * (a skewed clock) or it has none at all.
 */
export function latestFrameIndex(frames: readonly RadarFrame[], nowMs: number): number {
  if (frames.length === 0) return 0;
  let index = 0;
  for (let position = 0; position < frames.length; position += 1) {
    const frame = frames[position] as RadarFrame;
    if (frame.kind === "nowcast") break;
    if (frame.time * 1_000 <= nowMs + CLOCK_SKEW_MS) index = position;
  }
  return index;
}

/**
 * The timeline starts on the frame that reads as "now" and — unless the rider
 * asked for reduced motion — plays from there. Nothing autoplays under
 * `prefers-reduced-motion`: an animation the rider did not start is exactly what
 * that setting asks us not to run.
 */
export function initialRadarTimeline(
  frames: readonly RadarFrame[],
  nowMs: number,
  reducedMotion: boolean,
): RadarTimelineState {
  return { index: latestFrameIndex(frames, nowMs), playing: !reducedMotion && frames.length > 1 };
}

/** One step of playback, looping from the last nowcast frame back to the first. */
export function advanceRadarTimeline(
  state: RadarTimelineState,
  frameCount: number,
): RadarTimelineState {
  if (frameCount <= 1) return { ...state, playing: false };
  return { index: ((state.index % frameCount) + 1) % frameCount, playing: state.playing };
}

/** Moving the scrubber stops playback: the rider is choosing a frame, not a loop. */
export function scrubRadarTimeline(index: number, frameCount: number): RadarTimelineState {
  const last = Math.max(0, frameCount - 1);
  return { index: Math.min(Math.max(0, Math.round(index)), last), playing: false };
}

/** Pausing keeps the frame; playing resumes the loop (`advance` does the stepping). */
export function setRadarPlaying(
  state: RadarTimelineState,
  playing: boolean,
  frameCount: number,
): RadarTimelineState {
  return { index: state.index, playing: playing && frameCount > 1 };
}

/** The clock under a frame, in the rider's own time zone: "2:40 PM". */
export function formatRadarClock(unixSeconds: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(unixSeconds * 1_000));
}

/**
 * The timeline's label. A past frame is a clock time; a nowcast frame is an
 * offset from the list's own generation time ("+20 min"), because "3:10 PM" on a
 * forecast frame reads as an observation.
 */
export function radarFrameLabel(
  frame: RadarFrame,
  generatedAtMs: number,
  timeZone?: string,
): string {
  if (frame.kind === "past") return formatRadarClock(frame.time, timeZone);
  const minutes = Math.max(0, Math.round((frame.time * 1_000 - generatedAtMs) / 60_000));
  return `+${Math.round(minutes / 5) * 5} min`;
}

/**
 * What the layers panel says about the frame on screen. `stale` is a fact about
 * the radar's own newest frame, not about our request.
 */
export function radarFreshness(
  list: RadarFrameList,
  nowMs: number,
): LayerFreshness {
  const newestPast = [...list.frames].reverse().find((frame) => frame.kind === "past");
  const observed = newestPast === undefined ? null : new Date(newestPast.time * 1_000).toISOString();
  const stale = observed !== null && nowMs - Date.parse(observed) > RADAR_STALE_AFTER_MS;
  return {
    layerId: "weather-radar",
    source: RADAR_ATTRIBUTION,
    fetchedAt: list.generatedAt,
    observedAt: observed,
    stale,
    staleAfterMs: RADAR_STALE_AFTER_MS,
    note: "Two hours of past frames plus a 30-minute nowcast. Echoes are not proof of clear ground: radar gaps, beam blockage and a missing frame stay unknown. Online only.",
  };
}
