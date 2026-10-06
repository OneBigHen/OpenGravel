"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

import type { CatalogEntry } from "@/application/explore/catalog";
import type { MapExtent } from "@/application/map/build-map-scene";
import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import type { MapIntent, MapScene, RouteScene } from "@/application/map/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { Coordinate } from "@/domain/ride/types";
import { PlannerMap } from "@/ui/map/PlannerMap";

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
function ExploreMapCanvas({ entries, highlightedId, onOpen, hostFactory, basemap, assetBasePath }: ExploreMapProps) {
  const [fitRevision, setFitRevision] = useState(0);
  const [cameraOwned, setCameraOwned] = useState(false);
  const available = useMemo(() => entries.filter((entry) => lineOf(entry).length >= 2), [entries]);
  const scene = useMemo<MapScene>(() => {
    // EX-10: one quiet colour for the catalog (colours with no legend read as a
    // key that isn't there), and the route under the rider's pointer or focus
    // stands out with its name on the map.
    const routes: RouteScene[] = available.map((entry) => {
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
  }, [available, highlightedId]);
  const fitExtent = useMemo(() => extentOf(available), [available]);
  const fitKey = useMemo(() => `${available.map((entry) => entry.id).join("|")}:${fitRevision}`, [available, fitRevision]);

  const onIntent = useCallback(
    (intent: MapIntent): void => {
      if (intent.type === "camera-changed") setCameraOwned(true);
      else if (intent.type === "object-click" && intent.ref.kind === "route") onOpen(intent.ref.routeId);
      else if (intent.type === "overlap-click") {
        const route = intent.candidates.find((ref) => ref.kind === "route");
        if (route !== undefined && route.kind === "route") onOpen(route.routeId);
      }
    },
    [onOpen],
  );

  return (
    <div className="og-explore-map" data-testid="explore-map">
      <div className="og-explore-map__tools">
        <span>{available.length} mapped{entries.length > available.length ? ` · ${entries.length - available.length} without geometry` : ""}</span>
        <button type="button" className="og-secondary" onClick={() => { setCameraOwned(false); setFitRevision((value) => value + 1); }}>Fit routes</button>
      </div>
      <PlannerMap
        scene={scene}
        label="Map of the routes in this list"
        onIntent={onIntent}
        hostFactory={hostFactory}
        {...(assetBasePath === undefined ? {} : { assetBasePath })}
        activeTool="pan"
        basemap={basemap}
        dimmed={false}
        fitKey={cameraOwned ? null : fitKey}
        fitExtent={fitExtent}
      />
    </div>
  );
}


function ExpandedExploreMap({ props, onClose }: { readonly props: ExploreMapProps; readonly onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  return createPortal(
    <section ref={dialogRef} className="og-explore-map-dialog" role="dialog" aria-modal="true" aria-labelledby="explore-map-title">
      <header>
        <div><h2 id="explore-map-title">Explore route map</h2><p>All matching routes. Tap a route to open its details.</p></div>
        <button type="button" className="og-secondary" onClick={onClose}>Close map</button>
      </header>
      <ExploreMapCanvas {...props} />
    </section>, document.body,
  );
}

export function ExploreMap(props: ExploreMapProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="og-explore-map-panel">
      <div className="og-explore-map-panel__head">
        <span>Every matching route on the map</span>
        <button type="button" className="og-secondary" onClick={() => setExpanded(true)}>Expand map</button>
      </div>
      {expanded ? null : <ExploreMapCanvas {...props} />}
      {expanded ? <ExpandedExploreMap props={props} onClose={() => setExpanded(false)} /> : null}
    </div>
  );
}
