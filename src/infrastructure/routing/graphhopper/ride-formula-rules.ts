import type { ProviderRouteOptions } from "@/application/planner/route-provider";
import type { GraphHopperCustomModelRule } from "./request-builder";

/** LM-safe search hints; unexpressible formula facts stay in candidate scoring. */
export function rideFormulaRules(options: Partial<ProviderRouteOptions>, enabled: boolean): GraphHopperCustomModelRule[] {
  if (!enabled || options.roadCharacter === "efficient") return [];
  if (options.roadCharacter !== "curvy" && options.roadCharacter !== "backroads") return [];
  return [
    { if: "curvature >= 0.98", multiply_by: options.roadCharacter === "curvy" ? "0.7" : "0.85" },
    { if: "road_class == MOTORWAY || road_class == TRUNK || road_class == PRIMARY", multiply_by: "0.75" },
    { if: "road_class == SERVICE || road_class == RESIDENTIAL && urban_density != RURAL", multiply_by: "0.85" },
  ];
}
