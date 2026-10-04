import type { RiderOpportunity } from "@/application/discover/rider-opportunities";

/**
 * One thing worth stopping for: an event, food and drink, or a destination.
 *
 * Redesigned after the owner's 2026-10-04 iPad review ("not happy with layout on
 * events"): the old card stacked an eyebrow, a headline, a four-column fact grid
 * that wrapped word by word, a description, a byline and two big buttons. It is
 * now a scannable row:
 *
 * - a **when** badge on the left — "Now" while it is on, else the day and time;
 * - the name, one line of route facts ("Mile 7 · On route · arrive 3:57 PM") and
 *   whether the timing works for this ride;
 * - small actions: Add stop (the one that changes the ride) and a Details link.
 */

const KIND_LABEL: Readonly<Record<RiderOpportunity["kind"], string>> = {
  event: "Event",
  "happy-hour": "Food & drink",
  place: "Destination",
};

const FIT_COPY: Readonly<Record<RiderOpportunity["timingFit"], string | null>> = {
  fits: "On when you get there",
  wait: "You’d arrive before it starts",
  misses: "Over before you get there",
  unknown: null,
};

function time(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
}

/** The badge: "Now" while it is on, "Today"/"Sat" plus a time otherwise. */
function when(item: RiderOpportunity, now: Date): { readonly top: string; readonly main: string; readonly live: boolean } | null {
  if (item.startsAt === null) return null;
  const start = new Date(item.startsAt);
  const end = item.endsAt === null ? null : new Date(item.endsAt);
  if (start <= now && (end === null || end > now)) {
    return { top: "Now", main: end === null ? "On" : `til ${time(end.toISOString())}`, live: true };
  }
  const sameDay = start.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const top = sameDay
    ? "Today"
    : start.toDateString() === tomorrow.toDateString()
      ? "Tmrw"
      : start.toLocaleDateString([], { weekday: "short" });
  return { top, main: time(start.toISOString()), live: false };
}

/** "Mile 7 · On route · arrive 3:57 PM", from whatever the source knows. */
function facts(item: RiderOpportunity): string {
  const parts: string[] = [];
  if (item.routeMile !== null) parts.push(`Mile ${Math.round(item.routeMile)}`);
  if (item.detourMinutes !== null) {
    parts.push(item.detourMinutes <= 1 ? "On route" : `${item.detourMinutes} min detour`);
  } else if (item.distanceMeters !== null) {
    parts.push(`${Math.max(1, Math.round(item.distanceMeters / 1609.344))} mi away`);
  }
  if (item.estimatedArrivalAt !== null) parts.push(`arrive ${time(item.estimatedArrivalAt)}`);
  return parts.join(" · ");
}

/** "events.henning.rodeo" out of "Things to do — Philly suburbs (events.henning.rodeo)". */
function sourceName(label: string): string {
  const inParens = /\(([^)]+)\)\s*$/.exec(label);
  return inParens?.[1] ?? label;
}

export function OpportunityCard({
  item,
  onAddStop,
  added = false,
  now = new Date(),
}: {
  readonly item: RiderOpportunity;
  readonly onAddStop?: ((item: RiderOpportunity) => void) | undefined;
  readonly added?: boolean;
  readonly now?: Date;
}) {
  const badge = when(item, now);
  const line = facts(item);
  const fit = item.startsAt === null ? null : FIT_COPY[item.timingFit];
  return (
    <li className="og-opp" data-kind={item.kind} data-live={badge?.live === true ? "true" : "false"}>
      {item.imageUrl != null ? (
        <div className="og-opp__media">
          {/* Provider photos are remote and decorative to the text beside them. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="og-opp__photo"
            src={item.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.parentElement?.setAttribute("data-broken", "true");
            }}
          />
          {badge === null ? null : (
            <span className="og-opp__media-badge">
              {badge.top}
              {badge.live ? null : <> · {badge.main}</>}
            </span>
          )}
        </div>
      ) : (
        <div className="og-opp__when" aria-hidden={badge === null ? "true" : undefined}>
          {badge === null ? (
            <span className="og-opp__glyph" data-kind={item.kind} />
          ) : (
            <>
              <span className="og-opp__when-top">{badge.top}</span>
              <span className="og-opp__when-main">{badge.main}</span>
            </>
          )}
        </div>
      )}
      <div className="og-opp__body">
        <p className="og-opp__eyebrow">
          <span className="og-opp__kind">{KIND_LABEL[item.kind]}</span>
          {item.reason.length > 0 ? <span className="og-opp__reason">{item.reason}</span> : null}
        </p>
        <h3 className="og-opp__title">{item.name}</h3>
        {line.length > 0 ? <p className="og-opp__facts">{line}</p> : null}
        {fit === null ? null : (
          <p className="og-opp__fit" data-fit={item.timingFit}>
            {fit}
          </p>
        )}
        {item.description !== null && item.description.length > 0 && !(badge?.live === true && /^happening now\.?$/i.test(item.description.trim())) ? (
          <p className="og-opp__desc">{item.description}</p>
        ) : null}
        <div className="og-opp__foot">
          <span className="og-opp__source" title={item.sourceLabel}>
            {sourceName(item.sourceLabel)}
          </span>
          <span className="og-opp__actions">
            {item.url !== null ? (
              <a className="og-opp__link" href={item.url} target="_blank" rel="noreferrer">
                Details<span className="sr-only"> for {item.name}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
              </a>
            ) : null}
            {onAddStop !== undefined ? (
              <button
                type="button"
                className="og-opp__add"
                data-added={added ? "true" : "false"}
                disabled={added}
                onClick={() => onAddStop(item)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  {added ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
                </svg>
                {added ? "Added" : "Add stop"}
                <span className="sr-only"> · {item.name}</span>
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </li>
  );
}
