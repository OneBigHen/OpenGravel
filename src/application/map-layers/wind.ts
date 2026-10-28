/**
 * Wind on the map (MAP-EXPERIENCE-NEXT Wave 3, item 13): a coarse field of
 * arrows so a rider can see where the crosswind is before committing to a ridge
 * or a bridge, and a hiker can see which way the weather is coming from.
 *
 * The reading is the National Weather Service gridpoint forecast, one value per
 * forecast window. Three rules shape everything here:
 *
 * 1. **Unknown is not calm.** A point with no published speed or direction is
 *    left out of the grid entirely rather than drawn as a zero. The catalogue
 *    caveat says so on the panel, and the feature card only ever prints numbers
 *    NWS actually published.
 * 2. **One provider fact, normalized once.** The reading is a
 *    {@link WindReading}: speed, gust and the direction the wind blows *from*,
 *    the way a forecast says it ("W 18 mph"). The arrow is the projection of
 *    that fact — it points downwind — and the card prints the same numbers.
 * 3. **The grid is coarse on purpose.** The NWS wind grid is roughly 2.5 km, and
 *    its fields are smooth over tens of kilometres: a dense grid of arrows would
 *    say less than a sparse one and cost more upstream reads. The view sampler is
 *    bounded (see {@link WIND_GRID_MAX_POINTS}) and every point is read from the
 *    same per-cell weather cache `/api/weather` already keeps.
 */

import type { InfoFeature, LngLat, MapLayerBounds } from "./types";

/** Attribution the panel and the map both show for the wind layer. */
export const WIND_ATTRIBUTION = "National Weather Service gridpoint forecast";

/**
 * The most arrows one view may draw. A phone at the widest served span draws
 * 5 × 5; the cap also bounds how many NWS cells one view can read.
 */
export const WIND_GRID_MAX_POINTS = 25;

/** The most arrows along one axis. */
export const WIND_GRID_MAX_AXIS = 5;

/**
 * One arrow per ~0.1° (about 11 km in Pennsylvania), measured across the view.
 * Wider views keep the 5 × 5 cap instead of adding arrows; narrower views get the
 * one or two arrows the NWS grid can honestly support.
 */
export const WIND_GRID_STEP_DEGREES = 0.1;

/** The forecast window the arrows describe; older than this reads as stale. */
export const WIND_FORECAST_STALE_MS = 6 * 60 * 60_000;

/**
 * How late a window may be used when its own end has already passed. A gap in
 * the published grid is answered by the most recent earlier window inside this
 * bound; beyond it the point stays unknown.
 */
export const WIND_READING_TOLERANCE_MS = 3 * 60 * 60_000;

/** One NWS forecast window: a value that holds from `startMs` to `endMs`. */
export interface WindInterval {
  readonly startMs: number;
  readonly endMs: number;
  readonly value: number;
}

/** Wind windows for one NWS cell, already converted to the rider's units. */
export interface WindSeries {
  /** Sustained speed, mph. */
  readonly speedMph: readonly WindInterval[];
  /** Gusts, mph; empty when NWS publishes none for the cell. */
  readonly gustMph: readonly WindInterval[];
  /** The direction the wind blows *from*, degrees clockwise from north. */
  readonly fromDegrees: readonly WindInterval[];
}

/** What the wind is doing at one point: the fact, never a rendered guess. */
export interface WindReading {
  /** Sustained speed, mph, as published. */
  readonly speedMph: number;
  /** Gust, mph, when published for the same window; `null` is unknown. */
  readonly gustMph: number | null;
  /** Direction the wind blows *from*, degrees clockwise from north. */
  readonly fromDegrees: number;
}

/** A reading plus the forecast window it came from. */
export interface WindReadingAt {
  readonly reading: WindReading;
  readonly startMs: number;
}

/** One point of the arrow grid. Only points with a reading are in the grid. */
export interface WindPoint {
  readonly coordinate: LngLat;
  readonly reading: WindReading;
  /** Start of the forecast window the reading came from, ISO. */
  readonly validFrom: string;
}

