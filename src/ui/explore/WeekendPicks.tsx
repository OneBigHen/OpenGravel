"use client";

/**
 * "Near you this weekend" (R3-8): up to three rides a rider can reach from
 * where they are standing, in one sideways-scrolling row on a phone.
 *
 * The picks themselves, their order, the mix rule and every weather phrase are
 * decided in `application/explore/weekend-picks`, never here. This component
 * owns the one network job the strip needs: a forecast for each card's start,
 * asked once per visit and shared when two cards start in the same place.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { staticRouteMapUrl } from "@/application/map/static-map";
import type { CatalogEntry } from "@/application/explore/catalog";
import type { WeatherSnapshot } from "@/application/preparation/providers";
import {
  localDayKey,
  weekendDayPlan,
  weekendPicks,
  weekendStripTitle,
  type WeekendPick,
  type WeekendPickBike,
  type WeekendPickForecastDay,
} from "@/application/explore/weekend-picks";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";
import { rememberListPosition } from "@/ui/explore/list-position";
import { awayLabel } from "@/ui/explore/rider-distance";
import { RouteLinePreview } from "@/ui/explore/RouteLinePreview";
import { RideCardFacts } from "@/ui/explore/RideCardFacts";

import "./weekend-picks.css";

export interface WeekendPicksProps {
  readonly entries: readonly CatalogEntry[];
  /** The rider's position as `[lon, lat]`; absent means no strip at all. */
  readonly origin?: readonly [number, number] | undefined;
  readonly bike?: WeekendPickBike | null | undefined;
  /** Routes the rider asked Explore not to show. */
  readonly hiddenIds?: ReadonlySet<string> | undefined;
  readonly mapboxToken?: string | undefined;
}

/** At most this many forecast requests per Explore visit, whatever the rider does. */
const MAX_REQUESTS = 3;

/** Rounded like the conditions chip, so panning a street does not refetch. */
function startKey(entry: CatalogEntry): string | null {
  const start = entry.geometry[0];
  if (start === undefined) return null;
  return `${Math.round(start.lat * 10) / 10},${Math.round(start.lon * 10) / 10}`;
}

function PickPreview({ entry, mapboxToken, night }: {
  readonly entry: CatalogEntry;
  readonly mapboxToken?: string | undefined;
  readonly night: boolean;
}) {
  const mapUrl = mapboxToken === undefined
    ? null
    : staticRouteMapUrl(entry.previewGeometry ?? entry.geometry, { token: mapboxToken, width: 320, height: 200, night });
  if (mapUrl !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote static map, sized by CSS; next/image would proxy it.
      <img
        className="og-weekend-card__map"
        src={mapUrl}
        alt={`${entry.name} on a map`}
        loading="lazy"
        decoding="async"
        width={320}
        height={200}
      />
    );
  }
  const line = entry.previewGeometry ?? entry.geometry;
  if (line.length >= 2) {
    return <RouteLinePreview line={line} name={entry.name} className="og-weekend-card__map og-weekend-card__map--line" />;
  }
  return (
    <div className="og-weekend-card__map og-weekend-card__map--missing" role="img" aria-label={`${entry.name} map preview unavailable`}>
      <span aria-hidden="true">⌖</span>
    </div>
  );
}

function PickCard({ pick, mapboxToken, night }: {
  readonly pick: WeekendPick;
  readonly mapboxToken?: string | undefined;
  readonly night: boolean;
}) {
  const away = awayLabel(pick.distanceKm);
  return (
    <li className="og-weekend__card" data-testid="weekend-pick">
      <Link
        className="og-weekend-card"
        href={`/explore/${encodeURIComponent(pick.entry.id)}`}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          rememberListPosition(window.scrollY);
        }}
      >
        <PickPreview entry={pick.entry} mapboxToken={mapboxToken} night={night} />
        <span className="og-weekend-card__body">
          <strong className="og-weekend-card__title">{pick.entry.name}</strong>
          <RideCardFacts entry={pick.entry} className="og-weekend-card__facts" />
          <span className="og-weekend-card__weather" data-testid="weekend-pick-weather">
            {pick.weather.map((phrase, index) => <span key={`${index}-${phrase}`}>{phrase}</span>)}
          </span>
          {away === null ? null : <span className="og-weekend-card__away">{away}</span>}
        </span>
      </Link>
    </li>
  );
}

