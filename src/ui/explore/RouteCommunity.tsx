"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { submitContribution } from "@/application/contributions/client";
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

function deviceId(): string {
  const saved = window.localStorage.getItem(COMMUNITY_DEVICE_ID_STORAGE_KEY);
  if (saved !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
  const created = newContributorPseudoId();
  window.localStorage.setItem(COMMUNITY_DEVICE_ID_STORAGE_KEY, created);
  return created;
}

export function RouteCommunity({ routeId }: { readonly routeId: string }) {
  const [community, setCommunity] = useState(EMPTY);
  const [rating, setRating] = useState(5);
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

  async function postRating(): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(routeId)}/community`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "rating", rating, deviceId: deviceId() }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many posts from this device. Try again later." : "Your submission could not be saved.");
      setStatus("Rating saved.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your submission could not be saved.");
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
      setStatus("Road condition report sent for review. Posted from this device.");
    } catch {
      setError("Road condition report could not be saved. Try again later.");
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
      setStatus("Comment sent for review. It will appear after approval. Posted from this device.");
    } catch {
      setError("Comment could not be sent for review. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="og-route-community" aria-labelledby="route-community-title">
      <div>
        <p className="og-eyebrow">Community</p>
        <h2 id="route-community-title">Route notes</h2>
        <p>
          {community.ratingAverage === null ? "No ratings yet" : `${community.ratingAverage.toFixed(1)} out of 5`}
          {` · ${community.ratingCount} ${community.ratingCount === 1 ? "rating" : "ratings"}`}
        </p>
      </div>
      <p className="og-route-community__device">Posted from this device. No account is required.</p>
      <p className="og-route-community__device">Community posts do not request your GPS location; reports are scoped to this route.</p>

      <form onSubmit={(event) => { event.preventDefault(); void postRating(); }}>
        <label>Rate this ride
          <select aria-label="Your rating" value={rating} onChange={(event) => setRating(Number(event.target.value))}>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {value === 1 ? "star" : "stars"}</option>)}
          </select>
        </label>
        <button type="submit" className="og-secondary" disabled={busy}>Save rating</button>
      </form>

      <form onSubmit={(event) => void postComment(event)}>
        <div className="og-route-community__comment">
          <label htmlFor="route-comment">Leave a comment</label>
          <textarea id="route-comment" maxLength={CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share a useful note about this ride." />
        </div>
        <button type="submit" className="og-secondary" disabled={busy || comment.trim().length === 0}>Post comment</button>
      </form>

      <form onSubmit={(event) => void report(event)}>
        <label>Report a road condition
          <select aria-label="Road condition" value={condition} onChange={(event) => setCondition(event.target.value)}>
            <option value="closed">Closed</option>
            <option value="rough">Rough</option>
            <option value="gravel">Gravel</option>
            <option value="hazard">Hazard</option>
          </select>
        </label>
        <label htmlFor="road-condition-note">Optional note
          <textarea id="road-condition-note" maxLength={CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH} value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder="Where on the route? What did you see?" />
        </label>
        <button type="submit" className="og-secondary" disabled={busy}>Send report</button>
      </form>

      {error !== null ? <p role="alert">{error}</p> : null}
      {status !== null ? <p role="status">{status}</p> : null}
      <ul aria-label="Route comments">
        {community.comments.map((item) => <li key={item.id}><p>{item.text}</p><small>{item.authorLabel} · {new Date(item.postedAt).toLocaleDateString()}</small></li>)}
      </ul>
    </section>
  );
}