/**
 * The coarse arrow grid for a view: equal cells, one point in each cell's
 * centre, at most {@link WIND_GRID_MAX_POINTS} points.
 *
 * An inverted or empty view has no grid. Points never sit on the view's edge —
 * an arrow half under the chrome is not information — and the same view always
 * produces the same points, so a pan back to a place costs the same reads.
 */
export function sampleWindGrid(
  bounds: MapLayerBounds,
  maxPoints: number = WIND_GRID_MAX_POINTS,
): readonly LngLat[] {
  const spanLon = bounds.east - bounds.west;
  const spanLat = bounds.north - bounds.south;
  if (!Number.isFinite(spanLon) || !Number.isFinite(spanLat)) return [];
  if (spanLon <= 0 || spanLat <= 0 || maxPoints < 1) return [];

  const axisLimit = Math.max(1, Math.min(WIND_GRID_MAX_AXIS, Math.floor(maxPoints)));
  let columns = Math.min(axisLimit, Math.max(1, Math.round(spanLon / WIND_GRID_STEP_DEGREES)));
  let rows = Math.min(axisLimit, Math.max(1, Math.round(spanLat / WIND_GRID_STEP_DEGREES)));
  while (columns * rows > maxPoints) {
    if (columns >= rows && columns > 1) columns -= 1;
    else if (rows > 1) rows -= 1;
    else break;
  }

  const points: LngLat[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lon = bounds.west + (spanLon * (column + 0.5)) / columns;
      const lat = bounds.south + (spanLat * (row + 0.5)) / rows;
      points.push([round5(lon), round5(lat)]);
    }
  }
  return points;
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** The window whose value holds at `atMs`, tolerating a short published gap. */
function intervalAt(
  intervals: readonly WindInterval[],
  atMs: number,
): WindInterval | null {
  let covering: WindInterval | null = null;
  let previous: WindInterval | null = null;
  for (const interval of intervals) {
    if (interval.startMs <= atMs && interval.endMs > atMs) {
      if (covering === null || interval.startMs > covering.startMs) covering = interval;
    } else if (interval.startMs <= atMs) {
      if (previous === null || interval.startMs > previous.startMs) previous = interval;
    }
  }
  if (covering !== null) return covering;
  if (previous !== null && atMs - previous.startMs <= WIND_READING_TOLERANCE_MS) return previous;
  return null;
}

/**
 * The reading that applies at an instant, or `null` when the cell publishes no
 * covering window. Speed and direction are both required: an arrow with a speed
 * and no direction would be a drawing, not a reading.
 */
export function windReadingAt(series: WindSeries, atMs: number): WindReadingAt | null {
  if (!Number.isFinite(atMs)) return null;
  const speed = intervalAt(series.speedMph, atMs);
  const direction = intervalAt(series.fromDegrees, atMs);
  if (speed === null || direction === null) return null;
  const gust = intervalAt(series.gustMph, atMs);
  return {
    startMs: speed.startMs,
    reading: {
      speedMph: speed.value,
      gustMph: gust === null ? null : gust.value,
      fromDegrees: normaliseDegrees(direction.value),
    },
  };
}

function normaliseDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return Math.round(wrapped * 10) / 10;
}

/** The compass points a rider says out loud; eight is enough for a forecast. */
const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** "W" for 250°, "N" for 0°: the direction the wind blows *from*. */
export function windDirectionLabel(fromDegrees: number): string {
  if (!Number.isFinite(fromDegrees)) return "Unknown";
  const index = Math.round(normaliseDegrees(fromDegrees) / 45) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] ?? "N";
}

/**
 * The rotation a north-pointing arrow needs to point downwind, in degrees
 * clockwise from north. The reading is the direction the wind comes *from*, so
 * the arrow turns by half a circle: a westerly (250°) arrow points east (70°).
 */
export function windArrowRotationDeg(fromDegrees: number): number {
  if (!Number.isFinite(fromDegrees)) return 0;
  return normaliseDegrees(normaliseDegrees(fromDegrees) + 180);
}

/**
 * The mean downwind direction across a view, in degrees clockwise from north, or
 * `null` when no reading is known. Averaged as vectors, so north-westerly and
 * north-easterly readings average to north rather than south.
 */
