/**
 * What a rider sees on the planner map when they are not editing.
 *
 * A shaping anchor is an editing handle, not a place: it exists so a drag can
 * bend the line, and a published route can carry dozens of them along a road.
 * Drawn at rest, they cover the line in dots and make a clean route read as a
 * string of pins the rider never placed. Start, stops and finish stay: those
 * are the ride's own places. The handles return while the rider is editing
 * (the Change this ride panel, an armed map tool, or a selected anchor).
 */
import type { MapScene } from "@/application/map/types";

export function sceneAtRest(scene: MapScene, editing: boolean): MapScene {
  if (editing) return scene;
  const points = scene.points.filter((point) => point.kind !== "shaping");
  if (points.length === scene.points.length) return scene;
  return { ...scene, points };
}
