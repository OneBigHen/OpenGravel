"use client";

/**
 * The planner's route briefing (MVP parity M4, OGV-D-266): when to leave, and
 * what that means for the selected route — weather over the ride's window,
 * heavy traffic when leaving now, fuel against the distance, daylight — plus
 * the offline readiness disclosure the workspace used to own. What could not
 * be checked is left out rather than listed.
 *
 * It owns no ride state: the departure is authored through `onDepartureChange`
 * (one `departure.set` command), and the checks are read-only projections of
 * the selected route. The weather and traffic providers are refreshed once per
 * (route, departure) pair; the selected route's traffic label is handed back
 * through `onRouteTraffic` so its card can say it too.
 */

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";

import type { OfflineRuntimeSnapshot } from "@/application/offline/offline-runtime";
import type { OfflineRegionsPort } from "@/application/offline/offline-regions";
import { useInstalledOfflineAreas } from "@/ui/planner/installed-offline-areas";
import { readBrowserOfflineRuntime } from "@/application/offline/offline-runtime";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import {
  plannerPreparationContext,
  type PlannerPreparationRoute,
} from "@/application/preparation/planner-context";
import { prepareRoute, type RoutePreparationContext } from "@/application/preparation/prepare-route";
import { daylightLine } from "@/application/preparation/daylight-line";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import type { BikeConstraintSnapshot, Coordinate, DepartureIntent } from "@/domain/ride/types";
import {
  arrivalFromInput,
  arrivalInputValue,
  arrivalInstant,
  arrivalIsLate,
  departureForArrival,
  type ArrivalTarget,
} from "@/application/planner/arrive-by";
import { snapshotOf, type BikeProfile } from "@/application/garage/garage-model";
import {
  RoutePreparationSection,
  stalenessNote,
  trafficWarning,
  WEATHER_SOURCE_CREDIT,
} from "@/ui/preparation/RoutePreparationSection";
import { PlannerAlongOpportunities } from "@/ui/planner/PlannerAlongOpportunities";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";
import { PlannerFuelAlong } from "@/ui/planner/PlannerFuelAlong";

export interface RouteTrafficLabel {
  readonly routeId: string;
  readonly label: string;
}

export interface PlannerPreparationProps {
  readonly route: (PlannerPreparationRoute & { readonly routeId: string }) | null;
  readonly departure: DepartureIntent;
  readonly bike: BikeConstraintSnapshot;
  readonly bikes?: readonly BikeProfile[];
  readonly providers?: PreparationProviderRegistry;
  readonly offlineRoute: SelectedOfflineRoute | null;
  /**
   * The downloaded areas on this device, so the summary describes this phone
   * rather than a build-time assumption. Defaults to the composition root's
   * provider; absent leaves that unknown.
   */
  readonly offlineRegions?: Pick<OfflineRegionsPort, "installed"> | undefined;
  readonly onDepartureChange: (departure: DepartureIntent) => void;
  /** Arrive-by (NV-09): the rider's arrival, when they planned one. */
  readonly arrival?: ArrivalTarget | null;
  /** Absent where arrive-by does not apply (loops keep their time budget). */
  readonly onArrivalChange?: (arrival: ArrivalTarget | null) => void;
  readonly onBikeChange: (bike: BikeConstraintSnapshot) => void;
  readonly onWeatherLine?: (line: string | null) => void;
  readonly onRouteTraffic?: (traffic: RouteTrafficLabel | null) => void;
  readonly opportunityMap?: ExploreMapConfig | undefined;
  readonly onRouteThrough?: ((road: RoadOpeningSummary) => void | Promise<void>) | undefined;
  readonly onAddStopAt?: (coordinate: Coordinate, name: string) => void;
}

/** What the ride can use before the reserve, in whole miles; `null` when unknown. */
function usableRangeMiles(bike: Pick<BikeConstraintSnapshot, "fuelRangeMiles" | "reserveMiles">): number | null {
  if (!Number.isFinite(bike.fuelRangeMiles)) return null;
  const reserve = Number.isFinite(bike.reserveMiles) ? bike.reserveMiles : 0;
  return Math.max(0, Math.round(bike.fuelRangeMiles - reserve));
}

