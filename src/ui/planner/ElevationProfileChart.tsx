"use client";

import { useEffect, useId, useMemo, useState, type PointerEvent } from "react";

import type { ElevationProfile } from "@/application/elevation/profile";
import type { SurfaceRun, SurfaceRunKind } from "@/application/roads/engine-road-evidence";

import { setRouteScrub } from "@/ui/stores/route-scrub-store";

import type { ElevationProfileState } from "./useElevationProfile";

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;
const WIDTH = 320;
const HEIGHT = 96;

function feet(meters: number): string {
  return `${Math.round(meters * FEET_PER_METER).toLocaleString("en-US")} ft`;
}

function miles(meters: number): string {
  const value = meters / METERS_PER_MILE;
  return `${value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-US")} mi`;
}

interface Plot {
  readonly line: string;
  readonly area: string;
  readonly x: (distance: number) => number;
  readonly y: (elevation: number) => number;
}

function plot(profile: ElevationProfile): Plot {
  // Pad the vertical range so a flat ride does not read as a mountain range.
  const span = Math.max(profile.maxMeters - profile.minMeters, 60);
  const floor = profile.minMeters - span * 0.08;
  const ceiling = floor + span * 1.16;
  const x = (distance: number): number => (distance / profile.totalMeters) * WIDTH;
  const y = (elevation: number): number => HEIGHT - ((elevation - floor) / (ceiling - floor)) * HEIGHT;
  const points = profile.points.map((point) => `${x(point.distanceMeters).toFixed(1)},${y(point.elevationMeters).toFixed(1)}`);
  const line = `M${points.join("L")}`;
  return { line, area: `${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z`, x, y };
}

/**
 * The route's elevation profile (UX rework phase 3): climb and descent up front,
 * the line drawn in the selected route's colour, and a scrub that reads out the
 * mile and height under the rider's finger or pointer.
 */
const SURFACE_WORDS: Readonly<Record<SurfaceRunKind, string>> = {
  paved: "Paved",
  gravel: "Gravel",
  dirt: "Dirt",
  unknown: "Unknown",
};

/** The surface under a share of the line, for the scrub readout. */
function surfaceAt(runs: readonly SurfaceRun[] | undefined, share: number): SurfaceRunKind | null {
  if (runs === undefined) return null;
  return runs.find((run) => share >= run.from && share <= run.to)?.kind ?? null;
}

/** Miles of each surface present, largest first: the strip's legend. */
function surfaceTotals(runs: readonly SurfaceRun[], totalMeters: number): readonly { readonly kind: SurfaceRunKind; readonly meters: number }[] {
  const totals = new Map<SurfaceRunKind, number>();
  for (const run of runs) totals.set(run.kind, (totals.get(run.kind) ?? 0) + (run.to - run.from) * totalMeters);
  return [...totals.entries()]
    .map(([kind, meters]) => ({ kind, meters }))
    .filter((entry) => entry.meters >= 80)
    .sort((a, b) => b.meters - a.meters);
}

export interface ElevationProfileChartProps {
  readonly state: ElevationProfileState;
  /** Where each surface is along the selected route, drawn as a strip under the profile. */
  readonly surface?: readonly SurfaceRun[] | undefined;
}

export function ElevationProfileChart({ state, surface }: ElevationProfileChartProps) {
  if (state.status === "loading") {
    return (
      <section className="og-elevation og-elevation--loading" aria-label="Elevation" aria-busy="true" data-testid="elevation-profile">
        <p className="og-elevation__title">Elevation</p>
        <div className="og-elevation__skeleton" />
      </section>
    );
  }
  if (state.status === "unavailable") {
    return (
      <section className="og-elevation" aria-label="Elevation" data-testid="elevation-profile">
        <p className="og-elevation__title">Elevation</p>
        <p className="og-elevation__status" data-testid="elevation-status">{state.reason}</p>
      </section>
    );
  }
  return <ReadyProfile profile={state.profile} surface={surface} />;
}

