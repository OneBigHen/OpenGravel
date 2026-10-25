"use client";
import { useEffect, useRef, useState } from "react";
import type { Coordinate, DepartureIntent } from "@/domain/ride/types";
import {
  alongRideSuggestions,
  type AlongRideSuggestion,
} from "@/application/explore/opportunity-projection";
import {
  ALONG_RIDE_STOP_LABEL,
  ALONG_RIDE_STOP_LAYERS,
  ALONG_RIDE_STOP_SOURCE,
  alongRideMileLabel,
  alongRideOffRouteLabel,
  alongRideStopRows,
  type AlongRideStopRow,
} from "@/application/explore/along-ride-stops";
import type { AlongStopsResult } from "@/application/map-layers/along";
import type { MapLayersSource } from "@/application/map-layers";
import type {
  RoadOpeningsBody,
  RoadOpeningsUnavailableBody,
  RoadOpeningSummary,
} from "@/application/route-intelligence/opening-calendar-contract";
import type { RiderOpportunitiesBody } from "@/application/discover/rider-opportunities-contract";
import { departureInstant } from "@/application/preparation/planner-context";
import { OpportunityCard } from "@/ui/explore/OpportunityCard";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { RoadOpeningCard } from "@/ui/explore/RoadOpeningCard";

export interface PlannerAlongOpportunitiesProps {
  readonly route: {
    readonly routeId: string;
    readonly geometry: readonly Coordinate[];
    readonly distanceMeters: number;
    readonly durationSeconds: number;
  } | null;
  readonly departure: DepartureIntent;
  readonly map?: ExploreMapConfig | undefined;
  /** The map-layer source that holds the provider key for gas, food and views. */
  readonly source?: MapLayersSource | undefined;
  readonly onAddStop?:
    ((coordinate: Coordinate, name: string) => void) | undefined;
  readonly onRouteThrough?:
    ((road: RoadOpeningSummary) => void | Promise<void>) | undefined;
}
/** The rider-facing name of a stop source; its wire id is developer detail. */
const STOP_SOURCE_LABEL: Readonly<Record<string, string>> = {
  "events.henning.rodeo": "Events and places",
  discover: "Destinations",
  "osm-rider-places": "Places",
  wikimedia: "Wikimedia",
};

interface Result {
  readonly key: string;
  readonly suggestions: readonly AlongRideSuggestion[];
  readonly roads: RoadOpeningsBody | null;
  readonly errors: readonly string[];
}

