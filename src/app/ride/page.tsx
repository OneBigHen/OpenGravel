import { assetBasePathFromEnv } from "@/app/asset-base-path";
import { RideClient } from "@/app/RideClient";
import { resolveBasemapMode } from "@/infrastructure/map/basemap";

/**
 * The Ride Focus route (08-RIDE-NAVIGATION-AND-FREE-RIDE §2, §13;
 * 04-PLANNER-AND-WORKSPACE-UX §28).
 *
 * It is a real URL on purpose: §13's recovery contract is "reload restores the
 * same session, paused", and a reload can only restore what a route can be
 * reloaded at. `/ride` therefore reads the bootstrap pointer, resumes the session
 * it names from the durable journal, and shows the surface — the same decisions
 * the planner's page makes about the basemap and the deployment prefix, read per
 * request for the same reason (an env value baked at build time would make
 * "environment-driven" a comment rather than a behaviour).
 */
export const dynamic = "force-dynamic";

export default function RidePage() {
  const basemap = resolveBasemapMode(process.env.NEXT_PUBLIC_OGV_BASEMAP, {
    ...(process.env.NODE_ENV === undefined ? {} : { nodeEnv: process.env.NODE_ENV }),
    ci: process.env.CI !== undefined,
    ...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN === undefined
      ? {}
      : { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }),
  });

  return (
    <RideClient
      basemap={basemap}
      {...(basemap === "mapbox" && process.env.NEXT_PUBLIC_MAPBOX_TOKEN !== undefined
        ? { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }
        : {})}
      assetBasePath={assetBasePathFromEnv(process.env)}
      fixturePosition={process.env.NEXT_PUBLIC_OGV_RIDE_FIXTURE === "1"}
    />
  );
}
