"use client";

/**
 * The national library's answer for one planned line (L6): the rides near it,
 * and the map host their lines are drawn on.
 *
 * Both belong to the same question, so they are resolved together: the index
 * arrives once a line exists, and the rows are a pure projection of that index
 * and the line. Extracting them keeps the planner composition root from growing
 * a second data-loading concern.
 */

import { useMemo, useState } from "react";

import type { MapHost } from "@/application/map/map-host";
import type { RideProvenance } from "@/domain/ride/types";
import { ridesAlongRoute } from "@/application/route-library/along-route";
import type { PlannerActiveRoute } from "@/ui/planner/hooks/usePlannerActiveRoute";
import { usePlannerRouteLibrary } from "@/ui/planner/hooks/usePlannerRouteLibrary";

export function usePlannerGreatRoads(
  activeRoute: PlannerActiveRoute | null,
  provenance: RideProvenance,
) {
  const library = usePlannerRouteLibrary(activeRoute !== null);
  const greatRoads = useMemo(() => {
    if (library === null || activeRoute === null) return undefined;
    const sourceId = provenance.type === "catalog" ? provenance.sourceId : undefined;
    const rides = ridesAlongRoute(library.rows, activeRoute.geometry, {
      ...(sourceId === undefined ? {} : { excludeIds: new Set([sourceId]) }),
    });
    return rides.length === 0 ? undefined : { rides, sources: library.sources };
  }, [activeRoute, library, provenance]);
  const [mapHost, setMapHost] = useState<MapHost | null>(null);
  return { library, greatRoads, mapHost, setMapHost };
}
