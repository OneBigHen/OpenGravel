/**
 * Where the ride's line layers go in a hosted basemap's layer stack (PF-1,
 * 2026-11-12): above every basemap road, bridge and tunnel line, so no street
 * is painted over the ride, but still under the road names, shields and place
 * labels that come after them, so a town name is never cut by the line.
 *
 * Mapbox Outdoors interleaves road labels with road lines (60+ `road-*` and
 * `bridge-*` layers come after its first label), so "before the first label"
 * left a pale street stripe running down the middle of the ride.
 */

import type { HostedStyleLayer } from "./visual-detail";
import { isBasemapRoadLayer } from "./ride-focus-dim";

const OURS = /^(ogv|og)-/;
const ROAD_ID = /^(road|bridge|tunnel)-/;
/** Road furniture drawn as symbols: these sit with the roads, not with the labels. */
const ROAD_FURNITURE = /oneway|arrow|crosswalk|level-crossing|gate/;
/** Street names and shields: the ride line is drawn over these (PF-7), never under. */
const ROAD_NAME = /^(road|highway)[-_](label|name|number|exit|shield)|shield/;

function isOurs(layer: HostedStyleLayer): boolean {
  return OURS.test(layer.id);
}

/** The basemap's first label layer (never one of ours), or `undefined`. */
export function firstBasemapLabel(layers: readonly HostedStyleLayer[]): string | undefined {
  return layers.find((layer) => layer.type === "symbol" && !isOurs(layer))?.id;
}

/**
 * The id the ride's line layers are inserted before. `undefined` means append.
 *
 * The last basemap road line is found first; the answer is the first basemap
 * label after it that is not road furniture. A style with no road lines keeps
 * the old rule (the first label).
 */
export function routeLineAnchorId(layers: readonly HostedStyleLayer[]): string | undefined {
  let lastRoad = -1;
  layers.forEach((layer, index) => {
    if (isOurs(layer) || layer.type !== "line") return;
    if (isBasemapRoadLayer(layer) || ROAD_ID.test(layer.id)) lastRoad = index;
  });
  if (lastRoad < 0) return firstBasemapLabel(layers);
  // Street names along the ride would paint over the line and the puck: the
  // line goes above them, still under place names and the rest.
  let lastName = -1;
  layers.forEach((layer, index) => {
    if (!isOurs(layer) && layer.type === "symbol" && ROAD_NAME.test(layer.id)) lastName = index;
  });
  return layers
    .slice(Math.max(lastRoad, lastName) + 1)
    .find((layer) => layer.type === "symbol" && !isOurs(layer) && !ROAD_FURNITURE.test(layer.id))?.id;
}

/**
 * Whether a route line layer already in the style sits under a basemap road
 * line (a style kept its layers but they were added under the old rule), so it
 * must be moved up to the anchor.
 */
export function routeLineBelowRoads(layers: readonly HostedStyleLayer[], id: string): boolean {
  const at = layers.findIndex((layer) => layer.id === id);
  if (at < 0) return false;
  return layers
    .slice(at + 1)
    .some((layer) => !isOurs(layer) && layer.type === "line" && (isBasemapRoadLayer(layer) || ROAD_ID.test(layer.id)));
}
