/**
 * What a road-authority record does to a route (§5 effect classes, §9
 * precedence). This is OpenGravel policy: a provider never declares itself a
 * hard gate.
 *
 * The exact hard gate (RI-1): only an authoritative source, only a record in
 * force now, and only when the route really rides that road (`traverses`):
 *
 * - an active closure (or a work zone / incident with every lane closed);
 * - a legal motor-vehicle designation that shuts the road to motorcycles on
 *   the ride's date.
 *
 * Everything else that applies is a warning. Community, modeled and contextual
 * sources can never reject a route on their own.
 */

import type { RouteMatch } from "./match";
import type { AuthorityClass, RoadAuthorityRecord, SeasonWindow } from "./types";

export type RoadAuthorityEffect =
  | { readonly effect: "reject"; readonly code: "road-closed" | "access-prohibited"; readonly message: string }
  | {
      readonly effect: "warn";
      readonly code:
        | "road-work-on-route"
        | "road-restriction-on-route"
        | "road-closure-reported"
        | "seasonal-access-unverified";
      readonly message: string;
    }
  | { readonly effect: "none" };

const HARD_GATE_AUTHORITY: ReadonlySet<AuthorityClass> = new Set([
  "authoritative-regulatory",
  "authoritative-operational",
]);

/** In force at `at`: started (or no start given) and not yet ended. */
export function isActive(record: RoadAuthorityRecord, at: string): boolean {
  const now = Date.parse(at);
  if (!Number.isFinite(now)) return false;
  if (record.validFrom !== null && Date.parse(record.validFrom) > now) return false;
  if (record.validUntil !== null && Date.parse(record.validUntil) <= now) return false;
  return true;
}

function dayOfYear(month: number, day: number): number {
  return month * 32 + day;
}

/** Whether `at` (the rider's local calendar date, taken from the instant) falls in a window. */
export function inSeason(windows: readonly SeasonWindow[], at: string): boolean {
  const date = new Date(at);
  const today = dayOfYear(date.getUTCMonth() + 1, date.getUTCDate());
  return windows.some((window) => {
    const start = dayOfYear(window.startMonth, window.startDay);
    const end = dayOfYear(window.endMonth, window.endDay);
    return start <= end ? today >= start && today <= end : today >= start || today <= end;
  });
}

function name(record: RoadAuthorityRecord): string {
  return record.roadName ?? "A road on this route";
}

export function roadAuthorityEffect(
  record: RoadAuthorityRecord,
  authority: AuthorityClass,
  match: RouteMatch,
  at: string,
): RoadAuthorityEffect {
  if (match.strength === "none") return { effect: "none" };
  const gate = HARD_GATE_AUTHORITY.has(authority) && match.strength === "traverses";

  if (record.kind === "motor-vehicle-designation") {
    const access = record.motorcycleAccess;
    if (access === undefined || access.status === "unknown" || match.strength !== "traverses") return { effect: "none" };
    if (access.status === "closed") {
      return gate
        ? { effect: "reject", code: "access-prohibited", message: `${name(record)} is not open to motorcycles.` }
        : { effect: "none" };
    }
    if (access.seasons === null) return { effect: "none" };
    if (access.seasons.length === 0) {
      return {
        effect: "warn",
        code: "seasonal-access-unverified",
        message: `${name(record)} is open only part of the year, and its dates aren't published.`,
      };
    }
    if (inSeason(access.seasons, at)) return { effect: "none" };
    return gate
      ? { effect: "reject", code: "access-prohibited", message: `${name(record)} is closed to motor vehicles this time of year.` }
      : { effect: "none" };
  }

  if (!isActive(record, at)) return { effect: "none" };
  const fullClosure = record.kind === "closure" || record.allLanesClosed === true;
  if (fullClosure && gate) {
    return { effect: "reject", code: "road-closed", message: `${name(record)} is closed: ${record.description}` };
  }
  if (fullClosure) {
    // Reported closed, but the match is too weak to be sure this route rides
    // that road (a point report, or a crossing): warn loudly, never reject.
    return { effect: "warn", code: "road-closure-reported", message: `${name(record)} reported closed: ${record.description}` };
  }
  if (record.kind === "restriction") {
    return { effect: "warn", code: "road-restriction-on-route", message: `${name(record)}: ${record.description}` };
  }
  return { effect: "warn", code: "road-work-on-route", message: `${name(record)}: ${record.description}` };
}
