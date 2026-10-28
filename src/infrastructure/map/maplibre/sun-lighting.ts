/**
 * The map's light, taken from the sun (docs/vnext/design/MAP-EXPERIENCE-NEXT.md
 * Wave 3, item 10).
 *
 * One `SolarPosition` (see `application/map/solar-position`) becomes the three
 * renderer settings that make a tilted map look like the hour it is drawn in:
 *
 * - **Hillshade direction.** `hillshade-illumination-direction` is the compass
 *   bearing the light comes from, which is the sun's own azimuth, and
 *   `hillshade-illumination-anchor: "map"` keeps that bearing fixed to the
 *   ground while the rider rotates the map. A relief that lit from the
 *   viewport would flip when the map turned, which is the tell that the light is
 *   painted on rather than falling on the land.
 * - **The 3D light.** MapLibre's light is `[radius, azimuth, polar angle]`, with
 *   the polar angle measured down from straight up, so a 5° sun is an 85° polar
 *   angle and throws the long shadows of golden hour.
 * - **Sky and haze.** Sky, horizon and fog colours move with the sun's altitude:
 *   a blue midday, a gold horizon at sunset, violet-blue dusk, and the night
 *   look's own palette once the rider has asked for it.
 *
 * Unknown is its own answer. Without a position the caller keeps the renderer's
 * default light and the look's static sky — never a made-up midday.
 */

import type { SolarPosition } from "@/application/map/solar-position";

import { SUN_LIGHT, skySpec } from "./visual-detail";

/** How the sun reads: day, golden hour, dusk, night — or what we could not say. */
export type SunTone = "day" | "golden" | "dusk" | "night" | "unknown";

/** At or above this altitude the light is plain daylight. */
export const DAY_ALTITUDE = 8;
/** Below the horizon: the sun has set and the sky is lit only by twilight. */
export const DUSK_ALTITUDE = 0;
/** Below civil twilight there is no sun left in the sky. */
export const NIGHT_ALTITUDE = -6;

/**
 * The hillshade's light bearing once the sun is down: north-west, high enough
 * that relief still reads. A below-horizon sun would otherwise invert it.
 */
export const NIGHT_HILLSHADE_DIRECTION = 315;

/** MapLibre's own hillshade bearing, kept for the unknown case. */
export const DEFAULT_HILLSHADE_DIRECTION = 335;

/** One altitude and the palette the map wears there. */
interface SunStop {
  readonly altitude: number;
  readonly sky: string;
  readonly horizon: string;
  readonly fog: string;
  readonly light: string;
  readonly intensity: number;
}

/**
 * The sun's course as colour, coldest first. Between stops the colours are
 * mixed, so the map warms and cools continuously instead of stepping at a
 * threshold the rider would notice.
 */
const SUN_STOPS: readonly SunStop[] = [
  { altitude: -18, sky: "#0a1420", horizon: "#16202c", fog: "#0f1720", light: "#8ea6c4", intensity: 0.16 },
  { altitude: -6, sky: "#152536", horizon: "#2c3c50", fog: "#1b2833", light: "#a2b8d6", intensity: 0.2 },
  { altitude: -1, sky: "#2c4a66", horizon: "#9a6a5a", fog: "#4a4a55", light: "#ffb27a", intensity: 0.28 },
  { altitude: 1, sky: "#41678c", horizon: "#e7a06c", fog: "#8f8b86", light: "#ffb178", intensity: 0.34 },
  { altitude: 6, sky: "#6d9cc2", horizon: "#f2cf9d", fog: "#d8cfba", light: "#ffcf9a", intensity: 0.4 },
  { altitude: DAY_ALTITUDE, sky: "#8fbfe0", horizon: "#e8eef0", fog: "#eef1ec", light: "#fff0dc", intensity: 0.46 },
  { altitude: 60, sky: "#8fbfe0", horizon: "#e8eef0", fog: "#eef1ec", light: "#ffffff", intensity: 0.5 },
];

