/**
 * The three coordinate notations a rescuer can be given (HIKE-MODE-PLAN H4 §19).
 *
 * An emergency card is only useful if the number read out is the number the
 * dispatcher needs. US rescue services work in decimal degrees, hikers often
 * quote degrees/minutes/seconds, and USNG/MGRS is what many search-and-rescue
 * grids are laid out in, so the same point is printed three ways instead of
 * asking a frightened person which one they want.
 *
 * Everything here is WGS84 and pure: no clock, no network, no projection
 * library (this app ships none, and an emergency card must work with the radio
 * off). UTM conversions use the standard Snyder series — the same formulas the
 * NGA reference implementation documents — which is accurate to better than a
 * metre inside the zone the point falls in, well below GPS error.
 *
 * Unknown stays unknown. A coordinate that is malformed, or a latitude outside
 * the UTM band range (80°S–84°N), yields `null` rather than a plausible-looking
 * grid reference to a place the grid does not cover.
 */

import type { Coordinate } from "../ride/types";

const WGS84_SEMI_MAJOR_AXIS = 6_378_137;
const WGS84_FLATTENING = 1 / 298.257223563;
const UTM_SCALE_FACTOR = 0.9996;
const UTM_FALSE_EASTING = 500_000;
const UTM_FALSE_NORTHING = 10_000_000;
const METRES_PER_DEGREE = Math.PI / 180;

/**
 * UTM latitude bands, C to X in 8° steps from 80°S. I and O are omitted so the
 * letter cannot be misread as a digit; X is the 12° band that reaches 84°N.
 */
const LATITUDE_BANDS = "CDEFGHJKLMNPQRSTUVWX";
/** The 100 km square rows, north to south from the equator, I and O omitted. */
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV";
/** The three column-letter sets, repeated in order once every three zones. */
const COLUMN_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"] as const;

/** Decimal places that carry a useful precision without overstating GPS. */
export const DECIMAL_DEGREE_DIGITS = 5;
/** 5 digits = 1 m; the finest USNG/MGRS precision practically quoted. */
export const MGRS_DIGITS = 5;

export interface UtmCoordinate {
  readonly zone: number;
  /** The latitude band letter (C–X). */
  readonly band: string;
  /** Metres east of the zone's 500 km false easting line. */
  readonly easting: number;
  /** Metres north of the equator, with the 10,000,000 m southern offset. */
  readonly northing: number;
  readonly hemisphere: "N" | "S";
}

/** The one string per notation the emergency card prints and copies. */
export interface CoordinateFormats {
  /** `40.71280, -74.00600` — decimal degrees, the form dispatchers read back. */
  readonly decimal: string;
  /** `40°42′46.1″ N, 74°00′21.6″ W`. */
  readonly dms: string;
  /** `18T WK 12345 67890` — USNG is MGRS with the datum implied by the app. */
  readonly usng: string;
  /** `18TWK1234567890` — the compact military grid reference. */
  readonly mgrs: string;
}

function isFiniteCoordinate(point: Coordinate): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon);
}

/**
 * Longitude folded into [-180, 180] so a wrapped value still grids correctly.
 *
 * The antimeridian keeps its two signed forms rather than collapsing to one:
 * 180°E is zone 60's eastern edge and 180°W is zone 1's western edge, and a
 * coordinate printed from a phone at the date line should use the zone the
 * device's own longitude is on.
 */
function normaliseLongitude(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

/**
 * The UTM zone a longitude belongs to, including the two documented exceptions
 * that keep Norway and Svalbard in one zone each (Snyder, "Map Projections —
 * A Working Manual", UTM zone exceptions).
 */
function utmZone(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  // Norway: band V (56°–64°N) between 3°E and 12°E is zone 32, not 31/32.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  // Svalbard: band X (72°–84°N) uses 31, 33, 35 and 37 only.
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon < 21) zone = 33;
    else if (lon < 33) zone = 35;
    else if (lon < 42) zone = 37;
  }
  return zone;
}

