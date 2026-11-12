"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { RouteExplanation } from "@/application/planner/route-explanation";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { PlannerRouteBriefingProps } from "@/ui/planner/PlannerRouteBriefing";
import { RideActions, type RideActionsProps } from "@/ui/planner/RideActions";
import { RouteChoices, RouteDecisionCard } from "@/ui/planner/RouteDecisionCard";
import type { RideStyleControlsModel } from "@/ui/planner/RideStyleControls";
import { RouteOptions } from "./RouteOptions";
import { rideStyleSummary } from "./RideStyleControls";
import { useCompactPlanner, usePhonePlanner } from "./usePhonePlanner";
import { RideSummary, type RideSummaryQuickActions } from "./RideSummary";
import { automaticRideName } from "./destination-line";
import { compareChoiceNames } from "@/application/planner/route-choice-words";
import { AdvisorRideAsk } from "@/ui/planner/RideAdvisor";
import { useActivityMode } from "@/ui/stores/activity-mode";
import { HikeSummary, type HikeSummaryModel } from "./HikeSummary";

// No route means there is no briefing or chart to draw. Keep their dependency
// trees out of the first map interaction.
const PlannerElevationProfile = dynamic(() => import("./PlannerElevationProfile").then((mod) => mod.PlannerElevationProfile), { loading: () => <p className="og-composer__reason" role="status">Loading elevation profile…</p> });
const PlannerRouteBriefing = dynamic(() => import("./PlannerRouteBriefing").then((mod) => mod.PlannerRouteBriefing), { loading: () => <p className="og-composer__reason" role="status">Loading ride briefing…</p> });
// Weather along the route loads with the profile it sits under: its request
// starts after the first paint, and a slow provider never holds the ride back.
const PlannerRouteWeather = dynamic(() => import("./PlannerRouteWeather").then((mod) => mod.PlannerRouteWeather), { loading: () => null });

/**
 * The wide tier (MVP parity row 27): once there is a ride, its result — the
 * route choices, the ride actions and the briefing — moves out of the planning
 * rail into an inspector column on the right of the map. The rail keeps the
 * inputs (where, how, refine), and the answer is on screen next to the map
 * instead of two screens down one tall form. Must match the CSS tier in
 * `globals.css` (`.og-planner__inspector`).
 */
export const INSPECTOR_QUERY = "(min-width: 1181px) and (min-height: 600px)";

