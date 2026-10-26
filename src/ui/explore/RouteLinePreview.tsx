import { PREVIEW_HEIGHT, PREVIEW_WIDTH, linePreviewPoints } from "@/ui/explore/line-preview";
import type { Coordinate } from "@/domain/ride/types";

/**
 * A ride's own line in a 16:9 frame, for a device that has no basemap image.
 * It is the picture of the ride, so it is what the card or page leads with.
 */
export function RouteLinePreview({
  line,
  name,
  className,
}: {
  readonly line: readonly Coordinate[];
  readonly name: string;
  readonly className?: string;
}) {
  const points = linePreviewPoints(line);
  if (points === "") return null;
  return (
    <div
      className={className === undefined ? "og-line-preview" : `og-line-preview ${className}`}
      role="img"
      aria-label={`${name} route shape`}
      data-testid="route-line-preview"
    >
      <svg viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