export function PlannerAlongOpportunities({
  route,
  departure,
  onAddStop,
  onRouteThrough,
  map,
  source,
}: PlannerAlongOpportunitiesProps) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [added, setAdded] = useState<{
    readonly key: string;
    readonly ids: ReadonlySet<string>;
  } | null>(null);
  const [actionError, setActionError] = useState<{
    readonly key: string;
    readonly message: string;
  } | null>(null);
  const key = `${route?.routeId ?? "none"}|${JSON.stringify(departure)}`;
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const currentKey = useRef(key);
  useEffect(() => {
    currentKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!open || route === null) return;
    const controller = new AbortController();
    const departAt = departureInstant(departure, new Date().toISOString());
    const options = {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
    } as const;
    async function read<T>(response: Response): Promise<T> {
      const body = (await response.json()) as T;
      if (!response.ok)
        throw new Error(
          (body as RoadOpeningsUnavailableBody).reason ??
            "Source unavailable right now.",
        );
      return body;
    }
    // Each layer answers or fails on its own, so one empty provider never
    // silences the others; a missing source leaves the list as it was.
    const line = route.geometry.map((point) => [point.lon, point.lat] as const);
    const along = source?.along;
    const alongPromise: Promise<readonly AlongStopsResult[]> =
      along === undefined
        ? Promise.resolve([])
        : Promise.all(
            ALONG_RIDE_STOP_LAYERS.map((layer) =>
              along(line, layer, controller.signal).catch(
                (): AlongStopsResult => ({ stops: [], available: false }),
              ),
            ),
          );
    void Promise.allSettled([
      fetch("/api/road-openings", {
        ...options,
        body: JSON.stringify({
          line: route.geometry,
          bufferMiles: 10,
          days: 180,
        }),
      }).then(read<RoadOpeningsBody | RoadOpeningsUnavailableBody>),
      fetch("/api/rider-opportunities", {
        ...options,
        body: JSON.stringify({
          line: route.geometry,
          routeDistanceMeters: route.distanceMeters,
          routeDurationSeconds: route.durationSeconds,
          departAt,
        }),
      }).then(read<RiderOpportunitiesBody>),
      alongPromise,
    ]).then(([roadResult, stopResult, alongResult]) => {
      if (controller.signal.aborted) return;
      const errors: string[] = [];
      const roads =
        roadResult.status === "fulfilled" &&
        !("unavailable" in roadResult.value)
          ? roadResult.value
          : null;
      if (roads === null)
        errors.push(
          `Road openings could not be checked: ${roadResult.status === "rejected" && roadResult.reason instanceof Error ? roadResult.reason.message : "authority unavailable"}`,
        );
      else {
        roads.sources
          .filter((source) => source.status !== "fresh")
          .forEach((source) =>
            errors.push(`${source.label}: ${source.reason ?? source.status}`),
          );
        if (roads.truncated)
          errors.push("Some road windows were omitted from this search.");
        if (
          roads.to !== undefined &&
          Date.parse(departAt) >= Date.parse(roads.to)
        )
          errors.push(
            "Road dates are outside the published search horizon. Access remains unknown.",
          );
      }
      if (stopResult.status === "fulfilled") {
        stopResult.value.sources
          .filter((source) => source.status !== "ok")
          .forEach((source) =>
            errors.push(
              `${STOP_SOURCE_LABEL[source.id] ?? "Stops"}: ${source.reason ?? source.status}`,
            ),
          );
      } else errors.push("Destinations could not be checked.");
      const alongAnswers =
        alongResult.status === "fulfilled" ? alongResult.value : [];
      // Nothing to report when this host has no along-route source at all.
      if (along !== undefined) {
        const unavailableLayers = ALONG_RIDE_STOP_LAYERS.filter(
          (_layer, index) => alongAnswers[index]?.available !== true,
        );
        if (unavailableLayers.length === ALONG_RIDE_STOP_LAYERS.length)
          errors.push("Gas, food and overlooks could not be checked.");
        else
          unavailableLayers.forEach((layer) =>
            errors.push(`${ALONG_RIDE_STOP_SOURCE[layer]} could not be checked.`),
          );
      }
      setResult({
        key,
        roads,
        errors,
        suggestions: alongRideSuggestions({
          roads: roads?.events ?? [],
          stops:
            stopResult.status === "fulfilled"
              ? stopResult.value.opportunities
              : [],
          alongStops: alongRideStopRows(
            alongAnswers.flatMap((answer) => answer.stops),
          ),
          line: route.geometry,
          durationSeconds: route.durationSeconds,
          departAt,
        }),
      });
    });
    return () => controller.abort();
  }, [open, key, route, departure, retry, source]);
  if (route === null) return null;
  const current = result?.key === key ? result : null;
  const markAdded = (id: string): void =>
    setAdded((previous) => ({
      key,
      ids: new Set(previous?.key === key ? previous.ids : []).add(id),
    }));
  return (
    <section className="og-along" aria-label="Route opportunities">
      <button
        type="button"
        className="og-along__toggle"
        aria-expanded={open}
        aria-controls="along-ride-results"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="og-along__icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
            <circle cx="12" cy="10" r="2.3" />
          </svg>
        </span>
        <span className="og-along__label">
          <span className="og-along__title">Along this ride</span>
          <span className="og-along__hint">
            {open && current !== null
              ? `${current.suggestions.length} worth a stop`
              : "Gas, food, views and road windows on your way"}
          </span>
        </span>
        <svg className="og-along__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div id="along-ride-results" className="og-along__results">
          {current === null ? (
            <p className="og-along__status" role="status">
              <span className="og-along__spinner" aria-hidden="true" />
              Checking events, stops and road windows along this ride…
            </p>
          ) : (
            <>
              {current.suggestions.length === 0 ? (
                <p className="og-along__status" role="status">
                  {current.errors.length === 0
                    ? "Nothing worth a stop on this route for this departure."
                    : "No stops could be checked along this ride."}
                </p>
              ) : (
                <ul
                  className="og-along__list"
                  aria-label="Along this ride suggestions"
                >
                  {current.suggestions.map((suggestion) => {
                    if (suggestion.kind === "along-stop")
                      return (
                        <AlongStopRow
                          key={suggestion.stop.id}
                          stop={suggestion.stop}
                          added={
                            added?.key === key &&
                            added.ids.has(suggestion.stop.id)
                          }
                          onAdd={
                            onAddStop === undefined
                              ? undefined
                              : (stop) => {
                                  onAddStop(stop.coordinate, stop.name);
                                  markAdded(stop.id);
                                }
                          }
                        />
                      );
                    if (suggestion.kind === "stop")
                      return (
                        <OpportunityCard
                          key={suggestion.item.id}
                          item={suggestion.item}
                          added={
                            added?.key === key &&
                            added.ids.has(suggestion.item.id)
                          }
                          onAddStop={
                            onAddStop === undefined
                              ? undefined
                              : (item) => {
                                  onAddStop(item.coordinate, item.name);
                                  markAdded(item.id);
                                }
                          }
                        />
                      );
                    return (
                      <li key={suggestion.road.id} className="og-along__road">
                        <p className="og-along__road-note">~{suggestion.detour} min detour</p>
                        <ul>
                          <RoadOpeningCard
                            map={map}
                            token={map?.staticMapToken}
                            road={suggestion.road}
                            source={
                              current.roads?.sources.find(
                                (source) =>
                                  source.id === suggestion.road.sourceId,
                              )?.label ?? suggestion.road.sourceId
                            }
                            added={
                              added?.key === key &&
                              added.ids.has(suggestion.road.id)
                            }
                            busy={pending.has(`${key}|${suggestion.road.id}`)}
                            onRouteThrough={
                              onRouteThrough === undefined
                                ? undefined
                                : (road) => {
                                    const actionKey = `${key}|${road.id}`;
                                    if (pending.has(actionKey)) return;
                                    setPending((previous) =>
                                      new Set(previous).add(actionKey),
                                    );
                                    void (async () => {
                                      try {
                                        await onRouteThrough(road);
                                        if (currentKey.current === key)
                                          markAdded(road.id);
                                      } catch (error: unknown) {
                                        if (currentKey.current === key)
                                          setActionError({
                                            key,
                                            message:
                                              error instanceof Error
                                                ? error.message
                                                : "The road could not be added.",
                                          });
                                      } finally {
                                        setPending((previous) => {
                                          const next = new Set(previous);
                                          next.delete(actionKey);
                                          return next;
                                        });
                                      }
                                    })();
                                  }
                            }
                          />
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
              {current.suggestions.some(
                (suggestion) => suggestion.kind === "along-stop",
              ) ? (
                <p className="og-along__note">
                  Stops from TomTom. Hours and access are not checked.
                </p>
              ) : null}
              {actionError?.key === key ? (
                <p className="og-along__error" role="alert">{actionError.message}</p>
              ) : null}
              {current.errors.length === 0 ? null : (
                <details className="og-along__sources">
                  <summary role="status">
                    {current.errors.length === 1
                      ? "One source didn’t answer"
                      : `${current.errors.length} sources didn’t answer`}
                  </summary>
                  <ul>
                    {current.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                type="button"
                className="og-along__refresh"
                onClick={() => {
                  setResult(null);
                  setRetry((value) => value + 1);
                }}
              >
                Refresh suggestions
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One gas station, diner, café or overlook: the provider's name and town, how
 * far along this ride it is, and how far off it. Compact on purpose — the Add
 * target is the only action, and it stays thumb-sized.
 */
function AlongStopRow({
  stop,
  added,
  onAdd,
}: {
  readonly stop: AlongRideStopRow;
  readonly added: boolean;
  readonly onAdd?: ((stop: AlongRideStopRow) => void) | undefined;
}) {
  // Off-route distance first: it is the fact that decides whether this stop
  // is worth tapping, so a narrow screen never truncates it.
  const detail = [
    alongRideOffRouteLabel(stop.offMeters),
    ALONG_RIDE_STOP_LABEL[stop.layer],
    stop.detail,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  return (
    <li className="og-along__stop" data-layer={stop.layer}>
      <span className="og-along__stop-mile">{alongRideMileLabel(stop.mile)}</span>
      <span className="og-along__stop-place">
        <span className="og-along__stop-name">{stop.name}</span>
        <small>{detail}</small>
      </span>
      {onAdd === undefined ? null : (
        <button
          type="button"
          className="og-along__stop-add"
          disabled={added}
          aria-label={
            added
              ? `Added ${stop.name} as a stop`
              : `Add ${stop.name} as a stop`
          }
          onClick={() => onAdd(stop)}
        >
          {added ? "Added" : "Add"}
        </button>
      )}
    </li>
  );
}
