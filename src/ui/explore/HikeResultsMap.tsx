"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { TrailFeature } from "../../../infra/trails/lib/types";
import type { Coordinate } from "@/domain/ride/types";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";
import { readMapPalette } from "@/infrastructure/map/maplibre/style";
import { hillshadeBeforeId, hillshadeLayerSpec, terrainSourceSpec } from "@/infrastructure/map/maplibre/visual-detail";
import { mapboxRequestUrl } from "@/infrastructure/map/basemap";

type GeoJsonData = { readonly type: "FeatureCollection"; readonly features: readonly { readonly type: "Feature"; readonly properties: { readonly id: string; readonly selected: boolean }; readonly geometry: TrailFeature["geometry"] }[] };

function collection(trails: readonly { readonly id: string; readonly feature: TrailFeature }[], selected: string | null): GeoJsonData {
  return { type: "FeatureCollection", features: trails.map(({ id, feature }) => ({ type: "Feature", properties: { id, selected: id === selected }, geometry: feature.geometry })) };
}

/**
 * Explore hikes as a map: every listed trail's mapped line, the selected one
 * bold. Tapping a line selects that trail; the list below the map shows it.
 * The camera frames the listed trails once, then belongs to the hiker.
 */
export function HikeResultsMap({ trails, origin, selected, onSelect, mapboxToken }: {
  readonly trails: readonly { readonly id: string; readonly feature: TrailFeature }[];
  readonly origin: Coordinate;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
  readonly mapboxToken?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const ready = useRef(false);
  const framed = useRef(false);
  const latest = useRef({ trails, selected, onSelect });
  const theme = useResolvedTheme();
  useEffect(() => { latest.current = { trails, selected, onSelect }; });

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !ref.current) return;
      maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
      const palette = readMapPalette();
      const style = mapboxToken
        ? `https://api.mapbox.com/styles/v1/mapbox/${theme === "night" ? "navigation-night-v1" : "outdoors-v12"}?access_token=${encodeURIComponent(mapboxToken)}`
        : `https://tiles.openfreemap.org/styles/${theme === "night" ? "dark" : "liberty"}`;
      const map = new maplibregl.Map({ container: ref.current, style, center: [origin.lon, origin.lat], zoom: 11, attributionControl: { compact: true }, ...(mapboxToken ? { transformRequest: (url: string) => ({ url: mapboxRequestUrl(url, mapboxToken) }), validateStyle: false } : {}) });
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("og-terrain-dem", terrainSourceSpec() as import("maplibre-gl").SourceSpecification);
        map.addLayer(hillshadeLayerSpec(palette) as import("maplibre-gl").HillshadeLayerSpecification, hillshadeBeforeId(map.getStyle().layers ?? []));
        map.addSource("trails", { type: "geojson", data: collection(latest.current.trails, latest.current.selected) as never });
        map.addLayer({ id: "trails-casing", type: "line", source: "trails", paint: { "line-color": palette.paper, "line-width": ["case", ["get", "selected"], 9, 5] } });
        map.addLayer({ id: "trails-line", type: "line", source: "trails", paint: { "line-color": palette.trailBrown, "line-width": ["case", ["get", "selected"], 5, 2.5], "line-opacity": ["case", ["get", "selected"], 1, 0.75] } });
        // A generous invisible line makes a thin trail easy to hit with a finger.
        map.addLayer({ id: "trails-hit", type: "line", source: "trails", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 22 } });
        map.on("click", "trails-hit", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") latest.current.onSelect(id);
        });
        map.on("mouseenter", "trails-hit", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "trails-hit", () => { map.getCanvas().style.cursor = ""; });
        ready.current = true;
        frame(maplibregl);
        // Credits stay one tap away instead of covering the bottom of the map.
        const attribution = ref.current?.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.removeAttribute("open");
      });
    });
    function frame(maplibregl: typeof import("maplibre-gl")) {
      const map = mapRef.current;
      if (!map || framed.current || latest.current.trails.length === 0) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const { feature } of latest.current.trails) {
        const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
        for (const line of lines) for (const [lon, lat] of line) bounds.extend([lon, lat]);
      }
      if (!bounds.isEmpty()) { framed.current = true; map.fitBounds(bounds, { padding: 32, maxZoom: 14, duration: 0 }); }
    }
    return () => { cancelled = true; ready.current = false; framed.current = false; mapRef.current?.remove(); mapRef.current = null; };
  }, [origin, theme, mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    (map.getSource("trails") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(collection(trails, selected) as never);
    if (!framed.current && trails.length > 0) void import("maplibre-gl").then((maplibregl) => {
      const bounds = new maplibregl.LngLatBounds();
      for (const { feature } of trails) {
        const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
        for (const line of lines) for (const [lon, lat] of line) bounds.extend([lon, lat]);
      }
      if (!bounds.isEmpty()) { framed.current = true; map.fitBounds(bounds, { padding: 32, maxZoom: 14, duration: 0 }); }
    });
  }, [trails, selected]);

  return <div className="og-hike__results-map" ref={ref} role="region" aria-label="Map of the listed trails. Tap a trail to select it; the list below shows the same trails." data-testid="hike-results-map" />;
}
