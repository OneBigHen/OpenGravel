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
import type { AlongRideStopRow } from "@/application/explore/along-ride-stops";

export type AlongRideSuggestion =
  | {
      readonly kind: "road";
      readonly road: RoadOpeningSummary;
      readonly score: number;
      readonly detour: number;
    }
  | {
      readonly kind: "along-stop";
      readonly stop: AlongRideStopRow;
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

type AlongStopSuggestion = Extract<AlongRideSuggestion, { kind: "along-stop" }>;
type StopSuggestion = Extract<AlongRideSuggestion, { kind: "stop" }>;
type RoadSuggestion = Extract<AlongRideSuggestion, { kind: "road" }>;

/** Mixed route-context policy lives here, independent of presentation and fetch state. */
const SUGGESTION_LIMIT = 6;
const ROAD_LIMIT = 2;
const EVENT_LIMIT = RIDER_OPPORTUNITY_EVENT_LIMIT;

function mileOf(suggestion: AlongRideSuggestion): number | null {
  if (suggestion.kind === "along-stop") return suggestion.stop.mile;
  if (suggestion.kind === "stop") return suggestion.item.routeMile;
  return null;
}

function scoreOf(suggestion: AlongRideSuggestion): number {
  return suggestion.kind === "road" || suggestion.kind === "stop" ? suggestion.score : 0;
}

function idOf(suggestion: AlongRideSuggestion): string {
  if (suggestion.kind === "along-stop") return suggestion.stop.id;
  if (suggestion.kind === "stop") return suggestion.item.id;
  return suggestion.road.id;
}

/**
 * Stops are read the way the ride is ridden: by route mile, with places whose
 * position is unknown after the ones that have one. Road windows close the
 * list because widening the ride is a different decision from stopping on it.
 */
function byRoutePosition(left: AlongRideSuggestion, right: AlongRideSuggestion): number {
  const leftMile = mileOf(left);
  const rightMile = mileOf(right);
  if (leftMile !== null && !Number.isFinite(leftMile)) return 1;
  if (rightMile !== null && !Number.isFinite(rightMile)) return -1;
  if (leftMile === null && rightMile === null) {
    return scoreOf(right) - scoreOf(left) || idOf(left).localeCompare(idOf(right));
  }
  if (leftMile === null) return 1;
  if (rightMile === null) return -1;
  return leftMile - rightMile || scoreOf(right) - scoreOf(left) || idOf(left).localeCompare(idOf(right));
}

export function alongRideSuggestions(input: {
  readonly roads: readonly RoadOpeningSummary[];
  readonly stops: readonly RiderOpportunity[];
  /** Gas, food, coffee and overlooks already placed on the line. */
  readonly alongStops?: readonly AlongRideStopRow[];
  readonly line: readonly Coordinate[];
  readonly durationSeconds: number;
  readonly departAt: string;
}): readonly AlongRideSuggestion[] {
  const alongStops: AlongStopSuggestion[] = (input.alongStops ?? []).map(
    (stop) => ({ kind: "along-stop" as const, stop }),
  );
  let events = 0;
  const stopSuggestions: StopSuggestion[] = input.stops
    .filter(
      (item) =>
        item.timingFit !== "misses" &&
        (item.detourMinutes === null || item.detourMinutes <= 25),
    )
    .map((item) => ({ kind: "stop" as const, item, score: item.score }))
    .sort((left, right) => right.score - left.score || idOf(left).localeCompare(idOf(right)))
    .filter(
      (item) =>
        item.kind !== "stop" ||
        item.item.kind !== "event" ||
        ++events <= EVENT_LIMIT,
    );

  const roadSuggestions: RoadSuggestion[] = [];
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
    roadSuggestions.push({
      kind: "road",
      road,
      detour,
      score: 1.5 + (closingSoon ? 0.4 : 0) - detour / 10,
    });
  }
  roadSuggestions.sort((left, right) => right.score - left.score || idOf(left).localeCompare(idOf(right)));

  const room = Math.max(0, SUGGESTION_LIMIT - alongStops.length);
  const keptRoads = roadSuggestions.slice(0, Math.min(ROAD_LIMIT, room));
  const keptStops = stopSuggestions.slice(0, Math.max(0, room - keptRoads.length));
  const positioned: AlongRideSuggestion[] = [...alongStops, ...keptStops];
  return positioned.sort(byRoutePosition).concat(keptRoads);
}
