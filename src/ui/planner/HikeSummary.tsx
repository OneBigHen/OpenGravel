"use client";

/**
 * The planned hike's summary: what the ride summary is for a ride, in the
 * bottom sheet on phones and the right inspector on wide screens. Walking time
 * and climb come from the foot router's line; warnings are compact rows.
 * Start sits right under the numbers so it never scrolls away.
 */

import type { RouteCandidate } from "@/domain/route/types";
import { formatDistance, formatFeet, formatLongDuration } from "@/application/planner/measurements";
import type { RideActionsProps } from "./RideActions";

export interface HikeSummaryModel {
  readonly candidate: RouteCandidate;
  readonly returnToStart: boolean;
  readonly onReturnToStart: (enabled: boolean) => void;
  readonly canPlan: boolean;
  readonly onPlan: () => void;
  readonly onDraw: () => void;
  /** Tap waypoints on the map, then Plan on trails. Absent where the planner has no breadcrumb tool. */
  readonly onBreadcrumb?: () => void;
}

const NAV = "M12 3 5 20l7-3.5 7 3.5z";
const PEN = "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3";
const PIN = "M12 21s-6-5.4-6-10.5a6 6 0 0 1 12 0C18 15.6 12 21 12 21z";
const Glyph = ({ d }: { readonly d: string }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function HikeSummary({ hike, start }: { readonly hike: HikeSummaryModel; readonly start: RideActionsProps["start"] }) {
  const { candidate } = hike;
  const gain = candidate.hike?.gainMeters ?? null;
  const loss = candidate.hike?.lossMeters ?? null;
  return <section className="og-phone-summary og-hike-summary" data-testid="hike-route-summary" data-comparing="false" aria-label="Your hike">
    <p className="og-hike-summary__kicker">HIKE</p>
    <div className="og-hike-summary__eta">
      <h2 className="og-hike-summary__time">~{formatLongDuration(candidate.durationSeconds)}</h2>
      <p className="og-hike-summary__distance">{formatDistance(candidate.distanceMeters)}</p>
    </div>
    {gain === null ? null : <p className="og-hike-summary__climb">
      <span>↑ {formatFeet(gain)}</span>{loss === null ? null : <span> · ↓ {formatFeet(loss)}</span>} <span className="og-hike-summary__hint">walking time from grade</span>
    </p>}
    {start === null ? null : <div className="og-hike-summary__start">
      <button type="button" className="og-primary" data-testid="start-hike" aria-label={start.starting ? undefined : "Start hike"} disabled={start.starting || start.refusal !== null} onClick={start.onStart}><Glyph d={NAV} />{start.starting ? "Starting…" : "Start hike"}</button>
      {start.refusal === null ? null : <p className="og-hike-summary__warn" data-testid="start-ride-reason">{start.refusal}</p>}
      {start.error === null ? null : <p className="og-hike-summary__warn" role="alert">{start.error}</p>}
    </div>}
    {candidate.warnings.length === 0 ? null : <ul className="og-hike-summary__warnings" aria-label="Heads up">
      {candidate.warnings.map((warning) => <li key={warning.id}>{warning.message}</li>)}
    </ul>}
    <div className="og-hike-summary__options" data-testid="hike-options">
      <label className="og-style__switch">
        <input type="checkbox" role="switch" data-testid="hike-there-and-back" checked={hike.returnToStart} onChange={(event) => hike.onReturnToStart(event.target.checked)} />
        <span>There and back</span>
      </label>
      <div className="og-hike-summary__buttons">
        <button type="button" data-testid="hike-plan" disabled={!hike.canPlan} onClick={hike.onPlan}>Re-plan</button>
        <button type="button" data-testid="hike-draw-start" onClick={hike.onDraw}><Glyph d={PEN} />Draw</button>
        {hike.onBreadcrumb === undefined ? null : <button type="button" data-testid="hike-breadcrumb" onClick={hike.onBreadcrumb}><Glyph d={PIN} />Breadcrumb</button>}
      </div>
    </div>
  </section>;
}