export function RideBikeControl({
  bike,
  bikes,
  onChange,
}: {
  readonly bike: BikeConstraintSnapshot;
  readonly bikes: readonly BikeProfile[];
  readonly onChange: (bike: BikeConstraintSnapshot) => void;
}) {
  const profile = bikes.find((candidate) => candidate.id === bike.bikeId);
  const name = profile?.name ?? "Saved bike";
  // The range that matters is what the ride can use before the reserve: the
  // tank is already read out against the route by the fuel line below.
  const usable = usableRangeMiles(bike);
  return (
    <div className="og-prepare__bike">
      <span>{name}{usable === null ? "" : ` · ${usable} mi range`}</span>
      {bikes.length > 1 && <label>Change bike for this ride<select aria-label="Change bike for this ride" value={bike.bikeId} onChange={(event) => {
        const selected = bikes.find((candidate) => candidate.id === event.target.value);
        if (selected !== undefined) onChange(snapshotOf(selected));
      }}>{bikes.map((candidate) => {
        const range = usableRangeMiles(candidate);
        return <option value={candidate.id} key={candidate.id}>{candidate.name}{range === null ? "" : ` · ${range} mi range`}</option>;
      })}</select></label>}
    </div>
  );
}

/** The quick departures a rider picks from; `custom` opens a time field. */
type DepartureChoice = "now" | "in-1h" | "in-3h" | "tomorrow-8" | "custom" | "arrive";

type QuickChoice = Exclude<DepartureChoice, "custom" | "arrive">;

const DEPARTURE_LABELS: Readonly<Record<QuickChoice, string>> = {
  now: "Now",
  "in-1h": "In 1 h",
  "in-3h": "In 3 h",
  "tomorrow-8": "Tomorrow 8 AM",
};

/** The instant a quick choice means, from the moment it was picked. */
export function departureFor(choice: QuickChoice, from: Date): DepartureIntent {
  switch (choice) {
    case "now":
      return { kind: "now" };
    case "in-1h":
      return { kind: "future", at: new Date(from.getTime() + 3_600_000).toISOString() };
    case "in-3h":
      return { kind: "future", at: new Date(from.getTime() + 3 * 3_600_000).toISOString() };
    case "tomorrow-8": {
      const tomorrow = new Date(from);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      return { kind: "future", at: tomorrow.toISOString() };
    }
  }
}

/** `Now`, or `Sun 11:00 AM`: the value beside the row's "Leaving" label. */
export function departureValue(departure: DepartureIntent, timeZone?: string): string {
  if (departure.kind === "now") return "Now";
  const at = new Date(departure.at);
  if (!Number.isFinite(at.getTime())) return "Now";
  return clock(at, timeZone);
}

function clock(at: Date, timeZone?: string): string {
  return at.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
}

/**
 * The departure row's value when an arrival time is authoritative:
 * `Sun 4:30 PM to arrive by 6:00 PM`, `Now · arrive by 6:00 PM`, or, when that
 * moment has already passed, `Now · arrive Sun 6:40 PM, after 6:00 PM`. The
 * label beside it is "Leaving", so every value reads as one clause.
 */
export function arrivalValue(
  arrival: ArrivalTarget,
  departure: DepartureIntent,
  late: boolean,
  durationSeconds: number,
  now: Date,
  timeZone?: string,
): string {
  const arrive = arrivalInstant(arrival);
  if (arrive === null) return departureValue(departure, timeZone);
  const target = arrive.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  if (late) {
    const eta = new Date(now.getTime() + durationSeconds * 1000);
    return `Now · arrive ${clock(eta, timeZone)}, after ${target}`;
  }
  if (departure.kind !== "future") return `Now · arrive by ${target}`;
  return `${clock(new Date(departure.at), timeZone)} to arrive by ${target}`;
}

/** `YYYY-MM-DDTHH:mm` in local time, the value a `datetime-local` field holds. */
function localInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Matches the CSS: the side-by-side layout, which short landscape also uses. */
const WIDE_QUERY = "(min-width: 1181px), (orientation: landscape) and (max-height: 500px) and (min-width: 560px)";

/** `null` where the platform has no media queries (older engines, jsdom). */
function wideQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null;
}

