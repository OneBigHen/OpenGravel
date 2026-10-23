import { knownRoadEvidence, type Bounds, type KnownRoadsPort } from "@/application/roads/known-roads";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteEvidence } from "@/domain/route/types";

/** Request-local reads and overlap work; provider fingerprints can collide. */
export function memoizedKnownRoadEvidence(port: KnownRoadsPort): (line: readonly Coordinate[]) => RouteEvidence {
  const cachedQuery = <T>(query: (bounds: Bounds) => readonly T[]) => {
    const boxes = new Map<string, readonly T[]>();
    return (bounds: Bounds): readonly T[] => {
      const key = JSON.stringify(bounds);
      let rows = boxes.get(key);
      if (rows === undefined) { rows = query(bounds); boxes.set(key, rows); }
      return rows;
    };
  };
  // Keep exact query boxes: a union can truncate a different set of rows at
  // the catalogue's MAX_ROWS cap, changing evidence for the original lines.
  const cachedPort: KnownRoadsPort = {
    curvyRoadsNear: cachedQuery(bounds => port.curvyRoadsNear(bounds)),
    gravelCorridorsNear: cachedQuery(bounds => port.gravelCorridorsNear(bounds)),
  };
  const lines = new Map<string, RouteEvidence>();
  return line => {
    const key = JSON.stringify(line);
    let evidence = lines.get(key);
    if (evidence === undefined) { evidence = knownRoadEvidence(line, cachedPort); lines.set(key, evidence); }
    return evidence;
  };
}
