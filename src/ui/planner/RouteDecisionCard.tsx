"use client";

/**
 * One route decision card (04-PLANNER-AND-WORKSPACE-UX §11–§13).
 *
 * A card is a real `<button>` with `aria-pressed`, so selecting a route is a
 * keyboard and screen-reader action and never a color-only distinction
 * (12 §9, 05 §25). `aria-pressed` is the correct state for a toggle button;
 * `aria-selected` would be a lie about the element's role. The card shows what
 * the view model proved: role, duration, distance, added time versus fastest
 * when that is an honest comparison, the 07 §5 confidence band, and the
 * evidence badges — an unverified surface says so instead of implying a
 * surface.
 *
 * `Why this ride?` is the deterministic explanation of the route on screen
 * (04 §13). It is a disclosure: a second real button with `aria-expanded` that
 * expands a region carrying the explanation's own bullets, each labelled with
 * the status of the evidence behind it. It is deliberately a **sibling** of the
 * selection button — a button inside a button is invalid HTML, and the two
 * actions are independent: opening the explanation must not select the route,
 * and selecting a route must not open its explanation.
 *
 * The test hooks are keyed by the *role* (`route-card-<role>`) because a
 * candidate id is minted per attempt while the role names the decision a rider
 * makes; the explanation region is keyed by the candidate identity instead
 * (`card.whyKey`), because two unroled candidates are both `alternative` and
 * duplicate DOM ids are invalid.
 */

import { useState, type ReactNode } from "react";

import type { RouteExplanation } from "@/application/planner/route-explanation";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import type { EvidenceStatus } from "@/domain/evidence/types";
import type { RouteCandidateId } from "@/domain/route/ids";

/**
 * The rider-readable name of an evidence status (07 §2). It travels with every
 * explanation bullet, so a weak fact reads weak instead of reading like a
 * measurement.
 */
const EVIDENCE_STATUS_LABELS: Readonly<Record<EvidenceStatus, string>> = {
  known: "Known",
  estimated: "Estimated",
  unknown: "Unknown",
  unavailable: "Unavailable",
  stale: "Stale",
};

export interface RouteDecisionCardProps {
  readonly card: RouteCardVm;
  readonly onSelect: (routeId: RouteCandidateId) => void;
  /**
   * The explanation of this card's route, or `null` when this card is not the
   * one on screen. The panel answers "why this ride?", so only the selected
   * card ever carries one (04 §13).
   */
  readonly explanation?: RouteExplanation | null;
}

/** A badge or status that only says "we don't know" — shown once per list, not per card. */
function isUnknownLabel(label: string | null | undefined): boolean {
  return label == null || /\bunknown\b/i.test(label);
}

/**
 * The route list. Unknown surface/traffic facts are stated once under the list
 * instead of repeated on every card, so the cards carry only what differs.
 */
export function RouteChoices({
  cards,
  children,
}: {
  readonly cards: readonly RouteCardVm[];
  readonly children: ReactNode;
}) {
  const unknownSurface = cards.some((card) => card.badges.some(isUnknownLabel));
  const unknownTraffic = cards.some((card) => isUnknownLabel(card.trafficLabel));
  // Live traffic is checked for the selected ride; when that one has it, the
  // others are unchecked, not unknowable, and the note must not contradict the
  // delay the selected card shows (PT-03).
  const someTrafficKnown = cards.some((card) => !isUnknownLabel(card.trafficLabel));
  const unknowns = [
    unknownSurface ? "surface" : null,
    unknownTraffic && !someTrafficKnown ? "live traffic" : null,
  ].filter((entry) => entry !== null);
  const trafficNote = unknownTraffic && someTrafficKnown
    ? "Live traffic is checked for the selected ride; pick another to check its traffic."
    : null;
  return (
    <div className="og-route-choices">
      {/* The sheet handle already says "Ride choices"; this heading is for screen readers. */}
      <h2 className="og-visually-hidden">Your ride options</h2>
      <ul className="og-route-list" data-testid="route-list">
        {children}
      </ul>
      {unknowns.length === 0 ? null : (
        <p className="og-route-choices__note" data-testid="route-unknowns-note">
          {`Not yet known for these rides: ${unknowns.join(" and ")}.`}
        </p>
      )}
      {trafficNote === null ? null : (
        <p className="og-route-choices__note" data-testid="route-traffic-note">
          {trafficNote}
        </p>
      )}
    </div>
  );
}

const STEPS = [1, 2, 3, 4, 5] as const;

