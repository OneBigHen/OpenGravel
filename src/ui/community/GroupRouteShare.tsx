"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CommunityRouteError, shareRouteWithEveryone } from "@/application/community/route-sharing-client";
import { PublicRidePhotos } from "./PublicRidePhotos";
import type { PreparedPublicPhoto } from "@/application/community/prepare-photo";
import { PUBLIC_RIDE_MAX_NAME, PUBLIC_RIDE_MAX_NOTES, PUBLIC_RIDE_MAX_POINTS, PUBLIC_RIDE_MIN_METERS } from "@/application/community/public-ride";
import { formatDistance } from "@/application/planner/measurements";
import type { Coordinate } from "@/domain/ride/types";
import { applyPrivacyTrim, defaultPrivacyTrim, routeDistanceMeters } from "@/domain/sharing/privacy";

/** Explicit public action over a privacy preview; never sends the source file. */
export function ShareWithEveryone({ name, geometry, initiallyOpen = false }: {
  readonly name: string;
  readonly geometry: readonly Coordinate[];
  readonly initiallyOpen?: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "busy" | "done">(initiallyOpen ? "confirm" : "idle");
  const [title, setTitle] = useState(name.slice(0, PUBLIC_RIDE_MAX_NAME));
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<readonly PreparedPublicPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [privacy, setPrivacy] = useState(defaultPrivacyTrim);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publishing = useRef(false);
  const preview = useMemo(() => {
    try {
      const route = applyPrivacyTrim({ segments: [geometry] }, privacy);
      const line = route.segments[0] ?? [];
      if (line.length < 2 || routeDistanceMeters(route) < PUBLIC_RIDE_MIN_METERS) return { line: [], error: "The public route is too short after trimming. Adjust the privacy settings or keep it private." };
      if (line.length > PUBLIC_RIDE_MAX_POINTS) return { line: [], error: "This route has too many points to share (maximum 20,000). Your private ride is still saved." };
      return { line, error: null };
    } catch {
      return { line: [], error: "The privacy trim could not be applied. Keep this ride private or adjust the settings." };
    }
  }, [geometry, privacy]);
  const points = useMemo(() => {
    const bounds = preview.line.reduce((box, p) => ({ west: Math.min(box.west, p.lon), east: Math.max(box.east, p.lon), south: Math.min(box.south, p.lat), north: Math.max(box.north, p.lat) }), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
    return preview.line.map((p) => `${10 + (p.lon - bounds.west) / Math.max(bounds.east - bounds.west, 0.000001) * 300},${110 - (p.lat - bounds.south) / Math.max(bounds.north - bounds.south, 0.000001) * 100}`).join(" ");
  }, [preview.line]);
  if (geometry.length < 2) return null;
  if (phase === "done" && sharedId !== null) return (
    <p className="og-community-action" role="status">
      Shared with everyone. <Link href={`/explore/${encodeURIComponent(sharedId)}`}>See it on Explore</Link>. Your private ride is unchanged. You can add comments on the shared ride page. Anyone can take a shared route down.
    </p>
  );
  if (phase === "idle") return <button type="button" className="og-secondary" onClick={() => setPhase("confirm")}>Share with everyone</button>;
  return (
    <section className="og-community-action" aria-label={`Share ${name} with everyone`}>
      <p>Add this ride to the group listing on Explore for anyone to view, ride and download. Share only routes you have permission to publish. Check the preview for private locations; trimming the ends cannot hide places elsewhere on the route.</p>
      <fieldset disabled={phase === "busy" || photoBusy}>
        <legend>Public ride preview</legend>
        <label className="og-community-action__label">Public ride name<input type="text" maxLength={PUBLIC_RIDE_MAX_NAME} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><input type="checkbox" checked={privacy.hideStart} onChange={(event) => setPrivacy({ ...privacy, hideStart: event.target.checked })} /> Hide the start (500 m)</label>
        <label><input type="checkbox" checked={privacy.hideFinish} onChange={(event) => setPrivacy({ ...privacy, hideFinish: event.target.checked })} /> Hide the finish (500 m)</label>
        <label><input type="checkbox" checked={privacy.blurCoordinates} onChange={(event) => setPrivacy({ ...privacy, blurCoordinates: event.target.checked })} /> Round coordinates (about 100 m)</label>
        <label className="og-community-action__label">Extra distance to remove from each end (meters)<input type="number" min={0} step={50} value={privacy.trimMetersFromEnds} onChange={(event) => setPrivacy({ ...privacy, trimMetersFromEnds: Number(event.target.value) })} /></label>
        <label className="og-community-action__label">Ride notes (optional)<textarea rows={4} maxLength={PUBLIC_RIDE_MAX_NOTES} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Useful stops, road conditions, access notes, or a comment about the ride." /></label>
        <PublicRidePhotos photos={photos} onChange={setPhotos} onBusy={setPhotoBusy} />
        {photoBusy ? <p role="status">Preparing photos…</p> : null}
        {preview.error === null ? <>
          <svg viewBox="0 0 320 120" role="img" aria-label="Public route preview" style={{ width: "100%", maxWidth: 360 }}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" /></svg>
          <p>{formatDistance(routeDistanceMeters({ segments: [preview.line] }))} visible · Only this previewed route, public name, notes and selected photos are uploaded. Original file, waypoints and timestamps stay private.</p>
        </> : <p role="alert">{preview.error}</p>}
      </fieldset>
      <div className="og-community-action__row">
        <button type="button" className="og-primary" disabled={phase === "busy" || photoBusy || preview.error !== null || title.trim().length === 0} onClick={async () => {
          if (publishing.current || preview.error !== null) return;
          publishing.current = true;
          setPhase("busy");
          setError(null);
          try {
            const id = await shareRouteWithEveryone(title, preview.line, { description: notes.trim(), photos: photos.map((photo) => photo.base64) });
            setSharedId(id);
            setPhase("done");
          } catch (caught: unknown) {
            setError(caught instanceof CommunityRouteError ? caught.message : "The ride could not be shared. Try again.");
            setPhase("confirm");
          } finally { publishing.current = false; }
        }}>{phase === "busy" ? "Sharing…" : "Share it"}</button>
        <button type="button" className="og-secondary" disabled={phase === "busy" || photoBusy} onClick={() => { setPhase("idle"); setError(null); }}>Not now</button>
      </div>
      {error === null ? null : <p role="alert" className="og-community-action__error">{error}</p>}
    </section>
  );
}
