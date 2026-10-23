import type { Coordinate } from "@/domain/ride/types";
import {
  LIBRARY_TRACK_BOX,
  projectTrackPoints,
  type TrackProjectionBox,
} from "./track-projection";

export interface RecordedTrackThumbnailProps {
  readonly coordinates: readonly Coordinate[];
  readonly title: string;
}

/** Pure geographic extent projection used only by the inline library preview. */
export function projectRecordedTrack(
  coordinates: readonly Coordinate[],
  box: TrackProjectionBox = LIBRARY_TRACK_BOX,
): readonly string[] {
  if (coordinates.length < 2) return [];
  const points = projectTrackPoints(coordinates, coordinates, box);
  // One point per coordinate, so the preview keeps the shape it simplified to.
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`);
}

export function RecordedTrackThumbnail({ coordinates, title }: RecordedTrackThumbnailProps) {
  const points = projectRecordedTrack(coordinates);
  if (points.length < 2) {
    return (
      <span className="og-library__track-placeholder" aria-label={`Track preview unavailable for ${title}`}>
        Track preview unavailable
      </span>
    );
  }
  return (
    <svg
      className="og-library__track-thumbnail"
      viewBox="0 0 160 52"
      role="img"
      aria-label={`Recorded track preview for ${title}`}
      data-testid="recorded-track-thumbnail"
    >
      <polyline points={points.join(" ")} />
    </svg>
  );
}
