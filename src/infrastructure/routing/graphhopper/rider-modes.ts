import type { ProviderRouteOptions } from "@/application/planner/route-provider";
import type { GraphHopperCustomModelRule } from "./request-builder";

const MAINTAINED = "surface == UNPAVED || surface == GRAVEL || surface == FINE_GRAVEL || surface == COMPACTED || surface == DIRT || surface == GROUND || (road_class == TRACK && (track_type == GRADE1 || track_type == GRADE2))";
const ROUGH = "track_type == GRADE3 || track_type == GRADE4 || track_type == GRADE5";

/** Highest dirt strength a request may ask for (pavement x0.118 at a 50% target). */
export const MAX_DIRT_STRENGTH = 5;

/** Request multipliers preserve hard zeroes. No access or speed is unlocked. */
export function riderModeRules(
  options: Partial<ProviderRouteOptions>,
  enabled = true,
  omitSmoothness = false,
  profile = "motorcycle_adventure",
): GraphHopperCustomModelRule[] {
  if (!enabled) return [];
  const rules: GraphHopperCustomModelRule[] = [];
  const raw = Math.max(0, options.riderModeFactor ?? 1);
  // Dirt strength may reach the router's step near pavement x0.1; busy-road
  // penalties stop at 4, where they already bury primaries.
  const strength = Math.min(MAX_DIRT_STRENGTH, raw);
  const busyStrength = Math.min(4, raw);
  const target = options.targetUnpavedShare ?? (options.surfacePreference === "dirt-preferred" ? 0.5 : 0);
  if (target > 0 && options.bike?.maintainedGravel !== "avoid") {
    const preferred = options.bike?.category === "dual-sport" && options.bike.roughTracks === "allow"
      ? `${MAINTAINED} || (road_class == TRACK && (track_type == GRADE3 || track_type == GRADE4))`
      : MAINTAINED;
    rules.push({ if: `!(${preferred})`, multiply_by: String(Number((1 / (1 + 3 * target * strength)).toFixed(4))) });
  }
  if (target > 0 && options.bike?.maintainedGravel !== "avoid") {
    const dirtPenalty = (condition: string, factor: number): void => {
      rules.push({ if: condition, multiply_by: String(Number((factor ** (target * strength)).toFixed(4))) });
    };
    dirtPenalty("road_class == MOTORWAY || road_class == TRUNK || road_class == PRIMARY", 0.45);
    dirtPenalty("road_class == SECONDARY && max_speed >= 80", 0.7);
  }
  if (options.traffic === "protect-ride" && options.roadCharacter !== "efficient") {
    const penalty = (condition: string, factor: number): void => {
      rules.push({ if: condition, multiply_by: String(Number((factor ** busyStrength).toFixed(4))) });
    };
    penalty("road_class == MOTORWAY || road_class == TRUNK", 0.65);
    penalty("road_class == PRIMARY", 0.8);
    penalty("road_class_link", 0.85);
    penalty("urban_density == CITY", 0.65);
    penalty("urban_density == RESIDENTIAL", 0.95);
    penalty("max_speed >= 80 && (road_class == PRIMARY || road_class == SECONDARY)", 0.9);
  }
  const bike = options.bike;
  if (bike !== undefined || target > 0 || (options.traffic === "protect-ride" && options.roadCharacter !== "efficient")) {
    rules.push({ if: "surface == SAND || road_access == PRIVATE || !car_access", multiply_by: "0" });
  }
  if (bike !== undefined) {
    if (bike.maintainedGravel === "avoid") rules.push({ if: MAINTAINED, multiply_by: "0" });
    if (bike.category === "dual-sport" && bike.roughTracks === "allow") {
      // Query multipliers cannot exceed one. Lower competing priorities to
      // make the persistent 0.4 rough-track weight relatively 0.8.
      if (profile === "motorcycle_adventure") {
        rules.push({ if: "!(track_type == GRADE3 || track_type == GRADE4)", multiply_by: "0.5" });
        if (!omitSmoothness) rules.push({ if: "!(smoothness == BAD || smoothness == VERY_BAD)", multiply_by: "0.8" });
      }
      rules.push({ if: "track_type == GRADE5", multiply_by: "0" });
    } else if (bike.roughTracks === "avoid" || bike.category === "street" || bike.category === "touring") {
      rules.push({ if: ROUGH, multiply_by: "0" });
      if (!omitSmoothness) rules.push({ if: "smoothness == BAD || smoothness == VERY_BAD || smoothness == HORRIBLE || smoothness == VERY_HORRIBLE || smoothness == IMPASSABLE", multiply_by: "0" });
    }
  }
  return rules;
}
