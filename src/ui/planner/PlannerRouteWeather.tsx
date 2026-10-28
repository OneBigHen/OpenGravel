"use client";

/**
 * The planned ride's weather, bound to the ride's own departure
 * (MAP-EXPERIENCE-NEXT Wave 2, item 7).
 *
 * The strip itself is a projection of `useRouteWeather`; what this wrapper owns
 * is the subject it is asked about. The departure is the same one the briefing
 * and the map's daylight split use — an arrive-by ride leaves when it must, a
 * future ride leaves at its authored instant, and a "now" ride leaves now — so
 * two surfaces cannot describe different hours of the same ride.
 *
 * A "now" departure is read from a one-minute clock, but the forecast is
 * hourly: asking the provider again every minute would be noise, so the instant
 * is rounded to the nearest quarter hour before it becomes part of the request.
 * The headline and every cell speak in whole hours ("around 3 PM"), so that
 * rounding cannot change what the rider reads.
 */

import type { PlannerPreparationRoute } from "@/application/preparation/planner-context";
import type { DepartureIntent, TimeIntent } from "@/domain/ride/types";
import { plannerDepartureOf, usePlannerDaylight } from "@/ui/planner/hooks/usePlannerDaylight";
import { RouteWeatherStrip } from "@/ui/weather/RouteWeatherStrip";
import { useRouteWeather, type RouteWeatherSubject } from "@/ui/weather/useRouteWeather";

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** The nearest quarter hour, so a "now" ride asks about the hour it is in. */
export function nearestQuarterHour(instant: string): string {
  const epoch = Date.parse(instant);
  if (!Number.isFinite(epoch)) return instant;
  return new Date(Math.round(epoch / QUARTER_HOUR_MS) * QUARTER_HOUR_MS).toISOString();
}

export interface PlannerRouteWeatherProps {
  /** The selected route, or `null` while there is nothing to preview. */
  readonly route: Pick<PlannerPreparationRoute, "geometry" | "durationSeconds"> | null;
  readonly departure: DepartureIntent;
  readonly time: TimeIntent;
}

export function PlannerRouteWeather({ route, departure, time }: PlannerRouteWeatherProps) {
  const durationSeconds =
    route === null || !Number.isFinite(route.durationSeconds) || route.durationSeconds <= 0
      ? null
      : route.durationSeconds;
  const { departureAt, riderTimeZone } = usePlannerDaylight({ departure, time, durationSeconds });
  const leavesNow = plannerDepartureOf({ departure, time, durationSeconds }).kind === "now";
  const departureTime =
    departureAt === null ? null : leavesNow ? nearestQuarterHour(departureAt) : departureAt;
  const subject: RouteWeatherSubject | null =
    route === null || departureTime === null || durationSeconds === null
      ? null
      : { line: route.geometry, departureTime, durationSeconds };
  const state = useRouteWeather(subject);
  if (subject === null) return null;
  return (
    <div className="og-route-weather-well" data-testid="planner-route-weather">
      <RouteWeatherStrip state={state} timeZone={riderTimeZone ?? null} />
    </div>
  );
}
