"use client";

/**
 * The three honest lines under a route (next round N3, taste call 5): surface,
 * bike, checked, always in that order. Each starts with an 8 px dot whose
 * colour carries the tone; the text stays ink. A line that knows a stretch of
 * the route (the bike line's roughest stretch) is a button that flies the map
 * there.
 */

import { useSyncExternalStore, type ReactNode } from "react";

import {
  getRiderReportPlanStatus,
  subscribeRiderReportPlanStatus,
} from "@/application/planner/rider-report-plan-status";

import { withRiderReportSentence, type RideTruth, type RideTruthLine, type RideTruthStretch } from "@/application/planner/ride-truth";

type LineKind = "surface" | "bike" | "checked" | "fuel";

function Line({ line, kind, onShowStretch }: {
  readonly line: RideTruthLine;
  readonly kind: LineKind;
  readonly onShowStretch?: ((stretch: RideTruthStretch) => void) | undefined;
}) {
  /*
    The surface line's `warn` tone means one thing: part of this ride was not
    measured. It used to draw the amber tone dot, which is the gravel swatch's
    own colour, so "paved where known · 6 mi surface unknown" sat next to a dot
    that said "gravel" (QA-10). It wears the unknown surface's hatch instead, the
    same mark the bar and the legend use.
  */
  const tone = kind === "surface" && line.tone === "warn" ? "unknown" : line.tone;
  const body = <>
    <span className="og-truth__dot" data-tone={tone} aria-hidden="true" />
    <span className="og-truth__text" {...(kind === "surface" ? { "data-testid": "phone-surface-line" } : {})}>{line.text}</span>
  </>;
  const jump = line.jumpTo;
  if (jump !== undefined && onShowStretch !== undefined) {
    return <button type="button" className="og-truth__line og-truth__line--jump" data-truth={kind} data-tone={tone}
      aria-label={`${line.text}. Show it on the map`} onClick={() => onShowStretch(jump)}>{body}</button>;
  }
  return <p className="og-truth__line" data-truth={kind} data-tone={tone}>{body}</p>;
}

export function RideTruthLines({ truth, fuel = null, surfaceBar = null, riderReports = true, onShowStretch, testId = "ride-truth" }: {
  readonly truth: RideTruth;
  /** The surface bar, drawn right under the surface line. */
  readonly surfaceBar?: ReactNode;
  /** The fuel line, shown last and only when the ride is longer than the tank. */
  readonly fuel?: RideTruthLine | null;
  /**
   * Whether the "spots you reported" note belongs here. It describes the plan
   * just made, so a catalog ride page (not planned by this rider) turns it off.
   */
  readonly riderReports?: boolean;
  readonly onShowStretch?: ((stretch: RideTruthStretch) => void) | undefined;
  readonly testId?: string;
}) {
  const reported = useSyncExternalStore(subscribeRiderReportPlanStatus, getRiderReportPlanStatus, getRiderReportPlanStatus);
  return <div className="og-truth" data-testid={testId}>
    <Line line={truth[0]} kind="surface" onShowStretch={onShowStretch} />
    {surfaceBar}
    <Line line={truth[1]} kind="bike" onShowStretch={onShowStretch} />
    <Line line={riderReports ? withRiderReportSentence(truth[2], reported) : truth[2]} kind="checked" onShowStretch={onShowStretch} />
    {fuel === null ? null : <Line line={fuel} kind="fuel" onShowStretch={onShowStretch} />}
  </div>;
}
