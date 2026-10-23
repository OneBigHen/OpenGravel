import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { assetBasePathFromEnv } from "@/app/asset-base-path";
import { renderInstant } from "@/app/render-clock";
import { resolveBasemapMode } from "@/infrastructure/map/basemap";
import { liveRideStore } from "@/server/live/live-ride-store";

import { FollowPageClient } from "./FollowPageClient";

/**
 * "Follow my ride": the page a rider sends to one loved one.
 *
 * No account, no app, no ads: one link, one map, one sentence about how the ride
 * is going. The page is dynamic for two reasons that both matter:
 *
 * - The ride is live, so it is read per request, never baked at build time.
 * - An expired or unknown token is a real 404 (`notFound()`), not an empty map.
 *   A follower who is told "no such ride" knows to ask for a new link; a blank
 *   page would leave them guessing.
 *
 * The rest of the page is a client surface that keeps asking for news every ten
 * seconds while it is visible (see `src/ui/follow/FollowScreen.tsx`). The first
 * paint needs no request at all: the snapshot read here is handed to it, with the
 * server's clock so the relative times hydrate to the same text.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Follow this ride · OpenGravel",
  description: "A live location link shared by a rider.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function FollowRidePage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const snapshot = liveRideStore().followSnapshot(token);
  if (snapshot === null) notFound();
  const basemap = resolveBasemapMode(process.env.NEXT_PUBLIC_OGV_BASEMAP, {
    ...(process.env.NODE_ENV === undefined ? {} : { nodeEnv: process.env.NODE_ENV }),
    ci: process.env.CI !== undefined,
    ...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN === undefined
      ? {}
      : { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }),
  });
  return (
    <FollowPageClient
      token={token}
      initial={snapshot}
      initialNow={renderInstant()}
      basemap={basemap}
      assetBasePath={assetBasePathFromEnv(process.env)}
      {...(basemap === "mapbox" && process.env.NEXT_PUBLIC_MAPBOX_TOKEN !== undefined
        ? { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }
        : {})}
    />
  );
}
