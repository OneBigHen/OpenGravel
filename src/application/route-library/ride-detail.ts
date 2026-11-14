import { creditText } from "@/domain/ride/credit";

import { kindFor, statedMiles, trackYear, typeFor } from "./classify";
import { factsFor, parseSourceRating } from "./facts";
import type { BuiltGeometry } from "./geometry";
import type { SourcePolicy } from "./policy";
import { trackFlags } from "./track-flags";
import type { LibraryBounds, LibraryPoi, LibraryRecord, RideCreditLine, RideDetail } from "./types";

const MILES_PER_KM = 0.621371;

/** Source text is written in kilometers; riders read miles. Only "NN km" is touched. */
export function milesInText(text: string): string {
  return text.replace(/\b(\d+(?:\.\d+)?)\s?km\b(?!\/)/gi, (_match, value: string) => {
    const miles = Number(value) * MILES_PER_KM;
    return `${miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10} mi`;
  });
}

export function creditFor(record: LibraryRecord): RideCreditLine {
  const named = record.author_credit.author.trim();
  const author = named === "" || named.toLowerCase() === "unknown" ? null : named;
  const fallback = creditText({ author, sourceName: record.source.name });
  const line = record.author_credit.credit_line?.trim();
  return {
    author,
    sourceName: record.source.name,
    sourceUrl: record.source.url,
    creditLine: line === undefined || line === "" ? fallback : line,
  };
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function pois(list: readonly LibraryPoi[] | undefined): readonly LibraryPoi[] {
  return list ?? [];
}

export interface PinSource {
  readonly start: { readonly lat: number; readonly lon: number };
  readonly bounds: LibraryBounds;
}

function usablePoint(lat: unknown, lon: unknown): boolean {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/**
 * Plan 5.4 item 1: where the index pin goes, and how exact it is.
 * The start of a line we serve beats everything; then the `location` the
 * library supplied, copied as it stands (never geocoded); then the middle of
 * the source's own measured box. Nothing at all stays `null`.
 */
export function pinFor(record: LibraryRecord, served: PinSource | null, bundle: boolean): RideDerived["pin"] {
  if (served !== null && !bundle) return { lat: served.start.lat, lon: served.start.lon, precision: "start" };
  const location = record.location;
  if (location !== undefined && usablePoint(location.lat, location.lon)) {
    const precision = location.precision === "trailhead" ? "start" : location.precision === "town" ? "town" : "area";
    return { lat: location.lat, lon: location.lon, precision };
  }
  const bounds = served?.bounds ?? (record.gpx.availability === "none" ? null : record.gpx.bounds ?? null);
  if (bounds === null) return null;
  return { lat: round((bounds.south + bounds.north) / 2, 5), lon: round((bounds.west + bounds.east) / 2, 5), precision: "area" };
}

export interface RideDerived {
  readonly detail: RideDetail;
  /** The stored line, or an empty string when the ride has none to serve. */
  readonly line: string;
  /** Where the pin goes, when there is one, and how exact that is. */
  readonly pin: { readonly lat: number; readonly lon: number; readonly precision: "start" | "area" | "town" } | null;
  readonly bounds: LibraryBounds | null;
  readonly mapLine: string | null;
  readonly cardLine: string | null;
}

/**
 * Stages 3 to 6 for one record: what the pack stores and shows. A `link`
 * policy (or a track we could not read) drops the line; the source link stays.
 * Facts are quoted, never upgraded: a `null` stays `null`.
 */
export function deriveRide(record: LibraryRecord, policy: SourcePolicy, built: BuiltGeometry | null): RideDerived {
  const served = policy.mode === "host" ? built : null;
  const stated = statedMiles(record);
  const libraryMiles = typeof record.gpx.distance_km === "number" ? record.gpx.distance_km * MILES_PER_KM : null;
  const kind = kindFor(record, built?.miles ?? libraryMiles);
  const year = trackYear(record);
  const bundle = record.gpx.is_bundle === true;
  const notes = [
    ...(record.discussion?.comments_captured ?? []).map((comment) => ({
      author: comment.author,
      text: comment.text,
      date: comment.captured_at,
      url: comment.url ?? record.discussion?.comments_url ?? null,
    })),
    ...(record.discussion?.post_text === undefined || record.discussion.post_text.trim() === ""
      ? []
      : [{ author: record.author_credit.author, text: record.discussion.post_text.trim(), date: null, url: record.discussion.comments_url ?? null }]),
  ];
  const stops = {
    fuel: pois(record.ancillary?.fuel),
    camping: pois(record.ancillary?.camping),
    lodging: pois(record.ancillary?.lodging),
    pois: pois(record.ancillary?.pois),
  };
  const availability: RideDetail["track"]["availability"] =
    served !== null ? "hosted" : record.gpx.availability === "none" ? "none" : "link";
  const gpxAllowed = served !== null;
  const measured = served === null ? null : round(served.miles, 2);
  const flags = trackFlags({
    miles: served === null ? null : served.miles,
    rawPoints: served?.rawPoints ?? null,
    longestJumpMiles: served?.longestJumpMiles ?? null,
    bundle,
    year,
    statedMiles: bundle ? null : stated,
  });

  const pin = pinFor(record, served, bundle);
  const bounds: LibraryBounds | null = served?.bounds ?? (record.gpx.availability === "none" ? null : record.gpx.bounds ?? null);

  const detail: RideDetail = {
    id: record.id,
    name: record.name,
    kind,
    type: typeFor(record, kind),
    score: record.value_score,
    scoreReason: record.value_reason === undefined ? null : milesInText(record.value_reason),
    states: record.states.filter((state) => state !== "NATIONAL").length > 0 ? record.states.filter((state) => state !== "NATIONAL") : record.states,
    summary: milesInText(record.summary ?? ""),
    miles: kind === "area" || measured === null ? null : measured,
    trailMiles: kind === "area" && measured !== null ? measured : null,
    loop: served?.loop === true,
    start: served === null || bundle ? null : { lat: round(served.start.lat, 5), lon: round(served.start.lon, 5) },
    bounds,
    points: served?.points ?? 0,
    segmentCount: served?.segmentCount ?? 0,
    track: {
      availability,
      year,
      vintage: record.gpx.track_vintage ?? null,
      old: flags.old,
      rough: flags.rough,
      mismatch: flags.mismatch,
      gpxAllowed,
      sourceDownloadUrl: record.gpx.download_url ?? null,
    },
    facts: factsFor(record),
    credit: creditFor(record),
    alsoOn: [],
    partOf: [],
    includes: [],
    sourceRating: parseSourceRating(record),
    notes,
    stops,
    alternates: (record.alternates ?? []).map((alternate) => ({
      label: alternate.label,
      difficulty: alternate.difficulty,
      notes: alternate.notes ?? null,
      gpxUrl: alternate.gpx_url ?? null,
    })),
    sections: kind === "trip" && (record.gpx.track_names?.length ?? 0) > 0 ? [...record.gpx.track_names!] : null,
    provenance: {
      basis: policy.basis,
      scrapedAt: record.scraped_at,
      lastVerified: record.last_verified,
    },
  };
  return {
    detail,
    line: served?.line ?? "",
    pin,
    bounds,
    mapLine: served?.mapLine ?? null,
    cardLine: served?.cardLine ?? null,
  };
}
