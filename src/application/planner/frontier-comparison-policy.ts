/** Positive comparison preferences; never a replacement for canonical RoutePolicy. */
import type { RoadCharacterIntent } from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";
import type { FrontierPreferenceProfile } from "./frontier-routing";

const BALANCED: readonly FrontierPreferenceProfile[] = deepFreeze([
  { id: "efficient", weights: { timeEfficiency: 0.8, curvature: 0.1, backroad: 0.1 } },
  { id: "curvy", weights: { timeEfficiency: 0.15, curvature: 0.65, backroad: 0.2 } },
  { id: "backroads", weights: { timeEfficiency: 0.2, curvature: 0.2, backroad: 0.6 } },
]);

const EFFICIENT: readonly FrontierPreferenceProfile[] = deepFreeze([
  { id: "efficient", weights: { timeEfficiency: 0.85, curvature: 0.075, backroad: 0.075 } },
  { id: "efficient-flexible", weights: { timeEfficiency: 0.75, curvature: 0.15, backroad: 0.1 } },
  { id: "efficient-direct", weights: { timeEfficiency: 0.9, curvature: 0.05, backroad: 0.05 } },
]);

const CURVY: readonly FrontierPreferenceProfile[] = deepFreeze([
  { id: "curvy", weights: { timeEfficiency: 0.15, curvature: 0.75, backroad: 0.1 } },
  { id: "curvy-flexible", weights: { timeEfficiency: 0.25, curvature: 0.65, backroad: 0.1 } },
  { id: "curvy-focused", weights: { timeEfficiency: 0.1, curvature: 0.8, backroad: 0.1 } },
]);

const CURVY_WITH_CONTINUITY: readonly FrontierPreferenceProfile[] = deepFreeze([
  { id: "curvy", weights: { timeEfficiency: 0.15, curvature: 0.5, backroad: 0.1, flow: 0.25 } },
  { id: "curvy-flexible", weights: { timeEfficiency: 0.25, curvature: 0.45, backroad: 0.1, flow: 0.2 } },
  { id: "curvy-focused", weights: { timeEfficiency: 0.1, curvature: 0.55, backroad: 0.1, flow: 0.25 } },
]);

const BACKROADS: readonly FrontierPreferenceProfile[] = deepFreeze([
  { id: "backroads", weights: { timeEfficiency: 0.15, curvature: 0.15, backroad: 0.7 } },
  { id: "backroads-flexible", weights: { timeEfficiency: 0.25, curvature: 0.15, backroad: 0.6 } },
  { id: "backroads-focused", weights: { timeEfficiency: 0.1, curvature: 0.1, backroad: 0.8 } },
]);

/** Compare nearby positive preferences around the rider's explicit Roads choice. */
export function frontierComparisonProfiles(roadCharacter: RoadCharacterIntent, commonContinuity = false): readonly FrontierPreferenceProfile[] {
  if (roadCharacter === "efficient") return EFFICIENT;
  if (roadCharacter === "curvy") return commonContinuity ? CURVY_WITH_CONTINUITY : CURVY;
  if (roadCharacter === "backroads") return BACKROADS;
  return BALANCED;
}
