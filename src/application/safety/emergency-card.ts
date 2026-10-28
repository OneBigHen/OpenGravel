/**
 * The model behind "Where am I / Emergency" (HIKE-MODE-PLAN H4 §19).
 *
 * One pure function turns the facts a surface actually holds — the current or
 * pressed coordinate, whatever altitude and accuracy the device reported, and
 * the nearest road line already loaded — into the rows the card prints and the
 * paragraph the share sheet sends. Presentation stays in the component so the
 * same sentences can be tested without a DOM, and so the card can never show a
 * value the share text disagrees with.
 *
 * Every unknown is a `null` here and an explicit "Unknown" in the copy. A
 * missing GPS fix, a device that reports no altitude, or a map with no road
 * layers loaded must never read as "at sea level", "no road nearby" or "0 m
 * away" — the whole point of an emergency card is that its silences are true.
 */

import type { NearestRoad } from "@/domain/geometry/nearest-road";
import { formatDecimalDegrees, formatDms, formatUsng } from "@/domain/geometry/coordinates";
import type { Coordinate } from "@/domain/ride/types";

const METRES_PER_FOOT = 0.3048;
const METRES_PER_MILE = 1609.344;

/** Which notation a copy row writes to the clipboard. */
export type EmergencyFormatId = "decimal" | "dms" | "usng";

export interface EmergencyFormatRow {
  readonly id: EmergencyFormatId;
  /** The row's name, e.g. "Decimal degrees". */
  readonly label: string;
  /** The coordinate as printed on the card. */
  readonly value: string;
  /** What the copy button writes, or `null` when the notation cannot exist. */
  readonly copyValue: string | null;
}

export interface EmergencyRoadLine {
  /** A name in the rider's words, or "Unknown" when nothing loaded. */
  readonly text: string;
  /** Distance and direction, or the reason there is none. */
  readonly detail: string | null;
  readonly known: boolean;
}

export interface EmergencyCardModel {
  readonly coordinate: Coordinate | null;
  /** Empty when there is no coordinate to print (no GPS fix yet). */
  readonly formats: readonly EmergencyFormatRow[];
  /** "1,240 ft" or "Unknown". */
  readonly altitude: string;
  readonly altitudeKnown: boolean;
  /** "±8 m" or `null` when the device did not report an accuracy. */
  readonly accuracy: string | null;
  readonly road: EmergencyRoadLine;
  /** Everything the share sheet or clipboard fallback sends. */
  readonly shareText: string;
}

export interface EmergencyCardInput {
  readonly coordinate: Coordinate | null;
  readonly altitudeMeters?: number | null;
  readonly accuracyMeters?: number | null;
  /** The closest road in the lines this surface holds, or `null`. */
  readonly nearestRoad: NearestRoad | null;
  /** Whether any road lines were available to search, known or empty. */
  readonly roadsLoaded: boolean;
  /** The moment printed on shared text; injected so tests are deterministic. */
  readonly at: Date;
}

/** `1240 → "1,240"` without depending on the runtime's locale data. */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** An altitude in feet, the unit US rescue crews read; `null` when unreported. */
export function formatAltitude(altitudeMeters: number | null | undefined): string | null {
  if (altitudeMeters === null || altitudeMeters === undefined || !Number.isFinite(altitudeMeters)) {
    return null;
  }
  return `${groupThousands(Math.round(altitudeMeters / METRES_PER_FOOT))} ft`;
}

/** The device's horizontal accuracy, to the nearest metre ("±8 m"). */
export function formatAccuracy(accuracyMeters: number | null | undefined): string | null {
  if (accuracyMeters === null || accuracyMeters === undefined || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    return null;
  }
  return `±${Math.max(1, Math.round(accuracyMeters))} m`;
}

/**
 * A short distance the way a person gives directions out loud: feet while a
 * road is a walk away, then miles to a tenth.
 */
export function formatRoadDistance(meters: number): string | null {
  if (!Number.isFinite(meters) || meters < 0) return null;
  const feet = meters / METRES_PER_FOOT;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  const miles = meters / METRES_PER_MILE;
  return `${miles >= 10 ? Math.round(miles) : Number(miles.toFixed(1))} mi`;
}

const ROAD_UNKNOWN_NO_DATA = "No road data available here";
const ROAD_UNKNOWN_EMPTY = "No mapped road in range";

/** The road row: the name, then distance and direction, or an honest silence. */
export function describeNearestRoad(
  nearest: NearestRoad | null,
  roadsLoaded: boolean,
): EmergencyRoadLine {
  if (nearest === null) {
    return {
      text: "Unknown",
      detail: roadsLoaded ? ROAD_UNKNOWN_EMPTY : ROAD_UNKNOWN_NO_DATA,
      known: false,
    };
  }
  const distance = formatRoadDistance(nearest.meters);
  return {
    text: nearest.name.trim() === "" ? "Unnamed road" : nearest.name,
    detail: distance === null ? null : `${distance} ${nearest.direction}`,
    known: true,
  };
}

function shareLines(
  input: EmergencyCardInput,
  formats: readonly EmergencyFormatRow[],
  road: EmergencyRoadLine,
): string[] {
  const lines = ["OpenGravel emergency location"];
  if (formats.length === 0) {
    lines.push("No GPS fix yet.");
  } else {
    for (const row of formats) {
      if (row.copyValue !== null) lines.push(row.copyValue);
    }
    const altitude = formatAltitude(input.altitudeMeters);
    if (altitude !== null) lines.push(`Altitude ${altitude}`);
    const accuracy = formatAccuracy(input.accuracyMeters);
    if (accuracy !== null) lines.push(`GPS accuracy ${accuracy}`);
  }
  // The reason a road is unknown belongs on the card, where a rider can act on
  // it; the shared message says only what is true without the map's context.
  lines.push(
    road.known && road.detail !== null
      ? `Nearest road: ${road.text} — ${road.detail}`
      : "Nearest road: unknown",
  );
  lines.push(`Recorded ${input.at.toISOString()}`);
  return lines;
}

export function emergencyCardModel(input: EmergencyCardInput): EmergencyCardModel {
  // Decimal degrees and DMS exist for any finite position; USNG stops at the
  // UTM bands. A point outside the grid keeps the two notations that are still
  // true and says why the third is missing, instead of hiding all three.
  const decimal = input.coordinate === null ? null : formatDecimalDegrees(input.coordinate);
  const dms = input.coordinate === null ? null : formatDms(input.coordinate);
  const usng = input.coordinate === null ? null : formatUsng(input.coordinate);
  const rows: readonly EmergencyFormatRow[] =
    decimal === null || dms === null
      ? []
      : [
          { id: "decimal", label: "Decimal degrees", value: decimal, copyValue: decimal },
          { id: "dms", label: "Degrees / minutes / seconds", value: dms, copyValue: dms },
          {
            id: "usng",
            label: "USNG / MGRS",
            value: usng ?? "Not covered by the grid",
            copyValue: usng,
          },
        ];
  const altitude = formatAltitude(input.altitudeMeters);
  const road = describeNearestRoad(input.nearestRoad, input.roadsLoaded);
  return {
    coordinate: rows.length === 0 ? null : input.coordinate,
    formats: rows,
    altitude: altitude ?? "Unknown",
    altitudeKnown: altitude !== null,
    accuracy: formatAccuracy(input.accuracyMeters),
    road,
    shareText: shareLines(input, rows, road).join("\n"),
  };
}
