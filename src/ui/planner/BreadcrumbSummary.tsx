"use client";

import { useMemo, useState } from "react";
import type { ElevationSource } from "@/application/elevation/profile";
import { breadcrumbLine, breadcrumbMeasurements } from "@/application/breadcrumb/measurements";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";
import { ElevationProfileChart } from "@/ui/planner/ElevationProfileChart";
import { useElevationProfile } from "@/ui/planner/useElevationProfile";
import { waypointsFromIntent, type LibraryServicePort } from "@/application/library/library-service";
import { buildPlannedTrackGpx, downloadExport, exportFilename, rideExportTitle } from "@/application/export/gpx-export";
import type { RideDocument } from "@/domain/ride/types";

function distance(meters: number): string { return `${(meters / 1609.344).toFixed(1)} mi`; }
function duration(seconds: number): string { const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`; }

export function BreadcrumbSummary({ route, document, libraryService, source, onToggleSnap, snapping, snapError, onStart, editing }: { readonly route: BreadcrumbRoute; readonly document: RideDocument; readonly libraryService?: LibraryServicePort | undefined; readonly source?: ElevationSource | undefined; readonly onToggleSnap: (index: number) => void; readonly snapping: number | null; readonly snapError: string | null; readonly onStart?: (() => Promise<string | null>) | undefined; readonly editing: boolean }) {
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [startState, setStartState] = useState<"idle" | "starting">("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const line = useMemo(() => breadcrumbLine(route), [route]);
  const elevation = useElevationProfile(source, `breadcrumb-${document.rideId}-${document.revision}`, line);
  const profile = elevation?.status === "ready" ? elevation.profile : null;
  const measurements = useMemo(() => breadcrumbMeasurements(route, profile), [route, profile]);
  if (route.waypoints.length === 0) return null;
  const save = async (): Promise<void> => {
    if (libraryService === undefined || title.trim() === "" || line.length < 2) return;
    setSaveState("saving");
    try {
      await libraryService.saveNamed(document, { title: title.trim(), plannedRoute: { geometry: line } });
      setSaveState("saved");
    } catch { setSaveState("failed"); }
  };
  const exportGpx = (): void => {
    const exportTitle = rideExportTitle(document.title);
    const xml = buildPlannedTrackGpx({ title: exportTitle, geometry: line, waypoints: waypointsFromIntent(document.intent), createdTime: document.createdAt });
    downloadExport(new TextEncoder().encode(xml), exportFilename(exportTitle, "planned-track"));
  };
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
        {editing ? null : <><ElevationProfileChart state={elevation ?? { status: "unavailable", reason: "Elevation unknown" }} line={line} waypoints={route.waypoints.map((point, index) => ({ coordinate: point.coordinate, label: point.name || `Waypoint ${index + 1}` }))} />
        <details><summary>Legs ({route.legs.length})</summary><ol>{measurements.legs.map((leg, index) => <li key={route.waypoints[index]!.id}>Leg {index + 1} · {distance(leg.distanceMeters)}{leg.maxGradePercent !== null && leg.maxGradePercent > 30 ? " · Steep (>30%)" : ""} <button type="button" disabled={snapping !== null} onClick={() => onToggleSnap(index)}>{snapping === index ? "Finding route…" : route.legs[index]!.kind === "snapped" ? "Use straight line" : "Snap to trail or road"}</button></li>)}</ol></details>
        {snapError === null ? null : <p role="status">{snapError}</p>}
        <div className="og-breadcrumb-summary__actions">
          {onStart === undefined ? null : <button type="button" disabled={startState === "starting"} onClick={() => { setStartState("starting"); setStartError(null); void onStart().then((error) => { setStartError(error); setStartState("idle"); }, () => { setStartError("Could not start following this route."); setStartState("idle"); }); }}>{startState === "starting" ? "Starting…" : "Follow breadcrumb"}</button>}
          {startError === null ? null : <p role="alert">{startError}</p>}
          <button type="button" onClick={exportGpx}>Export GPX</button>
          {libraryService === undefined ? null : <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label htmlFor="breadcrumb-title">Save to My rides</label><input id="breadcrumb-title" value={title} onChange={(event) => { setTitle(event.target.value); setSaveState("idle"); }} placeholder="Route name" /><button type="submit" disabled={title.trim() === "" || saveState === "saving"}>Save</button></form>}
          {saveState === "saved" ? <p role="status">Saved to My rides.</p> : saveState === "failed" ? <p role="alert">Could not save this route. Try again.</p> : null}
        </div>
        </>}
      </>}
    </section>
  );
}
