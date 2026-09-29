import type { Coordinate } from "@/domain/ride/types";

export interface RecordedTrackThumbnailProps {
  readonly coordinates: readonly Coordinate[];
  readonly title: string;
}

/** Pure geographic extent projection used only by the inline library preview. */
export function projectRecordedTrack(coordinates: readonly Coordinate[]): readonly string[] {
  if (coordinates.length < 2) return [];
  const longitudes = coordinates.map((coordinate) => coordinate.lon);
  const latitudes = coordinates.map((coordinate) => coordinate.lat);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const width = maxLon - minLon || 1;
  const height = maxLat - minLat || 1;
  const padding = 6;
  const innerWidth = 148;
  const innerHeight = 40;
  return coordinates.map((coordinate) => {
    const x = padding + ((coordinate.lon - minLon) / width) * innerWidth;
    const y = padding + ((maxLat - coordinate.lat) / height) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
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
