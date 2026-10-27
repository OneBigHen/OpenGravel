"use client";

/**
 * The ride block of the phone Plan sheet (small-screen design system v2 §3).
 *
 * At rest it is laid out like Google Maps' route sheet: where the ride goes with
 * two icon actions (ride options, share), the time large and green with the
 * arrival and distance beside it, one meta line, then a row of pills — Start,
 * Add stops, Save — and a quiet `Compare rides (n)` switch. Comparing swaps the summary for the options, one
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

/** "Back 12:04 PM" for a loop, "Arrive 12:04 PM" for a destination (Google's arrival line). */
function arrivalLine(seconds: number | undefined, loop: boolean): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  const at = new Date(Date.now() + seconds * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${loop ? "Back" : "Arrive"} ${at}`;
}

/** The quick actions around the ride; each is absent when the page cannot offer it. */
export interface PhoneRideQuickActions {
  readonly onAddStop?: (() => void) | undefined;
  readonly onSave?: (() => void) | undefined;
  readonly onShare?: (() => void) | undefined;
  readonly onStyle?: (() => void) | undefined;
}

const Glyph = ({ d }: { readonly d: string }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
const SLIDERS = "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4";
const SHARE = "M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6";
const NAV = "M12 3 5 20l7-3.5 7 3.5z";
const PIN_PLUS = "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7v6M9 10h6";
const BOOKMARK = "M7 3h10v18l-5-3.5L7 21z";

export function PhoneRideSummary({ directionsOptions = false, card, cards, start, route, elevationSource, comparing, onCompare, onSelect, rideStyle, weatherLine, destinationLine = null, quick = {} }: {
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
  readonly quick?: PhoneRideQuickActions;
}) {
  const elevation = useElevationProfile(elevationSource, route?.routeId ?? null, route?.geometry ?? NO_LINE);
  const words = useMemo(() => routeChoiceWords(cards), [cards]);
  const surface = rideGlanceSurface(card);
  const meta = [card.badges.find((badge) => /curv|twist/i.test(badge)) ?? card.curviness?.label, surface.known ? surface.label : null];
  if (elevation?.status === "ready") meta.push(`↗ ${Math.round(elevation.profile.climbMeters * 3.28084).toLocaleString("en-US")} ft`);
  const arrival = arrivalLine(card.durationSeconds, rideStyle?.view.shape === "loop");
  return <section className="og-phone-summary" data-testid="phone-ride-summary" data-directions={directionsOptions ? "true" : undefined} data-comparing={comparing ? "true" : "false"} aria-label="Your ride">
    {comparing ? <ul className="og-phone-alternatives" data-testid="phone-alternatives" aria-label="Compare rides">
      {cards.map((choice) => <RouteDecisionCard compact key={choice.routeId} card={choice} onSelect={onSelect}
        compactLabel={directionsOptions && (choice.roleKey === "fastest" || words[choice.routeId] === "Quickest") ? "Fastest" : directionsOptions && (choice.roleKey === "more-twisties" || words[choice.routeId] === "Twistiest") ? "Twistiest" : choice.roleLabel}
        compactReason={words[choice.routeId]}/>) }
    </ul> : <div className="og-phone-summary__ride">
      <div className="og-phone-summary__head">
        <p className="og-phone-summary__where" data-testid="phone-destination">{destinationLine ?? "Your ride"}</p>
        {quick.onStyle === undefined ? null : <button type="button" className="og-phone-summary__icon" data-testid="summary-style" aria-label="Ride options" title="Ride options" onClick={quick.onStyle}><Glyph d={SLIDERS}/></button>}
        {quick.onShare === undefined ? null : <button type="button" className="og-phone-summary__icon" data-testid="summary-share" aria-label="Share ride" title="Share ride" onClick={quick.onShare}><Glyph d={SHARE}/></button>}
      </div>
      <div className="og-phone-summary__eta">
        <h2 className="og-phone-summary__time">{card.durationLabel}</h2>
        <div className="og-phone-summary__facts">
          <p className="og-phone-summary__arrive">{arrival === null ? card.distanceLabel : `${arrival} · ${card.distanceLabel}`}</p>
          <p className="og-phone-summary__meta">{meta.filter(Boolean).join(" · ")}</p>
        </div>
      </div>
    </div>}
    {/* Start sits right under the ride, like Google Maps: on a 320x640 phone the
        style pickers below it may scroll, the one action never does. */}
    {start === null ? null : <div className="og-phone-summary__start">
      <div className="og-phone-summary__actions">
        <button className="og-primary" type="button" data-testid="start-ride" aria-label={start.starting ? undefined : "Start ride"} disabled={start.starting || start.refusal !== null} onClick={start.onStart}><Glyph d={NAV}/>{start.starting ? "Starting…" : "Start"}</button>
        {comparing || quick.onAddStop === undefined ? null : <button type="button" className="og-phone-summary__pill" data-testid="summary-add-stop" onClick={quick.onAddStop}><Glyph d={PIN_PLUS}/>Add stops</button>}
        {comparing || quick.onSave === undefined ? null : <button type="button" className="og-phone-summary__pill" data-testid="summary-save" onClick={quick.onSave}><Glyph d={BOOKMARK}/>Save</button>}
      </div>
      {start.refusal === null ? null : <p data-testid="start-ride-reason">{start.refusal}</p>}
      {start.error === null ? null : <p role="alert">{start.error}</p>}
    </div>}
    {/* One ride is not a comparison: the switch only appears when there is a
        second choice to compare against. */}
    {comparing || cards.length > 1 ? <button type="button" className="og-phone-summary__compare" data-testid="compare-rides" onClick={onCompare}>{comparing ? "Back to ride" : `Compare rides (${cards.length})`}</button> : null}
    {rideStyle === undefined ? null : <PhoneQuickStyle model={rideStyle} />}
    {weatherLine === null ? null : <p className="og-phone-summary__weather" data-testid="phone-weather">{weatherLine}</p>}
  </section>;
}
