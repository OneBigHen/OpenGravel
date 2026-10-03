"use client";
import { useMemo } from "react";
import { staticPointsMapUrl } from "@/application/map/static-map";
import type { MapScene } from "@/application/map/types";
import type { PointId } from "@/domain/ride/ids";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { PlannerMap } from "@/ui/map/PlannerMap";

export function RoadLocationMap({
  anchor,
  name,
  token,
  live,
}: {
  readonly anchor: readonly [number, number] | null;
  readonly name: string;
  readonly token?: string | undefined;
  readonly live?: ExploreMapConfig | undefined;
}) {
  const scene = useMemo<MapScene>(
    () => ({
      mode: "explore",
      routes: [],
      selectedRouteId: null,
      points:
        anchor === null
          ? []
          : [
              {
                id: "road-location" as PointId,
                kind: "stop",
                coordinate: { lon: anchor[0], lat: anchor[1] },
                label: name,
              },
            ],
      preview: null,
      avoidAreas: [],
      roadSpans: [],
      sketch: null,
      avoidHandles: [],
      previewArea: null,
      selectedObject: null,
    }),
    [anchor, name],
  );
  if (anchor === null) return <p>Road location not published.</p>;
  if (live !== undefined)
    return (
      <div className="og-road-map">
        <PlannerMap
          {...live}
          scene={scene}
          label={`${name} location map`}
          onIntent={() => undefined}
          activeTool="pan"
          dimmed={false}
          fitKey={name}
          fitExtent={{
            minLon: anchor[0] - 0.025,
            maxLon: anchor[0] + 0.025,
            minLat: anchor[1] - 0.02,
            maxLat: anchor[1] + 0.02,
          }}
        />
      </div>
    );
  const url =
    token === undefined
      ? null
      : staticPointsMapUrl([{ lon: anchor[0], lat: anchor[1] }], {
          token,
          width: 400,
          height: 190,
        });
  if (url === null)
    return (
      <p className="og-map-preview-unavailable">Map preview unavailable.</p>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- direct provider map image, as on catalog cards.
    <img
      className="og-road-map__image"
      src={url}
      width={400}
      height={190}
      alt={`${name} location map`}
      loading="lazy"
    />
  );
}
