"use client";

import { ExploreMap, type ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { staticRouteMapUrl } from "@/application/map/static-map";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";

import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

import type { CatalogEntry, CatalogVariantSummary } from "@/application/explore/catalog";
import { formatDistance as formatMiles } from "@/application/planner/measurements";
import {
  buildPlannedRouteGpx,
  downloadExport,
  exportFilename,
} from "@/application/export/gpx-export";
import type { CatalogRoadDetail } from "@/application/explore/catalog";
import {
  routeRoadCoverageLabel,
  routeSurfaceLabel,
} from "@/application/roads/route-road-summary";
import { aggregateRoadSurface } from "@/application/roads/surface-evidence";
import { aggregateSurface, type SurfaceAssessment } from "@/domain/roads/surface";
import {
  prepareRoute,
  type RoutePreparation,
  type RoutePreparationContext,
} from "@/application/preparation/prepare-route";
import { thinLine, TRAFFIC_CORRIDOR_POINTS } from "@/application/preparation/planner-context";
import { enrichRoutePreparationForLongTrip } from "@/application/explore/long-trip";
import type { LongTripBike } from "@/application/long-trip";
import type { PreparationProviderRegistry, RegisteredPreparationProviders } from "@/application/preparation/providers";
import { RoutePreparationSection } from "@/ui/preparation/RoutePreparationSection";
import { readBrowserOfflineRuntime, type OfflineRuntimeSnapshot } from "@/application/offline/offline-runtime";
import { RouteCommunity } from "@/ui/explore/RouteCommunity";
import { RouteStory } from "@/ui/explore/RouteStory";

export interface RouteDetailProps {
  readonly entry: CatalogEntry;
  readonly variants?: readonly CatalogVariantSummary[];
  readonly onUse: (entry: CatalogEntry) => Promise<void> | void;
  readonly onAddToLibrary?: (entry: CatalogEntry) => Promise<void> | void;
  /** Injected for later provider waves; absent means the honest zero-provider state. */
  readonly preparation?: RoutePreparation;
  /** The rider's active garage bike; fuel advice uses it (EX-02, RS-01). */
  readonly activeBike?: LongTripBike | null;
  readonly preparationProviders?: RegisteredPreparationProviders;
  /** The live map the route is drawn on (towns, roads, terrain); absent falls back to an image. */
  readonly map?: ExploreMapConfig;
  /** A public Mapbox token, for the static map image when there is no live map. */
  readonly mapboxToken?: string;
}

function subscribeToDeviceTimeZone(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function serverTimeZone(): string {
  return "UTC";
}

function UnknownMetric({ label }: { readonly label: string }) {
  return <span aria-label={`${label} not computed`}>—</span>;
}

function provenanceSummary(value: string): string {
  const separator = value.indexOf(" · ");
  return separator < 0 ? value : `Source: ${value.slice(0, separator)}`;
}

function formatDistance(distanceKm: number | null): string | ReactNode {
  return distanceKm === null ? <UnknownMetric label="Distance" /> : formatMiles(distanceKm * 1000);
}

function surfaceAssessmentForRoad(road: CatalogRoadDetail): SurfaceAssessment {
  return road.evidenceSummary.surfaceAssessment
    ?? aggregateRoadSurface(road.evidence);
}

function surfaceChip(assessment: SurfaceAssessment) {
  const value = assessment.value === "unknown" ? "" : `: ${assessment.value}`;
  return (
    <span
      className="og-road-surface"
      data-surface-band={assessment.band}
      aria-label={`Surface ${assessment.band}${value}`}
    >
      {`Surface ${assessment.band}`}{value}
    </span>
  );
}

function formatAge(ageDays: number | null, stale: boolean): string {
  if (ageDays === null) return stale ? "Age unknown · stale" : "Age unknown";
  if (ageDays === 0) return stale ? "Today · stale" : "Today";
  return `${ageDays} day${ageDays === 1 ? "" : "s"} ago${stale ? " · stale" : ""}`;
}

function surfaceCopy(assessment: SurfaceAssessment): string {
  return `Surface ${assessment.band}${assessment.value === "unknown" ? "" : ` · ${assessment.value}`}`;
}

function RoadDetailSheet({
  road,
  onClose,
}: {
  readonly road: CatalogRoadDetail;
  readonly onClose: () => void;
}) {
  const assessment = surfaceAssessmentForRoad(road);
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <section
      ref={dialogRef}
      className="og-road-detail-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="road-detail-title"
    >
      <div className="og-road-detail-sheet__head">
        <div>
          <p className="og-eyebrow">Road detail</p>
          <h2 id="road-detail-title">{road.entity.name}</h2>
        </div>
        <button type="button" className="og-secondary" onClick={onClose}>Close</button>
      </div>
      {road.aliases.length > 0 ? (
        <p className="og-road-detail-sheet__aliases">
          Also known as: {road.aliases.join(", ")}
        </p>
      ) : null}
      <dl className="og-road-detail-sheet__facts">
        <div><dt>Class</dt><dd>{road.entity.class}</dd></div>
        <div><dt>First seen</dt><dd>{road.entity.firstSeen}</dd></div>
        <div><dt>Last seen</dt><dd>{road.entity.lastSeen}</dd></div>
        <div>
          <dt>Rides through here</dt>
          <dd>{road.ridesThroughCount} {road.ridesThroughCount === 1 ? "ride" : "rides"} through here</dd>
        </div>
      </dl>
      {road.entity.lineage.length > 0 ? (
        <section aria-labelledby="road-lineage-title">
          <h3 id="road-lineage-title">Lineage history</h3>
          <ul className="og-road-detail-sheet__lineage">
            {road.entity.lineage.map((entry, index) => (
              <li key={`${entry.parentId ?? "unknown"}-${entry.reason}-${String(index)}`}>
                {entry.reason}{entry.parentId === undefined ? "" : ` from ${entry.parentId}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="road-evidence-title">
        <h3 id="road-evidence-title">Evidence</h3>
        <p className="og-road-detail-sheet__surface" data-surface-band={assessment.band}>
          {`Surface ${assessment.band}`}{assessment.value === "unknown" ? "" : ` · ${assessment.value}`}
        </p>
        {assessment.conflicts.length > 0 || road.evidenceSummary.conflict ? (
          <p className="og-road-detail-sheet__conflict" role="status">
            Surface reports conflict. See each source below.
          </p>
        ) : null}
        {assessment.conflicts.length > 0 ? (
          <ul className="og-road-detail-sheet__conflicts" aria-label="Surface conflicts">
            {assessment.conflicts.map((conflict) => (
              <li key={conflict.evidenceIds.join("|")}>
                {conflict.values.join(" vs ")} ({conflict.evidenceIds.join(", ")})
              </li>
            ))}
          </ul>
        ) : null}
        {assessment.provenance.length === 0 ? (
          <p>— <span className="sr-only">No evidence reported</span></p>
        ) : (
          <table className="og-road-detail-sheet__evidence">
            <caption className="sr-only">Evidence reports for {road.entity.name}</caption>
            <thead>
              <tr><th scope="col">Source</th><th scope="col">Age</th><th scope="col">Value</th></tr>
            </thead>
            <tbody>
              {assessment.provenance.map((record) => (
                <tr key={record.evidenceId}>
                  <td>{record.sourceLabel}</td>
                  <td>{formatAge(record.ageDays, record.stale)}</td>
                  <td>{record.value === "unknown" ? <span aria-label="Surface unknown">Surface unknown</span> : record.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}

/** A mixed backroad-and-gravel pace: what a catalog ride's time is estimated at. */
const ESTIMATE_MPH = 28;

function formatMinutes(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The catalog carries no ride time, so a blank told the rider nothing (EX-08).
 * Estimate it from the distance at a stated pace, rounded to the quarter hour.
 */
function estimatedTimeFromDistance(distanceKm: number | null | undefined): ReactNode {
  if (distanceKm === undefined || distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return <UnknownMetric label="Estimated time" />;
  }
  const minutes = Math.max(15, Math.round(((distanceKm / 1.609344) / ESTIMATE_MPH) * 60 / 15) * 15);
  return (
    <>
      {`~${formatMinutes(minutes)}`}
      <span className="og-route-detail__basis">{` at ${ESTIMATE_MPH} mph`}</span>
    </>
  );
}

/**
 * Share a route (launch kit): the phone's own share sheet where there is one,
 * otherwise the link copied. The page itself is the shared thing.
 */
function ShareRouteButton({ name }: { readonly name: string }) {
  const [note, setNote] = useState<string | null>(null);
  const share = async (): Promise<void> => {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `${name} · OpenGravel`, text: `${name} on OpenGravel`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNote("Couldn't share. Copy the address from the browser bar.");
    }
    window.setTimeout(() => setNote(null), 3_000);
  };
  return (
    <>
      <button type="button" className="og-secondary og-route-detail__share" data-testid="route-share" aria-label={`Share ${name}`} onClick={() => void share()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        <span className="og-route-detail__share-label">Share</span>
      </button>
      {note === null ? null : <p className="og-route-detail__share-note" role="status">{note}</p>}
    </>
  );
}

export function RouteDetail({
  entry,
  variants = [],
  onUse,
  onAddToLibrary,
  preparation: providedPreparation,
  preparationProviders,
  activeBike,
  map,
  mapboxToken,
}: RouteDetailProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<CatalogRoadDetail | null>(null);
  const [, setWeatherRefresh] = useState(0);
  const [, setTrafficRefresh] = useState(0);
  const [offlineSnapshot, setOfflineSnapshot] = useState<OfflineRuntimeSnapshot | null>(null);
  const riderTimeZone = useSyncExternalStore(
    subscribeToDeviceTimeZone,
    deviceTimeZone,
    serverTimeZone,
  );
  const staticMapUrl = mapboxToken === undefined
    ? null
    : staticRouteMapUrl(entry.geometry.length >= 2 ? entry.geometry : entry.previewGeometry ?? [], { token: mapboxToken, width: 640, height: 400 });
  const canExport = entry.geometry.length >= 2;
  const registeredProviders: RegisteredPreparationProviders = preparationProviders ?? {};
  const weatherCandidate = Array.isArray(registeredProviders)
    ? registeredProviders.find((provider) => provider.kind === "weather")
    : (registeredProviders as PreparationProviderRegistry).weather;
  const weatherProvider = weatherCandidate?.kind === "weather" ? weatherCandidate : undefined;
  const trafficCandidate = Array.isArray(registeredProviders)
    ? registeredProviders.find((provider) => provider.kind === "traffic")
    : (registeredProviders as PreparationProviderRegistry).traffic;
  const trafficProvider = trafficCandidate?.kind === "traffic" ? trafficCandidate : undefined;
  const plannedDeparture = entry.sourceDocument?.intent.departure.kind === "future"
    ? entry.sourceDocument.intent.departure.at
    : null;
  const preparationContext = useMemo<RoutePreparationContext>(() => {
    const firstPoint = entry.geometry[0];
    const durationMinutes = entry.estimatedTimeMinutes;
    const tripWindow = plannedDeparture !== null && durationMinutes !== undefined && Number.isFinite(durationMinutes)
      ? {
          start: plannedDeparture,
          end: new Date(Date.parse(plannedDeparture) + durationMinutes * 60_000).toISOString(),
        }
      : null;
    return {
      distanceKm: entry.distanceKm,
      rideDurationMinutes: durationMinutes,
      ...(plannedDeparture === null ? {} : { departure: plannedDeparture }),
      ...(tripWindow === null ? {} : { tripWindow }),
      routeTouchesMappedCorridor: true,
      trafficCorridor: thinLine(entry.geometry, TRAFFIC_CORRIDOR_POINTS),
      weatherLocation: firstPoint === undefined ? null : { lat: firstPoint.lat, lon: firstPoint.lon },
      riderTimeZone,
    };
  }, [entry.distanceKm, entry.estimatedTimeMinutes, entry.geometry, plannedDeparture, riderTimeZone]);

  const routeSurfaceAssessment = entry.roadSummary?.surfaceAssessment
    ?? (entry.stats?.surfaceHint === undefined
      ? aggregateSurface([])
      : aggregateSurface([{
          id: `legacy-route:${entry.id}`,
          value: entry.stats.surfaceHint,
          source: "legacy-route-record",
          sourceLabel: entry.provenance,
          confidence: null,
          weight: 0.2,
        }]));

  useEffect(() => {
    if (providedPreparation !== undefined || weatherProvider === undefined) return;
    const refresh = weatherProvider.refresh;
    if (typeof refresh !== "function") return;
    let active = true;
    void refresh(preparationContext).then(() => {
      if (active) setWeatherRefresh((value) => value + 1);
    });
    return () => { active = false; };
  }, [preparationContext, providedPreparation, riderTimeZone, weatherProvider]);

  useEffect(() => {
    if (providedPreparation !== undefined || trafficProvider?.refresh === undefined) return;
    let active = true;
    void trafficProvider.refresh(preparationContext).then(() => {
      if (active) setTrafficRefresh((value) => value + 1);
    });
    return () => { active = false; };
  }, [preparationContext, providedPreparation, trafficProvider]);

  useEffect(() => {
    let active = true;
    void readBrowserOfflineRuntime({
      route: {
        rideId: entry.id,
        routeRevision: 0,
        geometry: entry.geometry,
      },
    }).then((snapshot) => {
      if (active) setOfflineSnapshot(snapshot);
    }).catch(() => {
      // An unavailable observation leaves the disclosure absent; it never becomes
      // an invented ready state.
    });
    return () => { active = false; };
  }, [entry.id, entry.geometry]);

  const basePreparation = providedPreparation ?? prepareRoute({
    ...preparationContext,
    providers: registeredProviders,
    ...(entry.stats?.surfaceHint === undefined
      ? {}
      : {
          surface: {
            state: "ready" as const,
            reason: "Surface label comes from the route record.",
            provenance: entry.provenance,
            data: { display: surfaceCopy(routeSurfaceAssessment) },
          },
        }),
  });
  const preparation = enrichRoutePreparationForLongTrip(entry, basePreparation, activeBike);
  async function runAction(action: string, callback: () => Promise<void> | void): Promise<void> {
    setBusy(action);
    setStatus(null);
    try {
      await callback();
      if (action === "use") setStatus("Opening a private copy in the planner.");
      if (action === "library") setStatus("Added a copy to your library.");
    } catch {
      setStatus("That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  const noMatchedRoads = entry.roadDetails === undefined || entry.roadDetails.length === 0;

  function exportGpx(): void {
    const xml = buildPlannedRouteGpx({ title: entry.name, geometry: entry.geometry });
    downloadExport(new TextEncoder().encode(xml), exportFilename(entry.name, "planned-route"));
  }

  return (
    <main id="main" className="og-route-detail">
      <header className="og-route-detail__header">
        <Link className="og-secondary" href="/explore">Back to Explore</Link>
        <div className="og-route-detail__title">
          <p className="og-eyebrow">{entry.source === "catalog" ? "Catalog route" : entry.source === "import" ? "Imported route" : "Your ride"}</p>
          <h1>{entry.name}</h1>
          {/* Keep the route's source concise, with source mechanics behind a disclosure (09 §6 step 8). */}
          <p className="og-route-detail__provenance">{provenanceSummary(entry.provenance)}</p>
          {entry.provenanceDetail === undefined && !entry.provenance.includes(" · ") ? null : (
            <details className="og-route-detail__provenance-detail">
              <summary>Where this route came from</summary>
              {entry.provenance.includes(" · ") ? <p>Source project and file: {entry.provenance}</p> : null}
              {entry.provenanceDetail === undefined ? null : <p>{entry.provenanceDetail}</p>}
            </details>
          )}
        </div>
      </header>

      {/* The route where it is leads the page (VISUAL-OVERHAUL): a detail page
          opens on its live map, then the numbers, then the commitment. */}
      <div className="og-route-detail__body">
        <div className="og-route-detail__visual">
      <section className="og-route-detail__map" aria-label="Map preview">
        {/* The route where it is: a live map to pan, else a map image. */}
        {map !== undefined ? (
          <ExploreMap {...map} entries={[entry]} highlightedId={entry.id} onOpen={() => undefined} />
        ) : staticMapUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a remote static map; next/image would proxy it.
          <img className="og-route-detail__map-image" src={staticMapUrl} alt={`${entry.name} on a map`} width={640} height={400} />
        ) : (
          <div className="og-map-preview-unavailable" role="img" aria-label={`${entry.name} map preview`}>
            <span className="og-map-preview-unavailable__glyph" aria-hidden="true">⌖</span>
            <span>Map preview unavailable</span>
          </div>
        )}
      </section>

      <section className="og-route-detail__stats" aria-label="Route stats">
        <div><dt>Distance</dt><dd>{formatDistance(entry.distanceKm)}</dd></div>
        <div><dt>Est. time</dt><dd>{entry.estimatedTimeMinutes === undefined ? estimatedTimeFromDistance(entry.distanceKm) : formatMinutes(entry.estimatedTimeMinutes)}</dd></div>
        {/* EX-07: the catalog's summary is the route service's estimate; say so where it is shown. */}
        <div><dt>{entry.surfaceSummary === undefined ? "Surface" : "Est. surface"}</dt><dd>{entry.surfaceSummary ?? surfaceCopy(routeSurfaceAssessment)}</dd></div>
        <div><dt>Curvature</dt><dd>{entry.curvatureSummary ?? <UnknownMetric label="Curvature" />}</dd></div>
      </section>
        </div>
        <div className="og-route-detail__content">

      {/* EX-03: the main action sits with the summary, not 3,000 px below it;
          on a phone it stays pinned above the tab bar. */}
      <section className="og-route-detail__actions" aria-label="Route actions">
        <button type="button" className="og-primary" disabled={busy !== null} onClick={() => void runAction("use", () => onUse(entry))}>Plan this ride</button>
        {entry.source === "personal" && onAddToLibrary !== undefined ? <button type="button" className="og-secondary" disabled={busy !== null} onClick={() => void runAction("library", () => onAddToLibrary(entry))}>Add to library</button> : null}
        {canExport ? <button type="button" className="og-secondary" disabled={busy !== null} onClick={exportGpx}>Export GPX</button> : null}
        <ShareRouteButton name={entry.name} />
      </section>

      {entry.story === undefined ? null : <RouteStory story={entry.story} routeName={entry.name} />}

      {variants.length > 0 ? (
        <section className="og-route-detail__variants" aria-label="Catalog variants and tracks">
          <h2>Variants and tracks</h2>
          <p>Repeated exports are grouped together. Separate tracks remain available.</p>
          <ul>
            {variants.map((variant) => (
              <li key={variant.id}>
                <Link href={`/explore/${encodeURIComponent(variant.id)}`}>
                  <strong>{variant.label ? `${variant.label} · ` : ""}{variant.name}</strong>
                  <span>{formatDistance(variant.distanceKm)} · {variant.copyCount} {variant.copyCount === 1 ? "export" : "exports"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RoutePreparationSection
        preparation={preparation}
        offline={offlineSnapshot === null ? undefined : {
          matrix: offlineSnapshot.matrix,
          readiness: offlineSnapshot.readiness,
          packPresence: "not-present",
        }}
      />

      {entry.stats?.elevationProfile !== undefined ? (
        <section className="og-route-detail__elevation" aria-label="Elevation profile">
          <h2>Elevation</h2>
          <p>{entry.stats.elevationProfile.length} measured points</p>
        </section>
      ) : null}

      <section className="og-route-detail__roads" aria-labelledby="roads-on-this-ride-title">
          <div className="og-route-detail__roads-head">
            <div>
              <h2 id="roads-on-this-ride-title">Roads on this ride</h2>
              {entry.roadSummary === undefined ? (
                <p className="og-route-detail__coverage" aria-label="Road coverage not computed">—</p>
              ) : (
                <p className="og-route-detail__coverage">{routeRoadCoverageLabel(entry.roadSummary)}</p>
              )}
              {noMatchedRoads ? null : (
                <p className="og-route-detail__surface-summary">{routeSurfaceLabel(entry.roadSummary ?? {
                  roads: [],
                  totalKm: 0,
                  matchedKm: 0,
                  unmatchedKm: 0,
                  coveragePercent: 0,
                  unverifiedRoadCount: 0,
                })}</p>
              )}
            </div>
          </div>
          {noMatchedRoads ? (
            // EX-07: "unknown" here must not read as retracting the estimate above.
            <p className="og-route-detail__coverage" data-testid="roads-none-matched">
              No roads on this ride are matched to our road data yet, so there is no road-by-road surface.
              {entry.surfaceSummary === undefined ? "" : " The surface above is the route service's estimate."}
            </p>
          ) : (
            <ul className="og-route-detail__roads-list" aria-label="Roads on this ride">
              {entry.roadDetails.map((road) => (
                <li key={road.entity.id} className="og-route-detail__road-row">
                  <button
                    type="button"
                    className="og-route-detail__road-open"
                    onClick={() => setSelectedRoad(road)}
                    aria-label={`Open ${road.entity.name} road details`}
                  >
                    <span>
                      <strong>{road.entity.name}</strong>
                      <span className="og-route-detail__road-meta">
                        {formatMiles(road.summary.distanceKm * 1000)} · {road.summary.percentage.toFixed(0)}% of route
                      </span>
                    </span>
                    {surfaceChip(road.summary.surfaceAssessment ?? surfaceAssessmentForRoad(road))}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      {entry.source === "catalog" ? (
        <p className="og-route-detail__planning-note">
          Planning follows this line through a few checkpoints, so the road route may differ. GPX export keeps the full line.
        </p>
      ) : null}
      {entry.source === "catalog" ? <RouteCommunity routeId={entry.id} /> : null}
      <p className="og-route-detail__summary">{entry.summary}</p>
      <p className="og-route-detail__region">{entry.region}</p>
      {status !== null ? <p role="status">{status}</p> : null}
        </div>
      </div>
      {selectedRoad !== null ? <RoadDetailSheet road={selectedRoad} onClose={() => setSelectedRoad(null)} /> : null}
    </main>
  );
}
