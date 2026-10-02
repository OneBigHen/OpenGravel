"use client";

import { useEffect, useMemo, useState } from "react";

import type { RiderOpportunitiesBody } from "@/application/discover/rider-opportunities-contract";
import type { RiderOpportunity } from "@/application/discover/rider-opportunities";
import type {
  RoadOpeningsBody,
  RoadOpeningsUnavailableBody,
  RoadOpeningSummary,
  UndatedSeasonalRoadSummary,
} from "@/application/route-intelligence/opening-calendar-contract";
import type { Coordinate } from "@/domain/ride/types";

export interface SeasonalRoadOpeningsProps {
  readonly plannedRoute?: {
    readonly key: string;
    readonly line: readonly Coordinate[];
  };
}

type SearchContext =
  | { readonly kind: "route"; readonly line: readonly Coordinate[] }
  | { readonly kind: "near"; readonly lat: number; readonly lon: number };

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly mode: SearchContext["kind"] }
  | {
      readonly kind: "ready";
      readonly mode: SearchContext["kind"];
      readonly roads: RoadOpeningsBody | null;
      readonly opportunities: RiderOpportunitiesBody | null;
      readonly errors: readonly string[];
    }
  | { readonly kind: "error"; readonly message: string };

function dateLabel(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(value));
}

function dateTimeLabel(value: string): string | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(milliseconds));
}

