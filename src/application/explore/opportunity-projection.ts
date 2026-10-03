import { distanceToLineMeters } from "@/application/discover/search-area";
import {
  RIDER_OPPORTUNITY_EVENT_LIMIT,
  type RiderOpportunity,
} from "@/application/discover/rider-opportunities";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";
import type { Coordinate } from "@/domain/ride/types";
import {
  rideTimeWindow,
  type RideTimeLens,
} from "@/application/explore/time-lens";

export type AlongRideSuggestion =
  | {
      readonly kind: "road";
      readonly road: RoadOpeningSummary;
      readonly score: number;
      readonly detour: number;
    }
  | {
      readonly kind: "stop";
      readonly item: RiderOpportunity;
      readonly score: number;
    };
export type ThingsTimeLens = "today" | "weekend" | "next-weekend";

/** The server owns rider ranking; projections preserve that order and its event cap. */
export function thingsForTime(
  items: readonly RiderOpportunity[],
  lens: ThingsTimeLens,
  now: Date,
): readonly RiderOpportunity[] {
  const window =
    lens === "today"
      ? rideTimeWindow(
          "date",
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
          now,
        )
      : rideTimeWindow(lens, "", now);
  let events = 0;
  return items
    .filter((item) => {
      if (item.timingFit === "misses") return false;
      if (item.startsAt !== null && item.startsAt !== undefined) {
        const start = Date.parse(item.startsAt);
        const end =
          item.endsAt === null || item.endsAt === undefined
            ? start + 1
            : Date.parse(item.endsAt);
        if (start >= window.end.getTime() || end <= window.start.getTime())
          return false;
      }
      return item.kind !== "event" || ++events <= RIDER_OPPORTUNITY_EVENT_LIMIT;
    })
    .slice(0, 8);
}

export function roadWindowsForTime(
  events: readonly RoadOpeningSummary[],
  lens: RideTimeLens,
  date: string,
  now: Date,
): {
  readonly open: readonly RoadOpeningSummary[];
  readonly closing: readonly RoadOpeningSummary[];
} {
  const window = rideTimeWindow(lens, date, now);
  const matching = events.filter(
    (event) =>
      Date.parse(event.startsAt) < window.end.getTime() &&
      Date.parse(event.endsAt) > window.start.getTime(),
  );
  const closing = matching.filter(
    (event) =>
      Date.parse(event.endsAt) <= window.start.getTime() + 7 * 86_400_000,
  );
  const ids = new Set(closing.map((event) => event.id));
  return { open: matching.filter((event) => !ids.has(event.id)), closing };
}

/** Mixed route-context policy lives here, independent of presentation and fetch state. */
export function alongRideSuggestions(input: {
  readonly roads: readonly RoadOpeningSummary[];
  readonly stops: readonly RiderOpportunity[];
  readonly line: readonly Coordinate[];
  readonly durationSeconds: number;
  readonly departAt: string;
}): readonly AlongRideSuggestion[] {
  const suggestions: AlongRideSuggestion[] = input.stops
    .filter(
      (item) =>
        item.timingFit !== "misses" &&
        (item.detourMinutes === null || item.detourMinutes <= 25),
    )
    .map((item) => ({ kind: "stop", item, score: item.score }));
  // Conservative round-trip estimate at 30 mph; never an engine ETA/access proof.
  for (const road of input.roads) {
    if (road.anchor === null || (road.line?.length ?? 0) < 2) continue;
    const distance = distanceToLineMeters(
      { lon: road.anchor[0], lat: road.anchor[1] },
      input.line,
    );
    const detour = Math.ceil((2 * distance) / ((30 * 1609.344) / 60));
    const time = Date.parse(input.departAt);
    const starts = Date.parse(road.startsAt);
    const ends = Date.parse(road.endsAt);
    const arrival = time + (input.durationSeconds + detour * 60) * 1000;
    if (
      ![time, starts, ends, detour].every(Number.isFinite) ||
      detour > 25 ||
      starts > time ||
      ends <= arrival
    )
      continue;
    const closingSoon = Date.parse(road.endsAt) - time <= 7 * 86_400_000;
    suggestions.push({
      kind: "road",
      road,
      detour,
      score: 1.5 + (closingSoon ? 0.4 : 0) - detour / 10,
    });
  }
  let events = 0;
  return suggestions
    .sort((a, b) => b.score - a.score)
    .filter(
      (item) =>
        item.kind !== "stop" ||
        item.item.kind !== "event" ||
        ++events <= RIDER_OPPORTUNITY_EVENT_LIMIT,
    )
    .slice(0, 5);
}
