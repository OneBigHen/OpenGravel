"use client";

import { useId } from "react";

import {
  legalWording,
  permitWording,
  seasonWording,
  surfaceWording,
} from "@/application/route-library/fact-wording";
import {
  sectionsMiles,
  statedDays,
  tripLead,
  tripSections,
} from "@/application/route-library/trip-sections";
import type { LibraryPoi, RideDetail } from "@/application/route-library/types";

/**
 * A big trip reads as days and sections, with the fuel and camps the source
 * lists (L7). A trail area reads as a place, with its permit and season (L8).
 * Nothing here decides a fact: sections, mileage, stops and days are the
 * source's, and a silence says so.
 */

function milesText(miles: number): string {
  return `${miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10} mi`;
}

function isWebAddress(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

function StopList({ label, none, stops }: {
  readonly label: string;
  readonly none: string;
  readonly stops: readonly LibraryPoi[];
}) {
  return (
    <div className="og-library-ride__stop-group" data-stop={label.toLowerCase()}>
      <h3>{label}</h3>
      {stops.length === 0 ? (
        <p className="og-library-ride__none">{none}</p>
      ) : (
        <ul className="og-library-ride__stops">
          {stops.map((stop, index) => (
            <li key={`${stop.name}-${index}`} className="og-library-ride__stop">
              <span className="og-library-ride__stop-name">{stop.name}</span>
              {stop.notes === undefined ? null : (
                <span className="og-library-ride__stop-note">{stop.notes}</span>
              )}
              {isWebAddress(stop.source) ? (
                <a className="og-library-ride__stop-source" href={stop.source} target="_blank" rel="noopener noreferrer">
                  Where this came from<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Days and sections", only when the source gave a day count or named sections. */
export function LibraryTripDays({ route, summary }: {
  readonly route: RideDetail;
  readonly summary: string;
}) {
  const titleId = useId();
  const sections = tripSections(route.sections);
  const lead = tripLead(sections, statedDays(summary));
  if (sections.length === 0 && lead === null) return null;
  const total = sectionsMiles(sections);
  return (
    <section className="og-library-ride" data-testid="trip-days" aria-labelledby={titleId}>
      <h2 id={titleId}>Days and sections</h2>
      {lead === null ? null : <p className="og-library-ride__lead">{lead}</p>}
      {sections.length === 0 ? null : (
        <>
          <ol className="og-library-ride__sections">
            {sections.map((section) => (
              <li key={`${section.day}-${section.label}`} className="og-library-ride__section">
                <span className="og-library-ride__day">Day {section.day}</span>
                <span className="og-library-ride__name">{section.label}</span>
                <span className="og-library-ride__miles">
                  {section.miles === null ? <span aria-label="Distance not stated">—</span> : milesText(section.miles)}
                </span>
              </li>
            ))}
          </ol>
          <p className="og-library-ride__fine">
            {total === null ? "Section names are the source's." : `${milesText(total)} of sections, from the source.`}
            {" "}Check each day before you ride it.
          </p>
        </>
      )}
    </section>
  );
}

/** Fuel and camps, on every big trip: a list when the source gave one, and a plain "none" when not. */
export function LibraryTripStops({ stops }: { readonly stops: RideDetail["stops"] }) {
  const titleId = useId();
  return (
    <section className="og-library-ride" data-testid="trip-stops" aria-labelledby={titleId}>
      <h2 id={titleId}>Fuel and camps</h2>
      <StopList label="Fuel" none="The source lists no fuel stops." stops={stops.fuel} />
      <StopList label="Camps" none="The source lists no camps." stops={stops.camping} />
      <p className="og-library-ride__fine">Stops the source lists. Check they are open before you rely on them.</p>
    </section>
  );
}

/**
 * The quoted facts a place is ridden under: access, permit and season, each in
 * the source's words. Permit and season are always said, even as "not stated";
 * surface only appears when the source made a claim.
 */
/** The row already names the fact, so a value that opens with the same label drops it ("Permit: Permit: …" read twice). */
function withoutLabel(label: string, text: string | null): string | null {
  if (text === null) return null;
  const prefix = `${label}:`;
  return text.toLowerCase().startsWith(prefix.toLowerCase()) ? text.slice(prefix.length).trimStart() : text;
}

export function LibraryFacts({ facts, title }: {
  readonly facts: RideDetail["facts"];
  readonly title: string;
}) {
  const titleId = useId();
  const legal = legalWording(facts.legal);
  const permit = permitWording(facts.permits);
  return (
    <section className="og-library-ride" data-testid="library-facts" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <dl className="og-library-ride__facts">
        <div>
          <dt>Access</dt>
          <dd>{legal ?? "Access not stated"}</dd>
        </div>
        <div>
          <dt>Permit</dt>
          <dd>{withoutLabel("Permit", permit) ?? "Permit not stated"}</dd>
        </div>
        <div>
          <dt>Season</dt>
          <dd>{withoutLabel("Season", seasonWording(facts.season, "page")) ?? "Season not stated"}</dd>
        </div>
        {facts.surface.value === null ? null : (
          <div>
            <dt>Surface</dt>
            <dd>{surfaceWording(facts.surface)}</dd>
          </div>
        )}
      </dl>
      <p className="og-library-ride__fine">What the source says. Check the rules posted where you ride before you go.</p>
    </section>
  );
}

