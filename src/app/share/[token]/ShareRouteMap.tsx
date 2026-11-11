"use client";

import { staticRouteMapUrl } from "@/application/map/static-map";
import type { Coordinate } from "@/domain/ride/types";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";
import { RouteLinePreview } from "@/ui/explore/RouteLinePreview";

/**
 * The share page's picture of the route.
 *
 * It uses the same static-map builder the route detail page falls back to, so
 * a link with a Mapbox token draws the real line on the real basemap. Without a
 * token it draws the route's own line rather than a sentence about a missing
 * picture — the shape is still the ride, and no tile server is required to see
 * it.
 */
export function ShareRouteMap({
  line,
  name,
  token,
}: {
  readonly line: readonly Coordinate[];
  readonly name: string;
  readonly token?: string;
}) {
  const night = useResolvedTheme() === "night";
  const image =
    token === undefined
      ? null
      : staticRouteMapUrl(line, {
          token,
          width: 960,
          height: 640,
          // The chosen route is plum in both themes; Night uses its lighter tint.
          color: night ? "b48ae0" : "7b4fa0",
          night,
        });
  if (image !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote static map; next/image would proxy it.
      <img
        className="og-route-detail__map-image"
        src={image}
        alt={`${name} on a map`}
        width={960}
        height={640}
      />
    );
  }
  return <RouteLinePreview line={line} name={name} />;
}
