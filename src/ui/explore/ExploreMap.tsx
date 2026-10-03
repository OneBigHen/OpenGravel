"use client";

import { useCallback, useMemo } from "react";

import type { CatalogEntry } from "@/application/explore/catalog";
import type { MapExtent } from "@/application/map/build-map-scene";
import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import type { MapIntent, MapScene, RouteScene } from "@/application/map/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { Coordinate } from "@/domain/ride/types";
import { PlannerMap } from "@/ui/map/PlannerMap";

/** A regional sample stays legible even when a catalog has hundreds of routes. */
const MAX_LINES = 12;

export interface ExploreMapConfig {
  readonly hostFactory: MapHostFactory;
  readonly basemap: BasemapMode;
  readonly assetBasePath?: string;
  /** Public static-image credential supplied by the composition root. */
  readonly staticMapToken?: string;
}

export interface ExploreMapProps extends ExploreMapConfig {
  readonly entries: readonly CatalogEntry[];
  /** The card under the pointer or focus: its line is drawn as the chosen one. */
  readonly highlightedId: string | null;
  readonly onOpen: (entryId: string) => void;
}

function lineOf(entry: CatalogEntry): readonly Coordinate[] {
  return entry.previewGeometry ?? entry.geometry;
}

function extentOf(entries: readonly CatalogEntry[]): MapExtent | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const entry of entries) {
    for (const point of lineOf(entry)) {
      minLon = Math.min(minLon, point.lon);
      minLat = Math.min(minLat, point.lat);
      maxLon = Math.max(maxLon, point.lon);
      maxLat = Math.max(maxLat, point.lat);
    }
  }
  return Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null;
}

/**
 * Explore's map (UX rework phase 5): the routes in the list, drawn in the route
 * colours, so a rider picks a ride by where it goes and not only by its name.
 * The card under the pointer is drawn as the chosen line, and tapping a line
 * opens that route. A read-only map: nothing here authors a ride.
 */
export function ExploreMap({ entries, highlightedId, onOpen, hostFactory, basemap, assetBasePath }: ExploreMapProps) {
  const available = useMemo(() => entries.filter((entry) => lineOf(entry).length >= 2), [entries]);
  const drawn = useMemo(() => {
    const step = Math.max(1, Math.ceil(available.length / MAX_LINES));
    const sample = available.filter((_, index) => index % step === 0).slice(0, MAX_LINES);
    const highlighted = available.find((entry) => entry.id === highlightedId);
    return highlighted !== undefined && !sample.some((entry) => entry.id === highlighted.id)
      ? [...sample.slice(0, MAX_LINES - 1), highlighted]
      : sample;
  }, [available, highlightedId]);
  const scene = useMemo<MapScene>(() => {
    // EX-10: one quiet colour for the catalog (colours with no legend read as a
    // key that isn't there), and the route under the rider's pointer or focus
    // stands out with its name on the map.
    const routes: RouteScene[] = drawn.map((entry) => {
      const line = lineOf(entry);
      const highlighted = entry.id === highlightedId;
      const at = line[Math.floor((line.length - 1) / 2)];
      return {
        id: entry.id as RouteCandidateId,
        role: null,
        geometry: line,
        state: highlighted ? "selected" : "alternative",
        tint: highlighted ? 0 : 2,
        ...(highlighted && at !== undefined ? { label: { text: entry.name, at } } : {}),
      };
    });
    return {
      mode: "explore",
      routes,
      selectedRouteId: (highlightedId ?? null) as RouteCandidateId | null,
      points: [],
      preview: null,
      avoidAreas: [],
      roadSpans: [],
      sketch: null,
      avoidHandles: [],
      previewArea: null,
      selectedObject: null,
    };
  }, [drawn, highlightedId]);
  const fitExtent = useMemo(() => extentOf(drawn), [drawn]);
  const fitKey = useMemo(() => drawn.map((entry) => entry.id).join("|"), [drawn]);

  const onIntent = useCallback(
    (intent: MapIntent): void => {
      if (intent.type === "object-click" && intent.ref.kind === "route") onOpen(intent.ref.routeId);
      else if (intent.type === "overlap-click") {
        const route = intent.candidates.find((ref) => ref.kind === "route");
        if (route !== undefined && route.kind === "route") onOpen(route.routeId);
      }
    },
    [onOpen],
  );

  return (
    <div className="og-explore-map" data-testid="explore-map">
      {available.length > drawn.length ? (
        <p className="og-explore-map__sample">{drawn.length} routes shown of {available.length}</p>
      ) : null}
      <PlannerMap
        scene={scene}
        label="Map of the routes in this list"
        onIntent={onIntent}
        hostFactory={hostFactory}
        {...(assetBasePath === undefined ? {} : { assetBasePath })}
        activeTool="pan"
        basemap={basemap}
        dimmed={false}
        fitKey={fitKey}
        fitExtent={fitExtent}
      />
    </div>
  );
}