/** What the renderer should draw for one sun position. */
export interface SunLighting {
  readonly tone: SunTone;
  /** The MapLibre `LightSpecification`, anchored to the map. */
  readonly light: Readonly<Record<string, unknown>>;
  /** The MapLibre sky paint, safe to pass to `map.setSky`. */
  readonly sky: Readonly<Record<string, unknown>>;
  /** Where hillshade relief is lit from, and in which frame. */
  readonly hillshade: {
    readonly direction: number;
    readonly anchor: "map" | "viewport";
  };
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function channelOf(colour: string): readonly [number, number, number] {
  const value = Number.parseInt(colour.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Between two `#rrggbb` colours, `share` of the way from `from` to `to`. */
function mixColour(from: string, to: string, share: number): string {
  const clamped = Math.min(1, Math.max(0, share));
  const [fromR, fromG, fromB] = channelOf(from);
  const [toR, toG, toB] = channelOf(to);
  const channel = (a: number, b: number): string =>
    Math.round(a + (b - a) * clamped).toString(16).padStart(2, "0");
  return `#${channel(fromR, toR)}${channel(fromG, toG)}${channel(fromB, toB)}`;
}

/** The two stops `altitude` falls between, or the nearest one at the ends. */
function stopsFor(altitude: number): readonly [SunStop, SunStop, number] {
  const first = SUN_STOPS[0] as SunStop;
  const last = SUN_STOPS[SUN_STOPS.length - 1] as SunStop;
  if (altitude <= first.altitude) return [first, first, 0];
  if (altitude >= last.altitude) return [last, last, 0];
  for (let index = 1; index < SUN_STOPS.length; index += 1) {
    const upper = SUN_STOPS[index] as SunStop;
    if (altitude > upper.altitude) continue;
    const lower = SUN_STOPS[index - 1] as SunStop;
    const span = upper.altitude - lower.altitude;
    return [lower, upper, span === 0 ? 0 : (altitude - lower.altitude) / span];
  }
  return [last, last, 0];
}

/** The palette at `altitude`, mixed between the nearest stops. */
function paletteAt(altitude: number): SunStop {
  const [lower, upper, share] = stopsFor(altitude);
  return {
    altitude,
    sky: mixColour(lower.sky, upper.sky, share),
    horizon: mixColour(lower.horizon, upper.horizon, share),
    fog: mixColour(lower.fog, upper.fog, share),
    light: mixColour(lower.light, upper.light, share),
    intensity: lower.intensity + (upper.intensity - lower.intensity) * share,
  };
}

/** Which part of the hour this altitude belongs to. */
export function sunToneAt(altitude: number): SunTone {
  if (!Number.isFinite(altitude)) return "unknown";
  if (altitude >= DAY_ALTITUDE) return "day";
  if (altitude >= DUSK_ALTITUDE) return "golden";
  if (altitude >= NIGHT_ALTITUDE) return "dusk";
  return "night";
}

function skyAt(palette: SunStop): Readonly<Record<string, unknown>> {
  const day = skySpec(false);
  return {
    "sky-color": palette.sky,
    "horizon-color": palette.horizon,
    "fog-color": palette.fog,
    "sky-horizon-blend": day["sky-horizon-blend"],
    "horizon-fog-blend": day["horizon-fog-blend"],
    "fog-ground-blend": day["fog-ground-blend"],
    "atmosphere-blend": 0,
  };
}

/** The light spec for one palette, lit from the sun's own bearing. */
function lightAt(
  palette: Pick<SunStop, "light" | "intensity">,
  azimuth: number,
  altitude: number,
): Readonly<Record<string, unknown>> {
  // MapLibre's polar angle is measured down from overhead and only makes sense
  // above the ground, so a sun at or below the horizon lights the map from a
  // grazing half-degree rather than from underneath it.
  const polar = 90 - Math.min(89.5, Math.max(0.5, altitude));
  return {
    anchor: "map",
    // [radius, azimuth clockwise from north, polar angle down from overhead].
    position: [1.2, normalizedDegrees(azimuth), polar],
    color: palette.light,
    intensity: palette.intensity,
  };
}

/**
 * The light, sky and hillshade for `sun` in the given look.
 *
 * `night` is the rider's basemap look, not the sun's own state: a Night map is
 * a night map even at noon, so it keeps its own palette and a cool, steady
 * light. Hillshade still follows the real sun while it is up, because the
 * relief's direction is the ground's fact rather than the palette's.
 */
export function sunLighting(sun: SolarPosition | null, night: boolean): SunLighting {
  const known = sun !== null
    && Number.isFinite(sun.azimuth)
    && Number.isFinite(sun.altitude);

  if (!known) {
    return {
      tone: "unknown",
      light: SUN_LIGHT,
      sky: skySpec(night),
      hillshade: { direction: DEFAULT_HILLSHADE_DIRECTION, anchor: "viewport" },
    };
  }

  const { azimuth, altitude } = sun;
  const hillshadeDirection = altitude >= DUSK_ALTITUDE
    ? normalizedDegrees(azimuth)
    : NIGHT_HILLSHADE_DIRECTION;

  if (night) {
    return {
      tone: "night",
      light: lightAt({ light: "#aec6e2", intensity: 0.22 }, NIGHT_HILLSHADE_DIRECTION, 38),
      sky: skySpec(true),
      hillshade: { direction: hillshadeDirection, anchor: "map" },
    };
  }

  const palette = paletteAt(altitude);
  return {
    tone: sunToneAt(altitude),
    light: lightAt(palette, azimuth, altitude),
    sky: skyAt(palette),
    hillshade: { direction: hillshadeDirection, anchor: "map" },
  };
}
