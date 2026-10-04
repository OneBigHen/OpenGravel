"use client";
import { useEffect, useRef, useState } from "react";
import type { RiderOpportunitiesBody } from "@/application/discover/rider-opportunities-contract";
import {
  thingsForTime,
  type ThingsTimeLens,
} from "@/application/explore/opportunity-projection";
import { OpportunityCard } from "@/ui/explore/OpportunityCard";

type State =
  | { readonly kind: "idle" | "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly data: RiderOpportunitiesBody };
export function ThingsFeed() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [time, setTime] = useState<ThingsTimeLens>("today");
  const [radius, setRadius] = useState("100");
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
          radiusMiles: radius,
        });
        void fetch(`/api/rider-opportunities?${params}`, {
          signal: abort.signal,
          cache: "no-store",
        })
          .then(async (response) => {
            if (!response.ok)
              throw new Error("Things could not be checked. Try again.");
            const data = (await response.json()) as RiderOpportunitiesBody;
            if (mine === generation.current) setState({ kind: "ready", data });
          })
          .catch(() => {
            if (mine === generation.current && !abort.signal.aborted)
              setState({
                kind: "error",
                message: "Things could not be checked. Try again.",
              });
          });
      },
      () => {
        if (mine === generation.current)
          setState({
            kind: "error",
            message:
              "Location permission was not granted. You can keep browsing Ride.",
          });
      },
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  }
  const items =
    state.kind === "ready"
      ? thingsForTime(state.data.opportunities, time, new Date())
      : [];
  return (
    <section className="og-road-discovery" aria-label="Things worth riding to">
      <h2>Things worth riding to</h2>
      <p>
        A few destinations worth the ride, ranked for riders by timing and
        destination value.
      </p>
      <div className="og-explore__row">
        <label>
          Riding radius{" "}
          <select
            aria-label="Riding radius"
            value={radius}
            onChange={(event) => {
              generation.current++;
              controller.current?.abort();
              setRadius(event.target.value);
              setState({ kind: "idle" });
            }}
          >
            <option value="50">50 mi</option>
            <option value="100">100 mi</option>
            <option value="125">125 mi</option>
          </select>
        </label>
        <button type="button" className="og-primary" onClick={load}>
          {state.kind === "ready"
            ? "Refresh things"
            : "Find things worth riding to"}
        </button>
      </div>
      <div
        className="og-explore__row"
        role="group"
        aria-label="Things time"
      >
        {(
          [
            ["today", "Today"],
            ["weekend", "This weekend"],
            ["next-weekend", "Next weekend"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className="og-explore__quick-chip"
            aria-pressed={time === value}
            onClick={() => setTime(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {time !== "today" ? (
        <p>Published events only; future schedules may be incomplete.</p>
      ) : null}
      {state.kind === "loading" ? (
        <p role="status">Looking for worthwhile destinations…</p>
      ) : null}
      {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
      {state.kind === "ready" ? (
        <>
          {items.length === 0 ? (
            <p role="status">
              No suggestions returned by the available sources in this riding
              radius.
            </p>
          ) : (
            <ul className="og-explore__list">
              {items.map((item) => (
                <OpportunityCard key={item.id} item={item} />
              ))}
            </ul>
          )}
          {/* Source caveats are for the curious, not the headline (owner review 2026-10-04). */}
          {state.data.sources.some((source) => source.status !== "ok") ? (
            <details className="og-along__sources">
              <summary role="status">Some sources had gaps</summary>
              <ul>
                {state.data.sources
                  .filter((source) => source.status !== "ok")
                  .map((source) => (
                    <li key={source.id}>
                      {source.id}: {source.reason ?? "Some results are unavailable."}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
