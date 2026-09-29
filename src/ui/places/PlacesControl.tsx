"use client";

import { useState } from "react";

import type { PlaceKind, PlaceQuery, PlaceWindow, PlacesOverlayStatus } from "@/application/places";

export interface PlacesControlProps {
  readonly enabled: boolean;
  readonly status: PlacesOverlayStatus;
  readonly reason: string | null;
  readonly count: number;
  /** `route`: the count is only the places near the chosen ride. */
  readonly scope?: "view" | "route";
  readonly query: PlaceQuery;
  readonly onToggle: () => void;
  readonly setWindow: (window: PlaceWindow) => void;
  readonly setKinds: (kinds: readonly PlaceKind[]) => void;
  /**
   * Planner: the filters stay behind their own button so the map under them
   * stays tappable; the pill alone turns places on and off.
   */
  readonly collapsible?: boolean;
}

const WINDOWS: readonly { readonly value: PlaceWindow; readonly label: string }[] = [
  { value: "now", label: "Now" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
];

const KINDS: readonly { readonly value: PlaceKind; readonly label: string }[] = [
  { value: "happy_hour", label: "Happy hours" },
  { value: "event", label: "Events" },
];

function statusMessage(status: PlacesOverlayStatus, reason: string | null, count: number, scope: "view" | "route"): string | null {
  if (status === "zoom-in") return "Zoom in to see places";
  if (status === "unavailable") return `Places unavailable — ${reason ?? "the source gave no reason."}`;
  if (status === "loading") return "Finding places…";
  if (status === "ready" && count === 0) return scope === "route" ? "No places near this ride." : "No places in this view.";
  return null;
}

/** The compact pill's badge: the count when ready, otherwise the state in a glyph. */
function badgeFor(status: PlacesOverlayStatus, count: number): string {
  if (status === "loading") return "…";
  if (status === "zoom-in") return "zoom in";
  if (status === "unavailable") return "off";
  return String(count);
}

export function PlacesControl({
  enabled,
  status,
  reason,
  count,
  scope = "view",
  query,
  onToggle,
  setWindow,
  setKinds,
  collapsible = false,
}: PlacesControlProps) {
  const message = enabled ? statusMessage(status, reason, count, scope) : null;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showFilters = enabled && (!collapsible || filtersOpen);

  const toggleKind = (kind: PlaceKind): void => {
    const next = query.kinds.includes(kind)
      ? query.kinds.filter((current) => current !== kind)
      : [...query.kinds, kind];
    if (next.length > 0) setKinds(next);
  };

  return (
    <section className="og-places-control" data-testid="places-control" aria-label="Places on map">
      <button
        type="button"
        className="og-places-control__toggle"
        aria-pressed={enabled}
        onClick={onToggle}
      >
        <span className="og-places-control__label">{scope === "route" ? "Along ride" : "Places"}</span>
        {enabled ? (
          <span className="og-places-control__count" data-testid="places-count" data-status={status} data-count={count}>
            {collapsible ? badgeFor(status, count) : count}
          </span>
        ) : null}
      </button>
      {collapsible && enabled ? (
        <button
          type="button"
          className="og-places-control__filters"
          aria-expanded={filtersOpen}
          aria-label="Place filters"
          data-testid="places-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M3 5h14M6 10h8M9 15h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      ) : null}

      {showFilters ? (
        <div className="og-places-control__panel">
          <div className="og-places-control__segments" role="group" aria-label="Place time range">
            {WINDOWS.map(({ value, label }) => (
              <button
                type="button"
                className="og-places-control__option"
                key={value}
                aria-pressed={query.window === value}
                onClick={() => setWindow(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="og-places-control__kinds" role="group" aria-label="Place types">
            {KINDS.map(({ value, label }) => {
              const selected = query.kinds.includes(value);
              return (
                <button
                  type="button"
                  className="og-places-control__option"
                  key={value}
                  aria-pressed={selected}
                  disabled={selected && query.kinds.length === 1}
                  onClick={() => toggleKind(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {message === null ? null : (
            <p
              className={`og-places-control__status${status === "loading" ? " og-places-control__status--loading" : ""}`}
              data-status={status}
              role="status"
            >
              {message}
            </p>
          )}
        </div>
      ) : null}
      {!collapsible || message === null || showFilters ? null : (
        // Compact: the pill's badge carries the state; the words are for
        // assistive tech, so nothing extra sits over the map.
        <p className="og-visually-hidden" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
