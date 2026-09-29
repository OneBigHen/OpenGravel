"use client";

/**
 * Fuel on the way (UX rework phase 8): the gas stations within about a mile of
 * the chosen route, drawn as ticks on a strip the length of the ride, with the
 * longest stretch without fuel measured against the bike's usable range. The
 * answer to "can I make it?" in one glance, and a stop one tap away.
 */

import { useEffect, useMemo, useState } from "react";

import {
  METERS_PER_MILE,
  gapSummary,
  lineLengthMeters,
  spreadStops,
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

function miles(meters: number): string {
  const value = meters / METERS_PER_MILE;
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
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

  if (route === null || source?.along === undefined) return null;
  const current = state?.routeId === routeId ? state : null;
  const total = lineLengthMeters(line);
  const rangeMeters = usableRangeMiles === null ? null : usableRangeMiles * METERS_PER_MILE;
  const summary = current?.status === "ready" ? gapSummary(current.stops, total, rangeMeters) : null;
  const tight = summary !== null && rangeMeters !== null && summary.longestGapMeters > rangeMeters * 0.8;
  const over = summary !== null && summary.gapsOverRange > 0;

  return (
    <section className="og-fuel" data-testid="fuel-along" aria-label="Fuel on the way">
      <header className="og-fuel__head">
        <span className="og-fuel__icon" aria-hidden="true">⛽</span>
        <h3>Fuel on the way</h3>
        {summary === null ? null : (
          <span className="og-fuel__verdict" data-tone={over ? "bad" : tight ? "tight" : "good"} data-testid="fuel-verdict">
            {over ? "Plan a fuel stop" : tight ? "Tight on range" : usableRangeMiles === null ? "Stations en route" : "In range"}
          </span>
        )}
      </header>
      {current === null || current.status === "loading" ? (
        <p className="og-fuel__status" role="status">Finding gas stations along your route…</p>
      ) : current.status === "unavailable" ? (
        <p className="og-fuel__status" role="status">Fuel stops are unavailable right now.</p>
      ) : (
        <>
          <div className="og-fuel__strip" aria-hidden="true">
            {summary === null || total === 0 ? null : (
              <span
                className="og-fuel__gap"
                data-over={over ? "true" : "false"}
                style={{
                  left: `${(summary.longestGapStartMeters / total) * 100}%`,
                  width: `${(summary.longestGapMeters / total) * 100}%`,
                }}
              />
            )}
            {current.stops.map((stop) => (
              <span
                key={stop.feature.id}
                className="og-fuel__tick"
                style={{ left: `${(stop.alongMeters / Math.max(1, total)) * 100}%` }}
              />
            ))}
          </div>
          <div className="og-fuel__scale" aria-hidden="true">
            <span>Start</span>
            <span>{miles(total)} mi</span>
          </div>
          <p className="og-fuel__summary" data-testid="fuel-summary">
            {current.stops.length === 0
              ? `No gas stations within a mile of this ${miles(total)} mi route.`
              : `${current.stops.length} ${current.stops.length === 1 ? "station" : "stations"} within a mile · longest stretch without gas ${miles(summary?.longestGapMeters ?? 0)} mi`}
            {usableRangeMiles === null ? "" : ` · your usable range ${Math.round(usableRangeMiles)} mi (range minus reserve)`}
          </p>
          {current.stops.length === 0 ? null : (
            <ul className="og-fuel__list" aria-label="Gas stations along your ride">
              {spreadStops(current.stops, 10 * METERS_PER_MILE, 8).map((stop) => {
                const point = stop.feature.geometry.type === "Point" ? stop.feature.geometry.coordinates : null;
                const isAdded = added.has(stop.feature.id);
                return (
                  <li key={stop.feature.id} className="og-fuel__row">
                    <span className="og-fuel__mile">Mile {Math.round(stop.alongMeters / METERS_PER_MILE)}</span>
                    <span className="og-fuel__name">
                      {stop.feature.name}
                      <small>{stop.offMeters < 160 ? "On your route" : `${miles(stop.offMeters)} mi off`}</small>
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
          )}
          <p className="og-fuel__source">TomTom points of interest. Hours and ethanol-free pumps are not checked.</p>
        </>
      )}
    </section>
  );
}
