import type { LibraryRecord, RideKind, RideType } from "./types";

/** The track sanity thresholds live in `track-flags.ts`; these stay the names the rest of the code used. */
export { isLengthMismatch as lengthMismatch, isOldTrack, OLD_TRACK_YEAR } from "./track-flags";

/** Lane to the rider's five words (plan section 3). Trail bundles and riding areas become Trails in `kindFor` users. */
export function typeForLane(lane: string): RideType {
  switch (lane) {
    case "paved-twisty":
      return "twisty";
    case "scenic":
      return "scenic";
    case "single-track":
      return "trail";
    case "dual-sport":
    case "adv":
    case "gravel":
    case "mixed":
    case "bdr":
    case "bdr-x":
      return "dirt";
    default:
      return "scenic";
  }
}

/** Named big trips that are not always 250 miles in one file. */
const TRIP_NAME = /\b(?:tat|trans[- ]?america(?:n)?(?: trail)?|continental divide|great divide|bdr-?x|backcountry discovery)\b/i;
export const TRIP_MILES = 250;

export function isTripName(name: string): boolean {
  return TRIP_NAME.test(name);
}

/**
 * Stage 5. `area`: a bundle of trail segments, or an OHV riding area with no
 * track. `trip`: BDR lanes, 250 miles or more, or a named big trip. Else `road`.
 */
export function kindFor(record: LibraryRecord, miles: number | null): RideKind {
  const bundle = record.gpx.is_bundle === true;
  const noTrack = record.gpx.availability !== "hosted";
  if (bundle || (noTrack && record.surface?.legal_status === "designated-ohv")) return "area";
  if (record.lane === "bdr" || record.lane === "bdr-x") return "trip";
  if (miles !== null && miles >= TRIP_MILES) return "trip";
  if (isTripName(record.name)) return "trip";
  return "road";
}

/** Areas are places to ride, so they live under Trails whatever lane the source gave. */
export function typeFor(record: LibraryRecord, kind: RideKind): RideType {
  return kind === "area" ? "trail" : typeForLane(record.lane);
}

/** The newest year named in a track's vintage or, failing that, in its credit line. */
export function trackYear(record: LibraryRecord): number | null {
  const years = (text: string | undefined): number[] =>
    [...(text ?? "").matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((match) => Number(match[1]));
  const fromVintage = years(record.gpx.track_vintage);
  if (fromVintage.length > 0) return Math.max(...fromVintage);
  const fromCredit = years(record.author_credit.credit_line);
  return fromCredit.length > 0 ? Math.max(...fromCredit) : null;
}

const MILES_PER_KM = 0.621371;

/** The source's own length figure, in miles, when the record carries one. */
export function statedMiles(record: LibraryRecord): number | null {
  if (typeof record.claimed_distance_km === "number" && record.claimed_distance_km > 0) return record.claimed_distance_km * MILES_PER_KM;
  const run = /^\s*(\d+(?:\.\d+)?)\s*km run\b/i.exec(record.summary ?? "");
  return run === null ? null : Number(run[1]) * MILES_PER_KM;
}
