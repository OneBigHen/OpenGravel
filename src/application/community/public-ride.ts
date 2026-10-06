import type { RideExportSource } from "@/application/library/library-service";
import type { Coordinate } from "@/domain/ride/types";

export const PUBLIC_RIDE_MAX_NAME = 80;
export const PUBLIC_RIDE_MAX_NOTES = 2000;
export const PUBLIC_RIDE_MAX_POINTS = 20_000;
export const PUBLIC_RIDE_MIN_METERS = 300;
export const PUBLIC_RIDE_MAX_PHOTOS = 3;
export const PUBLIC_PHOTO_MAX_BYTES = 300_000;

export interface PublicRideSegment {
  readonly id: string;
  readonly label: string;
  readonly geometry: readonly Coordinate[];
}
/** Segments are public editing choices, never an invented route across source gaps. */
export function publicRideSegments(source: RideExportSource): readonly PublicRideSegment[] {
  if (source.recordedTrack !== null) return [{ id: "recorded", label: source.title, geometry: source.recordedTrack.coordinates }];
  const segments = source.tracks.flatMap((track) => track.segments.map((segment, index) => {
    const geometry = source.trackGeometry[segment.geometryRef];
    if (geometry === undefined || geometry.length < 2) throw new Error("A saved track segment is unavailable. Try importing the original file again.");
    return { id: String(segment.geometryRef), label: `${track.name} · Segment ${index + 1}`, geometry };
  }));
  if (segments.length === 0) throw new Error("This saved ride has no route line available to share.");
  return segments;
}
