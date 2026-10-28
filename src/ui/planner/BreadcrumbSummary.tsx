"use client";

import { useMemo, useState } from "react";
import { breadcrumbLine, VERY_STEEP_PERCENT, STEEP_LEG_PERCENT, type breadcrumbMeasurements } from "@/application/breadcrumb/measurements";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";
import { BreadcrumbProfile } from "@/ui/planner/BreadcrumbProfile";
import type { ElevationProfileState } from "@/ui/planner/useElevationProfile";
import { waypointsFromIntent, type LibraryServicePort } from "@/application/library/library-service";
import { buildPlannedTrackGpx, downloadExport, exportFilename, rideExportTitle } from "@/application/export/gpx-export";
import type { RideDocument } from "@/domain/ride/types";

function distance(meters: number): string { return `${(meters / 1609.344).toFixed(1)} mi`; }
function duration(seconds: number): string { const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`; }

type Measurements = ReturnType<typeof breadcrumbMeasurements>;

function WarningMark() {
  return <svg className="og-breadcrumb-summary__warn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5 22 20.5H2L12 3.5zM12 10v4.5M12 17.6v.1" /></svg>;
}

export function BreadcrumbSummary({ route, document, libraryService, elevation, measurements, onToggleSnap, snapping, snapError, onStart, onClear, editing, onPlanTrails }: { readonly onPlanTrails?: (() => void) | undefined; readonly route: BreadcrumbRoute; readonly document: RideDocument; readonly libraryService?: LibraryServicePort | undefined; readonly elevation: ElevationProfileState | null | undefined; readonly measurements: Measurements | null; readonly onToggleSnap: (index: number) => void; readonly snapping: number | null; readonly snapError: string | null; readonly onStart?: (() => Promise<string | null>) | undefined; readonly onClear: () => void; readonly editing: boolean }) {
  const [title, setTitle] = useState("");
  // Phones show the essentials and the main actions; the chart, legs, export
  // and save open under More, so the map keeps most of the screen.
  const [more, setMore] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [startState, setStartState] = useState<"idle" | "starting">("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const line = useMemo(() => breadcrumbLine(route), [route]);
  const profile = elevation?.status === "ready" ? elevation.profile : null;
  const steepSpans = useMemo(() => {
    if (measurements === null) return [];
    let from = 0;
    return measurements.legs.flatMap((leg) => {
      const range = { from, to: from + leg.distanceMeters };
      from = range.to;
      return (leg.maxGradePercent ?? 0) > STEEP_LEG_PERCENT ? [range] : [];
    });
  }, [measurements]);
  if (route.waypoints.length === 0 || measurements === null) return null;
  const maxGrade = measurements.maxGradePercent === null ? null : Math.round(measurements.maxGradePercent);
  const steepness = maxGrade === null ? null : maxGrade >= VERY_STEEP_PERCENT ? "Very steep" : maxGrade > STEEP_LEG_PERCENT ? "Steep" : null;
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
    <section className="og-breadcrumb-summary" aria-label="Breadcrumb route" data-testid="breadcrumb-summary" data-editing={editing ? "true" : undefined} data-more={more ? "true" : undefined}>
      <header>
        <strong>Breadcrumb</strong>
        <span className="og-breadcrumb-summary__distance">{distance(measurements.totalMeters)}</span>
        <button type="button" className="og-breadcrumb-summary__clear" onClick={onClear}>Clear</button>
      </header>
      <p className="og-breadcrumb-summary__note">{route.legs.length > 0 && route.legs.every((leg) => leg.kind === "recorded") ? "Follows the mapped trail line. Check access and conditions." : editing ? "Straight-line legs, not roads." : "Straight-line legs are not roads. Check access and conditions."}</p>
      {line.length < 2 ? <p>Add another waypoint to make a route.</p> : <>
        <div className="og-breadcrumb-summary__stats">
          <span>{profile === null ? "Elevation unknown" : `↑ ${Math.round(profile.climbMeters * 3.28084)} ft · ↓ ${Math.round(profile.descentMeters * 3.28084)} ft`}</span>
          <span>{measurements.timeSeconds === null ? "Time unknown" : `${duration(measurements.timeSeconds)} walking`}</span>
          {steepness === null ? <span>{maxGrade === null ? "Grade unknown" : `Max grade about ${maxGrade}%`}</span> : null}
        </div>
        {steepness === null || maxGrade === null ? null : <p className="og-breadcrumb-summary__warn" role="note" data-testid="breadcrumb-steep"><WarningMark /><span><strong>{steepness}: about {maxGrade}% max grade.</strong>{editing ? "" : " Steep legs are orange on the map. Check them before you go."}</span></p>}
        {editing ? (profile === null ? null : <BreadcrumbProfile profile={profile} steepSpans={steepSpans} />) : <>
        <div className="og-breadcrumb-summary__actions og-breadcrumb-summary__main">
          {onStart === undefined ? null : <button type="button" disabled={startState === "starting"} onClick={() => { setStartState("starting"); setStartError(null); void onStart().then((error) => { setStartError(error); setStartState("idle"); }, () => { setStartError("Could not start following this route."); setStartState("idle"); }); }}>{startState === "starting" ? "Starting…" : "Follow breadcrumb"}</button>}
          {onPlanTrails === undefined ? null : <button type="button" data-testid="breadcrumb-plan-trails" onClick={onPlanTrails}>Plan on trails</button>}
          <button type="button" className="og-breadcrumb-summary__more-toggle" data-testid="breadcrumb-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
          {startError === null ? null : <p role="alert">{startError}</p>}
        </div>
        <div className="og-breadcrumb-summary__extra">
        {profile === null ? (elevation?.status === "loading" ? <p className="og-breadcrumb-summary__quiet">Reading elevation…</p> : null) : <BreadcrumbProfile profile={profile} steepSpans={steepSpans} />}
        <details><summary>Legs ({route.legs.length})</summary><ol>{measurements.legs.map((leg, index) => <li key={route.waypoints[index]!.id}>Leg {index + 1} · {distance(leg.distanceMeters)}{leg.maxGradePercent !== null && leg.maxGradePercent > STEEP_LEG_PERCENT ? ` · Steep (about ${Math.round(leg.maxGradePercent)}%)` : ""} <button type="button" disabled={snapping !== null} onClick={() => onToggleSnap(index)}>{snapping === index ? "Finding route…" : route.legs[index]!.kind === "snapped" ? "Use straight line" : "Snap to trail or road"}</button></li>)}</ol></details>
        {snapError === null ? null : <p role="status">{snapError}</p>}
        <div className="og-breadcrumb-summary__actions">
          <button type="button" onClick={exportGpx}>Export GPX</button>
          {libraryService === undefined ? null : <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label htmlFor="breadcrumb-title">Save to My rides</label><input id="breadcrumb-title" value={title} onChange={(event) => { setTitle(event.target.value); setSaveState("idle"); }} placeholder="Route name" /><button type="submit" disabled={title.trim() === "" || saveState === "saving"}>Save</button></form>}
          {saveState === "saved" ? <p role="status">Saved to My rides.</p> : saveState === "failed" ? <p role="alert">Could not save this route. Try again.</p> : null}
        </div>
        </div>
        </>}
      </>}
    </section>
  );
}
