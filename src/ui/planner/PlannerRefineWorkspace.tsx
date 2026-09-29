"use client";

/**
 * The workspace assembly for the controls that shape a planned ride.
 *
 * Each panel receives its current projection and typed actions from the
 * workspace controllers; this component owns only the Refine section layout.
 */

import { AvoidAreasPanel, type AvoidAreasPanelProps } from "@/ui/planner/AvoidAreasPanel";
import { RefineSection, refineSummary } from "@/ui/planner/RefineSection";
import { RoadSpansPanel, type RoadSpansPanelProps } from "@/ui/planner/RoadSpansPanel";
import { SketchPanel, type SketchPanelProps } from "@/ui/planner/SketchPanel";
import { StopsPanel, type StopsPanelProps } from "@/ui/planner/StopsPanel";

export interface PlannerRefineWorkspaceProps {
  readonly forceOpen: boolean;
  readonly summaryCounts: {
    readonly stops: number;
    readonly avoidAreas: number;
    readonly roadSpans: number;
    readonly sketch: boolean;
  };
  readonly stops: StopsPanelProps;
  readonly avoidAreas: AvoidAreasPanelProps;
  readonly roadSpans: RoadSpansPanelProps | null;
  readonly sketch: SketchPanelProps;
}

export function PlannerRefineWorkspace({
  forceOpen,
  summaryCounts,
  stops,
  avoidAreas,
  roadSpans,
  sketch,
}: PlannerRefineWorkspaceProps) {
  return (
    <RefineSection forceOpen={forceOpen} summary={refineSummary(summaryCounts)}>
      <StopsPanel {...stops} />
      <AvoidAreasPanel {...avoidAreas} />
      {/*
       * A road span can only be selected against a route. Existing spans remain
       * visible before a route so their current authored intent stays reachable.
       */}
      {roadSpans === null ? null : <RoadSpansPanel {...roadSpans} />}
      {/*
       * The drawing toolbar stays visible for an armed sketch and a committed
       * sketch, where it is the control that removes the authored drawing.
       */}
      <SketchPanel {...sketch} />
    </RefineSection>
  );
}
