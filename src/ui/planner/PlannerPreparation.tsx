"use client";

/**
 * The planner's route briefing (MVP parity M4, OGV-D-266): when to leave, and
 * what that means for the selected route — weather over the ride's window,
 * live traffic when leaving now, fuel range against the distance, daylight —
 * plus the offline readiness disclosure the workspace used to own.
 *
 * It owns no ride state: the departure is authored through `onDepartureChange`
 * (one `departure.set` command), and the checks are read-only projections of
 * the selected route. The weather and traffic providers are refreshed once per
 * (route, departure) pair; the selected route's traffic label is handed back
 * through `onRouteTraffic` so its card can say it too.
 */

import { useEffect, useId, useState, useSyncExternalStore } from "react";

import type { OfflineRuntimeSnapshot } from "@/application/offline/offline-runtime";
import { readBrowserOfflineRuntime } from "@/application/offline/offline-runtime";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import {
  plannerPreparationContext,
  type PlannerPreparationRoute,
} from "@/application/preparation/planner-context";
import { prepareRoute, type RoutePreparationContext } from "@/application/preparation/prepare-route";
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
import { OfflineDisclosure } from "@/ui/preparation/OfflineDisclosure";
import { RoutePreparationSection } from "@/ui/preparation/RoutePreparationSection";
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
  readonly onDepartureChange: (departure: DepartureIntent) => void;
  /** Arrive-by (NV-09): the rider's arrival, when they planned one. */
  readonly arrival?: ArrivalTarget | null;
  /** Absent where arrive-by does not apply (loops keep their time budget). */
  readonly onArrivalChange?: (arrival: ArrivalTarget | null) => void;
  readonly onBikeChange: (bike: BikeConstraintSnapshot) => void;
  readonly onRouteTraffic?: (traffic: RouteTrafficLabel | null) => void;
  readonly opportunityMap?: ExploreMapConfig | undefined;
  readonly onRouteThrough?: ((road: RoadOpeningSummary) => void | Promise<void>) | undefined;
  readonly onAddStopAt?: (coordinate: Coordinate, name: string) => void;
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
  return (
    <div className="og-prepare__bike">
      <span>Riding: {name} · {bike.fuelRangeMiles} mi range · {bike.reserveMiles} mi reserve · {Math.max(0, bike.fuelRangeMiles - bike.reserveMiles)} mi usable</span>
      {bikes.length > 1 && <label>Change bike for this ride<select aria-label="Change bike for this ride" value={bike.bikeId} onChange={(event) => {
        const selected = bikes.find((candidate) => candidate.id === event.target.value);
        if (selected !== undefined) onChange(snapshotOf(selected));
      }}>{bikes.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.fuelRangeMiles} mi range</option>)}</select></label>}
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

