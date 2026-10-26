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
 * the options. It is hidden at the peek detent, where only the summary fits,
 * unless the rider is comparing — and there it stays in view while the options
 * scroll, because reshaping the ride is the point of looking at the options.
 */

import { useMemo } from "react";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { routeChoiceWords } from "@/application/planner/route-choice-words";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";
import type { RideStyleControlsModel } from "@/ui/planner/RideStyleControls";
import type { RideActionsProps } from "./RideActions";
import { RouteDecisionCard } from "./RouteDecisionCard";
import { PhoneQuickStyle } from "./PhoneQuickStyle";
import { rideGlanceSurface } from "./MapRideGlance";
import { useElevationProfile } from "./useElevationProfile";

const NO_LINE: readonly Coordinate[] = [];

export function PhoneRideSummary({ directionsOptions = false, card, cards, start, route, elevationSource, comparing, onCompare, onSelect, rideStyle, weatherLine, destinationLine = null }: {
  readonly directionsOptions?: boolean;
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
  const surface = rideGlanceSurface(card);
  const meta = [card.badges.find((badge) => /curv|twist/i.test(badge)) ?? card.curviness?.label, surface.known ? surface.label : null];
  if (elevation?.status === "ready") meta.push(`↗ ${Math.round(elevation.profile.climbMeters * 3.28084).toLocaleString("en-US")} ft`);
  return <section className="og-phone-summary" data-testid="phone-ride-summary" data-directions={directionsOptions ? "true" : undefined} data-comparing={comparing ? "true" : "false"} aria-label="Your ride">
    {comparing ? <ul className="og-phone-alternatives" data-testid="phone-alternatives" aria-label="Compare rides">
      {cards.map((choice) => <RouteDecisionCard compact key={choice.routeId} card={choice} onSelect={onSelect}
        compactLabel={directionsOptions && (choice.roleKey === "fastest" || words[choice.routeId] === "Quickest") ? "Fastest" : directionsOptions && (choice.roleKey === "more-twisties" || words[choice.routeId] === "Twistiest") ? "Twistiest" : choice.roleLabel}
        compactReason={words[choice.routeId]}/>) }
    </ul> : <div>
      {destinationLine === null ? null : <p className="og-phone-summary__where" data-testid="phone-destination">{destinationLine}</p>}
      <h2>{card.durationLabel} · {card.distanceLabel}</h2>
      <p className="og-phone-summary__meta">{meta.filter(Boolean).join(" · ")}</p>
    </div>}
    {start === null ? null : <div className="og-phone-summary__start">
      <button className="og-primary" type="button" data-testid="start-ride" disabled={start.starting || start.refusal !== null} onClick={start.onStart}>{start.starting ? "Starting…" : "Start ride"}</button>
      {start.refusal === null ? null : <p data-testid="start-ride-reason">{start.refusal}</p>}
      {start.error === null ? null : <p role="alert">{start.error}</p>}
    </div>}
    {/* Start sits right under the ride, like Google Maps: on a 320x640 phone the
        style pickers below it may scroll, the one action never does. */}
    {rideStyle === undefined ? null : <PhoneQuickStyle model={rideStyle} />}
    {weatherLine === null ? null : <p className="og-phone-summary__weather" data-testid="phone-weather">{weatherLine}</p>}
    {/* One ride is not a comparison: the switch only appears when there is a
        second choice to compare against. */}
    {comparing || cards.length > 1 ? <button type="button" className="og-phone-summary__compare" data-testid="compare-rides" onClick={onCompare}>{comparing ? "Back to ride" : `Compare rides (${cards.length})`}</button> : null}
  </section>;
}
