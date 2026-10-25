"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import { pointAtShare, type ElevationProfile } from "@/application/elevation/profile";
import { waypointNotches, type ElevationWaypoint } from "@/application/elevation/waypoints";
import type { SurfaceRun, SurfaceRunKind } from "@/application/roads/engine-road-evidence";
import type { Coordinate } from "@/domain/ride/types";

import { setRouteScrub } from "@/ui/stores/route-scrub-store";

import type { ElevationProfileState } from "./useElevationProfile";

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;
const WIDTH = 320;
const HEIGHT = 96;
/** Keyboard readout announcements: fast enough to follow, slow enough to read. */
const READOUT_THROTTLE_MS = 150;
const SAMPLE_STEP = 1;
const SAMPLE_STEP_SHIFT = 10;
const TICK_SHARES = [0, 0.25, 0.5, 0.75, 1] as const;

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
 * The expanded chart's y scale: the top, the three span quartiles and the
 * bottom. A span with no relief has nothing to label between its ends.
 */
function elevationMarks(profile: ElevationProfile): {
  readonly labels: readonly number[];
  readonly gridlines: readonly number[];
} {
  const span = profile.maxMeters - profile.minMeters;
  const gridlines = span < 1 ? [] : [0.25, 0.5, 0.75].map((share) => profile.minMeters + span * share);
  return { labels: [profile.maxMeters, ...gridlines.slice().reverse(), profile.minMeters], gridlines };
}

/**
 * The route's elevation profile (UX rework phase 3): climb and descent up front,
 * the line drawn in the selected route's colour, and a scrub that reads out the
 * mile and height under the rider's finger or pointer.
 *
 * Two densities share the drawing (UX rework, elevation chart): `compact` is the
 * one-line shape in the resting sheet, `expanded` adds a readable chart — a
 * y gutter with quartile gridlines, five distance ticks, numbered notches at the
 * author's own points, and the steepest-grade badge over the climb it describes.
 * The svg is focusable: arrows step one sample (Shift: ten), Home/End jump, and
 * the readout is mirrored into a polite live region.
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

const AXIS_INSTRUCTIONS =
  "Elevation chart. Use the left and right arrow keys to step along the ride, hold Shift for ten samples, and Home or End to jump to the ends.";

export interface ElevationProfileChartProps {
  readonly state: ElevationProfileState;
  /** Where each surface is along the selected route, drawn as a strip under the profile. */
  readonly surface?: readonly SurfaceRun[] | undefined;
  /** The authored points in order: the chart notches them at their distance. */
  readonly waypoints?: readonly ElevationWaypoint[] | undefined;
  /** The planned line the waypoints are projected onto. */
  readonly line?: readonly Coordinate[] | undefined;
  /** The sheet is at its expanded detent, so the chart opens expanded too. */
  readonly expandedBySheet?: boolean;
}

export function ElevationProfileChart({ state, surface, waypoints, line, expandedBySheet = false }: ElevationProfileChartProps) {
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
  return (
    <ReadyProfile
      profile={state.profile}
      surface={surface}
      waypoints={waypoints}
      line={line}
      expandedBySheet={expandedBySheet}
    />
  );
}

