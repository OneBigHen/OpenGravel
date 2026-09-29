"use client";

/**
 * The planner map with the rider's map layers (UX rework phase 8): the layer
 * scene merged into the map scene, taps on layer features consumed into a
 * card, and the Layers control in the map's control cluster. Without a source
 * this renders the plain map.
 */

import { useCallback, useMemo, type ComponentProps } from "react";

import type { MapExtent } from "@/application/map/build-map-scene";
import type { MapIntent } from "@/application/map/types";
import type { MapLayersSource } from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";
import { PlannerMap } from "@/ui/map/PlannerMap";

import { InfoFeatureCard } from "./InfoFeatureCard";
import { MapLayersPanel } from "./MapLayersPanel";
import { useMapLayers } from "./useMapLayers";

type PlannerMapProps = ComponentProps<typeof PlannerMap>;

export interface MapLayersProps {
  readonly source: MapLayersSource;
  readonly onAddStop?: (coordinate: Coordinate, name: string) => void;
}

export function LayeredMap({
  layers,
  ...map
}: PlannerMapProps & { readonly layers?: MapLayersProps | undefined }) {
  if (layers === undefined) return <PlannerMap {...map} />;
  return <LayeredMapWith map={map} layers={layers} />;
}

function LayeredMapWith({ map, layers }: { readonly map: PlannerMapProps; readonly layers: MapLayersProps }) {
  const view = useMapLayers(layers.source);
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
  const { onAddStop } = layers;
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

  return (
    <>
      <PlannerMap
        {...map}
        scene={scene}
        onIntent={intercept}
        onViewport={viewport}
        terrain3d={view.enabled.includes("terrain-3d")}
      />
      <div className="og-layers-overlay">
        <MapLayersPanel
          enabled={view.enabled}
          status={view.status}
          counts={view.counts}
          onToggle={view.toggle}
          onClearAll={view.clearAll}
        />
        {view.selected === null ? null : (
          <InfoFeatureCard feature={view.selected} onClose={() => select(null)} onAddStop={addStop} />
        )}
      </div>
    </>
  );
}
