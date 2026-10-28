/**
 * The planner map's scene: the projection of the document, session and live
 * previews (`buildMapScene`), with shaping anchors hidden at rest
 * (`sceneAtRest`). Anchors are handles, not places. They return for an edit:
 * the Change this ride panel open, an armed map tool, or the anchor itself
 * selected. A published Explore route can carry many of them, and at rest
 * they would bury the line under a row of dots.
 *
 * The **after-sunset reading** of the chosen line is resolved here, not in the
 * projection: it needs a clock (`usePlannerDaylight`) and one sun calculation per
 * vertex, so it is memoized against the route rather than recomputed on every
 * pointer move. `buildMapScene` stays a pure projection and only attaches the
 * answer to the line it describes.
 */
import { useMemo } from "react";

import { buildMapScene, type MapSceneInput } from "@/application/map/build-map-scene";
import { routeDaylightScene } from "@/application/map/route-daylight";
import type { MapScene, RouteDaylightScene } from "@/application/map/types";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { Coordinate } from "@/domain/ride/types";
import { usePlannerDaylight } from "@/ui/planner/hooks/usePlannerDaylight";
import { sceneAtRest } from "@/ui/planner/scene-points";

export interface PlannerSceneEditing {
  readonly refineEditing: boolean;
  readonly activeTool: string;
  readonly placementTool: string;
}

/** The chosen line and the engine's duration for it, as the map draws them. */
interface SelectedRouteLine {
  readonly geometry: readonly Coordinate[];
  readonly durationSeconds: number;
}

/**
 * The selected candidate's own line and duration, from the answer the map is
 * drawing — the same bundle `buildMapScene` projects, and never a second opinion
 * about it.
 */
function selectedRouteLine(
  session: PlanningSessionSnapshot,
  readGeometry: MapSceneInput["readGeometry"],
): SelectedRouteLine | null {
  const bundle = session.committedBundle ?? session.lastGoodBundle;
  if (bundle === null) return null;
  const candidate = bundle.candidates.find((entry) => entry.id === bundle.selectedRouteId);
  if (candidate === undefined) return null;
  const payload = readGeometry(candidate.geometryRef);
  if (payload === null || payload.kind !== "line") return null;
  return { geometry: payload.coordinates, durationSeconds: candidate.durationSeconds };
}

export function usePlannerScene(input: MapSceneInput, editingState: PlannerSceneEditing): MapScene {
  const { document, session, uiState, preview, previewArea, previewSpan, previewSketch, changedSpan, readGeometry, riderPosition, daylight: providedDaylight } = input;
  const { refineEditing, activeTool, placementTool } = editingState;
  const selectedObject = uiState.selectedObject;
  const departure = usePlannerDaylight({
    departure: document.intent.departure,
    time: document.intent.time,
    durationSeconds: selectedRouteLine(session, readGeometry)?.durationSeconds ?? null,
  });
  const selectedLine = useMemo(
    () => selectedRouteLine(session, readGeometry),
    [session, readGeometry],
  );
  /**
   * One sun calculation per route, not per frame: the geometry array and the
   * departure only change when the answer does, so a drag preview (which lives in
   * the UI store) re-projects without re-walking the line for sunset.
   */
  const daylight = useMemo((): RouteDaylightScene | null => {
    if (providedDaylight !== undefined) return providedDaylight;
    if (selectedLine === null || departure.departureAt === null) return null;
    return routeDaylightScene(
      selectedLine.geometry,
      selectedLine.durationSeconds,
      departure.departureAt,
      departure.riderTimeZone,
    );
  }, [providedDaylight, selectedLine, departure.departureAt, departure.riderTimeZone]);
  return useMemo(() => {
    const projected = buildMapScene({
      document, session, uiState: { selectedObject }, preview, previewArea, previewSpan, previewSketch, changedSpan, readGeometry, riderPosition, daylight,
    });
    const editing =
      refineEditing ||
      activeTool !== "pan" ||
      placementTool !== "idle" ||
      (selectedObject?.kind === "point" &&
        document.intent.shaping.some((anchor) => anchor.id === selectedObject.pointId));
    return sceneAtRest(projected, editing);
  }, [document, session, selectedObject, preview, previewArea, previewSpan, previewSketch, changedSpan, readGeometry, riderPosition, daylight, refineEditing, activeTool, placementTool]);
}
