import type { MapLayerId } from "@/application/map-layers/catalog";
import type { InfoFeature, LngLat, TerrainGrid } from "@/application/map-layers/types";

/** Keep regional contours legible and bounded; close views retain 20 m detail. */
export function terrainContourInterval(grid: TerrainGrid): number {
  const { bounds, size } = grid;
  const spacing = Math.max((bounds.east - bounds.west) * 111_195 * Math.cos((bounds.north + bounds.south) * Math.PI / 360), (bounds.north - bounds.south) * 111_195) / (size - 1);
  return 20 * 2 ** Math.max(0, Math.ceil(Math.log2(spacing / 250)));
}

const FEET_PER_METER = 3.28084;
const NICE_FEET = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const;

/**
 * The contour spacing a US rider reads: a round number of feet (50, 100, 200,
 * 500...) at least as coarse as the metric legibility rule above, so a close
 * view draws a line every 50 ft and a regional view every 500 ft.
 */
export function terrainContourIntervalFeet(grid: TerrainGrid): number {
  const wanted = terrainContourInterval(grid) * FEET_PER_METER * 0.75;
  return NICE_FEET.find((feet) => feet >= wanted) ?? NICE_FEET[NICE_FEET.length - 1]!;
}

const feetText = (feet: number): string => String(feet).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Marching triangles avoids the ambiguous saddle case of marching squares. */
export function terrainFeatures(grid: TerrainGrid, layers: readonly MapLayerId[]): readonly InfoFeature[] {
  const { bounds, size, heights } = grid;
  if (![bounds.west, bounds.east, bounds.south, bounds.north].every(Number.isFinite) || bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error("Invalid elevation grid bounds");
  if (!Number.isInteger(size) || size < 2 || size > 65 || heights.length !== size * size || !heights.every(Number.isFinite)) {
    throw new Error("Incomplete elevation grid");
  }
  const dx = (bounds.east - bounds.west) / (size - 1);
  const dy = (bounds.north - bounds.south) / (size - 1);
  const features: InfoFeature[] = [];
  const intervalFeet = terrainContourIntervalFeet(grid);
  for (let row = 0; row < size - 1; row++) {
    const lat = bounds.south + row * dy;
    const mx = dx * 111_195 * Math.cos((lat + dy / 2) * Math.PI / 180);
    const my = dy * 111_195;
    for (let col = 0; col < size - 1; col++) {
      const lon = bounds.west + col * dx;
      const points: readonly LngLat[] = [[lon, lat], [lon + dx, lat], [lon + dx, lat + dy], [lon, lat + dy]];
      const h = [heights[row * size + col]!, heights[row * size + col + 1]!, heights[(row + 1) * size + col + 1]!, heights[(row + 1) * size + col]!];
      if (layers.includes("slope")) {
        const grade = 100 * Math.hypot((h[1]! + h[2]! - h[0]! - h[3]!) / (2 * mx), (h[2]! + h[3]! - h[0]! - h[1]!) / (2 * my));
        features.push({ id: `slope:${lon}:${lat}:${dx}:${dy}`, layerId: "slope", name: `${Math.round(grade)}% terrain gradient`, detail: "Steepness of the ground itself, which is not the grade of the road.", weight: grade, geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] } });
      }
      if (!layers.includes("contours")) continue;
      for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
        const min = Math.min(...triangle.map((i) => h[i]!)) * FEET_PER_METER;
        const max = Math.max(...triangle.map((i) => h[i]!)) * FEET_PER_METER;
        for (let feet = Math.ceil(min / intervalFeet) * intervalFeet; feet < max; feet += intervalFeet) {
          const elevation = feet / FEET_PER_METER;
          const crossings: LngLat[] = [];
          for (let edge = 0; edge < 3; edge++) {
            const a = triangle[edge]!;
            const b = triangle[(edge + 1) % 3]!;
            if ((h[a]! <= elevation && h[b]! > elevation) || (h[b]! <= elevation && h[a]! > elevation)) {
              const fraction = (elevation - h[a]!) / (h[b]! - h[a]!);
              crossings.push([points[a]![0] + fraction * (points[b]![0] - points[a]![0]), points[a]![1] + fraction * (points[b]![1] - points[a]![1])]);
            }
          }
          if (crossings.length === 2 && (crossings[0]![0] !== crossings[1]![0] || crossings[0]![1] !== crossings[1]![1])) {
            features.push({ id: `contour:${lon}:${lat}:${dx}:${dy}:${triangle[1]}:${feet}`, layerId: "contours", name: `${feetText(feet)} ft contour`, detail: `A line every ${feetText(intervalFeet)} ft of elevation at this zoom.`, weight: feet % (intervalFeet * 5) === 0 ? 2 : 1, geometry: { type: "LineString", coordinates: crossings } });
          }
          if (features.length > 30_000) throw new Error("Terrain detail exceeds view budget; zoom in");
        }
      }
    }
  }
  return features;
}
