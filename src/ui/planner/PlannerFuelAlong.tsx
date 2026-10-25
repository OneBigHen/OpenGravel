"use client";

/**
 * Fuel on the way (UX rework phase 8): the longest stretch of the chosen route
 * with no gas against the bike's usable range. In range that is one line — the
 * stations themselves belong to "Along this ride", not here. Out of range it
 * says so and lists only the stations at either end of the dry stretch, so the
 * rider can fill up before it.
 */

import { useEffect, useMemo, useState } from "react";

import {
  METERS_PER_MILE,
  gapBoundingStops,
  gapSummary,
  lineLengthMeters,
  type AlongStop,
  type LngLat,
  type MapLayersSource,
} from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";

export interface PlannerFuelAlongProps {
  readonly route: { readonly routeId: string; readonly geometry: readonly Coordinate[] } | null;
  readonly source?: MapLayersSource | undefined;
  /** The bike's range minus its reserve, in miles; `null` when unknown. */
  readonly usableRangeMiles: number | null;
  readonly onAddStop?: ((coordinate: Coordinate, name: string) => void) | undefined;
}

type FuelState =
  | { readonly routeId: string; readonly status: "loading" }
  | { readonly routeId: string; readonly status: "unavailable" }
  | { readonly routeId: string; readonly status: "ready"; readonly stops: readonly AlongStop[] };

/** Rider miles: whole miles, and never a dry stretch that reads as zero. */
function riderMiles(meters: number): number {
  return Math.max(1, Math.round(meters / METERS_PER_MILE));
}

/** How far off the route a stop is, in miles, when it is not on it. */
function offRouteLabel(offMeters: number): string {
  if (offMeters < 160) return "On your route";
  const miles = offMeters / METERS_PER_MILE;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi off`;
}

export function PlannerFuelAlong({ route, source, usableRangeMiles, onAddStop }: PlannerFuelAlongProps) {
  const routeId = route?.routeId ?? null;
  const line = useMemo<readonly LngLat[]>(
    () => (route === null ? [] : route.geometry.map((point) => [point.lon, point.lat] as const)),
    [route],
  );
  const [state, setState] = useState<FuelState | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (routeId === null || source?.along === undefined || line.length < 2) return;
    const controller = new AbortController();
    void source.along(line, "fuel", controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState(result.available ? { routeId, status: "ready", stops: result.stops } : { routeId, status: "unavailable" });
      },
      () => {
        if (!controller.signal.aborted) setState({ routeId, status: "unavailable" });
      },
    );
    return () => controller.abort();
    // The geometry is fixed for one route id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, source]);

  // Unknown stays off the screen: no stations found or no answer yet says
  // nothing a rider can act on, and never reads as "you are fine".
  if (route === null || source?.along === undefined) return null;
  const current = state?.routeId === routeId ? state : null;
  if (current === null || current.status !== "ready") return null;

  const totalMeters = lineLengthMeters(line);
  // A bike with no usable range left is a garage problem, not a fuel verdict.
  const usableMiles =
    usableRangeMiles === null || !Number.isFinite(usableRangeMiles) ? 0 : Math.round(usableRangeMiles);
  const rangeMiles = usableMiles > 0 ? usableMiles : null;
  const summary = gapSummary(current.stops, totalMeters, rangeMiles === null ? null : rangeMiles * METERS_PER_MILE);
  const overRange = rangeMiles !== null && summary.gapsOverRange > 0;

  if (current.stops.length === 0) {
    return (
      <p className="og-fuel__line" data-testid="fuel-line">
        No gas within a mile of this {riderMiles(totalMeters)} mi ride
      </p>
    );
  }

  if (!overRange || rangeMiles === null) {
    return (
      <p className="og-fuel__line" data-testid="fuel-line">
        Gas every ~{riderMiles(summary.longestGapMeters)} mi{rangeMiles === null ? "" : " — you're fine"}
      </p>
    );
  }

  const dryMiles = riderMiles(summary.longestGapMeters);
  return (
    <section className="og-fuel" data-testid="fuel-along" aria-label="Fuel on the way">
      <p className="og-fuel__line og-fuel__line--warn" data-testid="fuel-line">
        No gas for {dryMiles} mi — your range is {rangeMiles} mi
      </p>
      {/* Only the stations that bound the dry stretch: the rest live in
          "Along this ride". */}
      <ul className="og-fuel__list" aria-label="Gas around the dry stretch">
        {gapBoundingStops(current.stops, summary.longestGapStartMeters, summary.longestGapMeters).map((stop) => {
          const point = stop.feature.geometry.type === "Point" ? stop.feature.geometry.coordinates : null;
          const isAdded = added.has(stop.feature.id);
          return (
            <li key={stop.feature.id} className="og-fuel__row">
              <span className="og-fuel__mile">Mile {Math.round(stop.alongMeters / METERS_PER_MILE)}</span>
              <span className="og-fuel__name">
                {stop.feature.name}
                <small>{offRouteLabel(stop.offMeters)}</small>
              </span>
              {onAddStop === undefined || point === null ? null : (
                <button
                  type="button"
                  className="og-fuel__add"
                  disabled={isAdded}
                  aria-label={isAdded ? `Added ${stop.feature.name} as a stop` : `Add ${stop.feature.name} as a stop`}
                  onClick={() => {
                    onAddStop({ lon: point[0], lat: point[1] }, stop.feature.name);
                    setAdded((previous) => new Set(previous).add(stop.feature.id));
                  }}
                >
                  {isAdded ? "Added" : "Add"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
