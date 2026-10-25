"use client";

/**
 * The ride block of the phone Plan sheet (small-screen design system v2 §3).
 *
 * At rest it is one summary: where the ride goes, its time and distance at
 * headline size, one meta line, one full-width Start ride and a quiet
 * `Compare rides (n)` switch. Comparing swaps the summary for the options, one
 * row each: the colour of that option's line on the map, the role, its numbers,
 * the one character word it earns (`routeChoiceWords`) and what it costs in
 * time against the quickest. A row is a real `<button>` with `aria-pressed` and
 * the same selection action the desktop cards use, so picking one is a keyboard
 * and screen-reader action too, and the map highlights the line it names —
 * never colour alone.
 *
 * The short ride style sits directly under whichever block is showing (and under
 * the Compare list when comparing), so the ride can be reshaped without leaving
 * the options. It is hidden at the peek detent, where only the summary fits.
 */

import { useMemo } from "react";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { routeChoiceWords, type RouteChoiceWord } from "@/application/planner/route-choice-words";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";
import type { RideStyleControlsModel } from "@/ui/planner/RideStyleControls";
import type { RideActionsProps } from "./RideActions";
import { PhoneQuickStyle } from "./PhoneQuickStyle";
import { rideGlanceSurface } from "./MapRideGlance";
import { useElevationProfile } from "./useElevationProfile";

const NO_LINE: readonly Coordinate[] = [];

/** A tick in the row of the option the map is drawing. */
function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M4.5 10.5 8 14l7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** `+3 min` — what this option costs against the quickest one, or `null`. */
function addedMinutesLabel(card: RouteCardVm): string | null {
  const minutes = card.addedMinutes;
  return minutes === undefined || minutes === null || minutes <= 0 ? null : `+${minutes} min`;
}

function OptionRow({ choice, word, onSelect }: {
  readonly choice: RouteCardVm;
  readonly word: RouteChoiceWord | undefined;
  readonly onSelect: (id: RouteCandidateId) => void;
}) {
  const added = addedMinutesLabel(choice);
  return (
    <li>
      <button
        type="button"
        className="og-phone-choice"
        data-role={choice.roleKey}
        data-tint={choice.tint ?? 0}
        data-selected={choice.isSelected ? "true" : "false"}
        aria-pressed={choice.isSelected}
        onClick={() => onSelect(choice.routeId)}
      >
        <span className="og-phone-choice__swatch" aria-hidden="true" />
        <span className="og-phone-choice__body">
          <span className="og-phone-choice__role">{choice.roleLabel}</span>
          <span className="og-phone-choice__meta">
            {choice.durationLabel} · {choice.distanceLabel}
            {word === undefined ? null : <span className="og-phone-choice__word"> · {word}</span>}
          </span>
        </span>
        {added === null ? null : (
          <span className="og-phone-choice__delta">
            {added}
            {/* The words beside the number are for a reader who cannot see that
                every row is measured against the quickest one. */}
            <span className="og-visually-hidden"> vs fastest</span>
          </span>
        )}
        <span className="og-phone-choice__check" aria-hidden="true">
          {choice.isSelected ? <CheckGlyph /> : null}
        </span>
      </button>
    </li>
  );
}

export function PhoneRideSummary({ card, cards, start, route, elevationSource, comparing, onCompare, onSelect, rideStyle, weatherLine, destinationLine = null }: {
  readonly card: RouteCardVm;
  readonly cards: readonly RouteCardVm[];
  readonly start: RideActionsProps["start"];
  readonly route: { readonly routeId: string; readonly geometry: readonly Coordinate[] } | null;
  readonly elevationSource: ElevationSource | undefined;
  readonly comparing: boolean;
  readonly onCompare: () => void;
  readonly onSelect: (id: RouteCandidateId) => void;
  /** The composer's ride style, so reshaping here is the same state as there. */
  readonly rideStyle?: RideStyleControlsModel;
  readonly weatherLine: string | null;
  readonly destinationLine?: string | null;
}) {
  const elevation = useElevationProfile(elevationSource, route?.routeId ?? null, route?.geometry ?? NO_LINE);
  const words = useMemo(() => routeChoiceWords(cards), [cards]);
  const meta = [card.badges.find((badge) => /curv|twist/i.test(badge)) ?? card.curviness?.label, rideGlanceSurface(card).label];
  if (elevation?.status === "ready") meta.push(`↗ ${Math.round(elevation.profile.climbMeters * 3.28084).toLocaleString("en-US")} ft`);
  return <section className="og-phone-summary" data-testid="phone-ride-summary" aria-label="Your ride">
    {comparing ? <ul className="og-phone-alternatives" data-testid="phone-alternatives" aria-label="Compare rides">
      {cards.map((choice) => <OptionRow key={choice.routeId} choice={choice} word={words[choice.routeId]} onSelect={onSelect} />)}
    </ul> : <div>
      {destinationLine === null ? null : <p className="og-phone-summary__where" data-testid="phone-destination">{destinationLine}</p>}
      <h2>{card.durationLabel} · {card.distanceLabel}</h2>
      <p className="og-phone-summary__meta">{meta.filter(Boolean).join(" · ")}</p>
    </div>}
    {rideStyle === undefined ? null : <PhoneQuickStyle model={rideStyle} />}
    {start === null ? null : <div className="og-phone-summary__start">
      <button className="og-primary" type="button" data-testid="start-ride" disabled={start.starting || start.refusal !== null} onClick={start.onStart}>{start.starting ? "Starting…" : "Start ride"}</button>
      {start.refusal === null ? null : <p data-testid="start-ride-reason">{start.refusal}</p>}
      {start.error === null ? null : <p role="alert">{start.error}</p>}
    </div>}
    {weatherLine === null ? null : <p className="og-phone-summary__weather" data-testid="phone-weather">{weatherLine}</p>}
    <button type="button" className="og-phone-summary__compare" data-testid="compare-rides" onClick={onCompare}>{comparing ? "Back to ride" : `Compare rides (${cards.length})`}</button>
  </section>;
}
