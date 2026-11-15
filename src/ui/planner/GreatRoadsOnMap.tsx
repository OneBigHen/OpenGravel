"use client";

/**
 * Draws the great roads near a planned line on the planner's map (L6).
 *
 * The lines come from the library's own state files, the same bytes Explore
 * draws, so the shape beside the route is the shape on the ride page. They are
 * thin plum, dashed where the ride is dirt or trail, and sit under the rider's
 * chosen line in weight: a suggestion, never a second route.
 *
 * The host owns the renderer; this component owns one small overlay and nothing
 * else. When no library line has loaded yet, or no ride is near, it draws
 * nothing rather than a guessed shape.
 */

import { useEffect, useMemo, useState } from "react";

import type { MapHost } from "@/application/map/map-host";
import type { AlongRouteRide } from "@/application/route-library/along-route";
import { hasLine, type LinePart, type RouteLibrary } from "@/application/route-library/client";
import type { IndexRow } from "@/application/route-library/types";

const SOURCE_LINES = "og-near-rides-lines";
const SOURCE_DOTS = "og-near-rides-dots";
const LAYER_SOLID = "og-near-rides-solid";
const LAYER_DASH = "og-near-rides-dash";
const LAYER_DOTS = "og-near-rides-dots-layer";

type Feature = {
  readonly type: "Feature";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly geometry: { readonly type: string; readonly coordinates: unknown };
};

function lineFeature(row: IndexRow, parts: readonly LinePart[]): Feature {
  return {
    type: "Feature",
    properties: { id: row.id, t: row.t, k: row.k, q: row.q },
    geometry: {
      type: parts.length === 1 ? "LineString" : "MultiLineString",
      coordinates: parts.length === 1 ? parts[0] : parts,
    },
  };
}

export function GreatRoadsOnMap({
  host,
  library,
  rides,
}: {
  readonly host: MapHost | null;
  readonly library: RouteLibrary | null;
  readonly rides: readonly AlongRouteRide[];
}) {
  const [lines, setLines] = useState<ReadonlyMap<string, readonly LinePart[]>>(() => new Map());
  const [attached, setAttached] = useState(false);

  // One state file per ride; a multi-state ride is already in each of them.
  useEffect(() => {
    if (library === null) return;
    const states = [...new Set(rides.filter(({ row }) => hasLine(row)).flatMap(({ row }) => row.st.slice(0, 1)))];
    if (states.length === 0) return;
    let active = true;
    void Promise.all(states.map(async (state) => [state, await library.linesFor(state)] as const)).then((answers) => {
      if (!active) return;
      const byId = new Map<string, readonly LinePart[]>();
      for (const [, stateLines] of answers) {
        if (stateLines === null) continue;
        for (const [id, parts] of stateLines) byId.set(id, parts);
      }
      setLines(byId);
    });
    return () => { active = false; };
  }, [library, rides]);

  const drawn = useMemo(
    () => rides.filter(({ row }) => hasLine(row) && (lines.get(row.id)?.length ?? 0) > 0),
    [lines, rides],
  );

  useEffect(() => {
    if (host?.attachOverlay === undefined) return undefined;
    const features: Feature[] = drawn.flatMap(({ row }) => {
      const parts = lines.get(row.id);
      return parts === undefined || parts.length === 0 ? [] : [lineFeature(row, parts)];
    });
    if (features.length === 0) return undefined;
    const dots: Feature[] = drawn.flatMap(({ row }) =>
      row.p === null
        ? []
        : [{
            type: "Feature" as const,
            properties: { id: row.id },
            geometry: { type: "Point", coordinates: [row.p[1], row.p[0]] },
          }]);
    const detach = host.attachOverlay(({ map, colours }) => {
      const add = (id: string): void => {
        if (map.getSource(id) === undefined) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      };
      add(SOURCE_LINES);
      add(SOURCE_DOTS);
      const common = {
        type: "line",
        source: SOURCE_LINES,
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
      };
      const width = ["interpolate", ["linear"], ["zoom"], 7, 1.2, 12, 2.2, 16, 3.2];
      if (map.getLayer(LAYER_SOLID) === undefined) {
        map.addLayer({ ...common, id: LAYER_SOLID, filter: ["match", ["get", "t"], ["dirt", "trail"], false, true], paint: { "line-color": colours.route, "line-width": width, "line-opacity": 0.72 } });
      }
      if (map.getLayer(LAYER_DASH) === undefined) {
        map.addLayer({ ...common, id: LAYER_DASH, filter: ["match", ["get", "t"], ["dirt", "trail"], true, false], paint: { "line-color": colours.route, "line-width": width, "line-opacity": 0.78, "line-dasharray": [2, 1.4] } });
      }
      if (map.getLayer(LAYER_DOTS) === undefined) {
        map.addLayer({ id: LAYER_DOTS, type: "circle", source: SOURCE_DOTS, minzoom: 6, paint: { "circle-radius": 3.5, "circle-color": colours.route, "circle-stroke-color": colours.paper, "circle-stroke-width": 1.5 } });
      }
      map.getSource(SOURCE_LINES)?.setData({ type: "FeatureCollection", features });
      map.getSource(SOURCE_DOTS)?.setData({ type: "FeatureCollection", features: dots });
      setAttached(true);
      return () => {
        for (const id of [LAYER_DOTS, LAYER_DASH, LAYER_SOLID]) if (map.getLayer(id) !== undefined) map.removeLayer(id);
        for (const id of [SOURCE_DOTS, SOURCE_LINES]) if (map.getSource(id) !== undefined) map.removeSource(id);
        setAttached(false);
      };
    });
    return () => detach();
  }, [drawn, host, lines]);

  return <span data-testid="great-roads-on-map" data-count={attached ? drawn.length : 0} hidden />;
}