function ReadyProfile({ profile, surface }: { readonly profile: ElevationProfile; readonly surface: readonly SurfaceRun[] | undefined }) {
  const gradientId = useId();
  const shape = useMemo(() => plot(profile), [profile]);
  const [scrub, setScrub] = useState<number | null>(null);

  const onPointer = (event: PointerEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = Math.round(share * (profile.points.length - 1));
    setScrub(index);
    setRouteScrub(profile.points[index]?.coordinate ?? null);
  };
  const endScrub = (): void => {
    setScrub(null);
    setRouteScrub(null);
  };
  // A profile that goes away (a new plan, another route) takes its marker along.
  useEffect(() => () => setRouteScrub(null), [profile]);
  const scrubbed = scrub === null ? null : profile.points[scrub] ?? null;
  const scrubbedSurface = scrubbed === null ? null : surfaceAt(surface, scrubbed.distanceMeters / profile.totalMeters);
  const totals = surface === undefined ? [] : surfaceTotals(surface, profile.totalMeters);
  const summary = `Climbs ${feet(profile.climbMeters)} and descends ${feet(profile.descentMeters)} over ${miles(profile.totalMeters)}, between ${feet(profile.minMeters)} and ${feet(profile.maxMeters)}.`;

  return (
    <section className="og-elevation" aria-label="Elevation" data-testid="elevation-profile">
      <div className="og-elevation__head">
        <p className="og-elevation__title">Elevation</p>
        <p className="og-elevation__stats">
          <span data-testid="elevation-climb">
            <span aria-hidden="true">↗ </span>
            {feet(profile.climbMeters)}
          </span>
          <span data-testid="elevation-descent">
            <span aria-hidden="true">↘ </span>
            {feet(profile.descentMeters)}
          </span>
          {profile.steepestGradePercent === null || profile.steepestGradePercent < 1 ? null : (
            <span className="og-elevation__grade">max {Math.round(profile.steepestGradePercent)}%</span>
          )}
        </p>
      </div>
      <div className="og-elevation__plot">
        <svg
          className="og-elevation__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={endScrub}
          onPointerCancel={endScrub}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="og-elevation__fill-top" />
              <stop offset="100%" className="og-elevation__fill-bottom" />
            </linearGradient>
          </defs>
          <path d={shape.area} fill={`url(#${gradientId})`} />
          <path d={shape.line} className="og-elevation__line" vectorEffect="non-scaling-stroke" />
          {scrubbed === null ? null : (
            <line
              className="og-elevation__cursor"
              x1={shape.x(scrubbed.distanceMeters)}
              x2={shape.x(scrubbed.distanceMeters)}
              y1={0}
              y2={HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <span className="og-elevation__axis og-elevation__axis--max" aria-hidden="true">{feet(profile.maxMeters)}</span>
        <span className="og-elevation__axis og-elevation__axis--min" aria-hidden="true">{feet(profile.minMeters)}</span>
        {scrubbed === null ? null : (
          <span
            className="og-elevation__readout"
            data-testid="elevation-readout"
            style={{ left: `${(scrubbed.distanceMeters / profile.totalMeters) * 100}%` }}
          >
            {miles(scrubbed.distanceMeters)} · {feet(scrubbed.elevationMeters)}
            {scrubbedSurface === null ? null : ` · ${SURFACE_WORDS[scrubbedSurface].toLowerCase()}`}
          </span>
        )}
      </div>
      {surface === undefined ? null : (
        <div
          className="og-elevation__surface"
          data-testid="elevation-surface"
          role="img"
          aria-label={`Surface along the ride: ${totals.map((entry) => `${miles(entry.meters)} ${SURFACE_WORDS[entry.kind].toLowerCase()}`).join(", ")}`}
        >
          {surface.map((run, index) => (
            <span
              key={index}
              data-surface={run.kind}
              style={{ left: `${run.from * 100}%`, width: `${Math.max(0.4, (run.to - run.from) * 100)}%` }}
            />
          ))}
        </div>
      )}
      <div className="og-elevation__ticks" aria-hidden="true">
        <span>0 mi</span>
        <span>{miles(profile.totalMeters)}</span>
      </div>
      {totals.length < 2 ? null : (
        <p className="og-elevation__legend" aria-hidden="true">
          {totals.map((entry) => (
            <span key={entry.kind} data-surface={entry.kind}>
              {SURFACE_WORDS[entry.kind]} {miles(entry.meters)}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