/** The 8° latitude band a point falls in, or `null` outside UTM's coverage. */
export function utmBand(lat: number): string | null {
  if (!Number.isFinite(lat) || lat < -80 || lat > 84) return null;
  // The northernmost band is 12° tall so 84°N lands in X rather than off the end.
  const index = Math.min(LATITUDE_BANDS.length - 1, Math.floor((lat + 80) / 8));
  const band = LATITUDE_BANDS[index];
  return band ?? null;
}

/**
 * The point's UTM coordinate, or `null` when it is not a finite position the
 * grid covers. The forward series is Snyder's (§8-9), accurate to centimetres
 * within a zone and to a few metres at its 3° edges.
 */
export function toUtm(point: Coordinate): UtmCoordinate | null {
  if (!isFiniteCoordinate(point)) return null;
  const band = utmBand(point.lat);
  if (band === null) return null;
  const lon = normaliseLongitude(point.lon);
  const zone = utmZone(point.lat, lon);

  const eccentricitySquared = WGS84_FLATTENING * (2 - WGS84_FLATTENING);
  const secondEccentricitySquared = eccentricitySquared / (1 - eccentricitySquared);
  const latitude = point.lat * METRES_PER_DEGREE;
  const longitude = lon * METRES_PER_DEGREE;
  const centralMeridian = ((zone - 1) * 6 - 180 + 3) * METRES_PER_DEGREE;

  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const tanLatitude = Math.tan(latitude);
  const radius = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1 - eccentricitySquared * sinLatitude ** 2);
  const t = tanLatitude ** 2;
  const c = secondEccentricitySquared * cosLatitude ** 2;
  const a = cosLatitude * (longitude - centralMeridian);

  const e4 = eccentricitySquared ** 2;
  const e6 = eccentricitySquared ** 3;
  const meridionalArc =
    WGS84_SEMI_MAJOR_AXIS *
    ((1 - eccentricitySquared / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latitude -
      ((3 * eccentricitySquared) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latitude) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latitude) -
      ((35 * e6) / 3072) * Math.sin(6 * latitude));

  const easting =
    UTM_SCALE_FACTOR *
      radius *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * secondEccentricitySquared) * a ** 5) / 120) +
    UTM_FALSE_EASTING;

  let northing =
    UTM_SCALE_FACTOR *
    (meridionalArc +
      radius *
        tanLatitude *
        (a ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * secondEccentricitySquared) * a ** 6) / 720));
  if (point.lat < 0) northing += UTM_FALSE_NORTHING;

  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  return {
    zone,
    band,
    easting,
    northing,
    hemisphere: point.lat < 0 ? "S" : "N",
  };
}

/** The 100 km square identifier (`WK`) for a UTM coordinate. */
function gridSquare(zone: number, easting: number, northing: number): string | null {
  const columnIndex = Math.floor(easting / 100_000);
  const columnSet = COLUMN_SETS[(zone - 1) % 3];
  if (columnSet === undefined) return null;
  const column = columnSet[columnIndex - 1];
  if (column === undefined) return null;
  // Even zones start the row lettering five rows along, so the same northing
  // has a different square north of the equator than in the zone next door.
  // This is the same A/F alternation the NGA and proj4js implementations use.
  const rowIndex = (Math.floor(northing / 100_000) % ROW_LETTERS.length +
    (zone % 2 === 0 ? 5 : 0)) % ROW_LETTERS.length;
  const row = ROW_LETTERS[rowIndex];
  return row === undefined ? null : `${column}${row}`;
}

/** The digits of a grid reference, each value truncated to its last `digits`. */
function gridDigits(value: number, digits: number): string {
  const precision = 10 ** digits;
  const remainder = Math.floor(value) % precision;
  return String(remainder).padStart(digits, "0");
}

/**
 * The MGRS reference as its parts: `{ zone: "18T", square: "WK", easting:
 * "12345", northing: "67890" }`.
 *
 * USNG is exactly this with the datum spelled out, so both renderings come from
 * the same parts and can never disagree about the point.
 */
