"use client";

/**
 * The collapsible home of the route-shaping tools (stops, avoid areas, road
 * spans, drawing). Most rides never need them, so they sit behind one
 * disclosure below the route answer instead of pushing it off screen.
 *
 * `forceOpen` keeps the section expanded while a map tool is armed or a draft
 * exists: the controls that finish or cancel that work must stay reachable.
 */

import { useEffect, useId, useState, type ReactNode } from "react";

export interface RefineSectionProps {
  readonly forceOpen: boolean;
  /** Short count of what is already applied, e.g. "2 stops · 1 avoid area". */
  readonly summary: string | null;
  /**
   * Told whenever the disclosure opens or closes, so the map can show the
   * points a rider edits only while they are editing (shaping handles).
   */
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly children: ReactNode;
}

export function RefineSection({ forceOpen, summary, onExpandedChange, children }: RefineSectionProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const expanded = open || forceOpen;
  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <section className="og-refine" data-testid="refine-section" aria-label="Change this ride">
      <button
        type="button"
        className="og-refine__toggle"
        data-testid="refine-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        disabled={forceOpen}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="og-refine__title">Change this ride</span>
        <span className="og-refine__summary">
          {summary ?? "Stops, no-go areas, roads, draw"}
        </span>
        <span className="og-refine__chevron" aria-hidden="true">
          {expanded ? "⌃" : "⌄"}
        </span>
      </button>
      {expanded ? (
        <div className="og-refine__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function refineSummary(counts: {
  readonly stops: number;
  readonly avoidAreas: number;
  readonly roadSpans: number;
  readonly sketch: boolean;
}): string | null {
  const parts: string[] = [];
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (counts.stops > 0) parts.push(plural(counts.stops, "stop"));
  if (counts.avoidAreas > 0) parts.push(plural(counts.avoidAreas, "avoid area"));
  if (counts.roadSpans > 0) parts.push(plural(counts.roadSpans, "road"));
  if (counts.sketch) parts.push("drawn route");
  return parts.length === 0 ? null : parts.join(" · ");
}
