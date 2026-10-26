"use client";

import { ExploreMap, type ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { RouteLinePreview } from "@/ui/explore/RouteLinePreview";
import { peekListPosition } from "@/ui/explore/list-position";
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
  routeSurfaceLabel,
  type RouteRoadSummary,
} from "@/application/roads/route-road-summary";
import { aggregateRoadSurface } from "@/application/roads/surface-evidence";
import { aggregateSurface, type SurfaceAssessment } from "@/domain/roads/surface";
import { elevationSummaryOf } from "@/application/explore/elevation-summary";
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
import { useRiderOrigin } from "@/ui/hooks/use-rider-origin";
import { distanceToStartKm } from "@/application/explore/query";
import { startDistanceLabel } from "@/ui/explore/rider-distance";
import { RouteCommunity } from "@/ui/explore/RouteCommunity";
import { RemoveRoute, ShareWithEveryone } from "@/ui/explore/RouteCommunityActions";
import { RouteStory } from "@/ui/explore/RouteStory";
import { routeFacts } from "@/ui/explore/route-facts";
import { surfaceReportAge } from "@/ui/explore/surface-report-copy";

import "./explore-rides.css";

export interface RouteDetailProps {
  readonly entry: CatalogEntry;
  readonly variants?: readonly CatalogVariantSummary[];
  readonly onUse: (entry: CatalogEntry) => Promise<void> | void;
  /** Keep this ride in the rider's own library without leaving the page. */
  readonly onSave?: (entry: CatalogEntry) => Promise<void> | void;
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
  return <span aria-label={`${label} unknown`}>—</span>;
}

const FEET_PER_METER = 3.28084;

/** `3,200 ft`: the same spelling the planner's elevation head uses. */
function feet(meters: number): string {
  return `${Math.round(meters * FEET_PER_METER).toLocaleString("en-US")} ft`;
}

/**
 * The source's own name: what it calls itself, without the file path it also
 * carries. The path and the rest of the paperwork stay in the disclosure.
 */
