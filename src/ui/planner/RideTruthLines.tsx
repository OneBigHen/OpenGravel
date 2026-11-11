"use client";

/**
 * The three honest lines under a route (next round N3, taste call 5): surface,
 * bike, checked, always in that order. Each starts with an 8 px dot whose
 * colour carries the tone; the text stays ink. A line that knows a stretch of
 * the route (the bike line's roughest stretch) is a button that flies the map
 * there.
 */

import type { ReactNode } from "react";

import type { RideTruth, RideTruthLine, RideTruthStretch } from "@/application/planner/ride-truth";

const KEYS = ["surface", "bike", "checked"] as const;

function Line({ line, kind, onShowStretch }: {
  readonly line: RideTruthLine;
  readonly kind: (typeof KEYS)[number];
  readonly onShowStretch?: ((stretch: RideTruthStretch) => void) | undefined;
}) {
  const body = <>
    <span className="og-truth__dot" data-tone={line.tone} aria-hidden="true" />
    <span className="og-truth__text" {...(kind === "surface" ? { "data-testid": "phone-surface-line" } : {})}>{line.text}</span>
  </>;
  const jump = line.jumpTo;
  if (jump !== undefined && onShowStretch !== undefined) {
    return <button type="button" className="og-truth__line og-truth__line--jump" data-truth={kind} data-tone={line.tone}
      aria-label={`${line.text}. Show it on the map`} onClick={() => onShowStretch(jump)}>{body}</button>;
  }
  return <p className="og-truth__line" data-truth={kind} data-tone={line.tone}>{body}</p>;
}

export function RideTruthLines({ truth, surfaceBar = null, onShowStretch, testId = "ride-truth" }: {
  readonly truth: RideTruth;
  /** The surface bar, drawn right under the surface line. */
  readonly surfaceBar?: ReactNode;
  readonly onShowStretch?: ((stretch: RideTruthStretch) => void) | undefined;
  readonly testId?: string;
}) {
  return <div className="og-truth" data-testid={testId}>
    <Line line={truth[0]} kind="surface" onShowStretch={onShowStretch} />
    {surfaceBar}
    <Line line={truth[1]} kind="bike" onShowStretch={onShowStretch} />
    <Line line={truth[2]} kind="checked" onShowStretch={onShowStretch} />
  </div>;
}
