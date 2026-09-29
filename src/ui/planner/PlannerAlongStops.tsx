"use client";

import { useEffect, useState } from "react";

import { alongRouteRows, type AlongRouteRow } from "@/application/places/along-route";
import type { PlacesSource } from "@/application/places/places-source";
import type { NearbyPlace, PlaceQuery } from "@/application/places/types";
import type { Coordinate } from "@/domain/ride/types";

const TODAY_QUERY: PlaceQuery = { kinds: ["happy_hour", "event"], window: "today" };

type AlongStopsState =
  | { readonly routeId: string; readonly status: "loading" }
  | { readonly routeId: string; readonly status: "unavailable" }
  | { readonly routeId: string; readonly status: "available"; readonly rows: readonly AlongRouteRow[] };

export interface PlannerAlongStopsProps {
  readonly route: { readonly routeId: string; readonly geometry: readonly Coordinate[] } | null;
  readonly source?: PlacesSource;
  readonly onAddStop?: (place: NearbyPlace) => void;
}

/** Provider-backed places along the selected route, separate from ride state. */
export function PlannerAlongStops({ route, source, onAddStop }: PlannerAlongStopsProps) {
  const routeId = route?.routeId ?? null;
  const line = route?.geometry;
  const [state, setState] = useState<AlongStopsState | null>(null);
  const [added, setAdded] = useState<{ readonly routeId: string; readonly ids: ReadonlySet<string> } | null>(null);

  useEffect(() => {
    if (routeId === null || line === undefined || source === undefined) return;
    const controller = new AbortController();
    void source
      .alongRoute({ line, bufferMiles: 1 }, TODAY_QUERY, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.availability === "unavailable") {
          setState({ routeId, status: "unavailable" });
          return;
        }
        setState({ routeId, status: "available", rows: alongRouteRows(result.places) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ routeId, status: "unavailable" });
      });
    return () => controller.abort();
    // Geometry is immutable for one route id; a new route id owns the next fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, source]);

  if (route === null || source === undefined) return null;
  const current = state?.routeId === routeId ? state : null;

  return (
    <details className="og-places-along">
      <summary className="og-places-along__summary">Stops along your ride</summary>
      {current === null || current.status === "loading" ? (
        <div className="og-places-along__loading">
          <p className="og-places-along__status" role="status">
            Checking happy hours and events along your route…
          </p>
          <ul className="og-places-along__list" aria-label="Stops along your ride">
            {[0, 1, 2].map((index) => (
              <li className="og-places-along__skeleton" key={index}>
                <span />
              </li>
            ))}
          </ul>
        </div>
      ) : current.status === "unavailable" ? (
        <p className="og-places-along__status" role="status">Places unavailable right now</p>
      ) : current.rows.length === 0 ? (
        <p className="og-places-along__status" role="status">
          No happy hours or events within a mile of this route today.
        </p>
      ) : (
        <ul className="og-places-along__list" aria-label="Stops along your ride">
          {current.rows.map((row) => {
            const isAdded = added?.routeId === routeId && added.ids.has(row.id);
            return (
              <li className="og-places-along__row" key={row.id}>
                <div className="og-places-along__copy">
                  <p className="og-places-along__place">
                    <span className="og-places-along__mile">{row.mileLabel}</span>
                    {" · "}{row.title}{" · "}{row.detail}
                  </p>
                  <p className="og-places-along__when">
                    {row.live ? <span className="og-places-along__live" aria-hidden="true" /> : null}
                    {row.when}{" · "}{row.offRoute}
                  </p>
                </div>
                {onAddStop === undefined ? null : (
                  <button
                    type="button"
                    className="og-places-along__add"
                    aria-label={isAdded ? `Added ${row.title} as a stop` : `Add ${row.title} as a stop`}
                    disabled={isAdded}
                    onClick={() => {
                      onAddStop(row.place);
                      setAdded((previous) => ({
                        routeId: routeId ?? "",
                        ids: new Set(previous?.routeId === routeId ? previous.ids : []).add(row.id),
                      }));
                    }}
                  >
                    {isAdded ? "Added" : "Add as stop"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
