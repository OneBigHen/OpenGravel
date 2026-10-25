"use client";

import dynamic from "next/dynamic";

/**
 * The planner map with the rider's map layers (UX rework phase 8): the layer
 * scene merged into the map scene, taps on layer features consumed into a
 * card, and the Layers control in the map's control cluster. Without a source
 * this renders the plain map.
 */

import { useCallback, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";

import type { MapExtent } from "@/application/map/build-map-scene";
import type { MapIntent } from "@/application/map/types";
import type { MapLayersSource } from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";
import {
  readLookChoice,
  subscribeLookChoice,
  writeLookChoice,
  type BasemapLook,
} from "@/ui/map/basemap-look";
import { PlannerMap } from "@/ui/map/PlannerMap";

import { MapLayersPanel, type MapStyleChoice } from "./MapLayersPanel";
import { useMapLayers } from "./useMapLayers";

const InfoFeatureCard = dynamic(() => import("./InfoFeatureCard").then((mod) => mod.InfoFeatureCard), { loading: () => <p className="og-composer__reason" role="status">Loading map details…</p> });

type PlannerMapProps = ComponentProps<typeof PlannerMap>;

export interface MapLayersProps {
  readonly source: MapLayersSource;
  readonly onAddStop?: (coordinate: Coordinate, name: string) => void;
  /** Where the rider is coming from, so a tapped road is entered at the near end. */
  readonly rideRoadReference?: Coordinate | null;
  /** Present when the host can add a road's two via points as stops. */
  readonly onRideRoad?: (entry: Coordinate, exit: Coordinate, name: string) => void;
}

export function LayeredMap({
  layers,
  panelSettings,
  mapStyleInSheet = false,
  ...map
}: PlannerMapProps & {
  readonly layers?: MapLayersProps | undefined;
  /** Rows another surface owns, rendered inside the layers sheet (Places). */
  readonly panelSettings?: ReactNode;
  /** Let the sheet own the basemap style choice instead of the map's button. */
  readonly mapStyleInSheet?: boolean;
}) {
  if (layers === undefined) return <PlannerMap {...map} />;
  return (
    <LayeredMapWith
      map={map}
      layers={layers}
      panelSettings={panelSettings}
      mapStyleInSheet={mapStyleInSheet}
    />
  );
}

function LayeredMapWith({
  map,
  layers,
  panelSettings,
  mapStyleInSheet,
}: {
  readonly map: PlannerMapProps;
  readonly layers: MapLayersProps;
  readonly panelSettings: ReactNode;
  readonly mapStyleInSheet: boolean;
}) {
  // The remembered look is an external, per-device value: the server snapshot
  // is the default so hydration agrees, then the stored choice arrives. Writing
  // it notifies this store, so the sheet and the map change in one commit.
  const look = useSyncExternalStore(subscribeLookChoice, readLookChoice, () => "map" as const);
  const [lookOptions, setLookOptions] = useState<readonly BasemapLook[]>(["map"]);
  const chooseLook = useCallback((next: BasemapLook): void => {
    writeLookChoice(next);
  }, []);
  const mapStyle = useMemo<MapStyleChoice>(
    () => ({ look, options: lookOptions, onChoose: chooseLook }),
    [look, lookOptions, chooseLook],
  );
  const cameraRoute = useMemo(() => {
    const route = map.scene.routes.find((candidate) => candidate.id === map.scene.selectedRouteId);
    if (route === undefined || route.geometry.length < 2) return null;
    return route.geometry.map((coordinate) => [coordinate.lon, coordinate.lat] as const);
  }, [map.scene.routes, map.scene.selectedRouteId]);
  const view = useMapLayers(layers.source, cameraRoute);
  const scene = useMemo(
    () => (view.scene === undefined ? map.scene : { ...map.scene, infoLayers: view.scene }),
    [map.scene, view.scene],
  );
  const { interceptIntent } = view;
  const { onIntent, onViewport } = map;
  const intercept = useCallback(
    (intent: MapIntent): void => {
      const forwarded = interceptIntent(intent);
      if (forwarded !== null) onIntent(forwarded);
    },
    [interceptIntent, onIntent],
  );
  const layerViewport = view.onViewport;
  const viewport = useCallback(
    (extent: MapExtent): void => {
      layerViewport(extent);
      onViewport?.(extent);
    },
    [layerViewport, onViewport],
  );
  const { select } = view;
  const { onAddStop, onRideRoad, rideRoadReference } = layers;
  const addStop = useMemo(
    () =>
      onAddStop === undefined
        ? undefined
        : (coordinate: Coordinate, name: string): void => {
            onAddStop(coordinate, name);
            select(null);
          },
    [onAddStop, select],
  );
  const rideRoad = useMemo(
    () =>
      onRideRoad === undefined
        ? undefined
        : (entry: Coordinate, exit: Coordinate, name: string): void => {
            onRideRoad(entry, exit, name);
            select(null);
          },
    [onRideRoad, select],
  );

  return (
    <>
      <PlannerMap
        {...map}
        {...(mapStyleInSheet ? { look, onLookChange: chooseLook, onLookOptions: setLookOptions } : {})}
        scene={scene}
        onIntent={intercept}
        onViewport={viewport}
        terrain3d={view.enabled.includes("terrain-3d")}
        onLayerStatus={view.onLayerStatus}
      />
      <div className="og-layers-overlay">
        <MapLayersPanel
          freshness={view.freshness}
          enabled={view.enabled}
          status={view.status}
          counts={view.counts}
          cameraRouteOnly={view.cameraRouteOnly}
          cameraRouteAvailable={view.cameraRouteAvailable}
          onToggleCameraRouteOnly={view.toggleCameraRouteOnly}
          onToggle={view.toggle}
          onToggleLens={view.toggleSet}
          onClearAll={view.clearAll}
          {...(mapStyleInSheet ? { mapStyle } : {})}
          {...(panelSettings === undefined ? {} : { settings: panelSettings })}
        />
        {view.selected === null ? null : (
          <InfoFeatureCard
            feature={view.selected}
            onClose={() => select(null)}
            onAddStop={addStop}
            rideRoadReference={rideRoadReference}
            onRideRoad={rideRoad}
          />
        )}
      </div>
    </>
  );
}
