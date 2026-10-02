import type { RoadAuthorityGeometry, RoadAuthorityRecord, SeasonWindow } from "./types";

export type RoadOpeningCertainty = "published-window" | "recurring-season";

export interface RoadOpeningEvent {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRecordId: string;
  readonly roadName: string | null;
  readonly description: string;
  /** Inclusive start instant. */
  readonly startsAt: string;
  /** Exclusive end instant. */
  readonly endsAt: string;
  readonly certainty: RoadOpeningCertainty;
  readonly geometry: RoadAuthorityGeometry;
}

export interface UndatedSeasonalRoad {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRecordId: string;
  readonly roadName: string | null;
  readonly description: string;
  readonly geometry: RoadAuthorityGeometry;
}

export interface RoadOpeningCalendar {
  readonly from: string;
  readonly to: string;
  readonly events: readonly RoadOpeningEvent[];
  /** Seasonal access is known, but the authority did not publish the dates. */
  readonly undated: readonly UndatedSeasonalRoad[];
}

export interface RoadOpeningCalendarRange {
  readonly from: string;
  readonly to: string;
}

function validInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function exclusiveEnd(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day + 1);
}

function recurringWindows(
  window: SeasonWindow,
  fromMs: number,
  toMs: number,
): readonly { readonly startsAt: string; readonly endsAt: string }[] {
  const fromYear = new Date(fromMs).getUTCFullYear();
  const toYear = new Date(toMs).getUTCFullYear();
  const wraps = window.startMonth > window.endMonth
    || (window.startMonth === window.endMonth && window.startDay > window.endDay);
  const results: { startsAt: string; endsAt: string }[] = [];

  for (let year = fromYear - 1; year <= toYear + 1; year += 1) {
    const start = Date.UTC(year, window.startMonth - 1, window.startDay);
    const endYear = wraps ? year + 1 : year;
    const end = exclusiveEnd(endYear, window.endMonth, window.endDay);
    if (end <= fromMs || start >= toMs) continue;
    results.push({ startsAt: iso(start), endsAt: iso(end) });
  }
  return results;
}

function event(
  record: RoadAuthorityRecord,
  startsAt: string,
  endsAt: string,
  certainty: RoadOpeningCertainty,
): RoadOpeningEvent {
  return {
    id: `${record.sourceId}:${record.sourceRecordId}:${startsAt}:${endsAt}`,
    sourceId: record.sourceId,
    sourceRecordId: record.sourceRecordId,
    roadName: record.roadName,
    description: record.description,
    startsAt,
    endsAt,
    certainty,
    geometry: record.geometry,
  };
}

/**
 * Projects access-designation records into rider-facing opening windows.
 *
 * This deliberately emits only positive, published/recurring opening evidence:
 * year-round roads are omitted, closed/unknown roads are omitted, and seasonal
 * roads with no dates are returned separately as `undated`. The calendar must
 * never invent dates from hunting seasons or infer access from a surface tag.
 */
export function buildRoadOpeningCalendar(
  records: readonly RoadAuthorityRecord[],
  range: RoadOpeningCalendarRange,
): RoadOpeningCalendar {
  const fromMs = validInstant(range.from);
  const toMs = validInstant(range.to);
  if (fromMs === null || toMs === null || fromMs >= toMs) {
    throw new Error("Road opening calendar requires a valid increasing time range.");
  }

  const events: RoadOpeningEvent[] = [];
  const undated: UndatedSeasonalRoad[] = [];

  for (const record of records) {
    if (record.kind !== "motor-vehicle-designation") continue;
    const access = record.motorcycleAccess;
    if (access === undefined || access.status !== "open") continue;

    if (access.windows !== undefined) {
      for (const window of access.windows) {
        const start = validInstant(window.validFrom);
        const end = validInstant(window.validUntil);
        if (start === null || end === null || start >= end || end <= fromMs || start >= toMs) continue;
        events.push(event(record, iso(start), iso(end), "published-window"));
      }
      continue;
    }

    if (access.seasons === null) continue;
    if (access.seasons.length === 0) {
      undated.push({
        id: `${record.sourceId}:${record.sourceRecordId}`,
        sourceId: record.sourceId,
        sourceRecordId: record.sourceRecordId,
        roadName: record.roadName,
        description: record.description,
        geometry: record.geometry,
      });
      continue;
    }

    for (const season of access.seasons) {
      for (const window of recurringWindows(season, fromMs, toMs)) {
        events.push(event(record, window.startsAt, window.endsAt, "recurring-season"));
      }
    }
  }

  events.sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt)
    || (left.roadName ?? "").localeCompare(right.roadName ?? "")
    || left.id.localeCompare(right.id));
  undated.sort((left, right) =>
    (left.roadName ?? "").localeCompare(right.roadName ?? "") || left.id.localeCompare(right.id));

  return { from: range.from, to: range.to, events, undated };
}
