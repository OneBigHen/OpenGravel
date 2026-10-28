"use client";

/**
 * Weather along the route, for the ride-conditions sheet
 * (MAP-EXPERIENCE-NEXT Wave 2, item 7).
 *
 * The hook sends the route's own line, the rider's departure and the route's
 * measured duration to `/api/weather/route` and returns the sampled forecast.
 * It never derives weather itself: a failed or malformed answer is
 * `unavailable`, never an invented sky, and an unknown reading inside a report
 * stays `null` for the surface to show as unknown.
 */

import { useEffect, useRef, useState } from "react";

import {
  isRouteWeatherReport,
  type RouteWeatherReport,
} from "@/application/weather/route-weather";
import type { Coordinate } from "@/domain/ride/types";

const ROUTE_WEATHER_PATH = "/api/weather/route";
/** Recently read routes: switching between alternates never refetches. */
const CACHE_MAX = 16;

export interface RouteWeatherSubject {
  /** The route line in travel order, as the planner holds it. */
  readonly line: readonly Coordinate[];
  /** The rider's departure as an ISO instant; `null` until they choose one. */
  readonly departureTime: string | null;
  /** The route's measured total duration; `null` when it is unknown. */
  readonly durationSeconds: number | null;
}

export type RouteWeatherState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly report: RouteWeatherReport }
  | { readonly status: "unavailable"; readonly reason: string };

const IDLE: RouteWeatherState = { status: "idle" };
const LOADING: RouteWeatherState = { status: "loading" };
const UNAVAILABLE: RouteWeatherState = {
  status: "unavailable",
  reason: "Weather along the route is unavailable right now.",
};

/** Reports by route + departure; an outage is never cached. */
const cache = new Map<string, RouteWeatherReport>();
/** Requests in flight by key, so the sheet and a map strip share one call. */
const requests = new Map<string, Promise<RouteWeatherState>>();

function remember(key: string, report: RouteWeatherReport): void {
  cache.set(key, report);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cell(value: number): string {
  return value.toFixed(3);
}

/** The request identity: one answer serves one line, departure, duration and zone. */
function subjectKey(subject: RouteWeatherSubject): string | null {
  if (subject.departureTime === null || subject.durationSeconds === null) return null;
  if (subject.line.length < 2) return null;
  const first = subject.line[0];
  const last = subject.line[subject.line.length - 1];
  if (first === undefined || last === undefined) return null;
  return [
    subject.departureTime,
    subject.durationSeconds,
    subject.line.length,
    `${cell(first.lon)},${cell(first.lat)}`,
    `${cell(last.lon)},${cell(last.lat)}`,
    // A headline names the rider's local hour, so a different zone is a
    // different answer.
    riderTimeZone() ?? "",
  ].join("|");
}

function riderTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

async function load(key: string, subject: RouteWeatherSubject): Promise<RouteWeatherState> {
  const timeZone = riderTimeZone();
  try {
    const response = await fetch(ROUTE_WEATHER_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        line: subject.line.map((point) => ({ lon: point.lon, lat: point.lat })),
        departureTime: subject.departureTime,
        durationSeconds: subject.durationSeconds,
        ...(timeZone === undefined ? {} : { timeZone }),
      }),
    });
    if (!response.ok) return UNAVAILABLE;
    const body = (await response.json()) as { report?: unknown };
    if (!isRouteWeatherReport(body.report)) return UNAVAILABLE;
    remember(key, body.report);
    return { status: "ready", report: body.report };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * The sampled weather along one route. `idle` while there is no route or no
 * departure to place it against; the request is shared by every surface
 * showing the same route.
 */
export function useRouteWeather(route: RouteWeatherSubject | null): RouteWeatherState {
  const key = route === null ? null : subjectKey(route);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly state: RouteWeatherState } | null>(null);
  // Read through a ref: a re-render that rebuilds the same route's line must
  // not cancel the request in flight, which would leave the sheet loading.
  const subjectRef = useRef(route);
  useEffect(() => {
    subjectRef.current = route;
  });

  useEffect(() => {
    if (key === null || cache.has(key)) return;
    const subject = subjectRef.current;
    if (subject === null || subjectKey(subject) !== key) return;
    let request = requests.get(key);
    if (request === undefined) {
      request = load(key, subject);
      requests.set(key, request);
      void request.finally(() => {
        requests.delete(key);
      });
    }
    // Leaving only stops this subscriber setting state; the shared request and
    // its answer are useful to the next surface, so neither is discarded.
    let cancelled = false;
    void request.then((state) => {
      if (!cancelled) setAnswer({ key, state });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (route === null || key === null) return IDLE;
  const cached = cache.get(key);
  if (cached !== undefined) return { status: "ready", report: cached };
  return answer?.key === key ? answer.state : LOADING;
}
