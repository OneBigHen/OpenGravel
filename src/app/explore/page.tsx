import { assetBasePathFromEnv } from "@/app/asset-base-path";
import { ExploreClient } from "@/app/ExploreClient";
import { resolveBasemapMode } from "@/infrastructure/map/basemap";

/**
 * Explore reads the basemap per request for its route map, exactly as the
 * planner does (see `src/app/page.tsx` for why it is dynamic).
 */
export const dynamic = "force-dynamic";

export default function ExplorePage() {
  const basemap = resolveBasemapMode(process.env.NEXT_PUBLIC_OGV_BASEMAP, {
    ...(process.env.NODE_ENV === undefined ? {} : { nodeEnv: process.env.NODE_ENV }),
    ci: process.env.CI !== undefined,
    ...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN === undefined
      ? {}
      : { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }),
  });
  return (
    <ExploreClient
      basemap={basemap}
      {...(basemap === "mapbox" && process.env.NEXT_PUBLIC_MAPBOX_TOKEN !== undefined
        ? { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }
        : {})}
      assetBasePath={assetBasePathFromEnv(process.env)}
    />
  );
}
