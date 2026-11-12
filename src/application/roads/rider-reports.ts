/**
 * Spots a rider reported while riding ("Gate closed", "Road too rough").
 *
 * A report is a private note on this device. It is turned into a small avoid
 * area for this rider's own plans and nothing else: it is never sent anywhere,
 * never shown as "closed" to anyone, never overrides or hides an official
 * closure and never makes a road "open". Reports expire after 30 days.
 */

import { validateAvoidAreaRings } from "@/application/planner/avoid-area-geometry";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

export type RiderReportKind = "gate-closed" | "road-bad";

export interface RiderReport {
  readonly id: string;
  readonly point: Coordinate;
  /** Direction of travel in degrees, or null when the phone did not know. */
  readonly headingDegrees: number | null;
  readonly kind: RiderReportKind;
  /** When the rider tapped, epoch milliseconds. */
  readonly reportedAtMs: number;
  /** When the report stops counting, epoch milliseconds. */
  readonly expiresAtMs: number;
}

export const RIDER_REPORT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Half the side of the avoided box: the planned line stays at least this far away. */
export const RIDER_REPORT_HALF_SIDE_METERS = 60;
/** A new report this close to an older one replaces it instead of stacking. */
export const RIDER_REPORT_MERGE_METERS = 25;

const METERS_PER_DEGREE_LAT = 111_320;

export function riderReportKindLabel(kind: RiderReportKind): string {
  return kind === "gate-closed" ? "gate closed" : "road too rough";
}

export function isLiveReport(report: RiderReport, nowMs: number): boolean {
  return report.expiresAtMs > nowMs;
}

export function liveReports(reports: readonly RiderReport[], nowMs: number): readonly RiderReport[] {
  return reports.filter((report) => isLiveReport(report, nowMs));
}

/** The closed square ring around a report, valid for the avoid-area validator. */
export function riderReportRing(point: Coordinate): readonly Coordinate[] {
  const dLat = RIDER_REPORT_HALF_SIDE_METERS / METERS_PER_DEGREE_LAT;
  const dLon = dLat / Math.max(0.01, Math.cos((point.lat * Math.PI) / 180));
  const west = Math.max(-180, point.lon - dLon);
  const east = Math.min(180, point.lon + dLon);
  const south = Math.max(-90, point.lat - dLat);
  const north = Math.min(90, point.lat + dLat);
  return [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north },
    { lon: west, lat: south },
  ];
}

/** One box per live report. Expired reports produce nothing. */
export function reportsToAvoidAreas(
  reports: readonly RiderReport[],
  nowMs: number,
): readonly { readonly id: string; readonly ring: readonly Coordinate[] }[] {
  const areas: { id: string; ring: readonly Coordinate[] }[] = [];
  for (const report of liveReports(reports, nowMs)) {
    const ring = riderReportRing(report.point);
    if (validateAvoidAreaRings([ring]) !== null) continue;
    areas.push({ id: report.id, ring });
  }
  return areas;
}

/** Adds a report; any older report within 25 m is replaced, and expired ones are dropped. */
export function addReport(
  reports: readonly RiderReport[],
  report: RiderReport,
  nowMs: number,
): readonly RiderReport[] {
  const kept = liveReports(reports, nowMs).filter(
    (existing) => haversine(existing.point, report.point) > RIDER_REPORT_MERGE_METERS,
  );
  return [...kept, report];
}

export function removeReport(reports: readonly RiderReport[], id: string): readonly RiderReport[] {
  return reports.filter((report) => report.id !== id);
}

export function newRiderReport(input: {
  readonly id: string;
  readonly point: Coordinate;
  readonly headingDegrees: number | null;
  readonly kind: RiderReportKind;
  readonly nowMs: number;
}): RiderReport {
  return {
    id: input.id,
    point: { lon: input.point.lon, lat: input.point.lat },
    headingDegrees:
      input.headingDegrees !== null && Number.isFinite(input.headingDegrees) ? input.headingDegrees : null,
    kind: input.kind,
    reportedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + RIDER_REPORT_LIFETIME_MS,
  };
}

function isCoordinate(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null) return false;
  const { lon, lat } = value as Record<string, unknown>;
  return (
    typeof lon === "number" && typeof lat === "number" &&
    Number.isFinite(lon) && Number.isFinite(lat) &&
    Math.abs(lon) <= 180 && Math.abs(lat) <= 90
  );
}

/** Reads stored text; anything that does not parse as a report is dropped, never guessed. */
export function parseReports(text: string | null): readonly RiderReport[] {
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const result: RiderReport[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r["id"] !== "string" || !isCoordinate(r["point"])) continue;
    if (r["kind"] !== "gate-closed" && r["kind"] !== "road-bad") continue;
    if (typeof r["reportedAtMs"] !== "number" || typeof r["expiresAtMs"] !== "number") continue;
    if (!Number.isFinite(r["reportedAtMs"]) || !Number.isFinite(r["expiresAtMs"])) continue;
    const heading = r["headingDegrees"];
    result.push({
      id: r["id"],
      point: { lon: r["point"].lon, lat: r["point"].lat },
      headingDegrees: typeof heading === "number" && Number.isFinite(heading) ? heading : null,
      kind: r["kind"],
      reportedAtMs: r["reportedAtMs"],
      expiresAtMs: r["expiresAtMs"],
    });
  }
  return result;
}

/**
 * The third truth line's rider-report sentence. It counts reports apart from
 * official checks and never uses the word "closed" for a rider report.
 */
export function avoidingSpotsSentence(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Avoiding 1 spot you reported." : `Avoiding ${count} spots you reported.`;
}

/** What the marker says when tapped: "You marked this gate closed on Nov 11". */
export function reportMarkerText(report: RiderReport, locale?: string): string {
  const date = new Date(report.reportedAtMs).toLocaleDateString(locale ?? "en-US", {
    month: "short",
    day: "numeric",
  });
  return `You marked this ${riderReportKindLabel(report.kind)} on ${date}`;
}
