"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { staticRouteMapUrl } from "@/application/map/static-map";

import { AppBar } from "@/ui/nav/AppBar";
import { ExploreMap, type ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { SeasonalRoadOpenings } from "@/ui/explore/SeasonalRoadOpenings";
import type { Coordinate } from "@/domain/ride/types";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

import type { CatalogEntry, CatalogSource } from "@/application/explore/catalog";
import { previewPointsAttribute } from "@/application/explore/preview";
import { formatDistance } from "@/application/planner/measurements";
import {
  filterRoadCandidates,
  roadDiscoverySliceLabel,
  type RoadCandidate,
  type RoadDiscoverySlice,
  type RoadSurfaceFilter,
} from "@/application/roads/discovery";
import {
  distanceToStartKm,
  filterAndSortCatalog,
  parseExploreQuery,
  serializeExploreQuery,
  type DistanceBucket,
  type ExploreQuery,
  type ExploreSort,
} from "@/application/explore/query";

export interface ExplorePanelProps {
  readonly entries: readonly CatalogEntry[];
  readonly roadCandidates?: readonly RoadCandidate[];
  readonly initialQuery?: ExploreQuery;
  /** The route map beside the list (UX rework phase 5); absent renders the list alone. */
  readonly map?: ExploreMapConfig & { readonly onOpen: (entryId: string) => void };
  /** A public Mapbox token: cards then show the route on a real map image. */
  readonly mapboxToken?: string;
  /** Current selected route, when Explore was opened from an active planner session. */
  readonly plannedRoute?: { readonly key: string; readonly line: readonly Coordinate[] };
}

/**
 * The source of a result, in one honest word per source (09 §3, §5).
 *
 * `catalog` names the published route collection. It is kept distinct from the
 * rider's own saved and imported routes in both the card and source filter.
 */
const SOURCE_LABEL: Readonly<Record<CatalogSource, string>> = {
  catalog: "Catalog",
  personal: "Yours",
  import: "Imported",
};

function distanceLabel(distanceKm: number | null): string {
  return distanceKm === null ? "—" : formatDistance(distanceKm * 1000);
}

function queryWith(query: ExploreQuery, patch: Partial<ExploreQuery>): ExploreQuery {
  const next = { ...query, ...patch };
  return next;
}

function RoutePreview({ entry, mapboxToken }: { readonly entry: CatalogEntry; readonly mapboxToken?: string | undefined }) {
  // The route on a real map, so a rider sees where it is: towns, roads, terrain.
  const mapUrl = mapboxToken === undefined
    ? null
    : staticRouteMapUrl(entry.previewGeometry ?? entry.geometry, { token: mapboxToken, width: 400, height: 190 });
  if (mapUrl !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote static map, sized by CSS; next/image would proxy it.
      <img
        className="og-explore-card__preview og-explore-card__preview--map"
        src={mapUrl}
        alt={`${entry.name} on a map`}
        loading="lazy"
        decoding="async"
        width={400}
        height={190}
      />
    );
  }
  return (
    <div
      className="og-explore-card__preview og-map-preview-unavailable"
      role="img"
      aria-label={`${entry.name} geographic route preview`}
    >
      <span className="og-map-preview-unavailable__glyph" aria-hidden="true">⌖</span>
      <span>Map preview unavailable</span>
    </div>
  );
}

/** A summary that only restates the distance ("155 mi route") says nothing new. */
function isDistanceOnly(summary: string): boolean {
  return /^[\d.,]+\s*(mi|km)\s+route$/i.test(summary.trim());
}

