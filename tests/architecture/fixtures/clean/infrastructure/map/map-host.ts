import type { MapScene } from "./map-scene";

export type MapIntent = {
  readonly kind: "select-route";
  readonly routeId: string;
};

export function createMapHost(scene: MapScene): readonly MapIntent[] {
  return scene.routeGeometryRef === null
    ? []
    : [{ kind: "select-route", routeId: scene.routeGeometryRef }];
}
