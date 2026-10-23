"use client";

import { useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { RouteExplanation } from "@/application/planner/route-explanation";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import type { RoutingComparisonVm } from "@/application/planner/routing-method-comparison";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { PlannerRouteBriefingProps } from "@/ui/planner/PlannerRouteBriefing";
import { RideActions, type RideActionsProps } from "@/ui/planner/RideActions";
import { RouteChoices, RouteDecisionCard } from "@/ui/planner/RouteDecisionCard";
import { RoutingMethodComparison } from "@/ui/planner/RoutingMethodComparison";

// No route means there is no briefing or chart to draw. Keep their dependency
// trees out of the first map interaction.
const PlannerElevationProfile = dynamic(() => import("./PlannerElevationProfile").then((mod) => mod.PlannerElevationProfile), { loading: () => <p className="og-composer__reason" role="status">Loading elevation profile…</p> });
const PlannerRouteBriefing = dynamic(() => import("./PlannerRouteBriefing").then((mod) => mod.PlannerRouteBriefing), { loading: () => <p className="og-composer__reason" role="status">Loading ride briefing…</p> });

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
  readonly inspector: HTMLElement | null;
  readonly choices: {
    readonly cards: readonly RouteCardVm[];
    readonly explanation: RouteExplanation | null;
    readonly onSelect: (routeId: RouteCandidateId) => void;
    readonly comparisons?: RoutingComparisonVm;
  };
  readonly actions: RideActionsProps;
  readonly briefing: PlannerRouteBriefingProps;
}

export function PlannerResultPanel({ inspector, choices, actions, briefing }: PlannerResultPanelProps) {
  const wide = useInspectorTier();
  const { route, onRouteTraffic } = briefing;
  useEffect(() => {
    if (route === null) onRouteTraffic?.(null);
  }, [route, onRouteTraffic]);
  const selectedCard = choices.cards.find((card) => card.isSelected);
  const tint = selectedCard?.tint ?? 0;
  const result = (
    <>
      {choices.cards.length === 0 ? null : (
        <RouteChoices cards={choices.cards}>
          {choices.cards.map((card) => (
            <RouteDecisionCard
              key={card.routeId}
              card={card}
              onSelect={choices.onSelect}
              explanation={card.isSelected ? choices.explanation : null}
            />
          ))}
        </RouteChoices>
      )}
      {choices.comparisons === undefined ? null : <RoutingMethodComparison model={choices.comparisons} onSelect={choices.onSelect} />}
      {briefing.route === null || briefing.providers?.elevationProfile === undefined || choices.cards.length === 0 ? null : (
        <PlannerElevationProfile route={briefing.route} source={briefing.providers.elevationProfile} tint={tint} surface={selectedCard?.surfaceRuns} />
      )}
      <RideActions {...actions} />
      {briefing.route === null ? null : <PlannerRouteBriefing {...briefing} />}
    </>
  );
  if (!wide || inspector === null || choices.cards.length === 0) return result;
  return createPortal(
    <section className="og-planner__inspector-body" aria-label="Your ride" data-testid="planner-inspector">
      {result}
    </section>,
    inspector,
  );
}
