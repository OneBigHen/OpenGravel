"use client";

/**
 * The glance strip: the live ride summary over the map.
 *
 * A rider looking at a drawn route has one question the sheet answers only after
 * it is opened — *how big is this ride?* This is that answer, always on screen
 * while a route exists: the route's colour, its time, distance and climb, and the
 * surface the evidence actually covers.
 *
 * Three rules shape it:
 *
 * - **One statement.** The pill is a single `<button>` whose accessible name is
 *   the whole sentence ("Ride summary: 1 h 48 min, 78 miles, 3,200 feet of
 *   climbing, 12% gravel. Show ride details."), so assistive tech hears one
 *   answer rather than four loose fragments in a row of decorative glyphs.
 * - **Unknown stays unknown** (CLAUDE.md). A climb with no profile is omitted from
 *   the pill and named "not known" in the sentence; a route whose surface evidence
 *   covers nothing says `surface unknown` — it is never rounded up to paved.
 * - **The numbers are a projection.** Nothing is measured here: the values are the
 *   selected route card's own labels (`formatDuration`/`formatDistance`) and the
 *   climb the elevation profile measured, so the pill can never disagree with the
 *   card it belongs to — and it never holds a skeleton over a card that already
 *   has them. While a plan is in flight with no answer yet it says so; the moment
 *   a card exists, its numbers are what the pill shows.
 *
 * A change to the summary is re-stated once, after a short throttle, through a
 * `role="status"` region: a ride being edited is not a ride being shouted about
 * four times while a stop is dragged.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import { UNKNOWN_VALUE } from "@/application/planner/measurements";
import type { RouteCardVm } from "@/application/planner/planner-view-model";

/** Feet in a metre, for the climb the elevation profile measured. */
const FEET_PER_METER = 3.28084;
/** How long a changed value waits before the live region re-states the ride. */
export const GLANCE_ANNOUNCE_DELAY_MS = 700;

/** Where the strip is mounted: over the map, or in the sheet's column. */
export type RideGlancePlacement = "map" | "dock";

/** The worst surface the evidence covers, and whether it is a real claim. */
export interface RideGlanceSurface {
  /** `12% gravel`, or `surface unknown` when no usable report covers the line. */
  readonly label: string;
  /** True only when the label is a claim the route's evidence backs. */
  readonly known: boolean;
}

export interface RideGlanceSummary {
  readonly durationLabel: string;
  readonly distanceLabel: string;
  /** Climb measured from the route's elevation profile, or `null` while unknown. */
  readonly climbMeters: number | null;
  readonly surface: RideGlanceSurface;
  /** The route's colour slot, shared with its map line and its decision card. */
  readonly tint: number;
}

/**
 * The surface kinds a rider plans for, roughest first. The strip names the worst
 * one the line has, because that is the one a gravel rider is choosing the route
 * for: a ride that is 88% paved and 12% gravel reads `12% gravel`, not
 * `88% paved`. The share is stated so the number can never be read as the whole.
 */
const SURFACE_KINDS = ["dirt", "gravel", "paved"] as const;

/**
 * What the pill says about the surface, from the shares the card was built on
 * (`surfaceShares`, 07 §2).
 *
 * A share above zero is a known run of that surface and may be stated as such —
 * the percentage is explicit about how much of the line it covers, so "12% gravel"
 * claims nothing about the other 88%. A card with no mix evidence, or one whose
 * measured mix is entirely unknown, has no known run: it reads `surface unknown`,
 * never a paved claim (CLAUDE.md; `OGV-D-251`).
 */
export function rideGlanceSurface(card: RouteCardVm): RideGlanceSurface {
  const strip = card.surfaceStrip;
  if (strip === undefined) return { label: "surface unknown", known: false };
  // A ride with both is read for all of its unpaved riding: "8% dirt" on a loop
  // that is also 35% gravel undersold a 43% dirt-and-gravel ride by five times.
  if (strip.dirt > 0 && strip.gravel > 0) {
    return { label: `${Math.round((strip.dirt + strip.gravel) * 100)}% dirt & gravel`, known: true };
  }
  for (const kind of SURFACE_KINDS) {
    const share = strip[kind];
    if (share > 0) return { label: `${Math.round(share * 100)}% ${kind}`, known: true };
  }
  return { label: "surface unknown", known: false };
}

/** The pill's model for one route card, with the climb the profile measured. */
export function rideGlanceSummary(
  card: RouteCardVm,
  climbMeters: number | null,
): RideGlanceSummary {
  return {
    durationLabel: card.durationLabel,
    distanceLabel: card.distanceLabel,
    climbMeters:
      climbMeters !== null && Number.isFinite(climbMeters) && climbMeters >= 0
        ? climbMeters
        : null,
    surface: rideGlanceSurface(card),
    tint: card.tint ?? 0,
  };
}

/** `3,200 ft`, the same spelling the elevation profile's head uses. */
function feet(meters: number): string {
  return `${Math.round(meters * FEET_PER_METER).toLocaleString("en-US")} ft`;
}

/** The accessible name spells the units out; the pill keeps them short. */
function spokenDuration(label: string): string {
  return label === UNKNOWN_VALUE ? "time not known" : label;
}

function spokenDistance(label: string): string {
  return label === UNKNOWN_VALUE ? "distance not known" : label.replace(/ mi$/, " miles");
}