export function meanWindArrowDirectionDeg(
  readings: readonly WindReading[],
): number | null {
  if (readings.length === 0) return null;
  let east = 0;
  let north = 0;
  for (const reading of readings) {
    const radians = (windArrowRotationDeg(reading.fromDegrees) * Math.PI) / 180;
    east += Math.sin(radians);
    north += Math.cos(radians);
  }
  if (Math.abs(east) < 1e-9 && Math.abs(north) < 1e-9) return null;
  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  return normaliseDegrees(degrees);
}

/** The arrow's strength band: what the size and colour mean. */
export type WindBand = "calm" | "breeze" | "strong" | "gale";

/** Which palette slot a band draws in; the renderer maps it to a colour. */
export type WindTone = "sage" | "signal" | "gold" | "ember";

export interface WindBandDefinition {
  readonly band: WindBand;
  /** The speed at which this band starts, mph. */
  readonly fromMph: number;
  readonly tone: WindTone;
  /** Icon size factor; 1 is the mid size the layer is tuned for. */
  readonly size: number;
  /** One word for the legend and the layer's about text. */
  readonly words: string;
}

/**
 * Band edges and how each band draws. Size changes with the band, not with the
 * speed inside a band: an arrow that grows every mile an hour reads as a gauge,
 * and the numbers are in the card anyway. Colour carries the same grade for a
 * rider who cannot tell two sizes apart.
 */
export const WIND_BANDS: readonly WindBandDefinition[] = [
  { band: "calm", fromMph: 0, tone: "sage", size: 0.7, words: "Light" },
  { band: "breeze", fromMph: 8, tone: "signal", size: 0.82, words: "Breezy" },
  { band: "strong", fromMph: 16, tone: "gold", size: 0.96, words: "Strong" },
  { band: "gale", fromMph: 25, tone: "ember", size: 1.14, words: "Gale" },
];

/** The band a speed draws in, or `null` when the speed is unknown. */
export function windArrowStyle(speedMph: number | null | undefined): WindBandDefinition | null {
  if (speedMph === null || speedMph === undefined) return null;
  if (!Number.isFinite(speedMph) || speedMph < 0) return null;
  let chosen = WIND_BANDS[0] as WindBandDefinition;
  for (const definition of WIND_BANDS) {
    if (speedMph >= definition.fromMph) chosen = definition;
  }
  return chosen;
}

/** The map image id for a band; the renderer adds one image per band. */
export function windArrowImageId(band: WindBand): string {
  return `ogv-wind-arrow-${band}`;
}

/** The GeoJSON properties the arrow layer draws from, or `{}` when unknown. */
export function windArrowProperties(
  reading: WindReading | null | undefined,
): Readonly<Record<string, unknown>> {
  if (reading === null || reading === undefined) return {};
  const style = windArrowStyle(reading.speedMph);
  if (style === null) return {};
  return {
    direction: windArrowRotationDeg(reading.fromDegrees),
    icon: windArrowImageId(style.band),
    size: style.size,
    speed: Math.round(reading.speedMph),
  };
}

/**
 * What the feature card says for an arrow: the forecast's own words — "W 18 mph"
 * with the gust under it. A gust NWS did not publish is said to be unknown, not
 * printed as the sustained speed.
 */
export function windArrowText(reading: WindReading): { readonly name: string; readonly detail: string } {
  const speed = Math.round(reading.speedMph);
  return {
    name: `${windDirectionLabel(reading.fromDegrees)} ${speed} mph`,
    detail: reading.gustMph === null
      ? "Gusts not published"
      : `Gusts ${Math.round(reading.gustMph)} mph`,
  };
}

/**
 * The grid as map features: one tappable arrow per point, carrying the reading so
 * the card can print it and the renderer can point the arrow downwind.
 */
export function windGridFeatures(points: readonly WindPoint[]): readonly InfoFeature[] {
  return points.map((point) => {
    const text = windArrowText(point.reading);
    return {
      id: `wind:${point.coordinate[0].toFixed(3)},${point.coordinate[1].toFixed(3)}`,
      layerId: "wind",
      name: text.name,
      detail: text.detail,
      weight: Math.round(point.reading.speedMph * 10) / 10,
      wind: point.reading,
      geometry: { type: "Point", coordinates: point.coordinate },
    };
  });
}