/** Badges worth a chip: known ones, minus the curves the meter already says. */
function shownBadges(card: RouteCardVm): readonly string[] {
  return card.badges.filter(
    (badge) => !isUnknownLabel(badge) && !(card.curviness !== undefined && isCurvesBadge(badge)),
  );
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The card's at-a-glance character (UX rework phase 3): a five-step curviness
 * meter and a surface strip, both drawn in the route's own colour language so
 * two choices compare in a glance rather than a read.
 */
/** The curves badge the meter absorbs ("7.5 mi of curves", "Few curves"). */
function isCurvesBadge(badge: string): boolean {
  return / of curves$/.test(badge) || badge === "Few curves";
}

/** A strip earns its place only when the surface changes along the ride. */
function isMixedSurface(strip: NonNullable<RouteCardVm["surfaceStrip"]>): boolean {
  return (["paved", "gravel", "dirt", "unknown"] as const).filter((kind) => strip[kind] > 0).length > 1;
}

function RouteTraits({ card }: { readonly card: RouteCardVm }) {
  const { curviness } = card;
  // A one-surface ride's strip was a single unlabelled bar repeating the
  // "Paved" chip (UX rework 2, #10).
  const strip = card.surfaceStrip !== undefined && isMixedSurface(card.surfaceStrip) ? card.surfaceStrip : undefined;
  const curveMiles = card.badges.find((badge) => / of curves$/.test(badge))?.replace(/ of curves$/, "") ?? null;
  if (curviness === undefined && strip === undefined) return null;
  return (
    <span className="og-route-card__traits">
      {curviness === undefined ? null : (
        <span
          className="og-route-card__curvy"
          data-testid="route-curviness"
          data-level={curviness.level}
          role="img"
          aria-label={`Curviness ${curviness.level} of 5: ${curviness.label}${curveMiles === null ? "" : `, ${curveMiles} of curves`}`}
        >
          <span className="og-route-card__curvy-steps" aria-hidden="true">
            {STEPS.map((step) => (
              <span key={step} data-on={step <= curviness.level} />
            ))}
          </span>
          <span className="og-route-card__curvy-label" aria-hidden="true">
            {curviness.label}
            {curveMiles === null ? null : <span className="og-route-card__curvy-miles"> · {curveMiles}</span>}
          </span>
        </span>
      )}
      {strip === undefined ? null : (
        <span
          className="og-route-card__strip"
          data-testid="route-surface-strip"
          role="img"
          aria-label={`Surface: ${percent(strip.paved)} paved, ${percent(strip.gravel)} gravel, ${percent(strip.dirt)} dirt, ${percent(strip.unknown)} unknown`}
        >
          {(["paved", "gravel", "dirt", "unknown"] as const).map((kind) =>
            strip[kind] <= 0 ? null : (
              <span key={kind} data-surface={kind} style={{ flexGrow: strip[kind] }} />
            ),
          )}
        </span>
      )}
    </span>
  );
}

export function RouteDecisionCard({
  card,
  onSelect,
  explanation = null,
}: RouteDecisionCardProps) {
  const [whyExpanded, setWhyExpanded] = useState(false);

  return (
    <li className="og-route-card" data-selected={card.isSelected} data-tint={card.tint ?? 0}>
      <button
        type="button"
        className="og-route-card__button"
        data-testid={`route-card-${card.roleKey}`}
        data-role={card.roleKey}
        data-selected={card.isSelected}
        aria-pressed={card.isSelected}
        onClick={(): void => onSelect(card.routeId)}
      >
        <span className="og-route-card__role">
          <span className="og-route-card__swatch" aria-hidden="true" />
          {card.roleLabel}
        </span>
        <span className="og-route-card__metrics">
          <span className="og-route-card__metric" data-testid="route-duration">
            {card.durationLabel}
          </span>
          <span aria-hidden="true" className="og-route-card__separator">
            ·
          </span>
          <span className="og-route-card__metric" data-testid="route-distance">
            {card.distanceLabel}
          </span>
        </span>
        {card.addedTimeLabel === null ? null : (
          <span className="og-route-card__delta" data-testid="route-added-time">
            {card.addedTimeLabel}
          </span>
        )}
        {shownBadges(card).length === 0 ? null : (
          <span className="og-route-card__badges">
            {shownBadges(card).map((badge) => (
              <span className="og-route-card__badge" key={badge} data-testid="route-badge">
                {badge}
              </span>
            ))}
          </span>
        )}
        <RouteTraits card={card} />
        {isUnknownLabel(card.trafficLabel) ? null : (
          <span className="og-route-card__traffic" data-testid="route-traffic-status">
            {card.trafficLabel}
          </span>
        )}
      </button>
      {isUnknownLabel(card.confidenceLabel) ? null : (
        <p className="og-route-card__confidence" data-testid="route-confidence">
          {card.confidenceLabel}
        </p>
      )}
      {explanation === null ? null : (
        <>
          <button
            type="button"
            className="og-route-card__why-toggle"
            data-testid="route-why-toggle"
            aria-expanded={whyExpanded}
            aria-controls={card.whyKey}
            onClick={(): void => setWhyExpanded((expanded) => !expanded)}
          >
            Why this ride?
          </button>
          {whyExpanded ? (
            <div className="og-route-card__why" id={card.whyKey} data-testid="route-why-panel">
              <p className="og-route-card__why-headline" data-testid="route-why-headline">
                {explanation.headline}
              </p>
              <ul className="og-route-card__why-bullets">
                {explanation.bullets.map((bullet) => (
                  <li
                    className="og-route-card__why-bullet"
                    data-testid="route-why-bullet"
                    key={bullet.key}
                  >
                    {bullet.text}{" "}
                    <span
                      className="og-route-card__why-status"
                      data-testid="route-why-status"
                      data-status={bullet.evidenceStatus}
                    >
                      {EVIDENCE_STATUS_LABELS[bullet.evidenceStatus]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