function inspectorQuery(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(INSPECTOR_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = inspectorQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Server render and engines without media queries keep the result in the rail. */
function useInspectorTier(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => inspectorQuery()?.matches ?? false,
    () => false,
  );
}

export interface PlannerResultPanelProps {
  /** The inspector column's element; `null` until it is mounted. */
  readonly showOptions?: boolean;
  readonly onEditOptions?: (() => void) | undefined;
  readonly onOpenOptions?: (() => void) | undefined;
  readonly startLabel?: string;
  readonly finishLabel?: string;
  readonly inspector: HTMLElement | null;
  readonly choices: {
    readonly cards: readonly RouteCardVm[];
    readonly explanation: RouteExplanation | null;
    readonly onSelect: (routeId: RouteCandidateId) => void;
    /** One line naming what the settled pick improved over the first look. */
    readonly note?: string | null;
  };
  readonly actions: RideActionsProps;
  readonly briefing: PlannerRouteBriefingProps;
  /** The sheet is at its expanded detent: the elevation chart opens expanded. */
  readonly sheetExpanded?: boolean;
  /** Phone peek: where the ride goes ("To Hawk Mountain", "Loop from Jim Thorpe"). */
  readonly destinationLine?: string | null;
  /**
   * The composer's ride style, handed to the phone summary so the ride can be
   * reshaped from under the options with the same state the full controls edit.
   */
  readonly rideStyle?: RideStyleControlsModel;
  /**
   * The page's own next step up from the peek detent, offered when the rider
   * opens Compare rides there: the options and the one-tap ride style need more
   * than the peek block has, and a summary that hides its own options list would
   * be a dead end.
   */
  readonly onExpandSheet?: () => void;
  /** The phone summary's quick actions: ride options, share, add stops, save. */
  readonly quick?: RideSummaryQuickActions;
  /** The planned hike, shown instead of the ride summary while Hike mode is on. */
  readonly hike?: HikeSummaryModel | null;
  /** The place a one-tap save is named after: the loop's start or the destination. */
  readonly placeLabel?: string;
}

export function PlannerResultPanel({ showOptions = false, onEditOptions, onOpenOptions, startLabel = "My location", finishLabel = "Destination", inspector, choices, actions, briefing, sheetExpanded = false, destinationLine = null, rideStyle, onExpandSheet, quick, hike = null, placeLabel }: PlannerResultPanelProps) {
  const activity = useActivityMode();
  const hikeView = activity === "hike" ? hike : null;
  const wide = useInspectorTier();
  const phone = usePhonePlanner();
  const compact = useCompactPlanner();
  const [comparing, setComparing] = useState(false);
  const [weatherLine, setWeatherLine] = useState<string | null>(null);
  // No route on screen means no traffic claim about one: the caller clears it,
  // and that has to survive the briefing (and its provider tree) being deferred.
  const { route, onRouteTraffic } = briefing;
  useEffect(() => {
    if (route === null) onRouteTraffic?.(null);
  }, [route, onRouteTraffic]);
  const selectedCard = choices.cards.find((card) => card.isSelected);
  const tint = selectedCard?.tint ?? 0;
  /**
   * The one summary (round 3, restructure call 3): every tier and every kind of
   * ride — a loop, a destination, a curated "Ride this", a saved or imported
   * line — reads the same component, so they cannot drift apart.
   */
  const summaryShown = hikeView === null && selectedCard !== undefined;
  const loopRide = briefing.ride.intent.shape === "loop";
  const automaticName = automaticRideName({
    rideTitle: actions.document.title,
    placeLabel: placeLabel ?? (loopRide ? startLabel : finishLabel),
    loopRide,
    distanceMeters: actions.route?.summary.distanceMeters ?? selectedCard?.distanceMeters ?? null,
  });
  const names = compareChoiceNames(choices.cards);
  const summary = selectedCard === undefined ? null : <RideSummary
    // A different line is a different ride to save: Saved and its name start over.
    key={selectedCard.routeId}
    card={selectedCard}
    cards={choices.cards}
    start={actions.start}
    title={destinationLine ?? "Your ride"}
    automaticName={automaticName}
    document={actions.document}
    libraryService={actions.libraryService}
    shareService={actions.shareService}
    route={actions.route}
    routeLine={briefing.route}
    elevationSource={briefing.providers?.elevationProfile}
    comparing={comparing}
    onCompare={() => { if (!comparing) onExpandSheet?.(); setComparing(!comparing); }}
    onSelect={choices.onSelect}
    {...(rideStyle === undefined ? {} : { rideStyle })}
    showQuickStyle={phone}
    weatherLine={weatherLine}
    {...(quick === undefined ? {} : { quick })}
    // On a phone the sheet is short; "Why this ride?" stays on the wide tier.
    explanation={phone ? null : choices.explanation}
  />;
  if (hikeView === null && showOptions && compact && selectedCard !== undefined) return <RouteOptions
    summary={summary}
    onEdit={onEditOptions} onOptions={onOpenOptions} optionsLabel={rideStyle === undefined ? undefined : rideStyleSummary(rideStyle.view)}>
      <AdvisorRideAsk />
      <RideActions {...actions} start={null} rideActions={undefined} />
      {briefing.route === null ? null : <PlannerRouteBriefing {...briefing} onWeatherLine={setWeatherLine} />}
      {briefing.route === null || briefing.providers?.elevationProfile === undefined ? null : <PlannerElevationProfile route={briefing.route} source={briefing.providers.elevationProfile} intent={briefing.ride.intent} tint={tint} surface={selectedCard.surfaceRuns} expandedBySheet={false} />}
    </RouteOptions>;
  const result = (
    <>
      {hikeView !== null || !choices.note ? null : (
        <p className="og-first-look-note" role="status" data-testid="first-look-note">{choices.note}</p>
      )}
      {hikeView !== null ? <HikeSummary hike={hikeView} start={actions.start} /> : null}
      {summaryShown ? summary : null}
      {/* The choices stay a list to pick from under the summary (on a phone
          further down the full sheet). The summary already carries the chosen
          ride's truth lines and "Why this ride?", so the cards stay quiet. */}
      {/* While the summary shows its own Compare list, a second list of the
          same choices below it would be two answers to one question. */}
      {hikeView !== null || choices.cards.length === 0 || (summaryShown && comparing) ? null : (
        <div className="og-result-choices"><RouteChoices cards={choices.cards}>
          {choices.cards.map((card) => (
            <RouteDecisionCard
              key={card.routeId}
              card={card}
              onSelect={choices.onSelect}
              name={card.roleKey === "alternative" ? names[card.routeId] : undefined}
              {...(summaryShown ? {} : { explanation: card.isSelected ? choices.explanation : null })}
              quiet={summaryShown}
            />
          ))}
        </RouteChoices></div>
      )}
      {briefing.route === null || briefing.providers?.elevationProfile === undefined || choices.cards.length === 0 ? null : (
        <PlannerElevationProfile
          route={briefing.route}
          source={briefing.providers.elevationProfile}
          intent={briefing.ride.intent}
          tint={tint}
          surface={selectedCard?.surfaceRuns}
          expandedBySheet={sheetExpanded}
        />
      )}
      {/* The sampled weather sits under the profile it is read against, and
          keeps answering when the profile provider does not. */}
      {briefing.route === null ? null : (
        <PlannerRouteWeather
          route={briefing.route}
          departure={briefing.ride.intent.departure}
          time={briefing.ride.intent.time}
        />
      )}
      <RideActions
        {...actions}
        start={hikeView !== null || summaryShown ? null : actions.start}
        {...(hikeView !== null || (summaryShown && phone) ? { rideActions: undefined } : {})}
      />
      {hikeView !== null || choices.cards.length === 0 ? null : <AdvisorRideAsk />}
      {hikeView !== null || briefing.route === null ? null : <PlannerRouteBriefing {...briefing} onWeatherLine={setWeatherLine} />}
    </>
  );
  if (!wide || inspector === null || choices.cards.length === 0) return result;
  return createPortal(
    <section className="og-planner__inspector-body" aria-label={hikeView === null ? "Your ride" : "Your hike"} data-testid="planner-inspector">
      {result}
    </section>,
    inspector,
  );
}
