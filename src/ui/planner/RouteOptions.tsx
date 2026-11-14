"use client";

/**
 * Directions from a place card, on a phone or tablet (maps-for-riders §4).
 *
 * The ride itself reads exactly like every other route: the one summary
 * (`RideSummary`, round 3 restructure call 3) with its name, time and miles,
 * the three honest lines, Start, Save and Share, and Compare rides. Under it
 * sit the two ways into the ride's settings this view adds — Edit (the From /
 * To card's own edit target) and Options — then the full-sheet detail.
 */

import type { ReactNode } from "react";

export interface RouteOptionsProps {
  /** The one ride summary. */
  readonly summary: ReactNode;
  /**
   * What the ride's own plan says about it (a basic route). This view shows the
   * summary alone — there is no choices list under it — so the sentence lives
   * here, where the half sheet has room to say it.
   */
  readonly notices?: ReactNode;
  /** Save-adjacent detail, briefing and elevation: shown at the full detent. */
  readonly children?: ReactNode;
  readonly onEdit?: (() => void) | undefined;
  readonly onOptions?: (() => void) | undefined;
  readonly optionsLabel?: string | undefined;
}

export function RouteOptions({ summary, notices, onEdit, onOptions, optionsLabel, children }: RouteOptionsProps) {
  return <section className="og-route-options" data-testid="route-options" aria-label="Route options">
    <div className="og-route-options__scroll">
      {summary}
      {notices}
      {onOptions === undefined ? null : <button type="button" className="og-route-options__settings" data-testid="route-options-settings" onClick={onOptions}><span>Options</span><span>{optionsLabel} ›</span></button>}
      {onEdit === undefined ? null : <button type="button" className="og-route-options__settings" data-testid="route-options-edit" onClick={onEdit}><span>Edit route</span><span>Start, destination and stops ›</span></button>}
      {/* Briefing and elevation are full-sheet detail: at half height the
          route stays the subject and the map keeps its share of the screen. */}
      <div className="og-route-options__more">
        {children}
      </div>
    </div>
  </section>;
}
