import type { Metadata } from "next";

import type { CatalogEntry } from "@/application/explore/catalog";
import { staticRouteMapUrl } from "@/application/map/static-map";

/**
 * A shared route link unfurls as that route (launch kit): its name and
 * distance as the title, a one-line summary, and the route on a real map as
 * the preview image (Mapbox Static Images, the same map the cards use).
 * Unknown ids fall back to the site's own card.
 */
export function routeMetadata(
  id: string,
  entries: readonly CatalogEntry[],
  mapboxToken: string | undefined,
): Metadata {
  const entry = entries.find((route) => route.id === id);
  if (entry === undefined) return {};
  const miles = entry.distanceKm === null ? null : Math.round(entry.distanceKm / 1.609344);
  const title = miles === null ? entry.name : `${entry.name} · ${miles} mi`;
  const facts = [entry.surfaceSummary, entry.curvatureSummary].filter((fact): fact is string => fact !== undefined);
  const teaser = entry.storyTeaser;
  const lead = teaser === undefined
    ? entry.summary
    : `${teaser.sharedBy === undefined ? "Shared" : `Shared by ${teaser.sharedBy}`} in ${teaser.sourceName}`;
  const description = [lead, facts.join(" · ")].filter((part) => part !== "").join(" — ").slice(0, 200);
  const line = entry.geometry.length >= 2 ? entry.geometry : entry.previewGeometry ?? [];
  const image = mapboxToken === undefined ? null : staticRouteMapUrl(line, { token: mapboxToken, width: 600, height: 315 });
  const images = image === null ? undefined : [{ url: image, width: 1200, height: 630, alt: `${entry.name} on a map` }];
  return {
    title: `${title} · OpenGravel`,
    description,
    openGraph: {
      title,
      description,
      siteName: "OpenGravel",
      type: "website",
      ...(images === undefined ? {} : { images }),
    },
    twitter: {
      card: images === undefined ? "summary" : "summary_large_image",
      title,
      description,
      ...(images === undefined ? {} : { images: images.map((entryImage) => entryImage.url) }),
    },
  };
}
