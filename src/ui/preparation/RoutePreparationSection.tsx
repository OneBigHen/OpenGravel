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

function displayValue(item: RoutePreparationItem): string {
  if (item.kind === "traffic" && item.state === "unavailable") return "Traffic unknown";
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
  const usefulItems = preparation.items.filter((item) => item.state !== "unavailable");
  const unavailableItems = preparation.items.filter((item) => item.state === "unavailable");
  const visibleItems = showAll ? usefulItems : usefulItems.slice(0, MAX_DEFAULT_ITEMS);
  const hasMore = usefulItems.length > MAX_DEFAULT_ITEMS;
  const noProviders = preparation.registeredProviderCount === 0;
  const weatherUnavailable = unavailableItems.some((item) => item.kind === "weather");
  const trafficUnavailable = unavailableItems.some((item) => item.kind === "traffic");

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

      {!noProviders && unavailableItems.length > 0 ? (
        <details className="og-preparation__unavailable" open={weatherUnavailable || trafficUnavailable}>
          <summary>Not available yet</summary>
          <dl className="og-preparation__list" aria-label="Unavailable preparation checks">
            {unavailableItems.map((item) => <PreparationRow key={item.kind} item={item} />)}
          </dl>
        </details>
      ) : null}
      <ConsiderationList items={preparation.considerations ?? []} />
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