function provenanceSourceName(value: string): string {
  const separator = value.indexOf(" · ");
  return separator < 0 ? value : value.slice(0, separator);
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

/**
 * The coverage line above the road list, in rider words: how much of the ride
 * runs on roads this app has a record for, and how many of those have no
 * surface report yet. "7.7 mi matched · 0 surface unknown" counted absence.
 */
function roadCoverageCopy(summary: RouteRoadSummary): string {
  const roadNoun = summary.roads.length === 1 ? "road" : "roads";
  const parts = [`${formatMiles(summary.matchedKm * 1000)} on ${summary.roads.length} known ${roadNoun}`];
  if (summary.unverifiedRoadCount > 0) {
    parts.push(`${summary.unverifiedRoadCount} with no surface report yet`);
  }
  return parts.join(" · ");
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
  // One reading of the clock per open sheet, so every report's age is said
  // from the same moment.
  const [now] = useState(() => Date.now());
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
      <p className="og-road-detail-sheet__surface" data-surface-band={assessment.band}>
        {surfaceCopy(assessment)}
      </p>
      <dl className="og-road-detail-sheet__facts">
        <div>
          <dt>On this ride</dt>
          <dd>{formatMiles(road.summary.distanceKm * 1000)} · {Math.round(road.summary.percentage)}%</dd>
        </div>
        <div>
          <dt>Ridden by</dt>
          <dd>{road.ridesThroughCount} {road.ridesThroughCount === 1 ? "ride" : "rides"}</dd>
        </div>
      </dl>
      <section aria-labelledby="road-surface-reports-title">
        <h3 id="road-surface-reports-title">Surface reports</h3>
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
          <p>— <span className="sr-only">No surface reports</span></p>
        ) : (
          <table className="og-road-detail-sheet__evidence">
            <caption className="sr-only">Surface reports for {road.entity.name}</caption>
            <thead>
              <tr><th scope="col">Source</th><th scope="col">Age</th><th scope="col">Surface</th></tr>
            </thead>
            <tbody>
              {assessment.provenance.map((record) => (
                <tr key={record.evidenceId}>
                  <td>{record.sourceLabel}</td>
                  <td>
                    {surfaceReportAge(record.observedAt, now)}
                    {record.stale ? " · out of date" : ""}
                  </td>
                  <td>{record.value === "unknown" ? <span aria-label="Surface unknown">Surface unknown</span> : record.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {/* Where the road's identity came from, in one plain line: a rider who
          opens this sheet wants the road, not its reconciliation log. */}
      {road.entity.lineage.length === 0 ? null : (
        <details className="og-road-detail-sheet__history">
          <summary>Where this road came from</summary>
          <p>This road has changed since it was first recorded.</p>
        </details>
      )}
    </section>
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
  onSave,
  preparation: providedPreparation,
  preparationProviders,
  activeBike,
  map,
  mapboxToken,
}: RouteDetailProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Whether the way back leads to a list that knows where to stand: the list
  // restores that offset itself, so the router must not scroll it to the top.
  const [listKnowsPosition] = useState(() => peekListPosition() !== null);
  const [selectedRoad, setSelectedRoad] = useState<CatalogRoadDetail | null>(null);
  const [, setWeatherRefresh] = useState(0);
  const [, setTrafficRefresh] = useState(0);
  // A rider who already let OpenGravel see their location does not get asked
  // again; without it the start distance is simply absent.
  const { origin: riderOrigin } = useRiderOrigin();
  const riderTimeZone = useSyncExternalStore(
    subscribeToDeviceTimeZone,
    deviceTimeZone,
    serverTimeZone,
  );
  const staticMapUrl = mapboxToken === undefined
    ? null
    : staticRouteMapUrl(entry.geometry.length >= 2 ? entry.geometry : entry.previewGeometry ?? [], { token: mapboxToken, width: 640, height: 400 });
  // A list entry carries only the card's preview line. Plan, export and share
  // must wait for the route page's full geometry (ExploreClient shows the
  // load state when the full line cannot be fetched).
  const fullGeometry = entry.geometryComplete !== false;
  const canExport = fullGeometry && entry.geometry.length >= 2;
  /** The line the detail page draws when there is neither a live map nor an image. */
  const mapLine = entry.geometry.length >= 2 ? entry.geometry : entry.previewGeometry ?? [];
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

  const startDistance = riderOrigin === undefined ? null : startDistanceLabel(distanceToStartKm(riderOrigin, entry));
  // The header says the two things a rider decides with: how far the start is,
  // and where the route came from. Everything else waits below (§7 copy).
  const provenanceSource = provenanceSourceName(entry.provenance);
  const showHeaderMeta = startDistance !== null || provenanceSource !== "";

  // The ride's one line of facts, in the order a rider asks them: how far it
  // is, how long it takes, what is under the wheels, and how much of it turns.
  // A fact this route does not know is left out — an absence is not a value,
  // and the page does not print "unknown" four times under the name.
  const surfaceFact = entry.surfaceSummary !== undefined
    ? entry.surfaceSummary
    : entry.roadSummary === undefined || (entry.roadSummary.surfaceBand ?? "unknown") === "unknown"
      ? null
      : routeSurfaceLabel(entry.roadSummary);
  const rideFacts = routeFacts({
    distanceKm: entry.distanceKm,
    estimatedTimeMinutes: entry.estimatedTimeMinutes,
    surfaceLabel: surfaceFact,
    curvatureSummary: entry.curvatureSummary,
    formatDistance: (metres) => formatMiles(metres),
  });
  // Climb, descent and the highest point, in the units a US rider reads; the
  // section is absent when the stored profile cannot say.
  const elevation = elevationSummaryOf(entry.stats?.elevationProfile);

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
    } catch {
      setStatus("That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  const noMatchedRoads = entry.roadDetails === undefined || entry.roadDetails.length === 0;
  // A ride that came from the catalog is not in the rider's library yet, so it
  // can be kept there. One that came from the library has nothing to add.
  const canSave = onSave !== undefined && entry.source === "catalog" && fullGeometry;

  function exportGpx(): void {
    const xml = buildPlannedRouteGpx({ title: entry.name, geometry: entry.geometry });
    downloadExport(new TextEncoder().encode(xml), exportFilename(entry.name, "planned-route"));
  }

  /** Keep a copy in My rides and stay here: the ride page is for reading. */
  async function saveRide(): Promise<void> {
    if (onSave === undefined) return;
    await onSave(entry);
    setSaved(true);
    setStatus("Saved to My rides.");
  }

  return (
    <main id="main" className="og-route-detail">
      <header className="og-route-detail__header">
        {/* The way back is a target, not a pill: 48px, and it sits on the gutter
            the words below align to. */}
        <Link className="og-route-detail__back" href="/explore" scroll={!listKnowsPosition} aria-label="Back to Explore">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="og-route-detail__heading">
          <h1>{entry.name}</h1>
        </div>
        {/* One line of numbers under the name, before the map: how far, how
            long, what is under the wheels. It replaces a four-tile ledger that
            pushed the ride itself down the page. Each figure is one unbreakable
            unit, and an estimate's pace is its title rather than words that
            could wrap away from the number. */}
        {rideFacts.length === 0 ? null : (
          <p className="og-route-detail__facts" data-testid="route-facts">
            {rideFacts.map((fact) => (
              <span
                key={fact.key}
                className="og-route-detail__fact"
                {...(fact.note === undefined ? {} : { title: fact.note })}
              >
                {fact.text}
              </span>
            ))}
          </p>
        )}
        {showHeaderMeta ? (
          <p className="og-route-detail__meta" data-testid="route-meta">
            {startDistance === null ? null : (
              <span data-testid="route-start-distance">{startDistance}</span>
            )}
            {startDistance === null ? null : " · "}
            {provenanceSource}
          </p>
        ) : null}
      </header>

      {/* The route where it is comes next, then the one commitment: a rider
          decides with the map and the line, in that order. */}
      <div className="og-route-detail__body">
        <div className="og-route-detail__visual">
      <section className="og-route-detail__map" aria-label="Map preview">
        {/* The route where it is: a live map to pan, else a map image. */}
        {map !== undefined ? (
          <ExploreMap {...map} entries={[entry]} highlightedId={entry.id} onOpen={() => undefined} tools="recentre" />
        ) : staticMapUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a remote static map; next/image would proxy it.
          <img className="og-route-detail__map-image" src={staticMapUrl} alt={`${entry.name} on a map`} width={640} height={400} />
        ) : mapLine.length >= 2 ? (
          // No basemap on this device: the ride's own line takes the map's place
          // rather than a sentence about a missing picture.
          <RouteLinePreview line={mapLine} name={entry.name} />
        ) : (
          <div className="og-map-preview-unavailable" role="img" aria-label={`${entry.name} map preview`}>
            <span className="og-map-preview-unavailable__glyph" aria-hidden="true">⌖</span>
            <span>Map preview unavailable</span>
          </div>
        )}
      </section>
        </div>
        <div className="og-route-detail__content">

      {/* ONE action a rider takes on this page: it opens the ride ready to
          start. Saving and sharing sit beside it as the quiet choices, together
          on their own row so the commitment is the only thing that stands out. */}
      <section className="og-route-detail__actions" aria-label="Route actions">
        <button
          type="button"
          className="og-primary"
          data-testid="ride-this"
          aria-busy={busy === "use"}
          disabled={busy !== null || !fullGeometry}
          onClick={() => void runAction("use", () => onUse(entry))}
        >
          {busy === "use" ? "Getting this ride ready…" : "Ride this"}
        </button>
        <div className="og-route-detail__alternates">
          {canSave ? (
            // Already saved is a state, not a dead end: the button keeps its
            // focus and says what it did rather than going grey under the thumb.
            <button
              type="button"
              className="og-secondary"
              aria-pressed={saved}
              disabled={busy !== null}
              onClick={() => {
                if (saved) return;
                void runAction("save", saveRide);
              }}
            >
              {saved ? "Saved" : "Save"}
            </button>
          ) : null}
          <ShareRouteButton name={entry.name} />
        </div>
      </section>

      {status !== null ? <p className="og-route-detail__status" role="status">{status}</p> : null}

      <p className="og-route-detail__summary">{entry.summary}</p>

      {entry.story === undefined ? null : <RouteStory story={entry.story} routeName={entry.name} />}

      {variants.length > 0 ? (
        <section className="og-route-detail__variants" aria-label="Other versions of this ride">
          <h2>Other versions</h2>
          <ul>
            {variants.map((variant) => (
              <li key={variant.id}>
                <Link href={`/explore/${encodeURIComponent(variant.id)}`}>
                  <strong>{variant.label ? `${variant.label} · ` : ""}{variant.name}</strong>
                  <span>{formatDistance(variant.distanceKm)} · {variant.copyCount} {variant.copyCount === 1 ? "version" : "versions"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RoutePreparationSection variant="brief" preparation={preparation} />

      {elevation === null ? null : (
        <section className="og-route-detail__elevation" aria-label="Elevation">
          <h2>Elevation</h2>
          <dl className="og-route-detail__elevation-facts">
            <div><dt>Climb</dt><dd>{feet(elevation.climbMeters)}</dd></div>
            <div><dt>Descent</dt><dd>{feet(elevation.descentMeters)}</dd></div>
            <div><dt>Highest point</dt><dd>{feet(elevation.highPointMeters)}</dd></div>
          </dl>
        </section>
      )}

      {noMatchedRoads ? null : (
        <section className="og-route-detail__roads" aria-labelledby="roads-on-this-ride-title">
          <div className="og-route-detail__roads-head">
            <div>
              <h2 id="roads-on-this-ride-title">Roads on this ride</h2>
              {entry.roadSummary === undefined ? null : (
                <p className="og-route-detail__coverage">{roadCoverageCopy(entry.roadSummary)}</p>
              )}
              <p className="og-route-detail__surface-summary">{routeSurfaceLabel(entry.roadSummary ?? {
                roads: [],
                totalKm: 0,
                matchedKm: 0,
                unmatchedKm: 0,
                coveragePercent: 0,
                unverifiedRoadCount: 0,
              })}</p>
            </div>
          </div>
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
        </section>
      )}

      {entry.source === "catalog" ? <RouteCommunity routeId={entry.id} /> : null}

      {/* Taking the ride elsewhere is a quieter job than riding it: the file for
          a device, and the public listing for a shared ride. */}
      {canExport || (fullGeometry && (entry.source === "personal" || entry.source === "import")) ? (
        <section className="og-route-detail__take-away" aria-label="Take this ride with you">
          <h2>Take it with you</h2>
          <div className="og-route-detail__alternates">
            {canExport ? <button type="button" className="og-secondary" disabled={busy !== null} onClick={exportGpx}>Export GPX</button> : null}
            {fullGeometry && (entry.source === "personal" || entry.source === "import") ? <ShareWithEveryone name={entry.name} geometry={entry.geometry} /> : null}
          </div>
        </section>
      ) : null}

      {entry.source === "catalog" ? <RemoveRoute routeId={entry.id} name={entry.name} /> : null}
        </div>
      </div>
      {/* Credits close the page: who made the place the ride goes through, and
          — one press away — what produced its line (09 §6 step 8). */}
      <footer className="og-route-detail__credits" aria-label="Route credits">
        {entry.region.trim().length === 0 ? null : (
          <p className="og-route-detail__region">{entry.region}</p>
        )}
        {entry.provenanceDetail === undefined && !entry.provenance.includes(" · ") ? null : (
          <details className="og-route-detail__provenance-detail">
            <summary>Where this route came from</summary>
            {entry.provenance.includes(" · ") ? <p>From the file: {entry.provenance}</p> : null}
            {entry.provenanceDetail === undefined ? null : <p>{entry.provenanceDetail}</p>}
          </details>
        )}
      </footer>
      {selectedRoad !== null ? <RoadDetailSheet road={selectedRoad} onClose={() => setSelectedRoad(null)} /> : null}
    </main>
  );
}
