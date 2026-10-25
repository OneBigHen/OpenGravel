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
}

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

function stateLabel(state: RoutePreparationItem["state"]): string {
  return state === "unavailable" ? "Unknown" : state.charAt(0).toUpperCase() + state.slice(1);
}

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

function PreparationRow({ item }: { readonly item: RoutePreparationItem }) {
  const data = objectData(item);
  const primaryAlert = data?.primaryAlert;
  const severity = typeof primaryAlert === "object" && primaryAlert !== null && "severity" in primaryAlert
    && typeof primaryAlert.severity === "string" ? primaryAlert.severity : null;
  const freshness = data?.freshnessLabel === "Fresh" || data?.freshnessLabel === "Stale"
    ? data.freshnessLabel
    : null;
  return (
    <div className="og-preparation__row">
      <dt>{LABELS[item.kind]}</dt>
      <dd>
        <span className="og-preparation__value">{displayValue(item)}</span>
        <span
          className="og-preparation__state"
          data-state={item.state}
          data-testid={`preparation-state-${item.kind}`}
        >
          {stateLabel(item.state)}
        </span>
        {severity !== null ? <span className="og-preparation__severity" data-testid="weather-severity">{severity}</span> : null}
        {freshness !== null ? <span className="og-preparation__freshness" data-testid="weather-freshness">{freshness}</span> : null}
        <span className="og-preparation__reason">{item.reason}</span>
        <span className="og-preparation__provenance">{item.provenance}</span>
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
            <div className="og-preparation__consideration-head">
              <strong>{CONSIDERATION_LABELS[item.kind]}</strong>
              <span className="og-preparation__consideration-severity">{item.severity}</span>
            </div>
            <p>{item.whyLine}</p>
            <small>Sources: {item.sourceRefs.join(", ")}</small>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RoutePreparationSection({ preparation, offline }: RoutePreparationSectionProps) {
  const [showAll, setShowAll] = useState(false);
  // What could not be checked is not a row: an unknown route is never drawn as
  // clear, and a list of "not available yet" is not something a rider reads
  // before a ride. Traffic speaks once, as a warning, in the briefing line.
  const usefulItems = preparation.items.filter(
    (item) =>
      item.state !== "unavailable" &&
      item.kind !== "traffic" &&
      // Fuel is the one line under this list, and the bike's range is already
      // under the departure chips: no third reading of the same tank.
      item.kind !== "fuel",
  );
  const visibleItems = showAll ? usefulItems : usefulItems.slice(0, MAX_DEFAULT_ITEMS);
  const hasMore = usefulItems.length > MAX_DEFAULT_ITEMS;
  const noProviders = preparation.registeredProviderCount === 0;
  const considerations = preparation.considerations ?? [];
  const hasContent = noProviders || visibleItems.length > 0 || considerations.length > 0 || offline !== undefined;
  if (!hasContent) return null;

  return (
    <section
      className="og-preparation"
      aria-labelledby="before-you-ride-title"
      data-testid="preparation-section"
    >
      <div className="og-preparation__head">
        <div>
          <p className="og-eyebrow">Route briefing</p>
          <h2 id="before-you-ride-title">Before you ride</h2>
        </div>
        {hasMore ? (
          <button
            type="button"
            className="og-secondary og-preparation__toggle"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? "Show fewer checks" : "Show all checks"}
          </button>
        ) : null}
      </div>

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