/** The whole pill as one sentence: the numbers in the order a rider asks them. */
function statementFor(summary: RideGlanceSummary | null, planning: boolean): string {
  if (summary === null) {
    return planning ? "Ride summary: planning your ride." : "Ride summary: no route yet.";
  }
  const parts = [
    spokenDuration(summary.durationLabel),
    spokenDistance(summary.distanceLabel),
    summary.climbMeters === null
      ? "climb not known"
      : `${Math.round(summary.climbMeters * FEET_PER_METER).toLocaleString("en-US")} feet of climbing`,
    summary.surface.known ? summary.surface.label : "surface unknown",
  ];
  return `Ride summary: ${parts.join(", ")}.`;
}

/**
 * The statement as last announced, on a trailing throttle.
 *
 * The first statement is the state the rider arrived in, so it is never
 * announced; every later change is, once, after the edits stop.
 */
function useGlanceAnnouncement(statement: string): string {
  const [announced, setAnnounced] = useState("");
  const previous = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = statement;
    if (before === null || before === statement) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setAnnounced(statement);
    }, GLANCE_ANNOUNCE_DELAY_MS);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [statement]);
  return announced;
}

/** An up chevron: the sheet under the pill is what a tap opens. */
function OpenGlyph(): ReactElement {
  return (
    <svg
      className="og-glance__glyph"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export interface MapRideGlanceProps {
  /** The selected route's summary, or `null` when there is no route yet. */
  readonly summary: RideGlanceSummary | null;
  /** A plan is in flight: with no route card yet the metrics read as "still measuring", not as numbers. */
  readonly planning: boolean;
  /** The last attempt failed: with no route to show, the pill offers Retry. */
  readonly failed: boolean;
  /** The trailing tap target: show the ride details (the `ride` detent). */
  readonly onOpenRide: () => void;
  /** Plan again, from the pill's own failed state. */
  readonly onRetry: () => void;
  /**
   * Which composition slot renders it. The map slot shows the strip at the top
   * centre of the wide tiers; the sheet's column shows it directly above the
   * dock where the dock lies over the map (the phone and tablet tiers).
   */
  readonly placement?: RideGlancePlacement;
}

export function MapRideGlance({
  summary,
  planning,
  failed,
  onOpenRide,
  onRetry,
  placement = "map",
}: MapRideGlanceProps): ReactElement | null {
  const statement = statementFor(summary, planning);
  const announced = useGlanceAnnouncement(statement);
  // No route, nothing being planned and nothing failed: there is no ride to
  // summarise, and an empty pill would be a claim about a ride that does not exist.
  if (summary === null && !planning && !failed) return null;
  // "Still measuring" is only honest while nothing has been measured. A card that
  // is already on screen has its numbers, so the pill shows them instead of a
  // skeleton that would outlive the answer (the alternatives can still be on
  // their way long after the primary route and its card are there).
  const measuring = summary === null && planning;

  const className = `og-glance og-glance--${placement}`;
  const testId = `ride-glance-${placement}`;
  const live = (
    <span className="sr-only" role="status" data-testid={`${testId}-status`}>
      {announced}
    </span>
  );

  if (summary === null && !planning) {
    return (
      <div
        className={`${className} og-glance--failed`}
        data-testid={testId}
        data-state="failed"
        data-placement={placement}
      >
        <span className="og-glance__promise">No route yet</span>
        <button type="button" className="og-glance__retry" onClick={onRetry}>
          Retry
        </button>
        {live}
      </div>
    );
  }

  return (
    <div
      className={className}
      data-testid={testId}
      data-state={measuring ? "planning" : "ready"}
      data-placement={placement}
      data-tint={summary?.tint ?? 0}
    >
      <button
        type="button"
        className="og-glance__button"
        aria-label={summary === null ? `${statement} Show the planner.` : `${statement} Show ride details.`}
        aria-busy={measuring}
        onClick={onOpenRide}
      >
        {summary === null ? null : <span className="og-glance__swatch" aria-hidden="true" />}
        {measuring ? (
          <span className="og-glance__planning" aria-hidden="true">
            <span className="og-glance__shimmer" />
            <span className="og-glance__shimmer og-glance__shimmer--short" />
            <span className="og-glance__planning-word">Measuring the ride…</span>
          </span>
        ) : summary === null ? null : (
          <span className="og-glance__metrics">
            <span className="og-glance__metric" data-testid="ride-glance-duration">
              {summary.durationLabel}
            </span>
            <span className="og-glance__metric" data-testid="ride-glance-distance">
              {summary.distanceLabel}
            </span>
            {summary.climbMeters === null ? null : (
              <span className="og-glance__metric" data-testid="ride-glance-climb">
                <span aria-hidden="true">↗ </span>
                {feet(summary.climbMeters)}
              </span>
            )}
          </span>
        )}
        {summary === null ? null : (
          <span
            className={summary.surface.known ? "og-glance__surface" : "og-glance__surface og-glance__surface--unknown"}
            data-testid="ride-glance-surface"
            data-known={summary.surface.known}
          >
            {summary.surface.label}
          </span>
        )}
        <span className="og-glance__open" aria-hidden="true">
          <OpenGlyph />
        </span>
      </button>
      {live}
    </div>
  );
}