export function WeekendPicks({ entries, origin, bike, hiddenIds, mapboxToken }: WeekendPicksProps) {
  const [now] = useState(() => new Date());
  const night = useResolvedTheme() === "night";
  const plan = useMemo(() => weekendDayPlan(now), [now]);
  const title = useMemo(() => weekendStripTitle(now), [now]);
  const dayLabels = useMemo(() => plan.map((day) => day.label), [plan]);
  /** Fetch each card start once per visit, even when the position changes. */
  const requested = useRef(new Set<string>());
  const [forecasts, setForecasts] = useState<ReadonlyMap<string, readonly WeekendPickForecastDay[]>>(
    () => new Map<string, readonly WeekendPickForecastDay[]>(),
  );

  /** When the Weather Service answer was read, so the rider can judge its age. */
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const basePicks = useMemo(
    () => weekendPicks({
      entries,
      dayLabels,
      ...(origin === undefined ? {} : { position: origin }),
      ...(bike === undefined || bike === null ? {} : { bike }),
      ...(hiddenIds === undefined ? {} : { hiddenIds }),
    }),
    [bike, dayLabels, entries, hiddenIds, origin],
  );

  const controllers = useRef<AbortController[]>([]);
  // Leaving Explore stops the requests and ends the visit; a new visit asks again.
  useEffect(() => () => {
    for (const controller of controllers.current) controller.abort();
    controllers.current = [];
    requested.current.clear();
  }, []);

  useEffect(() => {
    if (basePicks === null) return;
    // One request per distinct start; the answer serves every card that starts there.
    const idsByKey = new Map<string, string[]>();
    for (const pick of basePicks) {
      const key = startKey(pick.entry);
      if (key === null) continue;
      idsByKey.set(key, [...(idsByKey.get(key) ?? []), pick.entry.id]);
    }
    for (const [key, ids] of idsByKey) {
      if (requested.current.has(key) || requested.current.size >= MAX_REQUESTS) continue;
      requested.current.add(key);
      const controller = new AbortController();
      controllers.current.push(controller);
      const [lat, lon] = key.split(",");
      void fetch(`/api/weather?lat=${lat}&lon=${lon}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { readonly snapshot?: WeatherSnapshot } | null) => {
          if (controller.signal.aborted) return;
          const snapshot = body?.snapshot;
          if (snapshot === undefined || !Array.isArray(snapshot.forecast)) return;
          const days = plan.map((day) => ({
            label: day.label,
            periods: snapshot.forecast.filter((period) => localDayKey(new Date(period.startTime)) === day.dayKey),
          }));
          setFetchedAt((previous) => previous ?? snapshot.fetchedAt);
          setForecasts((previous) => {
            const next = new Map(previous);
            for (const id of ids) next.set(id, days);
            return next;
          });
        })
        .catch(() => undefined);
    }
  }, [basePicks, plan]);

  const picks = useMemo(
    () => weekendPicks({
      entries,
      dayLabels,
      forecasts,
      ...(origin === undefined ? {} : { position: origin }),
      ...(bike === undefined || bike === null ? {} : { bike }),
      ...(hiddenIds === undefined ? {} : { hiddenIds }),
    }),
    [bike, dayLabels, entries, forecasts, hiddenIds, origin],
  );

  const readAt = fetchedAt === null || !Number.isFinite(Date.parse(fetchedAt))
    ? ""
    : new Date(fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // No position, no strip. Nothing else on the page depends on this.
  if (picks === null || picks.length === 0) return null;

  return (
    <section className="og-weekend" data-testid="weekend-picks" aria-labelledby="weekend-picks-title">
      <div className="og-weekend__head">
        <h2 id="weekend-picks-title">{title}</h2>
        <span className="og-weekend__count">{picks.length} {picks.length === 1 ? "ride" : "rides"}</span>
      </div>
      <ul className="og-weekend__row" aria-label={title}>
        {picks.map((pick) => (
          <PickCard key={pick.entry.id} pick={pick} mapboxToken={mapboxToken} night={night} />
        ))}
      </ul>
      {readAt === "" ? null : <p className="og-weekend__read" data-testid="weekend-forecast-read">Forecast read at {readAt}</p>}
    </section>
  );
}
