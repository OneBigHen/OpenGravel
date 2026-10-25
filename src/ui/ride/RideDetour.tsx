"use client";

/**
 * Back on track and gas or food ahead (UX rework phase 9; SwitchBack parity for
 * off-route recovery and "detour to fuel").
 *
 * Off the line, the ride replans by itself; this block says so, and offers the
 * same thing as a button for a rider who wants it now. "Fuel ahead" finds the
 * gas stations along the rest of the route, nearest first, and one tap routes
 * through the chosen one and on to the stops still ahead.
 */

import { useState } from "react";

import {
  METERS_PER_MILE,
  projectAlong,
  type AlongStop,
  type LngLat,
  type MapLayersSource,
} from "@/application/map-layers";
import type { RerouteDetour } from "@/application/ride-session/guided-reroute";
import type { Coordinate } from "@/domain/ride/types";

export interface RideDetourProps {
  readonly offRoute: boolean;
  readonly busy: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly routeLine: readonly Coordinate[];
  /** The last known position: enough to list what is ahead. */
  readonly position: Coordinate | null;
  /** Whether the fix is fresh and accurate enough to replan from. */
  readonly fixGood: boolean;
  readonly source?: MapLayersSource | undefined;
  readonly onReroute: (detour?: RerouteDetour) => void;
  readonly onEasierWayBack: () => void;
  readonly onTurnAround: () => void;
}

/** How far ahead "Add a stop" looks: a tank's worth for most bikes. */
const LOOK_AHEAD_METERS = 120 * METERS_PER_MILE;
const MAX_CHOICES = 4;

/** What "Add a stop" can look for along the rest of the route. */
type StopKind = "fuel" | "food";

const STOP_COPY: Readonly<Record<StopKind, { readonly plural: string; readonly noun: string }>> = {
  fuel: { plural: "gas stations", noun: "Gas" },
  food: { plural: "places to eat", noun: "Food" },
};

type FuelAhead =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly stops: readonly { readonly stop: AlongStop; readonly aheadMeters: number }[] };

