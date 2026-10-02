"use client";

import { useMemo, useState } from "react";

import type {
  RoadOpeningsBody,
  RoadOpeningsUnavailableBody,
  RoadOpeningSummary,
  UndatedSeasonalRoadSummary,
} from "@/application/route-intelligence/opening-calendar-contract";

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: RoadOpeningsBody }
  | { readonly kind: "error"; readonly message: string };

function dateLabel(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(value));
}

function recurringDateLabel(value: string): string {
  // Recurring month/day windows are calendar dates, not instants. UTC keeps an
  // Oct 1 season from rendering as Sep 30 for an Eastern-time rider.
  return dateLabel(value, "UTC");
}

function recurringInclusiveEndDateLabel(exclusiveEnd: string): string {
  const milliseconds = Date.parse(exclusiveEnd);
  return Number.isFinite(milliseconds)
    ? recurringDateLabel(new Date(milliseconds - 1).toISOString())
    : recurringDateLabel(exclusiveEnd);
}

function openingWindowLabel(event: RoadOpeningSummary): string {
  if (event.certainty === "recurring-season") {
    return `${recurringDateLabel(event.startsAt)} – ${recurringInclusiveEndDateLabel(event.endsAt)}`;
  }
  return `${dateLabel(event.startsAt)} · closes ${dateLabel(event.endsAt)}`;
}

function localDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function upcomingWeekend(now: Date): { readonly start: Date; readonly end: Date } {
  const start = localDayStart(now);
  if (start.getDay() === 0) {
    // Sunday still belongs to the current weekend, not next Saturday's.
    start.setDate(start.getDate() - 1);
  } else {
    const daysUntilSaturday = (6 - start.getDay() + 7) % 7;
    start.setDate(start.getDate() + daysUntilSaturday);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  return { start, end };
}

function overlaps(event: RoadOpeningSummary, start: Date, end: Date): boolean {
  return Date.parse(event.startsAt) < end.getTime() && Date.parse(event.endsAt) > start.getTime();
}

function openingGroup(events: readonly RoadOpeningSummary[], now: Date) {
  const instant = now.getTime();
  const weekend = upcomingWeekend(now);
  const week = instant + 7 * 24 * 3_600_000;
  const thisWeekend = events.filter((event) => overlaps(event, weekend.start, weekend.end));
  const openNow = events.filter((event) =>
    Date.parse(event.startsAt) <= instant
    && instant < Date.parse(event.endsAt)
    && !thisWeekend.some((weekendEvent) => weekendEvent.id === event.id));
  const soon = events.filter((event) => {
    const start = Date.parse(event.startsAt);
    return start > instant && start <= week
      && !thisWeekend.some((weekendEvent) => weekendEvent.id === event.id);
  });
  const later = events.filter((event) =>
    !openNow.some((candidate) => candidate.id === event.id)
    && !thisWeekend.some((candidate) => candidate.id === event.id)
    && !soon.some((candidate) => candidate.id === event.id));
  return { openNow, thisWeekend, soon, later };
}

function sourceLabel(data: RoadOpeningsBody, sourceId: string): string {
  return data.sources.find((source) => source.id === sourceId)?.label ?? sourceId;
}

function OpeningCard({ event, source }: { readonly event: RoadOpeningSummary; readonly source: string }) {
  return (
    <li className="og-explore-card">
      <div className="og-explore-card__body">
        <span className="og-explore-card__topline">
          <span className="og-explore-card__source">Seasonal road</span>
          <span className="og-explore-card__region">{source}</span>
        </span>
        <strong>{event.roadName ?? "Unnamed seasonal road"}</strong>
        <span className="og-explore-card__facts">
          <span>{openingWindowLabel(event)}</span>
          <span>{event.certainty === "published-window" ? "Published dates" : "Recurring season"}</span>
        </span>
        <span className="og-explore-card__summary">{event.description}</span>
      </div>
    </li>
  );
}

function Group({
  title,
  events,
  data,
}: {
  readonly title: string;
  readonly events: readonly RoadOpeningSummary[];
  readonly data: RoadOpeningsBody;
}) {
  if (events.length === 0) return null;
  return (
    <section className="og-road-discovery__slice">
      <div className="og-road-discovery__slice-head">
        <h2>{title}</h2>
        <span>{events.length}</span>
      </div>
      <ul className="og-explore__list">
        {events.map((event) => <OpeningCard key={event.id} event={event} source={sourceLabel(data, event.sourceId)} />)}
      </ul>
    </section>
  );
}

function Undated({ roads, data }: { readonly roads: readonly UndatedSeasonalRoadSummary[]; readonly data: RoadOpeningsBody }) {
  if (roads.length === 0) return null;
  return (
    <section className="og-road-discovery__slice">
      <div className="og-road-discovery__slice-head">
        <h2>Seasonal · dates not published</h2>
        <span>{roads.length}</span>
      </div>
      <p>These roads are marked seasonal by an authority, but OpenGravel will not guess the dates.</p>
      <ul className="og-explore__list">
        {roads.map((road) => (
          <li key={road.id} className="og-explore-card">
            <div className="og-explore-card__body">
              <span className="og-explore-card__topline">
                <strong>{road.roadName ?? "Unnamed seasonal road"}</strong>
                <span className="og-explore-card__region">{sourceLabel(data, road.sourceId)}</span>
              </span>
              <span className="og-explore-card__summary">{road.description}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SeasonalRoadOpenings() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const groups = useMemo(
    () => state.kind === "ready" ? openingGroup(state.data.events, new Date()) : null,
    [state],
  );

  function load(): void {
    if (!navigator.geolocation) {
      setState({ kind: "error", message: "Location is unavailable on this device." });
      return;
    }
    setState({ kind: "loading" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const params = new URLSearchParams({
          lat: String(position.coords.latitude),
          lon: String(position.coords.longitude),
          radiusMiles: "100",
          days: "90",
        });
        void fetch(`/api/road-openings?${params.toString()}`, { cache: "no-store" })
          .then(async (response) => {
            const payload = await response.json() as RoadOpeningsBody | RoadOpeningsUnavailableBody;
            if ("unavailable" in payload) throw new Error(payload.reason);
            if (!response.ok) throw new Error("Road openings are unavailable.");
            setState({ kind: "ready", data: payload });
          })
          .catch((error: unknown) => {
            setState({ kind: "error", message: error instanceof Error ? error.message : "Road openings are unavailable." });
          });
      },
      () => setState({ kind: "error", message: "Location permission was not granted. You can keep browsing without it." }),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  }

  if (state.kind === "idle") {
    return (
      <section className="og-road-discovery">
        <p className="og-eyebrow">Road seasons</p>
        <h2>What opens next?</h2>
        <p>See nearby forest, Game Lands and designated seasonal roads that are open now or opening soon.</p>
        <button type="button" className="og-primary" onClick={load}>Show openings near me</button>
      </section>
    );
  }
  if (state.kind === "loading") return <p role="status">Checking nearby road openings…</p>;
  if (state.kind === "error") {
    return (
      <section className="og-road-discovery">
        <p role="alert">{state.message}</p>
        <button type="button" className="og-secondary" onClick={load}>Try again</button>
      </section>
    );
  }

  const empty = state.data.events.length === 0 && state.data.undated.length === 0;
  return (
    <section className="og-road-discovery" aria-label="Seasonal road openings">
      <div className="og-road-discovery__slice-head">
        <div>
          <p className="og-eyebrow">Road seasons</p>
          <h2>Plan around the good windows</h2>
        </div>
        <button type="button" className="og-secondary" onClick={load}>Refresh</button>
      </div>
      {state.data.truncated ? <p>Showing the first results in the nearest search window. Narrow the area before treating this as complete.</p> : null}
      {empty ? <p>No published seasonal openings were found in this search window.</p> : null}
      {groups === null ? null : (
        <>
          <Group title="Open this weekend" events={groups.thisWeekend} data={state.data} />
          <Group title="Open now · closes before weekend" events={groups.openNow} data={state.data} />
          <Group title="Opening within 7 days" events={groups.soon} data={state.data} />
          <Group title="Later" events={groups.later} data={state.data} />
        </>
      )}
      <Undated roads={state.data.undated} data={state.data} />
      <p className="og-explore__intro">
        Access can change with weather, hunting operations, gates and agency updates. OpenGravel uses published authority data and does not infer permission from gravel surface alone.
      </p>
    </section>
  );
}
