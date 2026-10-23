/**
 * The map's scale rule (05-MAP-INTERACTION-AND-CARTOGRAPHY §9).
 *
 * A distance on a map is only honest if it names the ruler it was measured
 * with: two places at the same zoom are different distances apart, and a rule
 * that says "a finger's width" says nothing. This module owns the two numbers
 * behind the scale bar — how many metres one CSS pixel covers at a latitude,
 * and which round distance fits the bar — so the renderer only supplies the
 * camera and the UI only draws what it is told.
 *
 * Both functions are pure and locale-free: the label is part of a deterministic
 * readout, so a host locale must not be able to change it (the same rule the
 * planner's measurement formatters follow). A missing or impossible reading is
 * `null` — never a zero, and never a made-up ruler.
 */

/** Mean Earth circumference (WGS-84), in metres. */
export const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

/**
 * MapLibre and Mapbox render 512-pixel tiles, so a whole world at zoom 0 is
 * 512 CSS pixels wide, not the 256 the classic web-Mercator formula assumes.
 */
export const WORLD_PIXELS_AT_ZOOM_0 = 512;

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;

/**
 * Web-Mercator's latitude bound: past it the projection stretches a pixel to
 * nothing, so the reading would be meaningless.
 */
const MAX_MERCATOR_LATITUDE = 85.051_128_78;

/** One scale-bar reading: the round distance, its label and the rule's width. */
export interface MapScaleBar {
  /** The distance the rule spans, in metres. */
  readonly meters: number;
  /** The rider-facing label, e.g. `"1,000 ft"` or `"1 mi"`. */
  readonly label: string;
  /** How wide the rule is drawn, in CSS pixels (never past the caller's max). */
  readonly widthPx: number;
}

/**
 * Metres one CSS pixel covers at `zoom` and `latitude`.
 *
 * This is the projection's own arithmetic, not a measurement of the canvas, so
 * a scale bar stays correct during a pinch before the renderer has settled.
 * An impossible input (`NaN`, a non-finite zoom, a latitude past the Mercator
 * bound) returns `NaN` so the caller has nothing to draw.
 */
export function metersPerPixelAt(zoom: number, latitude: number): number {
  if (!Number.isFinite(zoom) || !Number.isFinite(latitude)) return Number.NaN;
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const worldMeters = EARTH_CIRCUMFERENCE_METERS * Math.cos((clamped * Math.PI) / 180);
  return worldMeters / (WORLD_PIXELS_AT_ZOOM_0 * 2 ** zoom);
}

/**
 * The candidate distances a rider actually reads, in the ladder the app uses:
 * 1-2-5 × 10ⁿ feet up to a mile, then 1-2-5 × 10ⁿ miles.
 *
 * OpenGravel states distance in feet and miles (`formatDistance`), so the ruler
 * speaks the same units as the ride beside it rather than making the rider
 * convert. The first entry starts at one foot because a zoomed-in map is
 * measured in feet; the ladder is only a table, and the choice is made below.
 */
const SCALE_CANDIDATES: readonly { readonly meters: number; readonly label: string }[] = [
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].map((feet) => ({
    meters: feet * METERS_PER_FOOT,
    label: `${feet.toLocaleString("en-US")} ft`,
  })),
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].map((miles) => ({
    meters: miles * METERS_PER_MILE,
    label: `${miles.toLocaleString("en-US")} mi`,
  })),
];

/** The widest the rule may be drawn, in CSS pixels (a third of a phone's width). */
export const MAX_SCALE_BAR_PX = 88;

/**
 * The largest 1-2-5 × 10ⁿ distance whose rule still fits `maxWidthPx`.
 *
 * Rounding *down* past the target is deliberate: a rule that is slightly short
 * of the space available stays truthful at the width it claims, while rounding
 * up would need a lie about the distance. `null` means no candidate fits (a
 * camera so far zoomed in that even a foot is wider than the rule) or the
 * reading itself is unknown — in both cases nothing is drawn.
 */
export function scaleBarFor(
  metersPerPixel: number,
  maxWidthPx: number = MAX_SCALE_BAR_PX,
): MapScaleBar | null {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) return null;
  let chosen: MapScaleBar | null = null;
  for (const candidate of SCALE_CANDIDATES) {
    const widthPx = candidate.meters / metersPerPixel;
    if (widthPx > maxWidthPx) break;
    chosen = {
      meters: candidate.meters,
      label: candidate.label,
      // One decimal is the sub-pixel detail a browser can actually draw, and it
      // keeps the rule from jittering between two adjacent integers.
      widthPx: Math.round(widthPx * 10) / 10,
    };
  }
  return chosen;
}
