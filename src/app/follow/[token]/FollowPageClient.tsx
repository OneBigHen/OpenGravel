"use client";

/**
 * The follower page's composition root.
 *
 * It lives in `src/app` for the same reason the planner's and ride's do: only
 * the composition root may name the concrete map renderer, so `src/ui` stays
 * renderer-agnostic (4.0 review finding 8) and the basemap the deployment
 * configured arrives as a plain value from the server page.
 */

import { useMemo } from "react";

import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import type { LiveFollowSnapshot } from "@/domain/live/types";
import { createMapLibreHost } from "@/infrastructure/map/maplibre/host";
import { FollowScreen } from "@/ui/follow/FollowScreen";

export interface FollowPageClientProps {
  readonly token: string;
  readonly initial: LiveFollowSnapshot;
  readonly initialNow: number;
  readonly basemap: BasemapMode;
  readonly assetBasePath: string;
  readonly mapboxToken?: string;
}

export function FollowPageClient({
  token,
  initial,
  initialNow,
  basemap,
  assetBasePath,
  mapboxToken,
}: FollowPageClientProps) {
  // The token rides into the host's creation options here, so the screen never
  // carries it (OGV-D-265).
  const hostFactory = useMemo<MapHostFactory>(
    () =>
      mapboxToken === undefined
        ? createMapLibreHost
        : (container, options) => createMapLibreHost(container, { ...options, mapboxToken }),
    [mapboxToken],
  );
  return (
    <FollowScreen
      token={token}
      initial={initial}
      initialNow={initialNow}
      hostFactory={hostFactory}
      basemap={basemap}
      assetBasePath={assetBasePath}
    />
  );
}
