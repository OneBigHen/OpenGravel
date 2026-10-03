"use client";
import { useEffect, useRef, useState } from "react";
import type {
  RoadOpeningsBody,
  RoadOpeningsUnavailableBody,
} from "@/application/route-intelligence/opening-calendar-contract";
import { type RideTimeLens } from "@/application/explore/time-lens";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { roadWindowsForTime } from "@/application/explore/opportunity-projection";
import { RoadOpeningCard } from "@/ui/explore/RoadOpeningCard";

type State =
  | { readonly kind: "idle" | "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly data: RoadOpeningsBody };
export function RideRoadOpenings({
  lens,
  date,
  token,
  map,
}: {
  readonly lens: RideTimeLens;
  readonly date: string;
  readonly token?: string | undefined;
  readonly map?: ExploreMapConfig | undefined;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  function load(): void {
    const mine = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    if (!navigator.geolocation) {
      setState({
        kind: "error",
        message: "Location is unavailable on this device.",
      });
      return;
    }
    setState({ kind: "loading" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (mine !== generation.current) return;
        const params = new URLSearchParams({
          lat: String(position.coords.latitude),
          lon: String(position.coords.longitude),
          radiusMiles: "100",
          days: "180",
        });
        void fetch(`/api/road-openings?${params}`, {
          signal: abort.signal,
          cache: "no-store",
        })
          .then(async (response) => {
            const data = (await response.json()) as
              RoadOpeningsBody | RoadOpeningsUnavailableBody;
            if ("unavailable" in data) throw new Error(data.reason);
            if (!response.ok)
              throw new Error("Road openings could not be checked.");
            if (mine === generation.current) setState({ kind: "ready", data });
          })
          .catch((error: unknown) => {
            if (mine === generation.current && !abort.signal.aborted)
              setState({
                kind: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Road openings could not be checked.",
              });
          });
      },
      () => {
        if (mine === generation.current)
          setState({
            kind: "error",
            message:
              "Location permission was not granted. You can keep browsing without it.",
          });
      },
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  }
  const data = state.kind === "ready" ? state.data : null;
  const { open: events, closing } = roadWindowsForTime(
    data?.events ?? [],
    lens,
    date,
    new Date(),
  );
  if (
    data !== null &&
    events.length === 0 &&
    closing.length === 0 &&
    data.undated.length === 0 &&
    !data.truncated &&
    data.sources.every((item) => item.status === "fresh")
  )
    return null;
  const source = (id: string): string =>
    data?.sources.find((item) => item.id === id)?.label ?? id;
  return (
    <section className="og-road-discovery" aria-label="Road access windows">
      <button type="button" className="og-secondary" onClick={load}>
        {data === null ? "Find roads near me" : "Refresh road windows"}
      </button>
      {state.kind === "loading" ? (
        <p role="status">Checking authority road windows…</p>
      ) : null}
      {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
      {data?.sources
        .filter((item) => item.status !== "fresh")
        .map((item) => (
          <p role="status" key={item.id}>
            {item.label}: {item.reason ?? item.status}
          </p>
        ))}
      {data?.truncated ? (
        <p role="status">
          Some road windows were omitted. Narrow the search before treating it
          as complete.
        </p>
      ) : null}
      {events.length > 0 ? (
        <section className="og-explore__section">
          <h2>{lens === "now" ? "Open now" : "Open for your ride"}</h2>
          <ul className="og-explore__list">
            {events.map((road) => (
              <RoadOpeningCard
                key={road.id}
                road={road}
                source={source(road.sourceId)}
                token={token}
                map={map}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {closing.length > 0 ? (
        <section className="og-explore__section">
          <h2>Closing soon</h2>
          <ul className="og-explore__list">
            {closing.map((road) => (
              <RoadOpeningCard
                key={road.id}
                road={road}
                source={source(road.sourceId)}
                token={token}
                map={map}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {data !== null && data.undated.length > 0 ? (
        <section className="og-explore__section">
          <h2>Seasonal · dates not published</h2>
          <ul className="og-explore__list">
            {data.undated.map((road) => (
              <RoadOpeningCard
                key={road.id}
                road={road}
                source={source(road.sourceId)}
                token={token}
                map={map}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {token === undefined ? null : (
        <p className="og-explore__attribution">
          Map images © Mapbox © OpenStreetMap
        </p>
      )}
    </section>
  );
}
