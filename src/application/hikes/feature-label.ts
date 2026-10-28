import type { TrailFeatureKind } from "../../../infra/trails/lib/rich-types";
export const FEATURE_LABELS: Record<TrailFeatureKind, string> = {
  waterfall: "Waterfall", viewpoint: "Views", peak: "Summit", "fire-tower": "Fire tower", water: "Lake / river", cave: "Cave", historic: "Historic site", shelter: "Shelter", campsite: "Campsite", "drinking-water": "Drinking water", toilets: "Toilets", parking: "Parking", trailhead: "Trailhead",
};
const priority: readonly TrailFeatureKind[] = ["waterfall", "viewpoint", "fire-tower", "peak", "cave", "water", "historic", "shelter", "campsite", "drinking-water", "trailhead", "toilets", "parking"];
export function featureLabel(kinds: readonly TrailFeatureKind[]): string {
  const kind = priority.find(k => kinds.includes(k));
  return kind ? FEATURE_LABELS[kind] : "";
}
