"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildElevationProfile,
  sampleLine,
  type ElevationProfile,
  type ElevationSource,
} from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";

export type ElevationProfileState =
  | { readonly status: "loading" }
  /**
   * Ready carries everything the chart reads: each sample's own distance along
   * the ride, the surface-friendly coordinate, and `steepestGradeShare` — where
   * the steepest sustained grade sits — so a surface never re-derives them.
   */
  | { readonly status: "ready"; readonly profile: ElevationProfile }
  | { readonly status: "unavailable"; readonly reason: string };

const LOADING: ElevationProfileState = { status: "loading" };
const CACHE_MAX = 24;
/** Profiles by route id: switching between alternates never refetches. */
const cache = new Map<string, ElevationProfileState>();
/**
 * Requests in flight by key. More than one surface shows the same route's
 * profile — the elevation chart and the map's glance strip mount together — and
 * one request answers both. A profile that lands is cached, so a surface that
 * arrives after the answer reads it from there.
 */
const requests = new Map<string, Promise<ElevationProfileState>>();

function remember(key: string, state: ElevationProfileState): void {
  cache.set(key, state);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** The shared request for one route's profile, or `null` when the line has no samples. */
function requestProfile(
  source: ElevationSource,
  key: string,
  line: readonly Coordinate[],
): Promise<ElevationProfileState> | null {
  const inFlight = requests.get(key);
  if (inFlight !== undefined) return inFlight;
  const samples = sampleLine(line);
  if (samples.length === 0) return null;
  const request = source
    .elevations(samples.map((sample) => sample.coordinate))
    .then((result) => {
      const profile = result.availability === "available" ? buildElevationProfile(samples, result.elevationsMeters) : null;
      const state: ElevationProfileState =
        profile !== null
          ? { status: "ready", profile }
          : {
              status: "unavailable",
              reason: result.availability === "unavailable" ? result.reason : "Elevation data is not available right now.",
            };
      // Only a real answer is cached; an outage is retried on the next plan.
      if (state.status === "ready") remember(key, state);
      return state;
    })
    .catch(
      (): ElevationProfileState => ({
        status: "unavailable",
        reason: "Elevation data is not available right now.",
      }),
    )
    .finally(() => {
      requests.delete(key);
    });
  requests.set(key, request);
  return request;
}

/** The elevation profile of one route line, fetched once per route id. */
export function useElevationProfile(
  source: ElevationSource | undefined,
  routeId: string | null,
  line: readonly Coordinate[],
): ElevationProfileState | null {
  const key = routeId === null ? null : `${routeId}:${line.length}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly state: ElevationProfileState } | null>(null);
  // The line is read through a ref: a re-render that rebuilds the same route's
  // array must not cancel the request in flight (it left the chart on its
  // loading skeleton for good while a drawing or an edit kept re-rendering).
  const lineRef = useRef(line);
  useEffect(() => {
    lineRef.current = line;
  });

  useEffect(() => {
    if (source === undefined || key === null || cache.has(key)) return;
    const request = requestProfile(source, key, lineRef.current);
    if (request === null) return;
    // Leaving does not cancel the shared request: another surface may be reading
    // it, and its answer is worth keeping. It only stops this subscriber from
    // setting state after it is gone.
    let cancelled = false;
    void request.then((state) => {
      if (!cancelled) setAnswer({ key, state });
    });
    return () => {
      cancelled = true;
    };
  }, [source, key]);

  if (source === undefined || key === null || line.length < 2) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  return answer?.key === key ? answer.state : LOADING;
}