function recurringDateLabel(value: string): string {
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

function opportunityDistance(item: RiderOpportunity): string | null {
  if (item.detourMinutes !== null) return item.detourMinutes <= 1 ? "On route" : `~${item.detourMinutes} min detour`;
  if (item.distanceMeters !== null) {
    const miles = item.distanceMeters / 1609.344;
    return `${miles < 10 ? miles.toFixed(0) : Math.round(miles)} mi away`;
  }
  return null;
}

function OpportunityCard({ item }: { readonly item: RiderOpportunity }) {
  const distance = opportunityDistance(item);
  const starts = item.startsAt === null ? null : dateTimeLabel(item.startsAt);
  const kind = item.kind === "event" ? "Event" : item.kind === "happy-hour" ? "Food & drink" : "Place";
  return (
    <li className="og-explore-card">
      <div className="og-explore-card__body">
        <span className="og-explore-card__topline">
          <span className="og-explore-card__source">{kind}</span>
          <span className="og-explore-card__region">{item.reason}</span>
        </span>
        <strong>{item.name}</strong>
        <span className="og-explore-card__facts">
          {starts === null ? null : <span>{starts}</span>}
          {distance === null ? null : <span>{distance}</span>}
          {item.popular ? <span>Popular</span> : null}
        </span>
        {item.description === null ? null : <span className="og-explore-card__summary">{item.description}</span>}
        <span className="og-explore-card__byline">{item.sourceLabel}</span>
        {item.url === null ? null : (
          <a className="og-secondary" href={item.url} target="_blank" rel="noreferrer">Details</a>
        )}
      </div>
    </li>
  );
}

function Opportunities({ data }: { readonly data: RiderOpportunitiesBody }) {
  if (data.opportunities.length === 0) return null;
  return (
    <section className="og-road-discovery__slice" aria-labelledby="rider-opportunities-title">
      <div className="og-road-discovery__slice-head">
        <div>
          <p className="og-eyebrow">Things & places</p>
          <h2 id="rider-opportunities-title">Worth stopping for</h2>
        </div>
        <span>{data.opportunities.length}</span>
      </div>
      <p>
        {data.mode === "route"
          ? "Re-ranked around your planned route, with detour cost heavily penalized."
          : `A rider-focused sweep up to ${Math.round(data.searchedRadiusMiles ?? 0)} miles away — not a nearest-place list.`}
      </p>
      <ul className="og-explore__list">
        {data.opportunities.map((item) => <OpportunityCard key={item.id} item={item} />)}
      </ul>
    </section>
  );
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T;
  if (!response.ok) throw new Error("A rider-intelligence source is unavailable.");
  return payload;
}

export function SeasonalRoadOpenings({ plannedRoute }: SeasonalRoadOpeningsProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const groups = useMemo(
    () => state.kind === "ready" && state.roads !== null ? openingGroup(state.roads.events, new Date()) : null,
    [state],
  );

  async function loadContext(context: SearchContext): Promise<void> {
    setState({ kind: "loading", mode: context.kind });
    const routeBody = context.kind === "route"
      ? JSON.stringify({ line: context.line, bufferMiles: 15, days: 90 })
      : null;
    const roadsRequest = context.kind === "route"
      ? fetch("/api/road-openings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: routeBody!,
          cache: "no-store",
        })
      : fetch(`/api/road-openings?${new URLSearchParams({
          lat: String(context.lat),
          lon: String(context.lon),
          radiusMiles: "100",
          days: "90",
        }).toString()}`, { cache: "no-store" });
    const opportunityRequest = context.kind === "route"
      ? fetch("/api/rider-opportunities", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ line: context.line }),
          cache: "no-store",
        })
      : fetch(`/api/rider-opportunities?${new URLSearchParams({
          lat: String(context.lat),
          lon: String(context.lon),
          radiusMiles: "100",
        }).toString()}`, { cache: "no-store" });

    const [roadsResult, opportunitiesResult] = await Promise.allSettled([
      roadsRequest.then((response) => responseJson<RoadOpeningsBody | RoadOpeningsUnavailableBody>(response)),
      opportunityRequest.then((response) => responseJson<RiderOpportunitiesBody>(response)),
    ]);
    const errors: string[] = [];
    let roads: RoadOpeningsBody | null = null;
    let opportunities: RiderOpportunitiesBody | null = null;

    if (roadsResult.status === "fulfilled" && !("unavailable" in roadsResult.value)) roads = roadsResult.value;
    else errors.push(roadsResult.status === "rejected" ? "Road openings could not be checked." : roadsResult.value.reason);
    if (opportunitiesResult.status === "fulfilled") opportunities = opportunitiesResult.value;
    else errors.push("Things and places could not be checked.");

    if (roads === null && opportunities === null) {
      setState({ kind: "error", message: errors[0] ?? "Weekend intelligence is unavailable right now." });
      return;
    }
    setState({ kind: "ready", mode: context.kind, roads, opportunities, errors });
  }

  function loadNear(): void {
    if (!navigator.geolocation) {
      setState({ kind: "error", message: "Location is unavailable on this device." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadContext({ kind: "near", lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => setState({ kind: "error", message: "Location permission was not granted. You can keep browsing without it." }),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  }

  useEffect(() => {
    if (plannedRoute === undefined || plannedRoute.line.length < 2) return;
    void loadContext({ kind: "route", line: plannedRoute.line });
    // The route key changes only when the selected route changes; coordinates
    // are intentionally not a dependency because the key owns their identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedRoute?.key]);

  if (state.kind === "idle") {
    return (
      <section className="og-road-discovery">
        <p className="og-eyebrow">Weekend intelligence</p>
        <h2>What is worth riding to?</h2>
        <p>Seasonal roads, events, food/drink stops and notable rider destinations within a broad riding radius.</p>
        <button type="button" className="og-primary" onClick={loadNear}>Show weekend ideas near me</button>
      </section>
    );
  }
  if (state.kind === "loading") {
    return <p role="status">{state.mode === "route" ? "Checking your planned route for openings and stops…" : "Checking the rider radius for weekend ideas…"}</p>;
  }
  if (state.kind === "error") {
    return (
      <section className="og-road-discovery">
        <p role="alert">{state.message}</p>
        <button type="button" className="og-secondary" onClick={plannedRoute === undefined ? loadNear : () => void loadContext({ kind: "route", line: plannedRoute.line })}>Try again</button>
      </section>
    );
  }

  const roadsEmpty = state.roads !== null && state.roads.events.length === 0 && state.roads.undated.length === 0;
  return (
    <section className="og-road-discovery" aria-label="Weekend rider intelligence">
      <div className="og-road-discovery__slice-head">
        <div>
          <p className="og-eyebrow">Weekend intelligence</p>
          <h2>{state.mode === "route" ? "Along your planned ride" : "Plan around the good windows"}</h2>
        </div>
        <button
          type="button"
          className="og-secondary"
          onClick={plannedRoute !== undefined && state.mode === "route"
            ? () => void loadContext({ kind: "route", line: plannedRoute.line })
            : loadNear}
        >
          Refresh
        </button>
      </div>

      {state.errors.map((error) => <p key={error} className="og-explore__note" role="status">{error}</p>)}
      {state.opportunities === null ? null : <Opportunities data={state.opportunities} />}

      {state.roads === null ? null : (
        <>
          <section className="og-road-discovery__slice">
            <div className="og-road-discovery__slice-head">
              <div>
                <p className="og-eyebrow">Seasonal roads</p>
                <h2>Road windows</h2>
              </div>
              <span>{state.roads.events.length + state.roads.undated.length}</span>
            </div>
            {state.roads.truncated ? <p>Showing the first results in this search window. Narrow the area before treating it as complete.</p> : null}
            {roadsEmpty ? <p>No published seasonal openings were found in this search window.</p> : null}
          </section>
          {groups === null ? null : (
            <>
              <Group title="Open this weekend" events={groups.thisWeekend} data={state.roads} />
              <Group title="Open now · closes before weekend" events={groups.openNow} data={state.roads} />
              <Group title="Opening within 7 days" events={groups.soon} data={state.roads} />
              <Group title="Later" events={groups.later} data={state.roads} />
            </>
          )}
          <Undated roads={state.roads.undated} data={state.roads} />
        </>
      )}

      <p className="og-explore__intro">
        OpenGravel keeps road access separate from destination popularity. A place can be worth a stop without proving a road is legal; road access still comes from the authority feeds and is rechecked by routing.
      </p>
    </section>
  );
}
