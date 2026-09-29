import { assetBasePathFromEnv } from "@/app/asset-base-path";
import { ExploreClient } from "@/app/ExploreClient";
import { resolveBasemapMode } from "@/infrastructure/map/basemap";
import { serverCatalogEntries } from "@/server/explore/catalog-data";
import { routeMetadata } from "@/server/explore/route-metadata";
import type { Metadata } from "next";

/** Dynamic for the same reason as Explore: the basemap is read per request. */
export const dynamic = "force-dynamic";

/** A shared route link unfurls as that route (src/server/explore/route-metadata.ts). */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return routeMetadata(decodeURIComponent(id), serverCatalogEntries, process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
}

export default async function ExploreRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  // The route page draws its route on the live map, like Explore itself.
  const basemap = resolveBasemapMode(process.env.NEXT_PUBLIC_OGV_BASEMAP, {
    ...(process.env.NODE_ENV === undefined ? {} : { nodeEnv: process.env.NODE_ENV }),
    ci: process.env.CI !== undefined,
    ...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN === undefined
      ? {}
      : { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }),
  });
  return (
    <ExploreClient
      detailId={decodeURIComponent(id)}
      basemap={basemap}
      {...(basemap === "mapbox" && process.env.NEXT_PUBLIC_MAPBOX_TOKEN !== undefined
        ? { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN }
        : {})}
      assetBasePath={assetBasePathFromEnv(process.env)}
    />
  );
}
