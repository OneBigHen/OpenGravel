import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

export interface RiderFlowSegment {
  readonly geometry: readonly Coordinate[];
  readonly currentSpeed: number | null;
  readonly freeFlowSpeed: number | null;
  readonly delaySeconds: number | null;
}

/** Only matching road sections contribute delay, avoiding duplicate flow samples. */
function exposure(candidate: ProviderCandidate, segments: readonly RiderFlowSegment[]): { meters: number; delay: number } {
  let meters = 0;
  let delay = 0;
  for (let index = 1; index < candidate.geometry.length; index += 1) {
    const from = candidate.geometry[index - 1]!;
    const to = candidate.geometry[index]!;
    const length = haversine(from, to);
    const center = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
    let edgeDelay = 0;
    let matched = false;
    for (const segment of segments) {
      let segmentLength = 0;
      let near = false;
      for (let j = 1; j < segment.geometry.length; j += 1) {
        const a = segment.geometry[j - 1]!;
        const b = segment.geometry[j]!;
        segmentLength += haversine(a, b);
        const cos = Math.cos(center.lat * Math.PI / 180);
        const ax = (a.lon - center.lon) * cos * 111320;
        const ay = (a.lat - center.lat) * 111320;
        const dx = (b.lon - a.lon) * cos * 111320;
        const dy = (b.lat - a.lat) * 111320;
        const norm = dx * dx + dy * dy;
        if (norm === 0) continue;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / norm));
        const ex = (to.lon - from.lon) * cos;
        const ey = to.lat - from.lat;
        const alignment = Math.abs(ex * dx + ey * dy) / (Math.hypot(ex, ey) * Math.sqrt(norm));
        if (Math.hypot(ax + t * dx, ay + t * dy) <= 30 && alignment >= 0.85) near = true;
      }
      if (near) {
        matched = true;
        edgeDelay = Math.max(edgeDelay, Math.max(0, segment.delaySeconds ?? 0) * Math.min(1, length / Math.max(1, segmentLength)));
      }
    }
    if (matched) { meters += length; delay += edgeDelay; }
  }
  return { meters, delay };
}

function penaltyPolygon(segment: RiderFlowSegment): readonly Coordinate[] {
  const latitudes = segment.geometry.map(point => point.lat);
  const longitudes = segment.geometry.map(point => point.lon);
  const latitude = latitudes.reduce((sum, lat) => sum + lat, 0) / latitudes.length;
  const latPad = 30 / 111320;
  const lonPad = latPad / Math.cos(latitude * Math.PI / 180);
  const south = Math.min(...latitudes) - latPad;
  const north = Math.max(...latitudes) + latPad;
  const west = Math.min(...longitudes) - lonPad;
  const east = Math.max(...longitudes) + lonPad;
  return [{ lat: south, lon: west }, { lat: north, lon: west }, { lat: north, lon: east }, { lat: south, lon: east }, { lat: south, lon: west }];
}

/** One optional reroute, compared against the same sampled current flow data. */
export async function refineRiderTraffic(input: {
  readonly request: ProviderRouteRequest;
  readonly candidate: ProviderCandidate;
  readonly provider: RouteCandidateProvider;
  readonly sample: (candidate: ProviderCandidate, signal: AbortSignal) => Promise<readonly RiderFlowSegment[]>;
  readonly signal: AbortSignal;
}): Promise<ProviderCandidate | null> {
  if (input.signal.aborted) throw input.signal.reason;
  if (input.request.options.traffic !== "protect-ride" || input.request.options.departureNow !== true || input.request.options.roadCharacter === "efficient" || input.request.discovery !== undefined || input.request.sketch !== undefined) return null;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(5000)]);
  try {
    const segments = await input.sample(input.candidate, signal);
    if (input.signal.aborted) throw input.signal.reason;
    const jams = segments.filter(segment => segment.geometry.length >= 2 && segment.currentSpeed !== null && segment.freeFlowSpeed !== null && segment.freeFlowSpeed > 0 && segment.currentSpeed / segment.freeFlowSpeed < 0.6);
    if (jams.length === 0 || signal.aborted) return null;
    const hasDelayEvidence = jams.every(segment => segment.delaySeconds !== null && Number.isFinite(segment.delaySeconds) && segment.delaySeconds >= 0);
    const before = exposure(input.candidate, jams);
    if (before.meters === 0) return null;
    const result = await input.provider.candidates({ ...input.request, options: { ...input.request.options, includeAlternatives: false, trafficPenaltyPolygons: jams.map(penaltyPolygon) } }, signal);
    if (input.signal.aborted) throw input.signal.reason;
    const kept = result.candidates.filter(candidate => {
      const after = exposure(candidate, jams);
      return (hasDelayEvidence && candidate.durationSeconds + after.delay <= input.candidate.durationSeconds + before.delay)
        || (after.meters < 1 && candidate.durationSeconds <= input.candidate.durationSeconds * 1.1);
    }).sort((a, b) => (a.durationSeconds + exposure(a, jams).delay) - (b.durationSeconds + exposure(b, jams).delay))[0];
    return kept === undefined ? null : { ...kept, providerMetadata: { ...kept.providerMetadata, liveTrafficAvoid: true, liveTrafficJamMetersBefore: before.meters, liveTrafficJamMetersAfter: exposure(kept, jams).meters } };
  } catch {
    if (input.signal.aborted) throw input.signal.reason;
    return null;
  }
}
