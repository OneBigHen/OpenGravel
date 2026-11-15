/**
 * Connects the loop anchors table to the loop-ring planner (RM-5).
 *
 * The table is optional. No file, or a table built for another map, gives no
 * rings and the engine's own loop is used.
 */

import type { LoopRingMaker } from "@/infrastructure/routing/graphhopper/provider";
import { estimateRoundTripDistanceMeters } from "@/infrastructure/routing/graphhopper/request-builder";
import { planLoopRings, type RingAnchor } from "@/application/planner/loop-skeletons";
import { createLoopAnchors, type LoopAnchorFilter, type LoopAnchorsPort } from "@/server/roads/loop-anchors";

const MAX_SAND_SHARE = 0.1;

function filterFor(request: Parameters<LoopRingMaker>[0]): LoopAnchorFilter {
  const bike = request.options.bike;
  const dirt = request.options.surfacePreference === "dirt-preferred";
  const street = bike?.category === "street" || bike?.category === "touring";
  const rough = bike?.roughTracks === "allow";
  return {
    kind: dirt ? "dirt" : "curvy",
    maxSandShare: MAX_SAND_SHARE,
    maxGrade: rough ? 4 : 2,
    requireThrough: street ? "street" : "any",
    maxTown: 0.5,
    minQuality: 0.2,
    limit: 500,
  };
}

export function createLoopRingMaker(path: string | null | undefined, log: (line: string) => void = (line) => console.warn(line)): LoopRingMaker {
  const ports = new Map<string, LoopAnchorsPort>();
  return (request, importDate, scales) => {
    const discovery = request.discovery;
    if (discovery === undefined || importDate === null) return [];
    let port = ports.get(importDate);
    if (port === undefined) {
      port = createLoopAnchors(path, importDate, log);
      ports.set(importDate, port);
    }
    if (!port.availability().available) return [];
    const loopMeters = estimateRoundTripDistanceMeters(request.profile, discovery.targetMinutes);
    // Search a box a bit wider than the ring can reach.
    const reachMeters = (loopMeters / 1.3 / Math.PI) * 1.4;
    const dLat = reachMeters / 111_320;
    const dLon = reachMeters / (111_320 * Math.cos((request.origin.lat * Math.PI) / 180));
    const found = port.anchorsNear(
      { south: request.origin.lat - dLat, north: request.origin.lat + dLat, west: request.origin.lon - dLon, east: request.origin.lon + dLon },
      filterFor(request),
    );
    const anchors: RingAnchor[] = found.map((anchor) => ({
      id: anchor.id, lat: anchor.lat, lon: anchor.lon, quality: anchor.quality, lengthMeters: anchor.lengthMeters, heading: anchor.heading,
    }));
    return planLoopRings({
      start: request.origin,
      loopMeters,
      ...(discovery.headingDegrees === undefined ? {} : { heading: discovery.headingDegrees }),
      seedKey: `${request.origin.lat.toFixed(4)}|${request.origin.lon.toFixed(4)}|${discovery.targetMinutes}|${discovery.variation ?? 0}`,
      anchors,
    }, scales);
  };
}
