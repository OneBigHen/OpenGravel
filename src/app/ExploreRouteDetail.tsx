"use client";

import { useMemo } from "react";
import { createAppPreparationProviders } from "@/app/preparation-providers";
import { RouteDetail, type RouteDetailProps } from "@/ui/explore/RouteDetail";

/** Detail-only providers stay out of the Explore list's first interaction. */
export function ExploreRouteDetail(props: Omit<RouteDetailProps, "preparationProviders">) {
  const preparationProviders = useMemo(() => createAppPreparationProviders(), []);
  return <RouteDetail {...props} preparationProviders={preparationProviders} />;
}
