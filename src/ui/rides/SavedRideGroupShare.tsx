"use client";

import { useRef, useState } from "react";
import type { RideExportSource, RideSummary } from "@/application/library/library-service";
import { publicRideSegments, type PublicRideSegment } from "@/application/community/public-ride";
import { ShareWithEveryone } from "@/ui/community/GroupRouteShare";

/** Loads a saved source on demand, keeping the active planner draft untouched. */
export function SavedRideGroupShare({ ride, loadSource }: {
  readonly ride: RideSummary;
  readonly loadSource: (rideId: RideSummary["rideId"]) => Promise<RideExportSource>;
}) {
  const [segments, setSegments] = useState<readonly PublicRideSegment[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  if (segments !== null) {
    const segment = segments.length === 1 ? segments[0] : segments.find((part) => part.id === selected);
    return <div>
      {segments.length < 2 ? null : <label>This ride has disconnected segments. Choose the continuous segment to share<select aria-label="Continuous segment to share" value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Choose a segment</option>
        {segments.map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}
      </select></label>}
      {segment === undefined ? null : <ShareWithEveryone key={segment.id} name={ride.title} geometry={segment.geometry} initiallyOpen />}
    </div>;
  }
  return <div>
    <button type="button" className="og-secondary" disabled={busy} onClick={async () => {
      if (loading.current) return;
      loading.current = true;
      setBusy(true);
      setError(null);
      try {
        const source = await loadSource(ride.rideId);
        setSegments(publicRideSegments(source));
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : "The saved ride could not be read. Try again.");
      } finally { loading.current = false; setBusy(false); }
    }}>{busy ? "Loading ride…" : "Share with everyone"}</button>
    {error === null ? null : <p role="alert">{error}</p>}
  </div>;
}
