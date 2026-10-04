import type { ProviderRouteOptions } from "@/application/planner/route-provider";
import type { GraphHopperCustomModelRule } from "./request-builder";

const DIRT = "surface == UNPAVED || surface == GRAVEL || surface == FINE_GRAVEL || surface == COMPACTED || surface == DIRT || surface == GROUND";

/**
 * LM-safe search hints; unexpressible formula facts stay in candidate scoring.
 *
 * The deployed profiles run landmarks (hybrid), where a request can only make
 * weights worse. "Seek dirt/curves" is therefore written as penalties on what
 * the rider does not want (straight pavement, urban streets, arterials), never
 * as a reward, and every multiplier here is at most 1.
 */
export function rideFormulaRules(options: Partial<ProviderRouteOptions>, enabled: boolean): GraphHopperCustomModelRule[] {
  if (!enabled || options.roadCharacter === "efficient") return [];
  const dirt = options.surfacePreference === "dirt-preferred" || (options.targetUnpavedShare ?? 0) > 0 || options.bike?.category === "dual-sport";
  if (dirt) {
    return [
      { if: `curvature >= 0.98 && !(${DIRT})`, multiply_by: "0.85" },
      { if: "urban_density != RURAL && road_class != TRACK", multiply_by: "0.85" },
      { if: "road_class == SERVICE || road_class == RESIDENTIAL && urban_density != RURAL", multiply_by: "0.85" },
    ];
  }
  if (options.roadCharacter !== "curvy" && options.roadCharacter !== "backroads") return [];
  return [
    { if: "curvature >= 0.98", multiply_by: options.roadCharacter === "curvy" ? "0.7" : "0.85" },
    { if: "road_class == MOTORWAY || road_class == TRUNK || road_class == PRIMARY", multiply_by: "0.75" },
    { if: "road_class == SERVICE || road_class == RESIDENTIAL && urban_density != RURAL", multiply_by: "0.85" },
  ];
}