/** `Leaving Tue 3:40 PM` in the rider's own time zone, or `Leaving now`. */
export function departureSummary(departure: DepartureIntent, timeZone?: string): string {
  if (departure.kind === "now") return "Leaving now";
  const at = new Date(departure.at);
  if (!Number.isFinite(at.getTime())) return "Leaving now";
  return `Leaving ${at.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  })}`;
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
 * `Leave Tue 3:40 PM to arrive by 6:00 PM`, or, when that moment has passed,
 * `Leave now · arrive Tue 6:40 PM, after 6:00 PM`.
 */
export function arrivalSummary(
  arrival: ArrivalTarget,
  departure: DepartureIntent,
  late: boolean,
  durationSeconds: number,
  now: Date,
  timeZone?: string,
): string {
  const arrive = arrivalInstant(arrival);
  if (arrive === null) return departureSummary(departure, timeZone);
  const target = arrive.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  if (late) {
    const eta = new Date(now.getTime() + durationSeconds * 1000);
    return `Leave now · arrive ${clock(eta, timeZone)}, after ${target}`;
  }
  if (departure.kind !== "future") return `Arrive by ${target}`;
  return `Leave ${clock(new Date(departure.at), timeZone)} to arrive by ${target}`;
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
  onDepartureChange,
  arrival = null,
  onArrivalChange,
  onBikeChange,
  onRouteTraffic,
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
    void readBrowserOfflineRuntime({ route: offlineRoute })
      .then((snapshot) => {
        if (!cancelled) setOffline({ routeKey: offlineRouteKey, snapshot });
      })
      .catch(() => {
        // A failed observation is not a reason to manufacture readiness.
      });
    return () => {
      cancelled = true;
    };
  }, [offlineRoute, offlineRouteKey]);
  const offlineSnapshot = offline?.routeKey === offlineRouteKey ? offline.snapshot : null;

  const current = briefing !== null && briefing.key === briefingKey ? briefing : null;
  const preparation = current === null ? null : prepareRoute({ ...current.context, providers: providers ?? {} });
  const glance = preparation === null ? [] : glanceParts(preparation);

  return (
    <>
      {/* FT-03: weather and fuel in one line under Start, without opening anything. */}
      {route === null || glance.length === 0 ? null : (
        <p className="og-prepare__glance" data-testid="prepare-glance">
          {glance.join(" · ")}
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
            <span className="og-composer__label">Before you ride</span>
            <span className="og-prepare__summary" data-testid="departure-summary">
              {arrival !== null && route !== null
                ? arrivalSummary(
                    arrival,
                    effectiveDeparture,
                    current?.late ?? false,
                    route.durationSeconds,
                    new Date(current?.now ?? 0),
                    timeZone,
                  )
                : departureSummary(departure, timeZone)}
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
            <RoutePreparationSection preparation={preparation ?? prepareRoute({ ...current.context, providers: providers ?? {} })} />
          )}
          <PlannerFuelAlong
            route={route === null ? null : { routeId: route.routeId, geometry: route.geometry }}
            source={providers?.mapLayers}
            usableRangeMiles={Number.isFinite(bike.fuelRangeMiles) ? Math.max(0, bike.fuelRangeMiles - bike.reserveMiles) : null}
            onAddStop={onAddStopAt}
          />

        </details>
      )}

      <PlannerAlongOpportunities route={route} departure={effectiveDeparture} onAddStop={onAddStopAt} onRouteThrough={onRouteThrough} map={opportunityMap} />

      {/* Nothing to be offline-ready for until there is a route. */}
      {route === null ? null : (
      <details className="og-offline-details">
        {/* Offline region downloads are cut for the MVP (parity row 26): say so
            in the one line a rider sees, not only inside the disclosure. */}
        <summary data-testid="offline-toggle">
          Offline readiness <span className="og-offline-details__note">· online only for now</span>
        </summary>
        {offlineSnapshot === null ? (
          <p className="og-offline__readiness" data-testid="offline-checking" role="status">
            Checking offline availability…
          </p>
        ) : (
          <OfflineDisclosure
            matrix={offlineSnapshot.matrix}
            readiness={offlineSnapshot.readiness}
            packPresence={offlineRoute === null ? undefined : "not-present"}
          />
        )}
      </details>
      )}
    </>
  );
}

/** The briefing's verdicts a rider needs before Start, in a few words each (FT-03). */
function glanceParts(preparation: ReturnType<typeof prepareRoute>): readonly string[] {
  const ready = (kind: string) => preparation.items.find((item) => item.kind === kind && item.state === "ready");
  const parts: string[] = [];
  const weather = ready("weather");
  const weatherData = weather?.data;
  if (typeof weatherData === "object" && weatherData !== null && "display" in weatherData && typeof weatherData.display === "string") {
    parts.push(weatherData.display);
  }
  const fuel = ready("fuel");
  if (fuel !== undefined) parts.push(/does not cover/.test(fuel.reason) ? "Fuel stop needed" : "Range covers it");
  const daylight = ready("daylight");
  if (daylight !== undefined && /after sunset/.test(daylight.reason)) parts.push("Ends after sunset");
  return parts;
}
