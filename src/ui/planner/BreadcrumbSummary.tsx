"use client";

import { useMemo } from "react";
import type { ElevationSource } from "@/application/elevation/profile";
import { breadcrumbLine, breadcrumbMeasurements } from "@/application/breadcrumb/measurements";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";
import { ElevationProfileChart } from "@/ui/planner/ElevationProfileChart";
import { useElevationProfile } from "@/ui/planner/useElevationProfile";

function distance(meters: number): string { return `${(meters / 1609.344).toFixed(1)} mi`; }
function duration(seconds: number): string { const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`; }

export function BreadcrumbSummary({ route, revision, source, onToggleSnap, snapping, snapError }: { readonly route: BreadcrumbRoute; readonly revision: number; readonly source?: ElevationSource | undefined; readonly onToggleSnap: (index: number) => void; readonly snapping: number | null; readonly snapError: string | null }) {
  const line = useMemo(() => breadcrumbLine(route), [route]);
  const elevation = useElevationProfile(source, `breadcrumb-${revision}`, line);
  const profile = elevation?.status === "ready" ? elevation.profile : null;
  const measurements = useMemo(() => breadcrumbMeasurements(route, profile), [route, profile]);
  if (route.waypoints.length === 0) return null;
  return (
    <section className="og-breadcrumb-summary" aria-label="Breadcrumb route" data-testid="breadcrumb-summary">
      <header><strong>Breadcrumb</strong><span>{distance(measurements.totalMeters)}</span></header>
      <p>Straight-line legs are not roads. Check access and conditions.</p>
      {line.length < 2 ? <p>Add another waypoint to make a route.</p> : <>
        <div className="og-breadcrumb-summary__stats">
          <span>{profile === null ? "Elevation unknown" : `↑ ${Math.round(profile.climbMeters * 3.28084)} ft · ↓ ${Math.round(profile.descentMeters * 3.28084)} ft`}</span>
          <span>{measurements.timeSeconds === null ? "Time unknown" : `${duration(measurements.timeSeconds)} walking`}</span>
          <span>{measurements.maxGradePercent === null ? "Grade unknown" : `Max grade ${Math.round(measurements.maxGradePercent)}%`}</span>
        </div>
        <ElevationProfileChart state={elevation ?? { status: "unavailable", reason: "Elevation unknown" }} line={line} waypoints={route.waypoints.map((point, index) => ({ coordinate: point.coordinate, label: point.name || `Waypoint ${index + 1}` }))} />
        <details><summary>Legs ({route.legs.length})</summary><ol>{measurements.legs.map((leg, index) => <li key={route.waypoints[index]!.id}>Leg {index + 1} · {distance(leg.distanceMeters)}{leg.maxGradePercent !== null && leg.maxGradePercent > 30 ? " · Steep (>30%)" : ""} <button type="button" disabled={snapping !== null} onClick={() => onToggleSnap(index)}>{snapping === index ? "Finding route…" : route.legs[index]!.kind === "snapped" ? "Use straight line" : "Snap to trail or road"}</button></li>)}</ol></details>
        {snapError === null ? null : <p role="status">{snapError}</p>}
      </>}
    </section>
  );
}
