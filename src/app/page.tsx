import { assetBasePathFromEnv } from "@/app/asset-base-path";
import { PlannerClient } from "@/app/PlannerClient";
import { advisorCapabilityFromEnv } from "@/infrastructure/advisor/config";
import { resolveBasemapMode } from "@/infrastructure/map/basemap";

/**
 * The planner workspace is the application
 * (04-PLANNER-AND-WORKSPACE-UX §1, 02-ARCHITECTURE-CONTRACT §17).
 *
 * Open the app, place a start and a destination on the map, plan, and choose among
 * the routes that come back. `PlannerClient` is the browser composition root for the
 * stores and the map renderer, so this file stays a server component whose only
 * decisions are which basemap the renderer draws (VNX-011/012) and which deployment
 * prefix its vendored assets are served under (4.0 review finding 2).
 *
 * ## Why this page is dynamic
 *
 * Both environment values are read **per request**, not baked at build time, so the
 * deployment's environment actually decides them. A statically prerendered page
 * would freeze them into the build, and a `next start` with a different value would
 * silently keep serving the old one — the kind of lie that makes "env-driven" a
 * comment instead of a behaviour. The resolution rules themselves are pure
 * functions with their own tests (`src/infrastructure/map/basemap.ts`,
 * `src/app/asset-base-path.ts`): an explicit mode wins, a test or CI process gets
 * the deterministic offline basemap, everything else — preview, production,
 * development — gets the real token-free OpenFreeMap style, and a base path is
 * normalized into `""` or `/prefix`.
 */
export const dynamic = "force-dynamic";

export default function Home() {
  const basemap = resolveBasemapMode(process.env.NEXT_PUBLIC_OGV_BASEMAP, {
    ...(process.env.NODE_ENV === undefined ? {} : { nodeEnv: process.env.NODE_ENV }),
    ci: process.env.CI !== undefined,
    ...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN === undefined
      ? {}
      : { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }),
  });
  // The test-only fixture switch enables the UI while Playwright intercepts its
  // API request. Normal deployments must have a server-side advisor key.
  const advisorEnabled =
    advisorCapabilityFromEnv().status === "available" || process.env.OGV_ADVISOR_FIXTURE === "1";

  return (
    <PlannerClient
      basemap={basemap}
      advisorEnabled={advisorEnabled}
      {...(basemap === "mapbox" && process.env.NEXT_PUBLIC_MAPBOX_TOKEN !== undefined
        ? { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }
        : {})}
      assetBasePath={assetBasePathFromEnv(process.env)}
    />
  );
}
