"use client";

import dynamic from "next/dynamic";

/**
 * The workspace assembly for the controls that shape a planned ride.
 *
 * Each panel receives its current projection and typed actions from the
 * workspace controllers; this component owns only the Refine section layout.
 */

import { AvoidAreasPanel, type AvoidAreasPanelProps } from "@/ui/planner/AvoidAreasPanel";
import { RefineSection, refineSummary } from "@/ui/planner/RefineSection";
import type { RoadSpansPanelProps } from "@/ui/planner/RoadSpansPanel";
import type { SketchPanelProps } from "@/ui/planner/SketchPanel";
import type { StopsPanelProps } from "@/ui/planner/StopsPanel";

const RoadSpansPanel = dynamic(() => import("./RoadSpansPanel").then((mod) => mod.RoadSpansPanel), { loading: () => <p className="og-composer__reason" role="status">Loading road controls…</p> });

const SketchPanel = dynamic(() => import("./SketchPanel").then((mod) => mod.SketchPanel), { loading: () => <p className="og-composer__reason" role="status">Loading drawing controls…</p> });

const StopsPanel = dynamic(() => import("./StopsPanel").then((mod) => mod.StopsPanel), { loading: () => <p className="og-composer__reason" role="status">Loading stop controls…</p> });

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
