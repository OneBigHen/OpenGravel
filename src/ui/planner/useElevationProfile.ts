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
  | { readonly status: "ready"; readonly profile: ElevationProfile }
  | { readonly status: "unavailable"; readonly reason: string };

const LOADING: ElevationProfileState = { status: "loading" };
const CACHE_MAX = 24;
/** Profiles by route id: switching between alternates never refetches. */
const cache = new Map<string, ElevationProfileState>();

function remember(key: string, state: ElevationProfileState): void {
  cache.set(key, state);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
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
    const samples = sampleLine(lineRef.current);
    if (samples.length === 0) return;
    const controller = new AbortController();
    void source
      .elevations(samples.map((sample) => sample.coordinate), controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
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
        setAnswer({ key, state });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAnswer({ key, state: { status: "unavailable", reason: "Elevation data is not available right now." } });
      });
    return () => controller.abort();
  }, [source, key]);

  if (source === undefined || key === null || line.length < 2) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  return answer?.key === key ? answer.state : LOADING;
}
