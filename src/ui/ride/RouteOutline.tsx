"use client";

/**
 * The route's outline, drawn the moment the ride opens (round 3, restructure
 * call 8), so the rider sees their line before the map's tiles arrive. It sits
 * in the map's own box, takes no touches, and goes as soon as the map is ready
 * and draws the real line. An unavailable line draws nothing.
 */

import type { Coordinate } from "@/domain/ride/types";

/** The outline's fixed drawing box; the SVG scales it to the map. */
const BOX = 1000;
const PAD = 0.12;

/** An SVG path for the line, fitted to the box with the map's own aspect (equirectangular). */
export function outlinePath(line: readonly Coordinate[]): string | null {
  if (line.length < 2) return null;
  const lats = line.map((point) => point.lat);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const xScale = Math.cos((midLat * Math.PI) / 180);
  const xs = line.map((point) => point.lon * xScale);
  const ys = line.map((point) => -point.lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  if (!Number.isFinite(span) || span <= 0) return null;
  const scale = (BOX * (1 - 2 * PAD)) / span;
  const offsetX = (BOX - (Math.max(...xs) - minX) * scale) / 2;
  const offsetY = (BOX - (Math.max(...ys) - minY) * scale) / 2;
  return xs
    .map((x, index) => {
      const px = offsetX + (x - minX) * scale;
      const py = offsetY + ((ys[index] ?? 0) - minY) * scale;
      return `${index === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join("");
}

export function RouteOutline({ line }: { readonly line: readonly Coordinate[] }) {
  const path = outlinePath(line);
  if (path === null) return null;
  return (
    <svg
      className="og-ride__outline"
      data-testid="ride-route-outline"
      viewBox={`0 0 ${BOX} ${BOX}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