function miles(meters: number): string {
  const value = meters / METERS_PER_MILE;
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

export function RideDetour({ offRoute, busy, message, error, routeLine, position, fixGood, source, onReroute, onEasierWayBack, onTurnAround }: RideDetourProps) {
  const [kind, setKind] = useState<StopKind | null>(null);
  const [fuel, setFuel] = useState<FuelAhead | null>(null);
  const [adding, setAdding] = useState(false);
  const canFindStops = source?.along !== undefined && routeLine.length >= 2 && position !== null;

  const findStops = (next: StopKind): void => {
    if (source?.along === undefined || position === null) return;
    const line: readonly LngLat[] = routeLine.map((point) => [point.lon, point.lat] as const);
    const here = projectAlong(line, [position.lon, position.lat]).alongMeters;
    setKind(next);
    setFuel({ status: "loading" });
    void source.along(line, next).then(
      (result) => {
        if (!result.available) {
          setFuel({ status: "unavailable" });
          return;
        }
        const ahead = result.stops
          .map((stop) => ({ stop, aheadMeters: stop.alongMeters - here }))
          .filter((entry) => entry.aheadMeters > 150 && entry.aheadMeters < LOOK_AHEAD_METERS)
          .sort((a, b) => a.aheadMeters - b.aheadMeters)
          .slice(0, MAX_CHOICES);
        setFuel({ status: "ready", stops: ahead });
      },
      () => setFuel({ status: "unavailable" }),
    );
  };
  const copy = STOP_COPY[kind ?? "fuel"];

  return (
    <section className="og-ride__detour" aria-label="Route changes" data-testid="ride-detour" data-off-route={offRoute ? "true" : "false"}>
      {/* Off the line with nothing in flight, the top card already says so. */}
      {message === null && error === null ? null : (
        <p
          className="og-ride__detour-status"
          data-testid="ride-reroute-status"
          data-tone={error !== null ? "error" : busy ? "info" : "done"}
          role="status"
        >
          {error ?? message}
        </p>
      )}
      {/* Plain 56 px rows, one thing each; the rarer changes wait behind "More". */}
      <div className="og-ride__sheet-rows">
        <button
          type="button"
          className="og-ride__sheet-row"
          data-testid="ride-reroute"
          disabled={busy || !fixGood}
          aria-busy={busy ? "true" : undefined}
          title={fixGood ? undefined : "Rerouting needs a fresh, accurate GPS fix."}
          onClick={(): void => onReroute()}
        >
          <span className="og-ride__sheet-row-label">{busy ? "Routing…" : "New route from here"}</span>
        </button>
        {!canFindStops ? null : (
          <button
            type="button"
            className="og-ride__sheet-row"
            data-testid="ride-add-stop"
            aria-expanded={adding}
            disabled={busy}
            onClick={(): void => {
              setAdding(!adding);
              if (adding) {
                setKind(null);
                setFuel(null);
              }
            }}
          >
            <span className="og-ride__sheet-row-label">Add a stop</span>
            <span className="og-ride__sheet-row-hint">Gas or food ahead</span>
          </button>
        )}
      </div>
      {!adding || !canFindStops ? null : (
        <div className="og-ride__detour-actions" role="group" aria-label="Add a stop">
          <button
            type="button"
            className="og-ride__action"
            data-testid="ride-fuel-ahead"
            aria-pressed={kind === "fuel"}
            disabled={busy}
            onClick={(): void => findStops("fuel")}
          >
            <span aria-hidden="true">⛽ </span>
            Gas
          </button>
          <button
            type="button"
            className="og-ride__action"
            data-testid="ride-food-ahead"
            aria-pressed={kind === "food"}
            disabled={busy}
            onClick={(): void => findStops("food")}
          >
            Food
          </button>
        </div>
      )}
      <details className="og-ride__more" data-testid="ride-more">
        <summary className="og-ride__action">More</summary>
        <div className="og-ride__detour-actions">
          <button
            type="button"
            className="og-ride__action"
            data-testid="ride-easier-way-back"
            disabled={busy || !fixGood}
            title={fixGood ? undefined : "An easier return needs a fresh, accurate GPS fix."}
            onClick={onEasierWayBack}
          >
            Easier way back
          </button>
          <button
            type="button"
            className="og-ride__action"
            data-testid="ride-turn-around"
            disabled={busy || !fixGood}
            title={fixGood ? undefined : "Turn Around needs a fresh, accurate GPS fix."}
            onClick={onTurnAround}
          >
            Turn around
          </button>
        </div>
      </details>
      {fuel === null ? null : fuel.status === "loading" ? (
        <p className="og-ride__detour-note" role="status">Finding {copy.plural} along the rest of your route…</p>
      ) : fuel.status === "unavailable" ? (
        <p className="og-ride__detour-note" role="status">Stops are unavailable right now.</p>
      ) : fuel.stops.length === 0 ? (
        <p className="og-ride__detour-note" role="status">No {copy.plural} within a mile of the route in the next 120 mi.</p>
      ) : (
        <ul className="og-ride__fuel" aria-label={`${copy.noun} ahead`} data-testid="ride-fuel-list">
          {fuel.stops.map(({ stop, aheadMeters }) => {
            const point = stop.feature.geometry.type === "Point" ? stop.feature.geometry.coordinates : null;
            return (
              <li key={stop.feature.id} className="og-ride__fuel-row">
                <span className="og-ride__fuel-ahead">{miles(aheadMeters)} mi</span>
                <span className="og-ride__fuel-name">
                  {stop.feature.name}
                  <small>{stop.offMeters < 160 ? "On your route" : `${miles(stop.offMeters)} mi off route`}</small>
                </span>
                {point === null ? null : (
                  <button
                    type="button"
                    className="og-ride__action og-ride__action--primary og-ride__fuel-go"
                    disabled={busy || !fixGood}
                    title={fixGood ? undefined : "Routing needs a fresh, accurate GPS fix."}
                    aria-label={`Route via ${stop.feature.name}`}
                    onClick={(): void => {
                      setFuel(null);
                      setKind(null);
                      setAdding(false);
                      onReroute({ coordinate: { lon: point[0], lat: point[1] }, label: stop.feature.name });
                    }}
                  >
                    Go
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
