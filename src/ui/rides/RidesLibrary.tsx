"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { AppBar } from "@/ui/nav/AppBar";
import { useRouter } from "next/navigation";

import {
  type LibraryServicePort,
  type RideListFilter,
  type RideSummary,
} from "@/application/library/library-service";
import { DRAFT_DIRTY_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import {
  buildPlannedRouteGpx,
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
import { ExportMenu } from "./ExportMenu";
import { libraryTypeLabel, type LibraryRideType } from "@/application/library/provenance";
import { formatDistance } from "@/application/planner/measurements";
import { RecordedTrackThumbnail } from "./RecordedTrackThumbnail";
import { staticPointsMapUrl, staticRouteMapUrl } from "@/application/map/static-map";
import type { RoadProgressReader } from "@/application/roads/explorable-roads";
import { RecordedRoadProgress, type RecordedRoadProgressState } from "./RecordedRoadProgress";
import { emitTelemetry } from "@/ui/telemetry/emit-telemetry";

const TYPE_FILTERS: readonly { readonly value: LibraryRideType | null; readonly label: string }[] = [
  { value: null, label: "All" },
  { value: "planned", label: "Planned" },
  { value: "imported", label: "Imported" },
  { value: "recorded", label: "Recorded" },
  { value: "catalog-derivative", label: "Catalog derivative" },
  { value: "shared-derivative", label: "Shared derivative" },
];

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

/** How long a deleted ride can be brought back before it is gone. */
const UNDO_DELETE_MS = 8000;

/**
 * Today's changes carry seconds ("Today, 10:15:32 AM"), so two rides saved in
 * the same minute still show which came last (RS-15); older ones show the date.
 */
function formatTimestamp(value: string, now = new Date()): string {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString()) {
    return `Today, ${new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** "1:05 h" / "42 min": a ride's length in time. */
function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
}

/** The facts the card knows, and nothing for the ones it doesn't. */
function rideFacts(ride: RideSummary): string | null {
  const facts = [
    ride.distanceMeters === null ? null : formatDistance(ride.distanceMeters),
    ride.durationSeconds === null ? null : formatDuration(ride.durationSeconds),
    ride.area,
  ].filter((fact): fact is string => fact !== null && fact !== "");
  return facts.length === 0 ? null : facts.join(" · ");
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

function formatRideTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
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
  const size = { token, width: 400, height: 170 };
  return ride.mapPreview.line.length >= 2
    ? staticRouteMapUrl(ride.mapPreview.line, size)
    : staticPointsMapUrl(ride.mapPreview.pins, size);
}

export function RidesLibrary({ service: library, onOpen, importService, mapboxToken, roadProgressReader }: RidesLibraryProps) {
  const router = useRouter();
  const [rides, setRides] = useState<readonly RideSummary[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<LibraryRideType | null>(null);
  const [sort, setSort] = useState<"updated-desc" | "updated-asc">("updated-desc");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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
  // Decided by the first load and then kept, so nothing jumps mid-import: a
  // rider with no rides yet starts by bringing some in; everyone else sees
  // their rides first (UX rework phase 5).
  const [importsFirst, setImportsFirst] = useState<boolean | null>(null);

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
    return () => {
      for (const request of roadProgressRequests.current.values()) request.controller.abort();
      roadProgressRequests.current.clear();
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
    if (mode === "planned-route") {
      if (source.plannedRoute === null) throw new Error("This imported track has disconnected segments and cannot be exported as one route.");
      bytes = new TextEncoder().encode(buildPlannedRouteGpx({ ...source.plannedRoute, title: source.title }));
    } else if (mode === "track") {
      const tracks: ExportTrack[] = source.tracks.map((track) => ({
        name: track.name,
        segments: track.segments.map((segment) => {
          const coordinates = source.trackGeometry[segment.geometryRef];
          if (coordinates === undefined) throw new Error("An imported track segment is unavailable.");
          return { coordinates, timestamps: segment.timestamps, elevation: segment.elevation };
        }),
      }));
      bytes = new TextEncoder().encode(buildTrackGpx({ title: source.title, tracks, waypoints: source.waypoints }));
    } else if (mode === "original") {
      if (source.originalBytes === null) throw new Error("The original file is not available.");
      bytes = originalFileBytes(source.originalBytes);
    } else {
      if (source.recordedTrack === null) throw new Error("The recorded track is not available.");
      bytes = new TextEncoder().encode(buildTrackGpx({
        title: source.title,
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

  const filter: RideListFilter = useMemo(
    () => ({ text: search, ...(type === null ? {} : { type }) }),
    [search, type],
  );

  const load = async (): Promise<void> => {
    setStatus("loading");
    setError(null);
    try {
      const next = await library.listRides(filter);
      setRides(next);
      setImportsFirst((current) => current ?? next.length === 0);
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
    // `filter` is the intentionally complete query identity for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, filter]);

  const sortedRides = useMemo(
    () =>
      rides.filter((ride) => ride.rideId !== removed?.rideId).sort((a, b) =>
        sort === "updated-desc"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.updatedAt.localeCompare(b.updatedAt),
      ),
    [rides, sort, removed],
  );

  async function rename(ride: RideSummary): Promise<void> {
    const title = titles[ride.rideId]?.trim() ?? "";
    if (title.length === 0) return;
    setBusy(ride.rideId);
    try {
      await library.renameRide(ride.rideId, title);
      await load();
    } catch {
      setError("Could not rename this ride.");
    } finally {
      setBusy(null);
    }
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

  function clearFilters(): void {
    setSearch("");
    setType(null);
  }

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

  const importPanels = importService !== undefined ? (
    <div className="og-library__imports">
      <ImportPanel
        service={importService}
        onImported={() => load()}
        onOpenInPlanner={async (outcome: ImportOutcome) => {
          await library.openRide(outcome.namedRide.document.rideId);
          router.push("/");
        }}
      />
      <details>
        <summary>Import older saved rides (advanced)</summary>
        <SwitchBackImportPanel service={importService} onImported={() => load()} />
      </details>
    </div>
  ) : null;

  return (
    <main id="main" className="og-library">
      <AppBar current="/rides" />
      <header className="og-library__header">
        <div>
          <h1>My rides</h1>
          <p className="og-library__intro">
            Keep your rides here, upload your own GPX files, and choose which rides to share with everyone on Explore. Saved rides stay in this browser until you share them.
          </p>
        </div>
      </header>

      {/* The empty library leads with its invitation, before the import panels,
          so the first thing a new rider meets is the next step (VISUAL-OVERHAUL). */}
      {status === "ready" && sortedRides.length === 0 && !search && type === null ? (
        <section className="og-library__state og-empty-state og-empty-state--hero">
          <div className="og-empty-state__body">
            <h2>Your library is ready for its first ride.</h2>
            <p>
              Plan a ride, import a route, or use a catalog ride to create a named copy here.
            </p>
            <div className="og-empty-state__actions">
              <Link className="og-primary og-library__cta" href="/">Plan a ride</Link>
              <Link className="og-secondary" href="/explore">Browse Explore</Link>
            </div>
          </div>
        </section>
      ) : null}

      {importsFirst === false ? null : importPanels}

      <section className="og-library__controls" aria-label="Ride library filters">
        <label className="og-library__search">
          <span>Search</span>
          <input
            type="search"
            aria-label="Search rides"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search titles"
          />
        </label>
        <div className="og-library__chips" aria-label="Ride type">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="og-chip"
              aria-pressed={type === item.value}
              onClick={() => setType(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="og-library__sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="updated-desc">Updated, newest first</option>
            <option value="updated-asc">Updated, oldest first</option>
          </select>
        </label>
      </section>

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
          <span className="og-eyebrow">My rides</span>
          <h2>Opening your library</h2>
          <p>Your saved rides will appear here in a moment.</p>
        </section>
      ) : null}
      {status === "error" ? (
        <section className="og-library__state og-library__state--notice" role="alert">
          <span className="og-eyebrow">Library unavailable</span>
          <h2>We couldn’t open your rides.</h2>
          <p>{error}</p>
          <button type="button" className="og-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : null}
      {status === "ready" && sortedRides.length === 0 ? (
        search || type !== null ? (
          <section className="og-library__state" role="status">
            <h2>No rides match these filters.</h2>
            <p>Try another title, or show every ride again.</p>
            <button type="button" className="og-primary og-library__cta" onClick={clearFilters}>
              Clear filters
            </button>
          </section>
        ) : null
      ) : null}

      {status === "ready" && sortedRides.length > 0 ? (
        <ul className="og-library__list" aria-label="Saved rides">
          {sortedRides.map((ride) => {
            const title = titles[ride.rideId] ?? ride.title;
            const emptyTitle = title.trim().length === 0;
            const isExpanded = expanded.has(ride.rideId);
            const isPendingDelete = pendingDelete === ride.rideId;
            const isPendingOpen = pendingOpen === ride.rideId;
            return (
              <li key={ride.rideId} className="og-library__row">
                <div className="og-library__row-main">
                  <div className="og-library__title-line">
                    <input
                      aria-label={`Rename ${ride.title}`}
                      value={title}
                      onChange={(event) =>
                        setTitles((current) => ({ ...current, [ride.rideId]: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void rename(ride);
                      }}
                    />
                    <span className="og-library__badge">{libraryTypeLabel(ride.type)}</span>
                  </div>
                  {emptyTitle ? (
                    <p className="og-library__reason">A title is required.</p>
                  ) : null}
                  {rideMapUrl(ride, mapboxToken) !== null ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a remote static map; next/image would proxy it.
                    <img
                      className="og-library__map"
                      src={rideMapUrl(ride, mapboxToken) ?? undefined}
                      alt={`${ride.title} on a map`}
                      loading="lazy"
                      decoding="async"
                      width={400}
                      height={170}
                    />
                  ) : ride.recordedTrack === undefined ? null : (
                    <RecordedTrackThumbnail
                      coordinates={ride.recordedTrack.previewGeometry}
                      title={ride.title}
                    />
                  )}
                  <p className="og-library__meta">
                    Updated {formatTimestamp(ride.updatedAt)} · Saved {formatTimestamp(ride.savedAt)}
                  </p>
                  {ride.recordedTrack === undefined ? (
                    rideFacts(ride) === null ? null : (
                      <p className="og-library__meta og-library__facts" data-testid={`ride-facts-${ride.rideId}`}>
                        {rideFacts(ride)}
                      </p>
                    )
                  ) : (
                    <p className="og-library__meta" data-testid="recorded-ride-summary">
                      Distance: {formatDistance(ride.recordedTrack.summary.distanceMeters)} · {formatRideTime(ride.recordedTrack.summary.movingSeconds)} moving · {formatRideTime(ride.recordedTrack.summary.elapsedSeconds)} total
                    </p>
                  )}
                  <p className="og-library__meta" data-testid={`offline-pack-${ride.rideId}`}>
                    Offline pack: {ride.offlinePack === "present" ? "saved" : ride.offlinePack === "not-present" ? "not saved" : "unknown"}
                  </p>
                  {isExpanded ? (
                    <div className="og-library__details">
                      <p>{sourceText(ride)}</p>
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
                </div>
                <div className="og-library__actions">
                  {isPendingOpen ? (
                    <>
                      <span className="og-library__reason">Your unsaved draft will remain separate.</span>
                      <button type="button" className="og-primary" onClick={() => void openRide(ride)}>
                        Confirm open
                      </button>
                      <button type="button" className="og-secondary" onClick={() => setPendingOpen(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="og-primary"
                      aria-label={`Open ${ride.title}`}
                      disabled={busy === ride.rideId}
                      onClick={() => void openRide(ride)}
                    >
                      Open
                    </button>
                  )}
                  {library.loadExportSource !== undefined && (ride.exportCapabilities?.track || ride.exportCapabilities?.recordedRide) ? (
                    <SavedRideGroupShare ride={ride} loadSource={library.loadExportSource.bind(library)} />
                  ) : null}
                  <ExportMenu
                    title={ride.title}
                    capabilities={ride.exportCapabilities ?? { plannedRoute: false, track: false, original: false, recordedRide: false }}
                    onExport={(mode) => exportRide(ride, mode)}
                  />
                  <button
                    type="button"
                    className="og-secondary"
                    aria-label={`View details for ${ride.title}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggleDetails(ride)}
                  >
                    {isExpanded ? "Hide details" : "View details"}
                  </button>
                  {isPendingDelete ? (
                    <>
                      <button
                        type="button"
                        className="og-secondary"
                        aria-label={`Confirm delete ${ride.title}`}
                        disabled={busy === ride.rideId}
                        onClick={() => void deleteRide(ride)}
                      >
                        Confirm delete
                      </button>
                      <button type="button" className="og-secondary" onClick={() => setPendingDelete(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="og-secondary og-library__delete"
                      aria-label={`Delete ${ride.title}`}
                      onClick={() => setPendingDelete(ride.rideId)}
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    className="og-secondary"
                    aria-label={`Rename ${ride.title}`}
                    disabled={emptyTitle || busy === ride.rideId}
                    title={emptyTitle ? "A title is required." : "Rename ride"}
                      onClick={() => void rename(ride)}
                  >
                    Rename
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {status === "ready" && sortedRides.length > 0 && mapboxToken !== undefined ? (
        <p className="og-explore__attribution">Map images © Mapbox © OpenStreetMap</p>
      ) : null}
      {importsFirst === false ? importPanels : null}
    </main>
  );
}