function durationLabel(minutes: number | undefined): string | null {
  if (minutes === undefined || !(minutes > 0)) return null;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The surface chip's tone, from the rider-facing summary the catalog build wrote. */
function surfaceTone(summary: string | undefined): "paved" | "mixed" | "unpaved" | "unknown" {
  if (summary === undefined) return "unknown";
  if (/^paved/i.test(summary)) return "paved";
  if (/^mostly paved/i.test(summary)) return "mixed";
  return "unpaved";
}

/** "12 mi away" to where the route starts, rounded the way a rider says it. */
function awayLabel(km: number): string | null {
  if (!Number.isFinite(km)) return null;
  const miles = km / 1.609344;
  if (miles < 1) return "Starts near you";
  return `${miles < 10 ? miles.toFixed(0) : Math.round(miles / 5) * 5} mi away`;
}

function RouteCard({
  entry,
  onHighlight,
  mapboxToken,
  awayKm,
}: {
  readonly entry: CatalogEntry;
  readonly onHighlight?: (entryId: string | null) => void;
  readonly mapboxToken?: string | undefined;
  /** Kilometres from the rider to the start, once their location is known. */
  readonly awayKm?: number | undefined;
}) {
  const away = awayKm === undefined ? null : awayLabel(awayKm);
  const duration = durationLabel(entry.estimatedTimeMinutes);
  const variants = entry.exportCount !== undefined && entry.exportCount > 1
    ? `${entry.exportCount} exports${(entry.variantCount ?? entry.exportCount) > 1 ? ` · ${entry.variantCount ?? entry.exportCount} tracks` : ""}`
    : entry.variantCount !== undefined && entry.variantCount > 1
      ? `${entry.variantCount} tracks and variants`
      : null;
  return (
    <li
      className="og-explore-card"
      onPointerEnter={onHighlight === undefined ? undefined : () => onHighlight(entry.id)}
      onPointerLeave={onHighlight === undefined ? undefined : () => onHighlight(null)}
      onFocus={onHighlight === undefined ? undefined : () => onHighlight(entry.id)}
      onBlur={onHighlight === undefined ? undefined : () => onHighlight(null)}
    >
      <Link
        className={mapboxToken === undefined ? "og-explore-card__link" : "og-explore-card__link og-explore-card__link--map"}
        href={`/explore/${encodeURIComponent(entry.id)}`}
      >
        <RoutePreview entry={entry} mapboxToken={mapboxToken} />
        <span className="og-explore-card__body">
          <span className="og-explore-card__topline">
            <span className="og-explore-card__source" data-source={entry.source}>{SOURCE_LABEL[entry.source]}</span>
            <span className="og-explore-card__region">{entry.region}</span>
          </span>
          <strong>{entry.name}</strong>
          <span className="og-explore-card__facts">
            <span className="og-explore-card__distance">{distanceLabel(entry.distanceKm)}</span>
            {duration === null ? null : <span className="og-explore-card__time">≈ {duration}</span>}
            {away === null ? null : <span className="og-explore-card__away" data-testid="explore-card-away">{away}</span>}
          </span>
          <span className="og-explore-card__chips">
            {/* EX-03/RI-01: the catalog's surface is the route service's
                estimate (the detail page says "Est. surface"); say so here too. */}
            <span className="og-explore-card__chip" data-surface={surfaceTone(entry.surfaceSummary)}>
              {entry.surfaceSummary === undefined ? "Surface unknown" : `Est. ${entry.surfaceSummary}`}
            </span>
            <span className="og-explore-card__chip" data-curves={entry.curvatureSummary === undefined ? "unknown" : "known"}>
              <span aria-hidden="true">∿ </span>
              {entry.curvatureSummary ?? "Curvature unknown"}
            </span>
          </span>
          {isDistanceOnly(entry.summary) ? null : <span className="og-explore-card__summary">{entry.summary}</span>}
          {variants === null ? null : <span className="og-explore-card__variants">{variants}</span>}
          {entry.storyTeaser === undefined ? null : (
            <span className="og-explore-card__byline">
              {entry.storyTeaser.sharedBy === undefined ? `From ${entry.storyTeaser.sourceName}` : `Shared by ${entry.storyTeaser.sharedBy}`}
              {entry.storyTeaser.commentCount > 0 ? ` · ${entry.storyTeaser.commentCount} ${entry.storyTeaser.commentCount === 1 ? "comment" : "comments"}` : ""}
              {entry.storyTeaser.photoCount > 0 ? ` · ${entry.storyTeaser.photoCount} ${entry.storyTeaser.photoCount === 1 ? "photo" : "photos"}` : ""}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function roadLengthLabel(lengthKm: number): string {
  return lengthKm > 0 ? formatDistance(lengthKm * 1000) : "—";
}

function roadSurfaceLabel(candidate: RoadCandidate): string {
  return candidate.surfaceValue === "unknown"
    ? "Surface unknown"
    : `Surface ${candidate.surfaceBand} · ${candidate.surfaceValue}`;
}

function RoadPreview({ candidate }: { readonly candidate: RoadCandidate }) {
  const points = previewPointsAttribute(candidate.geometry);
  return (
    <svg
      className="og-explore-card__preview"
      viewBox="0 0 96 64"
      role="img"
      aria-label={`${candidate.entity.name} geographic road preview`}
    >
      <rect width="96" height="64" rx="8" fill="var(--og-canvas)" />
      {points.length > 0 ? (
        <polyline points={points} fill="none" stroke="var(--og-topo-sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <text x="48" y="35" textAnchor="middle" fill="var(--og-slate)" fontSize="7">No geometry</text>
      )}
    </svg>
  );
}

function RoadCard({ candidate, onOpen }: { readonly candidate: RoadCandidate; readonly onOpen: () => void }) {
  return (
    <li className="og-explore-card og-road-discovery-card">
      <button
        type="button"
        className="og-explore-card__link og-road-discovery-card__button"
        onClick={onOpen}
        aria-label={`Open ${candidate.entity.name} road details`}
      >
        <RoadPreview candidate={candidate} />
        <span className="og-explore-card__body">
          <span className="og-explore-card__topline">
            <span className="og-explore-card__source">Road</span>
            <span className="og-explore-card__distance">{roadLengthLabel(candidate.lengthKm)}</span>
          </span>
          <strong>{candidate.entity.name}</strong>
          <span className="og-explore-card__region">
            {candidate.entity.class} · {roadLengthLabel(candidate.lengthKm)}
          </span>
          <span className="og-road-surface" data-surface-band={candidate.surfaceBand}>
            {roadSurfaceLabel(candidate)}
          </span>
          <span className="og-explore-card__why">{candidate.whyLine}</span>
        </span>
      </button>
    </li>
  );
}

function RoadDiscoveryDetailSheet({ candidate, onClose }: { readonly candidate: RoadCandidate; readonly onClose: () => void }) {
  const records = candidate.evidenceSummary.records.length > 0
    ? candidate.evidenceSummary.records
    : candidate.evidence;
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <section
      ref={dialogRef}
      className="og-road-detail-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="road-discovery-detail-title"
    >
      <div className="og-road-detail-sheet__head">
        <div>
          <p className="og-eyebrow">Road detail</p>
          <h2 id="road-discovery-detail-title">{candidate.entity.name}</h2>
        </div>
        <button type="button" className="og-secondary" onClick={onClose}>Close</button>
      </div>
      {candidate.aliases.length > 0 ? (
        <p className="og-road-detail-sheet__aliases">Also known as: {candidate.aliases.join(", ")}</p>
      ) : null}
      <dl className="og-road-detail-sheet__facts">
        <div><dt>Class</dt><dd>{candidate.entity.class}</dd></div>
        <div><dt>Length</dt><dd>{roadLengthLabel(candidate.lengthKm)}</dd></div>
        <div><dt>Surface</dt><dd>{roadSurfaceLabel(candidate)}</dd></div>
        <div><dt>Region</dt><dd>{candidate.region ?? "—"}</dd></div>
      </dl>
      <section aria-labelledby="road-discovery-why-title">
        <h3 id="road-discovery-why-title">Why it appears</h3>
        <p>{candidate.whyLine}</p>
      </section>
      <section aria-labelledby="road-discovery-evidence-title">
        <h3 id="road-discovery-evidence-title">Evidence</h3>
        {records.length === 0 ? (
          <p>— <span className="sr-only">No evidence reported</span></p>
        ) : (
          <table className="og-road-detail-sheet__evidence">
            <caption className="sr-only">Evidence reports for {candidate.entity.name}</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Observed</th><th scope="col">Value</th></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.source}</td>
                  <td>{record.observedAt}</td>
                  <td>{record.value ?? "Surface unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {candidate.conflict ? <p className="og-road-detail-sheet__conflict" role="status">Surface reports conflict. See each source above.</p> : null}
      </section>
    </section>
  );
}

function RoadSlice({
  slice,
  candidates,
  onOpen,
}: {
  readonly slice: RoadDiscoverySlice;
  readonly candidates: readonly RoadCandidate[];
  readonly onOpen: (candidate: RoadCandidate) => void;
}) {
  const items = candidates.filter((candidate) => candidate.slices.includes(slice));
  if (items.length === 0) return null;
  return (
    <section className="og-road-discovery__slice" aria-labelledby={`road-slice-${slice}`}>
      <div className="og-road-discovery__slice-head">
        <h2 id={`road-slice-${slice}`}>{roadDiscoverySliceLabel(slice)}</h2>
        <span>{items.length} {items.length === 1 ? "road" : "roads"}</span>
      </div>
      <ul className="og-explore__list" aria-label={roadDiscoverySliceLabel(slice)}>
        {items.map((candidate) => <RoadCard key={`${slice}-${candidate.id}`} candidate={candidate} onOpen={() => onOpen(candidate)} />)}
      </ul>
    </section>
  );
}

/** One-tap distance buckets for the phone's quick-filter row. */
const DISTANCE_CHIPS: readonly { readonly value: DistanceBucket; readonly label: string }[] = [
  { value: "short", label: "Under 30 mi" },
  { value: "medium", label: "30–90 mi" },
  { value: "long", label: "90+ mi" },
];

function activeFilterCount(query: ExploreQuery): number {
  return [query.source, query.distance, query.surface, query.curvy, query.region].filter(
    (value) => value !== undefined && value !== "",
  ).length;
}

export function ExplorePanel({ entries, roadCandidates = [], initialQuery, map, mapboxToken, plannedRoute }: ExplorePanelProps) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Phone: search stays, the rest folds behind a Filters button (UX rework).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lens, setLens] = useState<"rides" | "roads" | "openings">("rides");
  const [query, setQuery] = useState<ExploreQuery>(initialQuery ?? { sort: "recommended" });
  const readUrlOnMount = useRef(initialQuery === undefined);
  /** A discrete filter change is a history entry; typing replaces (EX-12). */
  const pushNext = useRef(false);
  const [origin, setOrigin] = useState<readonly [number, number] | undefined>();
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [roadSurface, setRoadSurface] = useState<RoadSurfaceFilter>("any");
  const [roadOrigin, setRoadOrigin] = useState<readonly [number, number] | undefined>();
  const [roadNearMe, setRoadNearMe] = useState(false);
  const [roadLocationNote, setRoadLocationNote] = useState<string | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<RoadCandidate | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readUrlOnMount.current) {
      readUrlOnMount.current = false;
      setQuery(parseExploreQuery(window.location.search));
      return;
    }
    const nextSearch = serializeExploreQuery(query);
    if (window.location.search !== nextSearch) {
      const url = `${window.location.pathname}${nextSearch}`;
      if (pushNext.current) window.history.pushState({}, "", url);
      else window.history.replaceState({}, "", url);
    }
    pushNext.current = false;
  }, [query]);

  // Back and Forward restore the filters the address bar shows (EX-01, EX-12).
  useEffect(() => {
    const onPop = (): void => setQuery(parseExploreQuery(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const visibleEntries = useMemo(
    () => filterAndSortCatalog(entries, query, origin),
    [entries, origin, query],
  );
  const hasCatalogEntries = entries.some((entry) => entry.source === "catalog");
  const hasPersonalEntries = entries.some((entry) => entry.source === "personal");
  const hasSurfaceEvidence = entries.some((entry) => entry.surfaceSummary !== undefined
    || entry.catalogMembers?.some((member) => member.surfaceSummary !== undefined));
  const hasCurvatureEvidence = entries.some((entry) => entry.curvatureSummary !== undefined
    || entry.catalogMembers?.some((member) => member.curvatureSummary !== undefined));
  const visibleRoads = useMemo(
    () => filterRoadCandidates(roadCandidates, {
      surface: roadSurface,
      ...(roadOrigin === undefined ? {} : { origin: roadOrigin }),
      ...(roadNearMe ? { maxDistanceKm: 30 * 1.609344 } : {}),
    }),
    [roadCandidates, roadNearMe, roadOrigin, roadSurface],
  );

  const filterCount = activeFilterCount(query);

  // A rider who already let OpenGravel see their location gets "N mi away" on
  // every card and nearest-first Recommended, without being asked again. No
  // permission yet: nothing happens until they tap Near me.
  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.permissions?.query === undefined || !navigator.geolocation) return;
    let cancelled = false;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      if (cancelled || status.state !== "granted") return;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!cancelled) setOrigin((current) => current ?? [position.coords.longitude, position.coords.latitude]);
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
      );
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The phone's filter sheet closes on Escape, like any sheet.
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  function updateQuery(patch: Partial<ExploreQuery>): void {
    pushNext.current = !("search" in patch) && !("region" in patch);
    setQuery((current) => queryWith(current, patch));
  }

  function clearFilters(): void {
    pushNext.current = true;
    setQuery({ sort: query.sort });
  }

  function sortByLocation(): void {
    setLocationNote(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationNote("Location is unavailable on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin([position.coords.longitude, position.coords.latitude]);
        updateQuery({ sort: "near" });
      },
      () => setLocationNote("Your location permission was not granted. You can keep browsing without it."),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }

  function filterRoadsByLocation(): void {
    setRoadLocationNote(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setRoadLocationNote("Location is unavailable on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setRoadOrigin([position.coords.longitude, position.coords.latitude]);
        setRoadNearMe(true);
      },
      () => setRoadLocationNote("Your location permission was not granted. Roads remain unfiltered."),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }

  return (
    <main id="main" className="og-explore">
      <AppBar current="/explore" />
      <header className="og-explore__header">
        <div className="og-explore__heading">
          <p className="og-eyebrow">Ride library</p>
          <h1>Explore</h1>
          <p className="og-explore__intro">Routes worth a closer look, with the source and uncertainty kept visible.</p>
        </div>
        {/* AQ-06, AQ-07: a real tab list — arrow keys move, one tab stop, and
            each tab owns the panel below. */}
        <div
          className="og-explore__lens"
          role="tablist"
          aria-label="Explore lens"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const lenses = ["rides", "roads", "openings"] as const;
            const current = lenses.indexOf(lens);
            const next = event.key === "Home"
              ? lenses[0]
              : event.key === "End"
                ? lenses.at(-1)!
                : event.key === "ArrowRight"
                  ? lenses[(current + 1) % lenses.length]!
                  : lenses[(current - 1 + lenses.length) % lenses.length]!;
            setLens(next);
            document.getElementById(`og-explore-tab-${next}`)?.focus();
          }}
        >
          {(["rides", "roads", "openings"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`og-explore-tab-${id}`}
              aria-selected={lens === id}
              aria-controls="og-explore-panel"
              tabIndex={lens === id ? 0 : -1}
              className={lens === id ? "og-primary" : "og-secondary"}
              onClick={() => setLens(id)}
            >
              {id === "rides" ? "Rides" : id === "roads" ? "Roads" : "Openings"}
            </button>
          ))}
        </div>
      </header>

      <div role="tabpanel" id="og-explore-panel" aria-labelledby={`og-explore-tab-${lens}`}>
      {lens === "rides" ? <div className="og-explore__toolbar">
        <label className="og-explore__search">
          <span className="og-visually-hidden">Search</span>
          <input aria-label="Search routes" type="search" value={query.search ?? ""} onChange={(event) => updateQuery({ search: event.target.value || undefined })} placeholder="Search routes" />
        </label>
        <button
          type="button"
          className="og-secondary og-explore__filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="og-explore-filters"
          aria-label={`Filters${filterCount > 0 ? `, ${filterCount} on` : ""}`}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
          <span className="og-explore__filters-label">Filters</span>
          {filterCount > 0 ? <span className="og-explore__filters-count" aria-hidden="true">{filterCount}</span> : null}
        </button>
        {filtersOpen ? (
          <button type="button" className="og-explore__backdrop" aria-label="Close filters" tabIndex={-1} onClick={() => setFiltersOpen(false)} />
        ) : null}
      <section className="og-explore__controls" id="og-explore-filters" data-open={filtersOpen} aria-label="Explore filters">
        <div className="og-explore__sheet-head">
          <h2>Filters</h2>
          <button type="button" className="og-explore__sheet-reset" disabled={filterCount === 0} onClick={clearFilters}>Reset</button>
        </div>
        <label>
          <span>Source</span>
          <select
            aria-label="Filter by source"
            value={query.source ?? "all"}
            onChange={(event) => updateQuery({ source: event.target.value === "all" ? undefined : event.target.value as CatalogSource })}
          >
            <option value="all">All sources</option>
            <option value="catalog">Catalog</option>
            <option value="personal">Yours</option>
            <option value="import">Imported</option>
          </select>
        </label>
        <label>
          <span>Distance</span>
          <select
            aria-label="Filter by distance"
            value={query.distance ?? "all"}
            onChange={(event) => updateQuery({ distance: event.target.value === "all" ? undefined : event.target.value as DistanceBucket })}
          >
            <option value="all">Any distance</option>
            <option value="short">Up to 30 mi</option>
            <option value="medium">30–90 mi</option>
            <option value="long">Over 90 mi</option>
          </select>
        </label>
        <label>
          <span>Surface</span>
          <select aria-label="Filter by surface" value={query.surface ?? "all"} disabled={!hasSurfaceEvidence} title={!hasSurfaceEvidence ? "Surface evidence is not available for these catalog routes." : undefined} onChange={(event) => updateQuery({ surface: event.target.value === "all" ? undefined : event.target.value as "paved" | "gravel" })}>
            <option value="all">Any surface</option>
            <option value="paved">Paved</option>
            <option value="gravel">Gravel or unpaved</option>
          </select>
        </label>
        <label className="og-explore__check">
          <input aria-label="Curvy routes only" type="checkbox" checked={query.curvy === true} disabled={!hasCurvatureEvidence} title={!hasCurvatureEvidence ? "Curvature evidence is not available for these catalog routes." : undefined} onChange={(event) => updateQuery({ curvy: event.target.checked || undefined })} />
          <span>Curvy only</span>
        </label>
        <label>
          <span>Region</span>
          <input
            aria-label="Filter by region"
            type="search"
            value={query.region ?? ""}
            onChange={(event) => updateQuery({ region: event.target.value || undefined })}
            placeholder="e.g. Pennsylvania"
          />
        </label>
        <label>
          <span>Sort</span>
          <select
            aria-label="Sort routes"
            value={query.sort}
            onChange={(event) => {
              if (event.target.value === "near") {
                if (origin === undefined) sortByLocation();
                else updateQuery({ sort: "near" });
              } else updateQuery({ sort: event.target.value as ExploreSort });
            }}
          >
            <option value="recommended">Recommended</option>
            <option value="near">Nearest to me</option>
            <option value="name">Name</option>
            <option value="distance-asc">Distance, shortest first</option>
            <option value="distance-desc">Distance, longest first</option>
          </select>
        </label>
        <button type="button" className="og-secondary og-explore__near" aria-label="Sort by distance from me" onClick={sortByLocation}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
          Near me
        </button>
        <button type="button" className="og-primary og-explore__sheet-done" onClick={() => setFiltersOpen(false)}>
          {visibleEntries.length === 1 ? "Show 1 route" : `Show ${visibleEntries.length} routes`}
        </button>
      </section>
      </div> : lens === "roads" ? (
        <section className="og-explore__controls" aria-label="Road filters">
          <label>
            <span>Surface band</span>
            <select aria-label="Filter roads by surface" value={roadSurface} onChange={(event) => setRoadSurface(event.target.value as RoadSurfaceFilter)}>
              <option value="any">Any surface</option>
              <option value="gravel">Gravel</option>
              <option value="unknown">Unknown surface</option>
            </select>
          </label>
          <label>
            <span>Distance</span>
            <select aria-label="Filter roads by distance" value={roadNearMe ? "near" : "any"} onChange={(event) => {
              const near = event.target.value === "near";
              setRoadNearMe(near);
              if (near && roadOrigin === undefined) setRoadLocationNote("Tap Use my location to apply the near-me filter.");
            }}>
              <option value="any">Any distance</option>
              <option value="near">Near me (within 30 mi)</option>
            </select>
          </label>
          <button type="button" className="og-secondary" onClick={filterRoadsByLocation}>Use my location for road distance</button>
          {roadNearMe && roadOrigin !== undefined ? <button type="button" className="og-secondary" onClick={() => { setRoadNearMe(false); setRoadOrigin(undefined); }}>Clear near-me filter</button> : null}
        </section>
      ) : null}

      {lens === "rides" ? (
        <div className="og-explore__quick" role="group" aria-label="Quick filters">
          <button type="button" className="og-explore__quick-chip" aria-pressed={query.sort === "near"} onClick={() => {
            if (query.sort === "near") updateQuery({ sort: "recommended" });
            else if (origin === undefined) sortByLocation();
            else updateQuery({ sort: "near" });
          }}>Near me</button>
          {DISTANCE_CHIPS.map((chip) => (
            <button key={chip.value} type="button" className="og-explore__quick-chip" aria-pressed={query.distance === chip.value} onClick={() => updateQuery({ distance: query.distance === chip.value ? undefined : chip.value })}>
              {chip.label}
            </button>
          ))}
          {hasCurvatureEvidence ? (
            <button type="button" className="og-explore__quick-chip" aria-pressed={query.curvy === true} onClick={() => updateQuery({ curvy: query.curvy === true ? undefined : true })}>Curvy</button>
          ) : null}
          {hasSurfaceEvidence ? (
            <button type="button" className="og-explore__quick-chip" aria-pressed={query.surface === "gravel"} onClick={() => updateQuery({ surface: query.surface === "gravel" ? undefined : "gravel" })}>Gravel</button>
          ) : null}
        </div>
      ) : null}

      {lens === "rides" ? <>
        {locationNote !== null ? <p className="og-explore__note" role="status">{locationNote}</p> : null}
        {!hasCatalogEntries ? <p className="og-explore__empty">No catalog routes loaded.</p> : null}
        {/* EX-05, FT-08: the "no personal rides" note only matters when the
            rider asked for their own rides; it never heads a list of catalog routes. */}
        {!hasPersonalEntries && query.source === "personal" ? (
          <p className="og-explore__empty">No personal rides yet. <Link href="/">Plan and save a ride</Link> to see it here.</p>
        ) : null}
        {visibleEntries.length === 0 && hasCatalogEntries ? (
          // CL-04, EX-04, AQ-08: say it, announce it, and offer the way out.
          <p className="og-explore__empty" role="status" data-testid="explore-no-match">
            No routes match these filters.{" "}
            {activeFilterCount(query) > 0 || (query.search ?? "") !== "" ? (
              <button type="button" className="og-secondary og-explore__reset" data-testid="explore-clear-filters" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </p>
        ) : null}
        {visibleEntries.length > 0 ? (
          // EX-11: how many routes the list holds, so a long scroll has a size.
          <p className="og-explore__count" role="status" data-testid="explore-count">
            {visibleEntries.length === 1 ? "1 route" : `${visibleEntries.length} routes`}
          </p>
        ) : null}
        {visibleEntries.length > 0 ? (
          <div className={map === undefined ? undefined : "og-explore__split"}>
            {map === undefined ? null : (
              <ExploreMap
                {...map}
                entries={visibleEntries}
                highlightedId={highlightedId}
              />
            )}
            <ul className="og-explore__list" aria-label="Explore routes">
              {visibleEntries.map((entry) => (
                <RouteCard
                  key={entry.id}
                  entry={entry}
                  mapboxToken={mapboxToken}
                  awayKm={origin === undefined ? undefined : distanceToStartKm(origin, entry)}
                  {...(map === undefined ? {} : { onHighlight: setHighlightedId })}
                />
              ))}
            </ul>
            {mapboxToken === undefined ? null : (
              <p className="og-explore__attribution">Map images © Mapbox © OpenStreetMap</p>
            )}
          </div>
        ) : null}
      </> : lens === "roads" ? <>
        <h2 className="og-road-discovery__title">Roads</h2>
        {roadLocationNote !== null ? <p className="og-explore__note" role="status">{roadLocationNote}</p> : null}
        {roadCandidates.length === 0 ? (
          <div className="og-explore__empty og-empty-state" role="status">
            <div className="og-empty-state__body">
              <p>Roads will appear here as matched roads from saved or imported rides build up evidence. Save a ride or import a GPX to discover Great roads, gravel / unknown surface, and New to me roads.</p>
              {/* EX-06, CL-05: the next step, not just the explanation. AX-03:
                  a flex row below the copy, never inline over its last line. */}
              <div className="og-explore__empty-actions">
                <Link className="og-primary" href="/">Plan a ride</Link>
                <Link className="og-secondary" href="/rides">Import a GPX</Link>
              </div>
            </div>
          </div>
        ) : visibleRoads.length === 0 ? (
          <p className="og-explore__empty" role="status">
            No roads match these filters. Unknown geometry is not treated as nearby.{" "}
            <button type="button" className="og-secondary og-explore__reset" onClick={() => { setRoadSurface("any"); setRoadNearMe(false); setRoadOrigin(undefined); }}>
              Clear filters
            </button>
          </p>
        ) : (
          <div className="og-road-discovery" aria-label="Road discovery results">
            <RoadSlice slice="great" candidates={visibleRoads} onOpen={setSelectedRoad} />
            <RoadSlice slice="gravel" candidates={visibleRoads} onOpen={setSelectedRoad} />
            <RoadSlice slice="new-to-me" candidates={visibleRoads} onOpen={setSelectedRoad} />
          </div>
        )}
        {selectedRoad !== null ? <RoadDiscoveryDetailSheet candidate={selectedRoad} onClose={() => setSelectedRoad(null)} /> : null}
      </> : <SeasonalRoadOpenings {...(plannedRoute === undefined ? {} : { plannedRoute })} />}
      </div>
    </main>
  );
}
