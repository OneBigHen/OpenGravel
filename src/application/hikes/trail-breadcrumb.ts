import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";
import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";

/**
 * A mapped trail line as a breadcrumb: its two ends plus waypoints on the line
 * about every `spacingMeters`, each leg the trail's own recorded geometry. The
 * inner waypoints matter: "Plan on trails" routes through them in order, so a
 * trail whose ends sit close together is planned along the trail, not as the
 * shortcut between its ends.
 */
export function trailBreadcrumb(line: readonly Coordinate[], name: string, spacingMeters = 800, maxWaypoints = 12): BreadcrumbRoute | null {
  if (line.length < 2) return null;
  const along = [0];
  for (let i = 1; i < line.length; i += 1) along.push(along[i - 1]! + haversine(line[i - 1]!, line[i]!));
  const total = along[along.length - 1]!;
  if (total <= 0) return null;
  const inner = Math.min(maxWaypoints - 2, Math.max(0, Math.floor(total / spacingMeters) - 1));
  const cuts = [0];
  for (let k = 1; k <= inner; k += 1) {
    const target = (total * k) / (inner + 1);
    let index = cuts[cuts.length - 1]! + 1;
    while (index < line.length - 2 && along[index]! < target) index += 1;
    if (index > cuts[cuts.length - 1]! && index < line.length - 1) cuts.push(index);
  }
  cuts.push(line.length - 1);
  const waypoints = cuts.map((index, order) => ({
    id: order === 0 ? "trail-start" : order === cuts.length - 1 ? "trail-end" : `trail-${order}`,
    coordinate: line[index]!,
    name: order === 0 ? `${name} start` : order === cuts.length - 1 ? `${name} end` : `On ${name}`,
  }));
  const legs = cuts.slice(1).map((index, order) => ({ kind: "recorded" as const, geometry: line.slice(cuts[order]!, index + 1) }));
  return { waypoints, legs };
}
