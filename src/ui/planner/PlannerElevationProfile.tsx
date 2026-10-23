"use client";

import type { ComponentProps } from "react";
import type { ElevationSource } from "@/application/elevation/profile";
import type { PlannerPreparationRoute } from "@/application/preparation/planner-context";
import { ElevationProfileChart } from "./ElevationProfileChart";
import { useElevationProfile } from "./useElevationProfile";

export interface PlannerElevationProfileProps {
  readonly route: PlannerPreparationRoute & { readonly routeId: string };
  readonly source: ElevationSource;
  readonly tint: number;
  readonly surface: ComponentProps<typeof ElevationProfileChart>["surface"];
}

/** Sampling, fetching and drawing the profile start only once a route exists. */
export function PlannerElevationProfile({ route, source, tint, surface }: PlannerElevationProfileProps) {
  const elevation = useElevationProfile(source, route.routeId, route.geometry);
  if (elevation === null) return null;
  return (
    <div className="og-elevation-slot" data-tint={tint}>
      <ElevationProfileChart state={elevation} surface={surface} />
    </div>
  );
}