function subscribeToWidth(onChange: () => void): () => void {
  const query = wideQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function DepartureRow({
  departure,
  onChange,
  arrival,
  onArrivalChange,
}: {
  readonly departure: DepartureIntent;
  readonly onChange: (departure: DepartureIntent) => void;
  readonly arrival: ArrivalTarget | null;
  readonly onArrivalChange?: (arrival: ArrivalTarget | null) => void;
}) {
  const name = useId();
  // The quick choice the rider last made; the authored departure is the truth,
  // so an undo back to "now" shows "Now" whatever was picked before.
  const [choice, setChoice] = useState<DepartureChoice | null>(null);
  const effective: DepartureChoice =
    arrival !== null && onArrivalChange !== undefined
      ? "arrive"
      : choice === "custom" || choice === "arrive"
      ? choice
      : departure.kind === "now"
        ? "now"
        : choice !== null && choice !== "now"
          ? choice
          : "custom";
  const leaveInstead = (): void => {
    if (arrival !== null) onArrivalChange?.(null);
  };
  const pick = (next: QuickChoice): void => {
    setChoice(next);
    leaveInstead();
    onChange(departureFor(next, new Date()));
  };
  return (
    <fieldset className="og-prepare__departure" data-testid="departure">
      <legend className="og-composer__label">Leave</legend>
      <div className="og-style__chips">
        {(Object.keys(DEPARTURE_LABELS) as QuickChoice[]).map((option) => (
          <label key={option} className="og-style__chip">
            <input
              type="radio"
              name={name}
              checked={effective === option}
              onChange={() => pick(option)}
              data-testid={`departure-${option}`}
            />
            <span>{DEPARTURE_LABELS[option]}</span>
          </label>
        ))}
        <label className="og-style__chip">
          <input
            type="radio"
            name={name}
            checked={effective === "custom"}
            onChange={() => {
              setChoice("custom");
              leaveInstead();
            }}
            data-testid="departure-custom"
          />
          <span>Pick a time</span>
        </label>
        {onArrivalChange === undefined ? null : (
          <label className="og-style__chip">
            <input
              type="radio"
              name={name}
              checked={effective === "arrive"}
              onChange={() => setChoice("arrive")}
              data-testid="departure-arrive"
            />
            <span>Arrive by</span>
          </label>
        )}
      </div>
      {effective === "arrive" ? (
        <input
          type="datetime-local"
          className="og-prepare__time"
          aria-label="Arrival time"
          data-testid="arrival-time"
          value={arrival === null ? "" : arrivalInputValue(arrival)}
          onChange={(event) => {
            const next = arrivalFromInput(event.target.value);
            if (next !== null) onArrivalChange?.(next);
          }}
        />
      ) : null}
      {effective === "custom" ? (
        <input
          type="datetime-local"
          className="og-prepare__time"
          aria-label="Departure time"
          data-testid="departure-time"
          value={departure.kind === "future" ? localInputValue(departure.at) : ""}
          onChange={(event) => {
            const at = new Date(event.target.value);
            if (Number.isFinite(at.getTime())) onChange({ kind: "future", at: at.toISOString() });
          }}
        />
      ) : null}
    </fieldset>
  );
}

export function PlannerPreparation({
  route,
  departure,
  bike,
  bikes = [],
  providers,
  offlineRoute,
  offlineRegions: offlineRegionsProp,
  onDepartureChange,
  arrival = null,
  onArrivalChange,
  onBikeChange,
  onRouteTraffic,
  onWeatherLine,
  onAddStopAt,
  onRouteThrough,
  opportunityMap,
}: PlannerPreparationProps) {
  const wide = useSyncExternalStore(
    subscribeToWidth,
    () => wideQuery()?.matches ?? false,
    () => false,
  );
  const timeZone = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    () => undefined,
  );
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? wide;

  // Arrive-by: the departure follows from the chosen route's time (NV-09).
  const arrivalDeparture =
    arrival === null || route === null ? null : departureForArrival(arrival, route.durationSeconds);
  const effectiveDeparture = arrivalDeparture ?? departure;
  const briefingKey =
    route === null ? null : `${route.routeId}|${JSON.stringify(effectiveDeparture)}`;
  const [briefing, setBriefing] = useState<{
    readonly key: string;
    readonly context: RoutePreparationContext;
    /** Arrive-by only: leaving now already misses the arrival. */
    readonly late: boolean;
    readonly now: string;
  } | null>(null);
  const [offline, setOffline] = useState<{
    readonly routeKey: string;
    readonly snapshot: OfflineRuntimeSnapshot;
  } | null>(null);
  const offlineRouteKey = offlineRoute?.routeKey ?? "none";
  const providedOfflineRegions = useInstalledOfflineAreas();
  const offlineRegions = offlineRegionsProp ?? providedOfflineRegions;

  // One refresh per (route, departure): weather for the ride's window, and
  // live traffic when the ride leaves now. The context is computed here, not
  // in render, because it reads the clock.
  useEffect(() => {
    if (route === null || briefingKey === null) {
      onRouteTraffic?.(null);
      return;
    }
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const late =
      arrival !== null && arrivalDeparture !== null && arrivalIsLate(arrival, route.durationSeconds, nowDate);
    // A departure already behind us is a ride that leaves now.
    const briefDeparture: DepartureIntent =
      arrivalDeparture?.kind === "future" && Date.parse(arrivalDeparture.at) <= nowDate.getTime()
        ? { kind: "now" }
        : effectiveDeparture;
    const context = plannerPreparationContext({
      route,
      departure: briefDeparture,
      bike,
      now,
      ...(timeZone === undefined ? {} : { riderTimeZone: timeZone }),
    });
    let active = true;
    const weather = providers?.weather?.refresh?.(context) ?? Promise.resolve(null);
    const traffic =
      context.trafficCorridor === undefined
        ? Promise.resolve(null)
        : (providers?.traffic?.refresh?.(context) ?? Promise.resolve(null));
    void Promise.allSettled([weather, traffic]).then(([, trafficResult]) => {
      if (!active) return;
      setBriefing({ key: briefingKey, context, late, now });
      const result = trafficResult.status === "fulfilled" ? trafficResult.value : null;
      const display =
        result !== null && result.state === "ready" && typeof result.data?.display === "string"
          ? result.data.display
          : null;
      onRouteTraffic?.(display === null ? null : { routeId: route.routeId, label: display });
    });
    return () => {
      active = false;
    };
    // `route` is identified by its key; its geometry never changes under one id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefingKey, providers, bike, timeZone]);

  useEffect(() => {
    let cancelled = false;
    const installedAreas = offlineRegions === undefined
      ? Promise.resolve<number | null>(null)
      : offlineRegions.installed().then(
          (areas) => areas.length,
          () => null,
        );
    void installedAreas
      .then((count) => readBrowserOfflineRuntime({ route: offlineRoute, installedAreas: count }))
      .then((snapshot) => {
        if (!cancelled) setOffline({ routeKey: offlineRouteKey, snapshot });
      })
      .catch(() => {
        // A failed observation is not a reason to manufacture readiness.
      });
    return () => {
      cancelled = true;
    };
  }, [offlineRoute, offlineRouteKey, offlineRegions]);
  const offlineSnapshot = offline?.routeKey === offlineRouteKey ? offline.snapshot : null;

  const current = briefing !== null && briefing.key === briefingKey ? briefing : null;
  const preparation = current === null ? null : prepareRoute({ ...current.context, providers: providers ?? {} });
  const glance = preparation === null || current === null ? [] : glanceParts(preparation, current.context);
  const weatherShown = preparation !== null
    && preparation.items.some((item) => item.kind === "weather" && item.state !== "unavailable");

  const weatherItem = preparation?.items.find((item) => item.kind === "weather");
  const weatherData = weatherItem?.data as import("@/application/preparation/providers").WeatherData | undefined;
  const warningWeather = weatherData !== undefined && (
    (weatherData.tripAlerts?.length ?? weatherData.alerts?.length ?? 0) > 0 ||
    (weatherData.maxPrecipChance ?? 0) >= 30 || (weatherData.maxWindMph ?? 0) >= 20 ||
    /rain|snow|storm|ice|freez|fog/i.test(weatherData.display)
  ) ? weatherData.display : null;
  useEffect(() => { onWeatherLine?.(warningWeather); }, [onWeatherLine, warningWeather]);

  return (
    <>
      {/* FT-03: the ride's conditions in one line under Start, without opening
          anything. The checks below do not repeat it. */}
      {route === null || glance.length === 0 ? null : (
        <p className="og-prepare__glance" data-testid="prepare-glance">
          {glance.join(" · ")}
        </p>
      )}
      {/* A US forecast is the National Weather Service's work: one small credit,
          no update stamp or provider sentence in the rider's way. */}
      {route === null || !weatherShown ? null : (
        <p className="og-prepare__credit" data-testid="prepare-weather-credit">
          {WEATHER_SOURCE_CREDIT}
        </p>
      )}
      {route === null ? null : (
        <details
          className="og-prepare"
          data-testid="prepare"
          open={open}
          onToggle={(event) => setUserOpen(event.currentTarget.open)}
        >
          <summary className="og-prepare__head" data-testid="prepare-toggle">
            <span className="og-prepare__label">Leaving</span>
            <span className="og-prepare__summary" data-testid="departure-summary">
              {arrival !== null && route !== null
                ? arrivalValue(
                    arrival,
                    effectiveDeparture,
                    current?.late ?? false,
                    route.durationSeconds,
                    new Date(current?.now ?? 0),
                    timeZone,
                  )
                : departureValue(departure, timeZone)}
            </span>
          </summary>
          <DepartureRow
            departure={departure}
            onChange={onDepartureChange}
            arrival={onArrivalChange === undefined ? null : arrival}
            onArrivalChange={onArrivalChange}
          />
          <RideBikeControl bike={bike} bikes={bikes} onChange={onBikeChange} />
          {current === null ? (
            <p className="og-prepare__checking" role="status" data-testid="prepare-checking">
              Checking weather and traffic for this ride…
            </p>
          ) : (
            /* Weather and daylight are the one line above; the disclosure's own
               summary is the "Before you ride" heading. */
            <RoutePreparationSection
              preparation={preparation ?? prepareRoute({ ...current.context, providers: providers ?? {} })}
              omit={["weather", "daylight"]}
              heading={false}
            />
          )}
          <PlannerFuelAlong
            route={route === null ? null : { routeId: route.routeId, geometry: route.geometry }}
            source={providers?.mapLayers}
            usableRangeMiles={Number.isFinite(bike.fuelRangeMiles) ? Math.max(0, bike.fuelRangeMiles - bike.reserveMiles) : null}
            onAddStop={onAddStopAt}
          />

        </details>
      )}

      <PlannerAlongOpportunities route={route} departure={effectiveDeparture} source={providers?.mapLayers} onAddStop={onAddStopAt} onRouteThrough={onRouteThrough} map={opportunityMap} />

      {/* Downloading an area is a real action in Settings, so the sheet offers
          it as one plain row — and only while this phone really holds no area.
          With an area already saved the ride simply works offline, and with
          the download state unknown there is nothing honest to say. */}
      {route === null || offlineSnapshot === null || offlineSnapshot.installedAreas !== 0 ? null : (
        <Link className="og-prepare__row" data-testid="offline-save-area" href="/settings#settings-offline-title">
          <span className="og-prepare__row-label">Save this area for offline</span>
          <span className="og-prepare__chevron" aria-hidden="true">›</span>
        </Link>
      )}
    </>
  );
}

/**
 * The briefing's verdicts a rider needs before Start, in a few words each
 * (FT-03): the weather over the ride, when the light comes or goes, and a
 * delay worth changing the plan for. Everything else stays out of the line.
 */
function glanceParts(
  preparation: ReturnType<typeof prepareRoute>,
  context: RoutePreparationContext,
): readonly string[] {
  const parts: string[] = [];
  // Traffic only when it is worth changing the plan for; a checked-and-quiet
  // route says nothing here.
  const traffic = trafficWarning(preparation.items);
  if (traffic !== null) parts.push(traffic);
  const weather = preparation.items.find(
    (item) => item.kind === "weather" && (item.state === "ready" || item.state === "stale"),
  );
  const weatherData = weather?.data;
  if (typeof weatherData === "object" && weatherData !== null && "display" in weatherData && typeof weatherData.display === "string") {
    parts.push(weatherData.display);
    // An old forecast says so in words instead of wearing a "Stale" chip.
    const stale = weather === undefined ? null : stalenessNote(weather);
    if (stale !== null) parts.push(stale);
  }
  const daylight = daylightLine(context);
  if (daylight !== null) parts.push(daylight);
  return parts;
}
