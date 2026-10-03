import type { MapLayerId } from "@/application/map-layers/catalog";
import type { InfoFeature, LngLat, TerrainGrid } from "@/application/map-layers/types";

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
        features.push({ id: `slope:${lon}:${lat}:${dx}:${dy}`, layerId: "slope", name: `${Math.round(grade)}% terrain gradient`, detail: `Derived Terrarium terrain gradient over approximately ${Math.round(mx)} × ${Math.round(my)} m; not road grade. Survey date unknown.`, weight: grade, geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] } });
      }
      if (!layers.includes("contours")) continue;
      for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
        const min = Math.min(...triangle.map((i) => h[i]!));
        const max = Math.max(...triangle.map((i) => h[i]!));
        for (let elevation = Math.ceil(min / 20) * 20; elevation < max; elevation += 20) {
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
            features.push({ id: `contour:${lon}:${lat}:${dx}:${dy}:${triangle[1]}:${elevation}`, layerId: "contours", name: `${elevation} m contour`, detail: "Derived Terrarium elevation, metres above sea level; source survey date unknown.", weight: elevation % 100 === 0 ? 2 : 1, geometry: { type: "LineString", coordinates: crossings } });
          }
          if (features.length > 30_000) throw new Error("Terrain detail exceeds view budget; zoom in");
        }
      }
    }
  }
  return features;
}
