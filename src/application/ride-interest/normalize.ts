/**
 * Provider parsing: turns each source's own shape into `RideInterestPoint[]`.
 * Pure and source-specific; the merge and the corridor/ahead math live
 * elsewhere so this file stays a straight translation a unit test can pin.
 */

import type { AlongStop } from "@/application/map-layers/along";
import { mapLayer, type MapLayerId } from "@/application/map-layers/catalog";
import type { NearbyPlace } from "@/application/places/types";
import type { DiscoverCategory, InterestingPlace } from "@/application/discover/types";

import type { RideInterestFilter, RideInterestPoint } from "./types";

/** Every Wikimedia/OSM discover category buckets as Scenic, except events. */
export function discoverCategoryFilter(category: DiscoverCategory): Exclude<RideInterestFilter, "off"> {
  return category === "event" ? "events" : "scenic";
}

/** Wikimedia/Wikidata/OSM landmarks along the route (OGV-D-278/282: discovery only). */
export function discoverPlacesToRideInterest(places: readonly InterestingPlace[]): readonly RideInterestPoint[] {
  return places.map((place) => ({
    id: `ri:discover:${place.id}`,
    filter: discoverCategoryFilter(place.category),
    kind: place.category,
    name: place.name,
    coordinate: place.coordinate,
    summary: place.description,
    photoUrl: place.image?.url ?? null,
    detailUrl: place.provenance[0]?.url ?? null,
    attribution: place.provenance[0]?.sourceLabel ?? "Wikimedia",
  }));
}

/** Which sheet filter a `MapLayersSource.along` layer's stops belong to. */
export function mapLayerFilter(layerId: MapLayerId): Exclude<RideInterestFilter, "off"> | null {
  switch (layerId) {
    case "fuel":
    case "food":
    case "coffee":
      return "food";
    case "viewpoints":
    case "camping":
      return "scenic";
    default:
      return null;
  }
}

/** Fuel, food, coffee, camping or viewpoints found along the route (`MapLayersSource.along`). */
export function alongStopsToRideInterest(
  stops: readonly AlongStop[],
  layerId: MapLayerId,
): readonly RideInterestPoint[] {
  const filter = mapLayerFilter(layerId);
  if (filter === null) return [];
  const layer = mapLayer(layerId);
  const points: RideInterestPoint[] = [];
  for (const stop of stops) {
    if (stop.feature.geometry.type !== "Point") continue;
    const [lon, lat] = stop.feature.geometry.coordinates;
    points.push({
      id: `ri:layer:${layerId}:${stop.feature.id}`,
      filter,
      kind: layerId,
      name: stop.feature.name,
      coordinate: { lon, lat },
      summary: stop.feature.detail,
      photoUrl: null,
      detailUrl: null,
      attribution: layer.source,
    });
  }
  return points;
}

/** Happy hours and rodeo events along the route (`PlacesSource.alongRoute`). */
export function nearbyPlacesToRideInterest(places: readonly NearbyPlace[]): readonly RideInterestPoint[] {
  return places.map((place) => ({
    id: `ri:place:${place.id}`,
    filter: "events",
    kind: place.kind,
    name: place.name,
    coordinate: place.coordinate,
    summary: place.schedule ?? place.label,
    photoUrl: null,
    detailUrl: place.url,
    attribution: "Places",
  }));
}