export function toMgrsParts(
  point: Coordinate,
  digits: number = MGRS_DIGITS,
): { readonly zone: string; readonly square: string; readonly easting: string; readonly northing: string } | null {
  if (!Number.isInteger(digits) || digits < 0 || digits > MGRS_DIGITS) return null;
  const utm = toUtm(point);
  if (utm === null) return null;
  const square = gridSquare(utm.zone, utm.easting, utm.northing);
  if (square === null) return null;
  return {
    zone: `${utm.zone}${utm.band}`,
    square,
    easting: gridDigits(utm.easting, digits),
    northing: gridDigits(utm.northing, digits),
  };
}

/** The compact MGRS string (`18TWK1234567890`), or `null` outside the grid. */
export function formatMgrs(point: Coordinate, digits: number = MGRS_DIGITS): string | null {
  const parts = toMgrsParts(point, digits);
  return parts === null ? null : `${parts.zone}${parts.square}${parts.easting}${parts.northing}`;
}

/** The spaced USNG string (`18T WK 12345 67890`), or `null` outside the grid. */
export function formatUsng(point: Coordinate, digits: number = MGRS_DIGITS): string | null {
  const parts = toMgrsParts(point, digits);
  if (parts === null) return null;
  // A zero-digit reference names the 100 km square and has no numbers to space.
  return digits === 0
    ? `${parts.zone} ${parts.square}`
    : `${parts.zone} ${parts.square} ${parts.easting} ${parts.northing}`;
}

/** `40.71280, -74.00600`: signed decimal degrees, the dispatcher's form. */
export function formatDecimalDegrees(
  point: Coordinate,
  digits: number = DECIMAL_DEGREE_DIGITS,
): string | null {
  if (!isFiniteCoordinate(point)) return null;
  const fixed = (value: number): string => {
    // `toFixed` renders a tiny negative value as `-0.00000`; a coordinate that
    // rounds to the meridian is on it, not "minus zero" of it.
    const text = value.toFixed(digits);
    return text.startsWith("-0.") && Number(text) === 0 ? text.slice(1) : text;
  };
  return `${fixed(point.lat)}, ${fixed(point.lon)}`;
}

interface DmsParts {
  readonly degrees: number;
  readonly minutes: number;
  /** Seconds with one decimal, already carried into minutes and degrees. */
  readonly seconds: number;
}

/**
 * One half of a DMS pair. Rounding happens once, in tenths of a second, and the
 * carry is explicit: a point 0.04″ short of a degree prints as the next degree
 * rather than as `60.0″`, which is the classic way a hand-written DMS lies.
 */
function dmsParts(value: number): DmsParts {
  const tenths = Math.round(Math.abs(value) * 36_000);
  const degrees = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths - degrees * 36_000) / 600);
  const seconds = (tenths - degrees * 36_000 - minutes * 600) / 10;
  return { degrees, minutes, seconds };
}

function dmsHalf(value: number, positive: string, negative: string): string {
  const { degrees, minutes, seconds } = dmsParts(value);
  const hemisphere = value < 0 ? negative : positive;
  return `${degrees}°${String(minutes).padStart(2, "0")}′${seconds.toFixed(1).padStart(4, "0")}″ ${hemisphere}`;
}

/** `40°42′46.1″ N, 74°00′21.6″ W`, or `null` for a malformed coordinate. */
export function formatDms(point: Coordinate): string | null {
  if (!isFiniteCoordinate(point)) return null;
  return `${dmsHalf(point.lat, "N", "S")}, ${dmsHalf(point.lon, "E", "W")}`;
}

/**
 * Every notation for one point, ready to print.
 *
 * USNG and MGRS share a source, so a card cannot print two grid references that
 * disagree; a point outside the grid says so once (`null`) instead of showing a
 * blank row that reads like the data loaded and found nothing.
 */
export function coordinateFormats(point: Coordinate): CoordinateFormats | null {
  const decimal = formatDecimalDegrees(point);
  const dms = formatDms(point);
  const usng = formatUsng(point);
  const mgrs = formatMgrs(point);
  if (decimal === null || dms === null || usng === null || mgrs === null) return null;
  return { decimal, dms, usng, mgrs };
}
