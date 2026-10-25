"use client";

import { useState } from "react";

import type {
  RoutePreparation,
  RoutePreparationItem,
} from "@/application/preparation/prepare-route";
import type { Consideration } from "@/application/long-trip";
import { OfflineDisclosure, type OfflineDisclosureProps } from "./OfflineDisclosure";

export interface RoutePreparationSectionProps {
  readonly preparation: RoutePreparation;
  readonly offline?: OfflineDisclosureProps;
  /**
   * Checks that already have their own line above this list (the planner's one
   * line under Start), so the rider never reads the same fact twice.
   */
  readonly omit?: readonly RoutePreparationItem["kind"][];
  /**
   * The disclosure holding this section already says "Before you ride"; the
   * planner turns the heading off so the rider sees the name once.
   */
  readonly heading?: boolean;
  /**
   * `brief` is the route page on a phone: the rider is about to ride, so it is
   * one line of weather at the start and a warning only when it would change
   * the plan. No per-check rows, state badges or provenance. `full` is the
   * planner's briefing.
   */
  readonly variant?: "full" | "brief";
}

/**
 * The one credit a weather statement carries. The rider does not need the
 * provider's update stamp on a one-line brief, but a US forecast is the
 * National Weather Service's work and says so.
 */
export const WEATHER_SOURCE_CREDIT = "Weather from the National Weather Service";

const LABELS: Readonly<Record<RoutePreparationItem["kind"], string>> = {
  weather: "Weather",
  traffic: "Traffic",
  fuel: "Fuel",
  daylight: "Daylight",
  "offline-route": "Offline route",
  lodging: "Lodging",
  service: "Service",
  elevation: "Elevation",
  "route-character": "Route character",
  surface: "Surface",
  warnings: "Key warnings",
};

const MAX_DEFAULT_ITEMS = 3;

const CONSIDERATION_LABELS: Readonly<Record<Consideration["kind"], string>> = {
  fuel: "Fuel",
  daylight: "Daylight",
  weather: "Weather",
  lodging: "Lodging",
  service: "Service",
};

/**
 * A delay this long is worth changing the plan for; anything shorter is noise
 * on a backroads ride that already has the rider's attention.
 */
export const TRAFFIC_WARNING_MINUTES = 10;

/**
 * The one line traffic earns, or `null` when it says nothing a rider should act
 * on. A closure always counts; a small delay and an unchecked route do not — an
 * unknown route is not a quiet one, it is simply not shown.
 */
export function trafficWarning(items: readonly RoutePreparationItem[]): string | null {
  const item = items.find((candidate) => candidate.kind === "traffic");
  if (item === undefined) return null;
  const data = objectData(item);
  if (data === null) return null;
  if (data["roadClosure"] === true) return "Road closure reported on this route";
  // A delay band older than its freshness window no longer speaks for today.
  if (item.state !== "ready") return null;
  const band = data["delayBand"];
  const maxMinutes = typeof band === "object" && band !== null
    ? (band as { readonly maxMinutes?: unknown }).maxMinutes
    : null;
  if (typeof maxMinutes !== "number" || !Number.isFinite(maxMinutes) || maxMinutes < TRAFFIC_WARNING_MINUTES) {
    return null;
  }
  return typeof data["display"] === "string" ? data["display"] : `+${Math.round(maxMinutes)} min in traffic`;
}

function displayValue(item: RoutePreparationItem): string {
  const data = item.data;
  if (typeof data === "string" || typeof data === "number") return String(data);
  if (data !== undefined && typeof data.display === "string") return data.display;
  return "—";
}

function objectData(item: RoutePreparationItem): Record<string, unknown> | null {
  return item.data !== undefined && typeof item.data === "object" && item.data !== null
    ? item.data as Record<string, unknown>
    : null;
}

const STALE_NOUNS: Partial<Record<RoutePreparationItem["kind"], string>> = {
  weather: "Forecast",
};

/** `25 min`, `3 h`: how old a reading is, in the terms a rider checks a clock by. */
function ageWords(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  return `${Math.round(rounded / 60)} h`;
}

/**
 * What an old reading means, in words, or `null` when the reading is current.
 *
 * A "Stale" chip names a state and leaves the rider to work out whether it
 * matters; "Forecast is 3 h old" is the fact itself.
 */
export function stalenessNote(item: RoutePreparationItem): string | null {
  if (item.state !== "stale") return null;
  const noun = STALE_NOUNS[item.kind] ?? LABELS[item.kind];
  const age = objectData(item)?.["ageMinutes"];
  return typeof age === "number" && Number.isFinite(age) && age >= 0
    ? `${noun} is ${ageWords(age)} old`
    : `${noun} is out of date`;
}

/**
 * The weather at the start in one line, and only when there is something to
 * say: a forecast past its freshness window is silence here, because "Stale"
 * on a chip tells a rider nothing they can ride on, and a missing forecast must
 * never read as clear.
 *
 * A weather alert is the exception: its own text carries the age ("updated 12
 * min ago"), so it is shown even when the forecast behind it is stale.
 */
