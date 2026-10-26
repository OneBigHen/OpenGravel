"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppBar } from "@/ui/nav/AppBar";
import {
  type LibraryServicePort,
  type RideSummary,
} from "@/application/library/library-service";
import { DRAFT_DIRTY_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import {
  buildPlannedRouteGpx,
  buildPlannedTrackGpx,
  buildTrackGpx,
  downloadExport,
  exportFilename,
  originalFileBytes,
  type ExportMode,
  type ExportTrack,
} from "@/application/export/gpx-export";
import type { ImportOutcome, ImportServicePort } from "@/application/import/import-service";
import { ImportPanel } from "./../import/ImportPanel";
import { SwitchBackImportPanel } from "./../import/SwitchBackImportPanel";
import { SavedRideGroupShare } from "./SavedRideGroupShare";
import { formatDistance, formatDuration } from "@/application/planner/measurements";
import { RecordedTrackThumbnail } from "./RecordedTrackThumbnail";
import { staticPointsMapUrl, staticRouteMapUrl } from "@/application/map/static-map";
import type { RoadProgressReader } from "@/application/roads/explorable-roads";
import { RecordedRoadProgress, type RecordedRoadProgressState } from "./RecordedRoadProgress";
import { RideRowMenu } from "./RideRowMenu";
import { emitTelemetry } from "@/ui/telemetry/emit-telemetry";
import "./rides-library.css";

const NO_EXPORT_CAPABILITIES = {
  plannedRoute: false,
  track: false,
  original: false,
  recordedRide: false,
} as const;

type RideSegment = "planned" | "recorded";

/** How long a deleted ride can be brought back before it is gone. */
const UNDO_DELETE_MS = 8000;

/** The day a ride last changed, in the rider's own words. */
function formatRideDate(value: string, now = new Date()): string {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString()) return "Today";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/** "1:05" / "42:00": a recorded ride's moving or elapsed time. */
function formatRideTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const PROVENANCE_LABELS: Readonly<Record<RideSummary["provenanceType"], string>> = {
  new: "Planned here",
  import: "Imported from a file",
  "recreated-from-track": "Rebuilt from a recorded track",
  recorded: "Recorded on a ride",
  catalog: "From the catalog",
  derived: "Copied from another ride",
  shared: "Shared with you",
};

/** Where the ride came from, in words; internal ids stay out (RS-14). */
function sourceText(ride: RideSummary): string {
  const origin = PROVENANCE_LABELS[ride.provenanceType];
  return ride.sourceLabel === null || ride.sourceLabel === undefined ? origin : `${origin} · Source: ${ride.sourceLabel}`;
}

function isDraftDirty(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DRAFT_DIRTY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function originalExtension(filename: string | null, mime: string | null): string {
  const fromFilename = filename?.match(/\.([a-z0-9]{1,12})$/i)?.[1];
  if (fromFilename !== undefined) return fromFilename;
  if (mime === "application/vnd.google-earth.kmz" || mime === "application/zip") return "kmz";
  if (mime === "application/vnd.google-earth.kml+xml") return "kml";
  return "gpx";
}

/** The ride on a real map: its line when stored, else its pinned points. */
function rideMapUrl(ride: RideSummary, token: string | undefined): string | null {
  if (token === undefined || ride.mapPreview === undefined) return null;
  const size = { token, width: 400, height: 225 };
  return ride.mapPreview.line.length >= 2
    ? staticRouteMapUrl(ride.mapPreview.line, size)
    : staticPointsMapUrl(ride.mapPreview.pins, size);
}

/** A map image when a token exists, else the ride's own line drawn in the browser. */
function RideThumbnail({ ride, token }: { readonly ride: RideSummary; readonly token: string | undefined }) {
  const mapUrl = rideMapUrl(ride, token);
  if (mapUrl !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote static map; next/image would proxy it.
      <img
        className="og-rides__thumb-image"
        src={mapUrl}
        alt={`${ride.title} on a map`}
        loading="lazy"
        decoding="async"
        width={400}
        height={225}
      />
    );
  }
  const coordinates = ride.recordedTrack?.previewGeometry.length
    ? ride.recordedTrack.previewGeometry
    : ride.mapPreview?.line ?? [];
  if (coordinates.length >= 2) {
    return <RecordedTrackThumbnail coordinates={coordinates} title={ride.title} />;
  }
  return (
    <span className="og-rides__thumb-empty" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z" />
        <path d="M9 7v13M15 4v13" />
      </svg>
    </span>
  );
}

/** One line of facts: the day, then the distance and time the ride knows. */
function rideMeta(ride: RideSummary): string {
  const facts = [formatRideDate(ride.updatedAt)];
  if (ride.recordedTrack !== undefined) {
    facts.push(
      formatDistance(ride.recordedTrack.summary.distanceMeters),
      `${formatRideTime(ride.recordedTrack.summary.movingSeconds)} moving`,
      `${formatRideTime(ride.recordedTrack.summary.elapsedSeconds)} total`,
    );
    return facts.join(" · ");
  }
  if (ride.distanceMeters !== null) facts.push(formatDistance(ride.distanceMeters));
  if (ride.durationSeconds !== null) facts.push(formatDuration(ride.durationSeconds));
  return facts.join(" · ");
}

export interface RidesLibraryProps {
  readonly service: LibraryServicePort;
  readonly onOpen?: (ride: RideSummary) => Promise<void> | void;
  readonly importService?: ImportServicePort;
  /** A public Mapbox token: each ride is then shown on a real map image. */
  readonly mapboxToken?: string;
  /** Local-only reader, invoked when a recorded ride's details are expanded. */
  readonly roadProgressReader?: RoadProgressReader;
}

interface RoadProgressCache {
  readonly reader: RoadProgressReader | undefined;
  readonly entries: Readonly<Record<string, RecordedRoadProgressState>>;
}

export function RidesLibrary({ service: library, onOpen, importService, mapboxToken, roadProgressReader }: RidesLibraryProps) {
  const router = useRouter();
  const [rides, setRides] = useState<readonly RideSummary[]>([]);
  const [segment, setSegment] = useState<RideSegment>("planned");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sharing, setSharing] = useState<string | null>(null);
  const [roadProgressCache, setRoadProgressCache] = useState<RoadProgressCache>(() => ({
    reader: roadProgressReader,
    entries: {},
  }));
  const roadProgress = roadProgressCache.reader === roadProgressReader ? roadProgressCache.entries : {};
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A deleted ride stays recoverable for a few seconds (RS-09): it leaves the
  // list at once and is removed from the library when the undo window closes.
  const [removed, setRemoved] = useState<RideSummary | null>(null);
  const removal = useRef<{ ride: RideSummary; timer: ReturnType<typeof setTimeout> } | null>(null);
  const expandedRef = useRef<ReadonlySet<string>>(new Set());
  const roadProgressRequests = useRef(new Map<string, { readonly controller: AbortController }>());
  // Until the rider picks a segment, the first non-empty load picks the one
  // that actually has rides, so a recorded-only library never opens empty.
  const segmentChosen = useRef(false);
  // A file picked from the page's one import control, handed to the import flow.
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const importFileInput = useRef<HTMLInputElement | null>(null);

  function cancelRoadProgress(rideId: RideSummary["rideId"]): void {
    roadProgressRequests.current.get(rideId)?.controller.abort();
    roadProgressRequests.current.delete(rideId);
    setRoadProgressCache((current) => {
      if (current.reader !== roadProgressReader || current.entries[rideId] === undefined) return current;
      const entries = { ...current.entries };
      delete entries[rideId];
      return { reader: current.reader, entries };
    });
  }

  async function readRoadProgress(rideId: RideSummary["rideId"]): Promise<void> {
    const reader = roadProgressReader;
    if (reader === undefined) return;
    const controller = new AbortController();
    const request = { controller };
    roadProgressRequests.current.set(rideId, request);
    setRoadProgressCache((current) => ({
      reader,
      entries: {
        ...(current.reader === reader ? current.entries : {}),
        [rideId]: { status: "loading" },
      },
    }));
    try {
      const projection = await reader.read(rideId, controller.signal);
      if (roadProgressRequests.current.get(rideId) !== request || !expandedRef.current.has(rideId)) return;
      roadProgressRequests.current.delete(rideId);
      setRoadProgressCache((current) => current.reader === reader
        ? { reader, entries: { ...current.entries, [rideId]: { status: "ready", projection } } }
        : current);
    } catch {
      if (roadProgressRequests.current.get(rideId) !== request || controller.signal.aborted || !expandedRef.current.has(rideId)) return;
      roadProgressRequests.current.delete(rideId);
      setRoadProgressCache((current) => current.reader === reader
        ? { reader, entries: { ...current.entries, [rideId]: { status: "error", message: "unavailable" } } }
        : current);
    }
  }

  useEffect(() => {
    const requests = roadProgressRequests.current;
    return () => {
      for (const request of requests.values()) request.controller.abort();
      requests.clear();
    };
  }, [roadProgressReader]);

  function toggleDetails(ride: RideSummary): void {
    const opening = !expandedRef.current.has(ride.rideId);
    const next = new Set(expandedRef.current);
    if (opening) next.add(ride.rideId);
    else next.delete(ride.rideId);
    expandedRef.current = next;
    setExpanded(next);
    if (!opening) cancelRoadProgress(ride.rideId);
    if (opening && ride.recordedTrack !== undefined && roadProgressReader !== undefined && roadProgress[ride.rideId] === undefined) {
      void readRoadProgress(ride.rideId);
    }
  }

  async function exportRide(ride: RideSummary, mode: ExportMode): Promise<void> {
    if (library.loadExportSource === undefined) throw new Error("Export is not available for this ride.");
    const source = await library.loadExportSource(ride.rideId);
    let bytes: Uint8Array;
    if (mode === "planned-route" || mode === "planned-track") {
      if (source.plannedRoute === null) throw new Error("This ride has no saved route line to export.");
      const planned = { ...source.plannedRoute, title: source.title, createdTime: source.createdTime };
      bytes = new TextEncoder().encode(
        mode === "planned-route" ? buildPlannedRouteGpx(planned) : buildPlannedTrackGpx(planned),
      );
    } else if (mode === "track") {
      const tracks: ExportTrack[] = source.tracks.map((track) => ({
        name: track.name,
        segments: track.segments.map((segment) => {
          const coordinates = source.trackGeometry[segment.geometryRef];
          if (coordinates === undefined) throw new Error("An imported track segment is unavailable.");
          return { coordinates, timestamps: segment.timestamps, elevation: segment.elevation };
        }),
      }));
      bytes = new TextEncoder().encode(buildTrackGpx({
        title: source.title,
        tracks,
        waypoints: source.waypoints,
        createdTime: source.createdTime,
      }));
    } else if (mode === "original") {
      if (source.originalBytes === null) throw new Error("The original file is not available.");
      bytes = originalFileBytes(source.originalBytes);
    } else {
      if (source.recordedTrack === null) throw new Error("The recorded track is not available.");
      bytes = new TextEncoder().encode(buildTrackGpx({
        title: source.title,
        createdTime: source.createdTime,
        tracks: [{
          name: source.title,
          segments: [{
            coordinates: source.recordedTrack.coordinates,
            timestamps: source.recordedTrack.timestamps,
          }],
        }],
      }));
    }
    const filename = exportFilename(
      source.title,
      mode,
      mode === "original" ? { extension: originalExtension(source.originalFilename, source.originalMime) } : undefined,
    );
    downloadExport(bytes, filename, undefined, mode === "original" ? (source.originalMime ?? undefined) : undefined);
    emitTelemetry("export_completed");
  }

  const load = async (): Promise<void> => {
    setStatus("loading");
    setError(null);
    try {
      const next = await library.listRides({});
      setRides(next);
      if (!segmentChosen.current && next.length > 0) {
        segmentChosen.current = true;
        setSegment(next.some((ride) => ride.type !== "recorded") ? "planned" : "recorded");
      }
      setTitles((current) => {
        const merged: Record<string, string> = { ...current };
        for (const ride of next) merged[ride.rideId] = current[ride.rideId] ?? ride.title;
        return merged;
      });
      setStatus("ready");
    } catch {
      setStatus("error");
      setError("Could not load your rides. Try again.");
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // `library` is the intentionally complete identity of this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  // One stable bound reader: the share form auto-loads once it is opened.
  const loadExportSource = useMemo(
    () => library.loadExportSource?.bind(library),
    [library],
  );

  const activeRides = useMemo(
    () => rides.filter((ride) => ride.rideId !== removed?.rideId),
    [rides, removed],
  );

  // Two segments, each newest first. A ride recorded on the road belongs under
  // Recorded; every plan, import and copy belongs under Planned.
  const segmentRides = useMemo(
    () => activeRides
      .filter((ride) => (segment === "recorded" ? ride.type === "recorded" : ride.type !== "recorded"))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [activeRides, segment],
  );

  const visibleRides = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term === "" ? segmentRides : segmentRides.filter((ride) => ride.title.toLowerCase().includes(term));
  }, [segmentRides, search]);

  async function rename(ride: RideSummary): Promise<void> {
    const title = titles[ride.rideId]?.trim() ?? "";
    if (title.length === 0) return;
    setBusy(ride.rideId);
    try {
      await library.renameRide(ride.rideId, title);
      setRenaming(null);
      await load();
    } catch {
      setError("Could not rename this ride.");
    } finally {
      setBusy(null);
    }
  }

  function startRename(ride: RideSummary): void {
    setTitles((current) => ({ ...current, [ride.rideId]: current[ride.rideId] ?? ride.title }));
    setPendingOpen(null);
    setPendingDelete(null);
    setRenaming(ride.rideId);
  }

  function cancelRename(ride: RideSummary): void {
    setTitles((current) => ({ ...current, [ride.rideId]: ride.title }));
    setRenaming(null);
  }

  async function commitRemoval(): Promise<void> {
    const current = removal.current;
    if (current === null) return;
    removal.current = null;
    clearTimeout(current.timer);
    cancelRoadProgress(current.ride.rideId);
    setRemoved(null);
    try {
      await library.deleteRide(current.ride.rideId);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not delete this ride.");
    }
    await load();
  }

  async function deleteRide(ride: RideSummary): Promise<void> {
    await commitRemoval();
    const nextExpanded = new Set(expandedRef.current);
    nextExpanded.delete(ride.rideId);
    expandedRef.current = nextExpanded;
    setExpanded(nextExpanded);
    cancelRoadProgress(ride.rideId);
    setPendingDelete(null);
    if (sharing === ride.rideId) setSharing(null);
    removal.current = { ride, timer: setTimeout(() => void commitRemoval(), UNDO_DELETE_MS) };
    setRemoved(ride);
  }

  function undoDelete(): void {
    const current = removal.current;
    if (current === null) return;
    clearTimeout(current.timer);
    removal.current = null;
    setRemoved(null);
  }

  // Leaving the page ends the undo window: the delete the rider confirmed happens.
  useEffect(() => () => {
    const current = removal.current;
    if (current === null) return;
    clearTimeout(current.timer);
    removal.current = null;
    void library.deleteRide(current.ride.rideId).catch(() => undefined);
  }, [library]);

  async function openRide(ride: RideSummary): Promise<void> {
    if (isDraftDirty() && pendingOpen !== ride.rideId) {
      setPendingOpen(ride.rideId);
      return;
    }
    setBusy(ride.rideId);
    try {
      if (onOpen !== undefined) {
        await onOpen(ride);
      } else {
        await library.openRide(ride.rideId);
        router.push("/");
      }
      setPendingOpen(null);
    } catch {
      setError("Could not open this ride.");
    } finally {
      setBusy(null);
    }
  }

  const libraryIsEmpty = status === "ready" && activeRides.length === 0;
  const segmentIsEmpty = status === "ready" && !libraryIsEmpty && segmentRides.length === 0;
  // A short segment needs no search box; a long one earns it.
  const showSearch = status === "ready" && !libraryIsEmpty && (segmentRides.length > 8 || search !== "");

  return (
    <main id="main" className="og-library og-rides">
      <AppBar current="/rides" />
      <header className="og-library__header og-rides__header">
        <div>
          <h1>My rides</h1>
          <p className="og-library__intro">Saved rides stay in this browser until you share them.</p>
        </div>
        <button
          type="button"
          className="og-secondary og-rides__import"
          onClick={() => importFileInput.current?.click()}
        >
          Import GPX
        </button>
        <input
          ref={importFileInput}
          className="sr-only"
          type="file"
          aria-label="Import GPX, KML, or KMZ"
          accept=".gpx,.kml,.kmz"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (picked !== undefined) setDroppedFile(picked);
          }}
        />
      </header>

      {/* An empty library is one line and one way out. Dropping a file on it
          still starts the import flow without competing with the button. */}
      {libraryIsEmpty ? (
        <section
          className="og-library__empty og-rides__empty"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files[0];
            if (dropped !== undefined) setDroppedFile(dropped);
          }}
        >
          <h2>No saved rides yet</h2>
          <Link className="og-primary" href="/">Plan a ride</Link>
        </section>
      ) : null}

      {status === "ready" && !libraryIsEmpty ? (
        <div className="og-rides__segments" role="group" aria-label="Ride type">
          <button
            type="button"
            className="og-rides__segment"
            aria-pressed={segment === "planned"}
            onClick={() => { segmentChosen.current = true; setSegment("planned"); setSearch(""); }}
          >
            Planned
          </button>
          <button
            type="button"
            className="og-rides__segment"
            aria-pressed={segment === "recorded"}
            onClick={() => { segmentChosen.current = true; setSegment("recorded"); setSearch(""); }}
          >
            Recorded
          </button>
        </div>
      ) : null}

      {showSearch ? (
        <div className="og-rides__search">
          <input
            type="search"
            aria-label="Search rides"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search rides"
          />
        </div>
      ) : null}

      {removed === null ? null : (
        <div className="og-library__undo" role="status">
          <span>Deleted “{removed.title}”.</span>
          <button type="button" className="og-secondary" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}
      {status === "loading" ? (
        <section className="og-library__state og-library__state--notice" role="status">
          <h2>Opening your library</h2>
          <p>Your saved rides will appear here in a moment.</p>
        </section>
      ) : null}
      {status === "error" ? (
        <section className="og-library__state og-library__state--notice" role="alert">
          <h2>We couldn’t open your rides.</h2>
          <p>{error}</p>
          <button type="button" className="og-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : null}

      {status === "ready" && !libraryIsEmpty && visibleRides.length === 0 ? (
        <section className="og-library__state og-rides__state" role="status">
          <h2>{segmentIsEmpty ? (segment === "recorded" ? "No recorded rides yet." : "No planned rides yet.") : "No rides match this search."}</h2>
          {segmentIsEmpty ? null : (
            <button type="button" className="og-primary og-library__cta" onClick={() => setSearch("")}>
              Clear search
            </button>
          )}
        </section>
      ) : null}

      {status === "ready" && visibleRides.length > 0 ? (
        <ul className="og-library__list og-rides__list" aria-label="Saved rides">
          {visibleRides.map((ride) => {
            const title = titles[ride.rideId] ?? ride.title;
            const emptyTitle = title.trim().length === 0;
            const isExpanded = expanded.has(ride.rideId);
            const isPendingDelete = pendingDelete === ride.rideId;
            const isPendingOpen = pendingOpen === ride.rideId;
            const isRenaming = renaming === ride.rideId;
            const isSharing = sharing === ride.rideId;
            const canShare = loadExportSource !== undefined &&
              (ride.exportCapabilities?.track === true || ride.exportCapabilities?.recordedRide === true);
            return (
              <li key={ride.rideId} className="og-library__row og-rides__row">
                {isRenaming ? (
                  <form
                    className="og-rides__rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename(ride);
                    }}
                  >
                    <label className="og-rides__rename-field">
                      <span>Name</span>
                      <input
                        aria-label={`Rename ${ride.title}`}
                        value={title}
                        autoFocus
                        onChange={(event) =>
                          setTitles((current) => ({ ...current, [ride.rideId]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename(ride);
                          }
                        }}
                      />
                    </label>
                    {emptyTitle ? <p className="og-library__reason">A title is required.</p> : null}
                    <div className="og-rides__rename-actions">
                      <button type="submit" className="og-primary" disabled={emptyTitle || busy === ride.rideId}>
                        Save
                      </button>
                      <button type="button" className="og-secondary" onClick={() => cancelRename(ride)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="og-rides__row-body">
                    <button
                      type="button"
                      className="og-rides__row-open"
                      aria-label={`Open ${title}`}
                      aria-describedby={`ride-meta-${ride.rideId}`}
                      disabled={busy === ride.rideId}
                      onClick={() => void openRide(ride)}
                    >
                      <span className="og-rides__thumb">
                        <RideThumbnail ride={ride} token={mapboxToken} />
                      </span>
                      <span className="og-rides__row-text">
                        <span className="og-rides__row-title">{title.trim().length === 0 ? "Untitled ride" : title}</span>
                        <span
                          id={`ride-meta-${ride.rideId}`}
                          className="og-rides__meta"
                          data-testid={ride.recordedTrack === undefined ? `ride-facts-${ride.rideId}` : "recorded-ride-summary"}
                        >
                          {rideMeta(ride)}
                        </span>
                      </span>
                    </button>
                    <RideRowMenu
                      title={title}
                      capabilities={ride.exportCapabilities ?? NO_EXPORT_CAPABILITIES}
                      canShare={canShare}
                      onRename={() => startRename(ride)}
                      onExport={(mode) => exportRide(ride, mode)}
                      onShare={() => {
                        setPendingOpen(null);
                        setPendingDelete(null);
                        setSharing(ride.rideId);
                      }}
                      onDelete={() => {
                        setPendingOpen(null);
                        setSharing(null);
                        setPendingDelete(ride.rideId);
                      }}
                    />
                  </div>
                )}

                {isPendingOpen ? (
                  <div className="og-rides__confirm" role="status">
                    <p>Your unsaved draft will remain separate.</p>
                    <div className="og-rides__confirm-actions">
                      <button type="button" className="og-primary" onClick={() => void openRide(ride)}>
                        Confirm open
                      </button>
                      <button type="button" className="og-secondary" onClick={() => setPendingOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {isPendingDelete ? (
                  <div className="og-rides__confirm" role="alert">
                    <p>Delete “{title}”?</p>
                    <div className="og-rides__confirm-actions">
                      <button
                        type="button"
                        className="og-secondary og-library__delete"
                        aria-label={`Confirm delete ${title}`}
                        disabled={busy === ride.rideId}
                        onClick={() => void deleteRide(ride)}
                      >
                        Delete ride
                      </button>
                      <button type="button" className="og-secondary" onClick={() => setPendingDelete(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {isRenaming ? null : (
                  <div className="og-rides__row-tools">
                    <button
                      type="button"
                      className="og-rides__details"
                      aria-label={`${isExpanded ? "Hide" : "View"} details for ${title}`}
                      aria-expanded={isExpanded}
                      onClick={() => toggleDetails(ride)}
                    >
                      {isExpanded ? "Hide details" : "Details"}
                    </button>
                  </div>
                )}

                {isExpanded ? (
                  <div className="og-library__details og-rides__details">
                    <p>{sourceText(ride)}</p>
                    <p>Saved {formatRideDate(ride.savedAt)}</p>
                    <p data-testid={`offline-pack-${ride.rideId}`}>
                      Offline pack: {ride.offlinePack === "present" ? "saved" : ride.offlinePack === "not-present" ? "not saved" : "unknown"}
                    </p>
                    {ride.recordedTrack === undefined || roadProgressReader === undefined || roadProgress[ride.rideId] === undefined
                      ? null
                      : <RecordedRoadProgress state={roadProgress[ride.rideId]!} />}
                    {(ride.importNotes ?? []).length === 0 ? null : (
                      <ul aria-label={`Import notes for ${ride.title}`}>
                        {(ride.importNotes ?? []).map((note) => <li key={note}>{note}</li>)}
                      </ul>
                    )}
                  </div>
                ) : null}

                {isSharing && loadExportSource !== undefined ? (
                  <div className="og-rides__share">
                    <div className="og-rides__share-head">
                      <h3>Share “{title}”</h3>
                      <button type="button" className="og-rides__details" onClick={() => setSharing(null)}>
                        Close
                      </button>
                    </div>
                    <SavedRideGroupShare
                      ride={ride}
                      loadSource={loadExportSource}
                      autoStart
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {status === "ready" && activeRides.length > 0 && mapboxToken !== undefined ? (
        <p className="og-explore__attribution">Map images © Mapbox © OpenStreetMap</p>
      ) : null}

      {importService !== undefined ? (
        <div className="og-library__imports">
          <ImportPanel
            service={importService}
            chrome="quiet"
            {...(droppedFile === null ? {} : { initialFile: droppedFile, onInitialFileHandled: () => setDroppedFile(null) })}
            onImported={() => load()}
            onOpenInPlanner={async (outcome: ImportOutcome) => {
              await library.openRide(outcome.namedRide.document.rideId);
              router.push("/");
            }}
          />
        </div>
      ) : null}

      {/* The older SwitchBack import is a quiet way out of the page, not a
          third card beside the two real ways in. */}
      {importService === undefined ? null : (
        <details className="og-library__legacy">
          <summary>Import from an older version</summary>
          <SwitchBackImportPanel service={importService} onImported={() => load()} />
        </details>
      )}
    </main>
  );
}
