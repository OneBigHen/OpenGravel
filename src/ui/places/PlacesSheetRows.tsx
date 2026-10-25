"use client";

/**
 * The Places overlay as rows inside the layers sheet.
 *
 * On a phone the map keeps two floating controls, so the Places pill and its
 * filter button move here. The rows are the same provider state the pill used —
 * turning Places on, choosing a time window and picking the kinds — and the
 * sheet says what is actually on the map instead of leaving a badge over it.
 */

import type {
  PlaceKind,
  PlaceQuery,
  PlaceWindow,
  PlacesOverlayStatus,
} from "@/application/places";

import { LayerSwitch } from "@/ui/layers/LayerSwitch";

import { placesStatusMessage } from "./PlacesControl";

const WINDOWS: readonly { readonly value: PlaceWindow; readonly label: string }[] = [
  { value: "now", label: "Now" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
];

const KINDS: readonly { readonly value: PlaceKind; readonly label: string }[] = [
  { value: "happy_hour", label: "Happy hours" },
  { value: "event", label: "Events" },
];

export interface PlacesSheetRowsProps {
  readonly enabled: boolean;
  readonly status: PlacesOverlayStatus;
  readonly reason: string | null;
  readonly count: number;
  readonly scope: "view" | "route";
  readonly query: PlaceQuery;
  readonly onToggle: () => void;
  readonly setWindow: (window: PlaceWindow) => void;
  readonly setKinds: (kinds: readonly PlaceKind[]) => void;
}

function metaLine(
  enabled: boolean,
  status: PlacesOverlayStatus,
  reason: string | null,
  count: number,
  scope: "view" | "route",
): string {
  if (!enabled || status === "idle") return "Happy hours and events near the ride";
  const message = placesStatusMessage(status, reason, count, scope);
  if (message !== null) return message;
  return scope === "route" ? `${count} near this ride` : `${count} in view`;
}

export function PlacesSheetRows({
  enabled,
  status,
  reason,
  count,
  scope,
  query,
  onToggle,
  setWindow,
  setKinds,
}: PlacesSheetRowsProps) {
  const toggleKind = (kind: PlaceKind): void => {
    const next = query.kinds.includes(kind)
      ? query.kinds.filter((current) => current !== kind)
      : [...query.kinds, kind];
    if (next.length > 0) setKinds(next);
  };

  return (
    <section className="og-layers__group og-layers__group--places" aria-label="Places">
      <h3>Places</h3>
      <ul>
        <li className="og-layers__row" data-on={enabled ? "true" : "false"}>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className="og-layers__switch og-layers__switch--plain"
            data-testid="places-sheet-toggle"
            onClick={onToggle}
          >
            <span className="og-layers__swatch" aria-hidden="true">◉</span>
            <span className="og-layers__text">
              <span className="og-layers__name">Places</span>
              <span className="og-layers__legend" data-status={status}>
                {metaLine(enabled, status, reason, count, scope)}
              </span>
            </span>
            <LayerSwitch on={enabled} />
          </button>
          {enabled ? (
            <div className="og-layers__filters">
              <div className="og-layers__filter-row" role="group" aria-label="Place time range">
                {WINDOWS.map(({ value, label }) => (
                  <button
                    type="button"
                    className="og-layers__option"
                    key={value}
                    aria-pressed={query.window === value}
                    data-testid={`places-sheet-window-${value}`}
                    onClick={() => setWindow(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="og-layers__filter-row" role="group" aria-label="Place types">
                {KINDS.map(({ value, label }) => {
                  const selected = query.kinds.includes(value);
                  return (
                    <button
                      type="button"
                      className="og-layers__option"
                      key={value}
                      aria-pressed={selected}
                      disabled={selected && query.kinds.length === 1}
                      data-testid={`places-sheet-kind-${value}`}
                      onClick={() => toggleKind(value)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </li>
      </ul>
    </section>
  );
}