export function weatherLine(items: readonly RoutePreparationItem[]): string | null {
  const item = items.find((candidate) => candidate.kind === "weather");
  if (item === undefined) return null;
  const data = objectData(item);
  const alerts = Array.isArray(data?.["alerts"]) ? (data["alerts"] as readonly unknown[]) : [];
  const isAlert = data?.["primaryAlert"] !== undefined || alerts.length > 0;
  if (item.state !== "ready" && !isAlert) return null;
  const display = data?.["display"];
  if (typeof display !== "string" || display.trim() === "") return null;
  // An alert, or a sentence about the ride window, already says what it is
  // about; only a plain condition is the one measured where the ride starts.
  const readsAsCondition = !isAlert && !/[.!]$/.test(display.trim());
  return readsAsCondition ? `${display} at the start` : display;
}

function PreparationRow({ item }: { readonly item: RoutePreparationItem }) {
  const note = stalenessNote(item);
  return (
    <div className="og-preparation__row">
      <dt>{LABELS[item.kind]}</dt>
      <dd>
        <span className="og-preparation__value" data-testid={`preparation-value-${item.kind}`}>
          {displayValue(item)}
        </span>
        {note === null ? null : <span className="og-preparation__note">{note}</span>}
      </dd>
    </div>
  );
}

function ConsiderationList({ items }: { readonly items: readonly Consideration[] }) {
  if (items.length === 0) return null;
  return (
    <details className="og-preparation__considerations" open aria-label="Long-trip considerations">
      <summary>Long-trip considerations</summary>
      <ul className="og-preparation__consideration-list" aria-label="Long-trip consideration list">
        {items.map((item) => (
          <li
            key={item.kind}
            className="og-preparation__consideration"
            data-severity={item.severity}
            data-testid={`long-trip-consideration-${item.kind}`}
          >
            <strong>{CONSIDERATION_LABELS[item.kind]}</strong>
            <p>{item.whyLine}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One line of conditions, then only the warnings worth acting on. */
function BriefPreparation({ preparation }: { readonly preparation: RoutePreparation }) {
  const weather = weatherLine(preparation.items);
  const warning = trafficWarning(preparation.items);
  const considerations = preparation.considerations ?? [];
  if (weather === null && warning === null && considerations.length === 0) return null;
  return (
    <section
      className="og-preparation og-preparation--brief"
      aria-label="Conditions at the start"
      data-testid="route-conditions"
    >
      {weather === null ? null : <p className="og-preparation__weather-line">{weather}</p>}
      {warning === null ? null : <p className="og-preparation__warning-line">{warning}</p>}
      <ConsiderationList items={considerations} />
    </section>
  );
}

export function RoutePreparationSection({
  preparation,
  offline,
  omit,
  heading = true,
  variant = "full",
}: RoutePreparationSectionProps) {
  const [showAll, setShowAll] = useState(false);
  if (variant === "brief") return <BriefPreparation preparation={preparation} />;
  // What could not be checked is not a row: an unknown route is never drawn as
  // clear, and a list of "not available yet" is not something a rider reads
  // before a ride. Traffic speaks once, as a warning, in the briefing line.
  const omitted = new Set<RoutePreparationItem["kind"]>([
    "traffic",
    // Fuel is the one line under this list, and the bike's range is already
    // under the departure chips: no third reading of the same tank.
    "fuel",
    ...(omit ?? []),
  ]);
  const usefulItems = preparation.items.filter(
    (item) => item.state !== "unavailable" && !omitted.has(item.kind),
  );
  const visibleItems = showAll ? usefulItems : usefulItems.slice(0, MAX_DEFAULT_ITEMS);
  const hasMore = usefulItems.length > MAX_DEFAULT_ITEMS;
  const noProviders = preparation.registeredProviderCount === 0;
  const considerations = preparation.considerations ?? [];
  const hasContent = noProviders || visibleItems.length > 0 || considerations.length > 0 || offline !== undefined;
  if (!hasContent) return null;

  const toggle = hasMore ? (
    <button
      type="button"
      className="og-secondary og-preparation__toggle"
      aria-expanded={showAll}
      onClick={() => setShowAll((current) => !current)}
    >
      {showAll ? "Show fewer checks" : "Show all checks"}
    </button>
  ) : null;

  return (
    <section
      className="og-preparation"
      data-testid="preparation-section"
      {...(heading
        ? { "aria-labelledby": "before-you-ride-title" }
        : { "aria-label": "Before you ride" })}
    >
      {heading ? (
        <div className="og-preparation__head">
          <div>
            <p className="og-eyebrow">Route briefing</p>
            <h2 id="before-you-ride-title">Before you ride</h2>
          </div>
          {toggle}
        </div>
      ) : hasMore ? <div className="og-preparation__head">{toggle}</div> : null}

      {noProviders ? (
        <p className="og-preparation__empty" data-testid="preparation-zero-provider">
          Checks will appear here when optional capabilities are available. Nothing is marked clear
          or offline-ready until the route has supporting data.
        </p>
      ) : null}

      {!noProviders && visibleItems.length > 0 ? (
        <dl className="og-preparation__list" aria-label="Route preparation checks">
          {visibleItems.map((item) => <PreparationRow key={item.kind} item={item} />)}
        </dl>
      ) : null}

      {visibleItems.some((item) => item.kind === "weather") ? (
        <p className="og-preparation__credit">{WEATHER_SOURCE_CREDIT}</p>
      ) : null}

      <ConsiderationList items={considerations} />
      {/* Offline mechanics are a detail a rider opens, not a wall under the briefing. */}
      {offline === undefined ? null : (
        <details className="og-preparation__offline">
          <summary>Offline readiness</summary>
          <OfflineDisclosure {...offline} />
        </details>
      )}
    </section>
  );
}
