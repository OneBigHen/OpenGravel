/**
 * The planner map's scene: the projection of the document, session and live
 * previews (`buildMapScene`), with shaping anchors hidden at rest
 * (`sceneAtRest`). Anchors are handles, not places. They return for an edit:
 * the Change this ride panel open, an armed map tool, or the anchor itself
 * selected. A published Explore route can carry many of them, and at rest
 * they would bury the line under a row of dots.
 */
import { useMemo } from "react";

import { buildMapScene, type MapSceneInput } from "@/application/map/build-map-scene";
import type { MapScene } from "@/application/map/types";
import { sceneAtRest } from "@/ui/planner/scene-points";

export interface PlannerSceneEditing {
  readonly refineEditing: boolean;
  readonly activeTool: string;
  readonly placementTool: string;
}

export function usePlannerScene(input: MapSceneInput, editingState: PlannerSceneEditing): MapScene {
  const { document, session, uiState, preview, previewArea, previewSpan, previewSketch, changedSpan, readGeometry, riderPosition } = input;
  const { refineEditing, activeTool, placementTool } = editingState;
  const selectedObject = uiState.selectedObject;
  return useMemo(() => {
    const projected = buildMapScene({
      document, session, uiState: { selectedObject }, preview, previewArea, previewSpan, previewSketch, changedSpan, readGeometry, riderPosition,
    });
    const editing =
      refineEditing ||
      activeTool !== "pan" ||
      placementTool !== "idle" ||
      (selectedObject?.kind === "point" &&
        document.intent.shaping.some((anchor) => anchor.id === selectedObject.pointId));
    return sceneAtRest(projected, editing);
  }, [document, session, selectedObject, preview, previewArea, previewSpan, previewSketch, changedSpan, readGeometry, riderPosition, refineEditing, activeTool, placementTool]);
}
