"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ContributionSubmissionError, submitContribution } from "@/application/contributions/client";
import { COMMUNITY_DEVICE_ID_STORAGE_KEY } from "@/application/contributions/device-id";
import { asRoadEntityId, asRoadSpanId } from "@/domain/ride/ids";
import { CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH, newContributorPseudoId } from "@/domain/contributions";

interface RouteComment {
  readonly id: string;
  readonly text: string;
  readonly postedAt: string;
  readonly authorLabel: "Anonymous rider";
}

interface CommunityState {
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly comments: readonly RouteComment[];
}

const EMPTY: CommunityState = { ratingAverage: null, ratingCount: 0, comments: [] };
const ROUTE_LEVEL_GPS_PRECISION_M = 1_000;
const STARS = [1, 2, 3, 4, 5] as const;

/** "No ratings yet" is one line: a zero count is the same fact said twice. */
function ratingSummary(state: CommunityState): string {
  if (state.ratingAverage === null || state.ratingCount === 0) return "No ratings yet";
  const count = `${state.ratingCount} ${state.ratingCount === 1 ? "rating" : "ratings"}`;
  return `${state.ratingAverage.toFixed(1)} out of 5 · ${count}`;
}

/**
 * A refusal from the server already says what happened in plain English (too
 * many notes from this connection, a full review queue). Show it instead of
 * blaming the rider's note, and keep the action-specific copy for everything
 * else.
 */
function refusalMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ContributionSubmissionError && (caught.status === 429 || caught.status === 413)) {
    const message = (caught.body as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return fallback;
}

function deviceId(): string {
  const saved = window.localStorage.getItem(COMMUNITY_DEVICE_ID_STORAGE_KEY);
  if (saved !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
  const created = newContributorPseudoId();
  window.localStorage.setItem(COMMUNITY_DEVICE_ID_STORAGE_KEY, created);
  return created;
}

export function RouteCommunity({ routeId }: { readonly routeId: string }) {
  const [community, setCommunity] = useState(EMPTY);
  // No star is chosen until the rider taps one: a pre-filled "5 stars" would
  // claim a rating the rider never gave.
  const [rating, setRating] = useState<number | null>(null);
  const [ratingNotice, setRatingNotice] = useState<{ readonly failed: boolean; readonly text: string } | null>(null);
  const [comment, setComment] = useState("");
  const [condition, setCondition] = useState("rough");
  const [reportNote, setReportNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCommunity = useCallback(async (): Promise<CommunityState> => {
    const response = await fetch(`/api/catalog/${encodeURIComponent(routeId)}/community`, { cache: "no-store" });
    if (!response.ok) throw new Error("community-unavailable");
    return await response.json() as CommunityState;
  }, [routeId]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setCommunity(await loadCommunity());
      setError(null);
    } catch {
      setError("Community details are temporarily unavailable.");
    }
  }, [loadCommunity]);

  useEffect(() => {
    let active = true;
    void loadCommunity().then((value) => {
      if (!active) return;
      setCommunity(value);
      setError(null);
    }).catch(() => {
      if (active) setError("Community details are temporarily unavailable.");
    });
    return () => { active = false; };
  }, [loadCommunity]);

  async function postRating(value: number): Promise<void> {
    // The stars fill at the tap so the row answers immediately; if the save is
    // refused they go back to what the server last kept, never a claim of a
    // rating that was not stored.
    const previous = rating;
    setRating(value);
    setBusy(true);
    setRatingNotice(null);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(routeId)}/community`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "rating", rating: value, deviceId: deviceId() }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many posts from this device. Try again later." : "Your rating could not be saved.");
      setRatingNotice({ failed: false, text: "Thanks. Your rating is saved." });
      await refresh();
    } catch (reason) {
      setRating(previous);
      setRatingNotice({ failed: true, text: reason instanceof Error ? reason.message : "Your rating could not be saved." });
    } finally {
      setBusy(false);
    }
  }

  async function report(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const anonymousId = deviceId();
      await submitContribution({
        kind: "condition",
        roadRef: {
          roadId: asRoadEntityId(`road_${routeId}`),
          spanId: asRoadSpanId(`span_${routeId}`),
        },
        observedAt: new Date().toISOString(),
        // The contribution envelope requires a bounded precision value. Use its
        // coarsest accepted bound; this form does not request coordinates.
        gps_precision_m: ROUTE_LEVEL_GPS_PRECISION_M,
        value: {
          tag: condition,
          severity: condition === "closed" || condition === "hazard" ? "severe" : condition === "rough" ? "moderate" : "minor",
          ...(reportNote.trim().length === 0 ? {} : { note: reportNote.trim() }),
        },
        provenance: { contributorPseudoId: anonymousId, clientVersion: "vnext-m7", evidenceLevel: "low" },
      });
      setReportNote("");
      setStatus("Road condition report sent for review.");
    } catch (caught: unknown) {
      setError(refusalMessage(caught, "Road condition report could not be saved. Try again later."));
    } finally {
      setBusy(false);
    }
  }

  async function postComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const anonymousId = deviceId();
      await submitContribution({
        kind: "condition",
        roadRef: {
          roadId: asRoadEntityId(`road_${routeId}`),
          spanId: asRoadSpanId(`span_${routeId}`),
        },
        observedAt: new Date().toISOString(),
        gps_precision_m: ROUTE_LEVEL_GPS_PRECISION_M,
        value: { tag: "comment", severity: "minor", note: comment.trim() },
        provenance: { contributorPseudoId: anonymousId, clientVersion: "vnext-m7", evidenceLevel: "low" },
      });
      setComment("");
      setStatus("Comment sent for review. It will appear after approval.");
    } catch (caught: unknown) {
      setError(refusalMessage(caught, "Comment could not be sent for review. Try again later."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="og-route-community" aria-labelledby="route-community-title">
      <div className="og-route-community__head">
        <h2 id="route-community-title">Route notes</h2>
        <p className="og-route-community__meta">{ratingSummary(community)}</p>
      </div>

      {/* A radio group, not a select and a Save button: the tap is the save.
          The group is a div named by its own label, so the five stars do not
          depend on how each engine lays out a `legend` inside a `fieldset`. */}
      <div className="og-route-community__rating">
        <p className="og-route-community__legend" id="route-rating-label">Rate this ride</p>
        <div className="og-route-community__stars" role="radiogroup" aria-labelledby="route-rating-label">
          {STARS.map((value) => (
            <label
              key={value}
              className="og-route-community__star"
              data-filled={rating !== null && rating >= value}
            >
              <input
                className="og-route-community__star-input"
                type="radio"
                name={`route-rating-${routeId}`}
                value={value}
                checked={rating === value}
                disabled={busy}
                aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                // Tapping a star is the whole interaction: the rating saves on
                // that tap, so there is no separate save button to find.
                onChange={() => { void postRating(value); }}
              />
              <svg
                className="og-route-community__star-glyph"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill={rating !== null && rating >= value ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 3.4 14.7 9l6.1.9-4.4 4.3 1 6.1L12 17.4 6.6 20.3l1-6.1L3.2 9.9 9.3 9z" />
              </svg>
            </label>
          ))}
        </div>
      </div>
      {ratingNotice === null ? null : (
        <p
          className={ratingNotice.failed ? "og-route-community__note og-route-community__note--failed" : "og-route-community__note"}
          aria-live="polite"
        >
          {ratingNotice.text}
        </p>
      )}

      <form className="og-route-community__form" onSubmit={(event) => void postComment(event)}>
        <label className="og-route-community__label" htmlFor="route-comment">Leave a comment</label>
        <textarea
          id="route-comment"
          className="og-route-community__input"
          rows={3}
          maxLength={CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Share a useful note about this ride."
        />
        <button type="submit" className="og-secondary og-route-community__submit" disabled={busy || comment.trim().length === 0}>Post comment</button>
      </form>

      <form className="og-route-community__form" onSubmit={(event) => void report(event)}>
        <label className="og-route-community__label" htmlFor="road-condition">Report a road condition</label>
        <span className="og-select">
          <select
            id="road-condition"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          >
            <option value="closed">Closed</option>
            <option value="rough">Rough</option>
            <option value="gravel">Gravel</option>
            <option value="hazard">Hazard</option>
          </select>
        </span>
        <label className="og-route-community__label" htmlFor="road-condition-note">Optional note</label>
        <textarea
          id="road-condition-note"
          className="og-route-community__input"
          rows={3}
          maxLength={CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH}
          value={reportNote}
          onChange={(event) => setReportNote(event.target.value)}
          placeholder="Where on the route? What did you see?"
        />
        <button type="submit" className="og-secondary og-route-community__submit" disabled={busy}>Send report</button>
      </form>

      {error !== null ? <p className="og-route-community__note og-route-community__note--failed" role="alert">{error}</p> : null}
      {status !== null ? <p className="og-route-community__note" role="status">{status}</p> : null}
      <ul className="og-route-community__comments" aria-label="Route comments">
        {community.comments.map((item) => (
          <li key={item.id}>
            <p>{item.text}</p>
            <small>{item.authorLabel} · {new Date(item.postedAt).toLocaleDateString()}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
