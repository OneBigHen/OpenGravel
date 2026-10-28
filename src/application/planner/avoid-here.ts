import type { Coordinate } from "@/domain/ride/types";
import { rectangleRing } from "./avoid-area-geometry";

/** A roughly 200 m square, editable like any other avoid area. */
export function avoidHereRing(point: Coordinate): readonly Coordinate[] {
  const latDelta = 100 / 111_320;
  const lonDelta = latDelta / Math.max(0.01, Math.cos(point.lat * Math.PI / 180));
  return rectangleRing(
    { lat: Math.max(-90, point.lat - latDelta), lon: Math.max(-180, point.lon - lonDelta) },
    { lat: Math.min(90, point.lat + latDelta), lon: Math.min(180, point.lon + lonDelta) },
  );
}