function ReadyProfile({
  profile,
  surface,
  waypoints,
  line,
  expandedBySheet,
}: {
  readonly profile: ElevationProfile;
  readonly surface: readonly SurfaceRun[] | undefined;
  readonly waypoints: readonly ElevationWaypoint[] | undefined;
  readonly line: readonly Coordinate[] | undefined;
  readonly expandedBySheet: boolean;
}) {
  const gradientId = useId();
  const instructionsId = useId();
  const plotId = useId();
  const shape = useMemo(() => plot(profile), [profile]);
  const marks = useMemo(() => elevationMarks(profile), [profile]);
  // The scrub is keyed to the profile it was taken on: a new route's answer is
  // a different line, and its old index must not read out as this ride's.
  const [scrubState, setScrubState] = useState<{ readonly profile: ElevationProfile; readonly index: number | null }>({
    profile,
    index: null,
  });
  const scrub = scrubState.profile === profile ? scrubState.index : null;
  const setScrub = (index: number | null): void => setScrubState({ profile, index });
  // The sheet's own detent opens the chart; the rider's tap wins until the
  // sheet changes again, so closing the sheet restores the compact density.
  const [density, setDensity] = useState<{ readonly sheet: boolean; readonly value: boolean | null }>({
    sheet: expandedBySheet,
    value: null,
  });
  const expanded = (density.sheet === expandedBySheet ? density.value : null) ?? expandedBySheet;
  // Projection is only worth doing when the notches are drawn (expanded).
  const notches = useMemo(
    () => (expanded && line !== undefined ? waypointNotches(line, waypoints ?? []) : []),
    [expanded, line, waypoints],
  );

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
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    const last = profile.points.length - 1;
    const step = event.shiftKey ? SAMPLE_STEP_SHIFT : SAMPLE_STEP;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = Math.min(last, (scrub ?? -1) + step);
        break;
      case "ArrowLeft":
        // Nothing scrubbed yet: the first press lands on the far end, mirroring right.
        next = Math.max(0, (scrub ?? last + 1) - step);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const point = profile.points[next];
    if (point === undefined) return;
    setScrub(next);
    setRouteScrub(point.coordinate);
  };
  // A profile that goes away (a new plan, another route) takes its marker along.
  useEffect(() => () => setRouteScrub(null), [profile]);
  const scrubbed = scrub === null ? null : profile.points[scrub] ?? null;
  const scrubbedSurface = scrubbed === null ? null : surfaceAt(surface, scrubbed.distanceMeters / profile.totalMeters);
  const totals = surface === undefined ? [] : surfaceTotals(surface, profile.totalMeters);
  const summary = `Climbs ${feet(profile.climbMeters)} and descends ${feet(profile.descentMeters)} over ${miles(profile.totalMeters)}, between ${feet(profile.minMeters)} and ${feet(profile.maxMeters)}.`;
  const readout =
    scrubbed === null
      ? null
      : `${miles(scrubbed.distanceMeters)} · ${feet(scrubbed.elevationMeters)}${
          scrubbedSurface === null ? "" : ` · ${SURFACE_WORDS[scrubbedSurface].toLowerCase()}`
        }`;
  const gradePercent = profile.steepestGradePercent;
  const gradeShare = profile.steepestGradeShare;
  const gradePin =
    expanded && gradePercent !== null && gradePercent >= 1 && gradeShare !== null
      ? (() => {
          const point = pointAtShare(profile, gradeShare);
          if (point === null) return null;
          return {
            share: Math.min(0.94, Math.max(0.06, gradeShare)),
            top: Math.min(72, Math.max(10, (shape.y(point.elevationMeters) / HEIGHT) * 100)),
          };
        })()
      : null;

  // The visible readout is mirrored for screen readers, throttled so a held
  // arrow key reads as a moving position rather than a queue of announcements.
  const pendingReadout = useRef("");
  const readoutTimer = useRef<number | null>(null);
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    if (readout === null) return;
    pendingReadout.current = readout;
    if (readoutTimer.current !== null) return;
    readoutTimer.current = window.setTimeout(() => {
      readoutTimer.current = null;
      setSpoken(pendingReadout.current);
    }, READOUT_THROTTLE_MS);
  }, [readout]);
  useEffect(
    () => () => {
      if (readoutTimer.current !== null) window.clearTimeout(readoutTimer.current);
    },
    [],
  );

  return (
    <section
      className="og-elevation"
      aria-label="Elevation"
      data-testid="elevation-profile"
      data-density={expanded ? "expanded" : "compact"}
    >
      <p className="og-visually-hidden" id={instructionsId}>{AXIS_INSTRUCTIONS}</p>
      <div className="og-elevation__head">
        <p className="og-elevation__title">Elevation</p>
        <div className="og-elevation__head-right">
          <p className="og-elevation__stats">
            <span data-testid="elevation-climb">
              <span aria-hidden="true">↗ </span>
              {feet(profile.climbMeters)}
            </span>
            <span data-testid="elevation-descent">
              <span aria-hidden="true">↘ </span>
              {feet(profile.descentMeters)}
            </span>
            {gradePercent === null || gradePercent < 1 || expanded ? null : (
              <span className="og-elevation__grade">max {Math.round(gradePercent)}%</span>
            )}
          </p>
          <button
            type="button"
            className="og-elevation__expand"
            aria-expanded={expanded}
            aria-controls={plotId}
            data-testid="elevation-expand"
            onClick={(): void => setDensity({ sheet: expandedBySheet, value: !expanded })}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      <div className="og-elevation__plot" id={plotId} data-density={expanded ? "expanded" : "compact"}>
        {/* The feet sit in the plot's left gutter, which the plot reserves for
            them, so the drawing starts clear of the labels at 320 px. */}
        {expanded ? (
          <div className="og-elevation__yaxis" aria-hidden="true">
            {marks.labels.map((value, index) => (
              <span
                key={`${index}:${value}`}
                className="og-elevation__ylabel"
                style={{ top: `${(shape.y(value) / HEIGHT) * 100}%` }}
              >
                {feet(value)}
              </span>
            ))}
          </div>
        ) : null}
        <div className="og-elevation__frame">
          <svg
            className="og-elevation__svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            role="application"
            tabIndex={0}
            aria-label={summary}
            aria-describedby={instructionsId}
            data-density={expanded ? "expanded" : "compact"}
            onKeyDown={onKeyDown}
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
            {expanded
              ? marks.gridlines.map((value) => (
                  <line
                    key={value}
                    className="og-elevation__grid"
                    x1={0}
                    x2={WIDTH}
                    y1={shape.y(value)}
                    y2={shape.y(value)}
                    vectorEffect="non-scaling-stroke"
                    data-testid="elevation-gridline"
                  />
                ))
              : null}
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
          {expanded && notches.length > 0 ? (
            <div className="og-elevation__waypoints" data-testid="elevation-waypoints" aria-hidden="true">
              {notches.map((notch) => (
                <span
                  key={notch.position}
                  className="og-elevation__waypoint"
                  data-testid="elevation-waypoint"
                  data-position={notch.position}
                  title={notch.label}
                  style={{ left: `${notch.share * 100}%` }}
                >
                  <span className="og-elevation__waypoint-index">{notch.position}</span>
                  <span className="og-elevation__waypoint-bar" />
                </span>
              ))}
            </div>
          ) : null}
          {gradePin === null || gradePercent === null ? null : (
            <span
              className="og-elevation__grade-pin"
              data-testid="elevation-grade-pin"
              /* The share is data; the stylesheet clamps it inside the drawing. */
              style={{ "--og-elevation-pin-share": `${gradePin.share * 100}%`, top: `${gradePin.top}%` } as CSSProperties}
            >
              max {Math.round(gradePercent)}%
            </span>
          )}
          {expanded ? null : (
            <>
              <span className="og-elevation__axis og-elevation__axis--max" aria-hidden="true">{feet(profile.maxMeters)}</span>
              <span className="og-elevation__axis og-elevation__axis--min" aria-hidden="true">{feet(profile.minMeters)}</span>
            </>
          )}
          {readout === null || scrubbed === null ? null : (
            <span
              className="og-elevation__readout"
              data-testid="elevation-readout"
              style={{ left: `${(scrubbed.distanceMeters / profile.totalMeters) * 100}%` }}
            >
              {readout}
            </span>
          )}
        </div>
      </div>
      <p className="og-visually-hidden" role="status" aria-live="polite" data-testid="elevation-announcement">
        {spoken}
      </p>
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
      <div className={expanded ? "og-elevation__ticks og-elevation__ticks--expanded" : "og-elevation__ticks"} aria-hidden="true">
        {(expanded ? TICK_SHARES : [0, 1]).map((share) => (
          <span
            key={share}
            data-edge={share === 0 ? "start" : share === 1 ? "end" : undefined}
            style={expanded ? { left: `${share * 100}%` } : undefined}
          >
            {share === 0 ? "0 mi" : miles(profile.totalMeters * share)}
          </span>
        ))}
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
