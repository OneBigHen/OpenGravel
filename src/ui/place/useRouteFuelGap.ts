"use client";

/**
 * How far the open route runs without gas, as a chip-row fact: the along-route
 * fuel search measured into gaps, so the fuel suggestion can be offered before
 * the rider is already in one.
 *
 * Unknown stays `null` — no answer yet, a provider that failed, a route with no
 * line — and offers nothing. A provider fact is read here once and projected
 * into the row; the chip itself never guesses.
 */

import { useEffect, useMemo, useState } from "react";

import { lineLengthMeters, type LngLat, type MapLayersSource } from "@/application/map-layers";
import { fuelGapMiles } from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";

/** The part of the route the fuel search needs: its identity and its line. */
export interface FuelGapRoute {
  readonly routeId: string;
  readonly geometry: readonly Coordinate[];
}

export function useRouteFuelGap(
  route: FuelGapRoute | null,
  source: MapLayersSource | undefined,
): number | null {
  const routeId = route?.routeId ?? null;
  const line = useMemo<readonly LngLat[]>(
    () => (route === null ? [] : route.geometry.map((point) => [point.lon, point.lat] as const)),
    [route],
  );
  const [answer, setAnswer] = useState<{
    readonly routeId: string;
    readonly miles: number | null;
  } | null>(null);

  useEffect(() => {
    if (routeId === null || source?.along === undefined || line.length < 2) return;
    const controller = new AbortController();
    void source.along(line, "fuel", controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setAnswer({
          routeId,
          miles: result.available ? fuelGapMiles(result.stops, lineLengthMeters(line)) : null,
        });
      },
      () => {
        if (!controller.signal.aborted) setAnswer({ routeId, miles: null });
      },
    );
    return () => controller.abort();
  }, [routeId, source, line]);

  return routeId !== null && answer?.routeId === routeId ? answer.miles : null;
}
