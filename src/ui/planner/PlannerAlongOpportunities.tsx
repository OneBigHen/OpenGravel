"use client";
import { useEffect, useRef, useState } from "react";
import type { Coordinate, DepartureIntent } from "@/domain/ride/types";
import type {
  RoadOpeningsBody,
  RoadOpeningsUnavailableBody,
  RoadOpeningSummary,
} from "@/application/route-intelligence/opening-calendar-contract";
import type { RiderOpportunitiesBody } from "@/application/discover/rider-opportunities-contract";
import {
  alongRideSuggestions,
  type AlongRideSuggestion,
} from "@/application/explore/opportunity-projection";
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
  readonly onAddStop?:
    ((coordinate: Coordinate, name: string) => void) | undefined;
  readonly onRouteThrough?:
    ((road: RoadOpeningSummary) => void | Promise<void>) | undefined;
}
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
    ]).then(([roadResult, stopResult]) => {
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
            errors.push(`${source.id}: ${source.reason ?? source.status}`),
          );
      } else errors.push("Destinations could not be checked.");
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
          line: route.geometry,
          durationSeconds: route.durationSeconds,
          departAt,
        }),
      });
    });
    return () => controller.abort();
  }, [open, key, route, departure, retry]);
  if (route === null) return null;
  const current = result?.key === key ? result : null;
  const markAdded = (id: string): void =>
    setAdded((previous) => ({
      key,
      ids: new Set(previous?.key === key ? previous.ids : []).add(id),
    }));
  return (
    <section className="og-explore__section" aria-label="Route opportunities">
      <button
        type="button"
        className="og-secondary og-explore__wide"
        aria-expanded={open}
        aria-controls="along-ride-results"
        onClick={() => setOpen((value) => !value)}
      >
        Along this ride
      </button>
      {open ? (
        <div id="along-ride-results" className="og-explore__section">
          <p>
            Worthwhile detours for this route. Choose a suggestion to change
            your ride.
          </p>
          {current === null ? (
            <p role="status">
              Checking road windows and destinations along this ride…
            </p>
          ) : (
            <>
              {current.errors.map((message) => (
                <p role="status" key={message}>
                  {message}
                </p>
              ))}
              {current.suggestions.length === 0 ? (
                <p role="status">
                  No suggestions returned for this route and departure.
                </p>
              ) : (
                <ul
                  className="og-explore__list"
                  aria-label="Along this ride suggestions"
                >
                  {current.suggestions.map((suggestion) => {
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
                      <li key={suggestion.road.id}>
                        <p>~{suggestion.detour} min estimated detour</p>
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
              {actionError?.key === key ? (
                <p role="alert">{actionError.message}</p>
              ) : null}
              <button
                type="button"
                className="og-secondary"
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
