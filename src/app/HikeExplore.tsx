"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { HikeRecord, TrailFeature } from "../../infra/trails/lib/types";
import type { Coordinate } from "@/domain/ride/types";
import { AppBar } from "@/ui/nav/AppBar";
import { AppMenu } from "@/ui/nav/AppMenu";
import { haversine } from "@/domain/geometry/analysis";
import { createRideDocument } from "@/domain/ride/create";
import { newCommandId } from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import { createMapterhornElevationSource } from "@/infrastructure/elevation/mapterhorn-source";
import { buildElevationProfile, sampleLine, type ElevationProfile } from "@/application/elevation/profile";
import { matchHikeFilters, rankHikes, profileTimeSeconds, type HikeFilters } from "@/application/hikes/discovery";
import { readExploreOrigin } from "@/application/map/explore-origin";
import { trailBreadcrumb } from "@/application/hikes/trail-breadcrumb";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";
import { readMapPalette } from "@/infrastructure/map/maplibre/style";
import { hillshadeBeforeId, hillshadeLayerSpec, terrainSourceSpec } from "@/infrastructure/map/maplibre/visual-detail";
import { mapboxRequestUrl } from "@/infrastructure/map/basemap";
import { useElevationProfile } from "@/ui/planner/useElevationProfile";
import { ElevationProfileChart } from "@/ui/planner/ElevationProfileChart";
import { formatFeet, formatLongDuration } from "@/application/planner/measurements";
import { staticRouteMapUrl } from "@/application/map/static-map";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { setActivityMode } from "@/ui/stores/activity-mode";

function linesOf(feature: TrailFeature): Coordinate[][] {
  const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return lines.map((line) => line.map(([lon, lat]) => ({ lon, lat })));
}
function miles(meters: number): string { const value = meters / 1609.344; return `${value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1)} mi`; }
/** "~1 h 19 min", "~3 d 4 h": an estimate, never false precision. */
function hikeTime(seconds: number): string { return `~${formatLongDuration(Math.max(60, seconds))}`; }
function nameOf(hike: HikeRecord): string { return hike.name ?? hike.ref ?? "Unnamed trail"; }
function useGeometry(id: string) {
  const [feature, setFeature] = useState<TrailFeature | null>(null);
  useEffect(() => { let active = true; fetch(`/api/hikes/geometry?id=${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() as Promise<TrailFeature> : null).then((f) => { if (active) setFeature(f); }).catch(() => undefined); return () => { active = false; }; }, [id]);
  return feature;
}
const elevationSource = createMapterhornElevationSource();
const featureCache = new Map<string, TrailFeature>();
const profileCache = new Map<string, ElevationProfile>();

/** Fetch one page of geometry together and share the decoded DEM tiles across trails. */
function useHikeData(hikes: readonly HikeRecord[]) {
  const [features, setFeatures] = useState<ReadonlyMap<string, TrailFeature>>(new Map());
  const [profiles, setProfiles] = useState<ReadonlyMap<string, ElevationProfile>>(new Map());
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      const missing = hikes.filter((hike) => !featureCache.has(hike.id));
      for (let offset = 0; offset < missing.length; offset += 50) {
        const params = new URLSearchParams();
        missing.slice(offset, offset + 50).forEach((hike) => params.append("ids", hike.id));
        try {
          const response = await fetch(`/api/hikes/geometry?${params}`);
          if (!response.ok) continue;
          const data = await response.json() as { features: TrailFeature[] };
          data.features.forEach((feature) => featureCache.set(feature.id, feature));
        } catch { /* The cards simply omit unavailable facts. */ }
      }
      if (!active) return;
      setFeatures(new Map(featureCache));
      setProfiles(new Map(profileCache));
      let cursor = 0;
      async function worker() {
        while (cursor < hikes.length) {
          const hike = hikes[cursor++]!;
          const feature = featureCache.get(hike.id);
          if (!feature || profileCache.has(hike.id) || hike.toblerMinutes != null) continue;
          const lines = linesOf(feature);
          if (lines.length !== 1 || !lines[0]) continue;
          const samples = sampleLine(lines[0]);
          if (!samples.length) continue;
          const result = await elevationSource.elevations(samples.map((sample) => sample.coordinate));
          const profile = result.availability === "available" ? buildElevationProfile(samples, result.elevationsMeters) : null;
          if (profile) {
            profileCache.set(hike.id, profile);
            if (active) setProfiles(new Map(profileCache));
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, () => worker()));
      if (active) setLoading(false);
    };
    if (hikes.length) void run(); else queueMicrotask(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hikes]);
  return { features, profiles, loading };
}

/**
 * A list thumbnail is one cached static image: fifty cards cannot each hold a
 * live WebGL map (browsers drop contexts past ~16 and the cards go blank).
 */
function TrailThumb({ feature, mapboxToken }: { feature: TrailFeature | null; mapboxToken?: string }) {
  const theme = useResolvedTheme();
  const longest = feature === null ? [] : linesOf(feature).reduce<readonly Coordinate[]>((best, line) => line.length > best.length ? line : best, []);
  const url = mapboxToken === undefined ? null : staticRouteMapUrl(longest, { token: mapboxToken, width: 104, height: 104, color: theme === "night" ? "c9a98c" : "776353", night: theme === "night" });
  if (url === null) return <TrailMap feature={feature} thumbnail {...(mapboxToken ? { mapboxToken } : {})} />;
  return <div className="og-hike__thumb" role="img" aria-label="Map of trail">
    {/* eslint-disable-next-line @next/next/no-img-element -- a remote static map; next/image would proxy it. */}
    <img src={url} alt="" width={104} height={104} loading="lazy" decoding="async" /></div>;
}
function TrailMap({ feature, thumbnail = false, mapboxToken }: { feature: TrailFeature | null; thumbnail?: boolean; mapboxToken?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const theme = useResolvedTheme();
  useEffect(() => {
    if (!thumbnail || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { rootMargin: "100px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  useEffect(() => {
    if (!feature || !ref.current || !visible) return;
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !ref.current) return;
      maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
      const palette = readMapPalette();
      const mapbox = Boolean(mapboxToken);
      const style = mapbox ? `https://api.mapbox.com/styles/v1/mapbox/${theme === "night" ? "navigation-night-v1" : "outdoors-v12"}?access_token=${encodeURIComponent(mapboxToken!)}` : `https://tiles.openfreemap.org/styles/${theme === "night" ? "dark" : "liberty"}`;
      const currentMap = new maplibregl.Map({ container: ref.current, style, interactive: !thumbnail, attributionControl: thumbnail ? false : { compact: true }, ...(mapboxToken ? { transformRequest: (url: string) => ({ url: mapboxRequestUrl(url, mapboxToken) }), validateStyle: false } : {}) });
      map = currentMap;
      currentMap.on("load", () => {
        if (!map) return;
        map.addSource("og-terrain-dem", terrainSourceSpec() as import("maplibre-gl").SourceSpecification);
        const before = hillshadeBeforeId(map.getStyle().layers ?? []);
        const hillshade = hillshadeLayerSpec(palette) as import("maplibre-gl").HillshadeLayerSpecification;
        map.addLayer(theme === "night" ? { ...hillshade, paint: { ...hillshade.paint, "hillshade-exaggeration": 0.5, "hillshade-highlight-color": palette.slate } } : hillshade, before);
        map.addSource("trail", { type: "geojson", data: { type: "Feature", properties: {}, geometry: feature.geometry } });
        map.addLayer({ id: "trail-casing", type: "line", source: "trail", paint: { "line-color": palette.paper, "line-width": thumbnail ? 5 : 7 } });
        map.addLayer({ id: "trail-line", type: "line", source: "trail", paint: { "line-color": palette.trailBrown, "line-width": thumbnail ? 3 : 4 } });
        const bounds = new maplibregl.LngLatBounds();
        for (const line of linesOf(feature)) for (const point of line) bounds.extend([point.lon, point.lat]);
        map.resize();
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: thumbnail ? 16 : 48, maxZoom: 15, duration: 0 });
        const attribution = ref.current?.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.removeAttribute("open");
      });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [feature, thumbnail, visible, theme, mapboxToken]);
  return <div className={thumbnail ? "og-hike__thumb" : "og-hike__map"} ref={ref} role={thumbnail ? "img" : "region"} aria-label={feature ? "Map of trail" : "Trail map unavailable"}>{!feature && <span>Map unavailable</span>}</div>;
}
function HikeCard({ hike, origin, feature, profile, mapboxToken }: { hike: HikeRecord; origin: Coordinate; feature: TrailFeature | undefined; profile: ElevationProfile | undefined; mapboxToken?: string }) {
  const distance = haversine(origin, hike.start);
  const gain = hike.elevationGainMeters ?? profile?.climbMeters;
  const facts = [miles(hike.lengthMeters), ...(gain == null ? [] : [`${formatFeet(gain)} gain`]), ...(hike.toblerMinutes != null ? [hikeTime(hike.toblerMinutes * 60)] : profile ? [hikeTime(profileTimeSeconds(profile))] : [])];
  return <Link className="og-hike__card" href={`/explore/hikes/${encodeURIComponent(hike.id)}`}>
    <TrailThumb feature={feature ?? null} {...(mapboxToken ? { mapboxToken } : {})} />
    <span className="og-hike__card-body"><strong>{nameOf(hike)}</strong><span>{miles(distance)} to start</span><span>{facts.join(" · ")}</span>{hike.shape && hike.shape !== "unknown" && <span>{hike.shape === "out-and-back" ? "Out and back" : hike.shape === "point-to-point" ? "Point to point" : "Loop"}</span>}{hike.sacScale && <span>Difficulty: {hike.sacScale} (OSM)</span>}</span>
  </Link>;
}

type Filters = HikeFilters;
const initial: Filters = { length: "", gain: "", time: "", shape: "", dogs: false, kids: false };
export function HikeExplore({ mapboxToken }: { mapboxToken?: string }) {
  const [origin, setOrigin] = useState<Coordinate | null>(null);
  const [originLabel, setOriginLabel] = useState("Near map centre");
  const [hikes, setHikes] = useState<HikeRecord[]>([]);
  const [status, setStatus] = useState("Choose your location to find nearby hikes.");
  const [filters, setFilters] = useState(initial);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  function locate() {
    if (!navigator.geolocation) { setStatus("Location is unavailable on this device."); return; }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(({ coords }) => { setOrigin({ lon: coords.longitude, lat: coords.latitude }); setOriginLabel("Near your location"); }, () => setStatus("Location unavailable. Allow location access to find nearby hikes."));
  }
  useEffect(() => {
    const center = readExploreOrigin();
    if (center) { queueMicrotask(() => { setOrigin(center); setOriginLabel("Near map centre"); }); return; }
    if (navigator.permissions?.query) void navigator.permissions.query({ name: "geolocation" }).then((p) => { if (p.state === "granted") locate(); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!origin) return;
    const controller = new AbortController();
    fetch(`/api/geocode/reverse?lat=${origin.lat}&lon=${origin.lon}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ place?: { context?: string } | null }> : null)
      .then((result) => { const locality = result?.place?.context?.split(",")[0]?.trim(); if (locality) setOriginLabel(`Near ${locality}`); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [origin]);
  useEffect(() => {
    if (!origin) return;
    let active = true;
    const bbox = [origin.lon - 0.5, origin.lat - 0.4, origin.lon + 0.5, origin.lat + 0.4].join(",");
    fetch(`/api/hikes?bbox=${bbox}`).then(async (r) => { if (!r.ok) throw new Error(); return r.json() as Promise<{ enabled: boolean; hikes: HikeRecord[] }>; }).then((data) => { if (active) { setHikes(data.hikes); setStatus(data.enabled ? "" : "Hike catalog is not configured."); } }).catch(() => { if (active) setStatus("Hike catalog unavailable. Try again later."); });
    return () => { active = false; };
  }, [origin]);
  // Catalog facts filter the whole list before paging; only hikes whose gain or
  // time waits on a measured profile are settled after their page loads.
  const ranked = useMemo(() => { const query = search.trim().toLocaleLowerCase(); return origin ? rankHikes(hikes, origin).filter((h) => (!query || (h.name ?? "").toLocaleLowerCase().includes(query)) && matchHikeFilters(h, filters) !== false) : []; }, [origin, hikes, filters, search]);
  const page = useMemo(() => ranked.slice(0, limit), [ranked, limit]);
  const { features, profiles, loading } = useHikeData(page);
  const results = page.filter((h) => matchHikeFilters(h, filters, profiles.get(h.id)) === true);
  const more = ranked.length - page.length;
  const update = (key: keyof Filters, value: string | boolean) => setFilters((old) => ({ ...old, [key]: value }));
  return <main id="main" className="og-explore og-hike"><AppBar current="/explore" /><header className="og-explore__header"><div className="og-explore__heading-row"><div><h1>Explore hikes</h1><p className="og-hike__sub">{origin ? originLabel : "Find a trail near you"}</p></div><AppMenu className="og-page-menu" /></div><label className="og-hike__search">Search trails<input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(50); }} placeholder="Trail name" /></label><div className="og-hike__tools"><button onClick={locate}>⌖ {origin ? "Use my location" : "Find my location"}</button><button onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>Filters {showFilters ? "−" : "+"}</button></div></header>
    {showFilters && <section className="og-hike__filters" aria-label="Hike filters">{hikes.some((h) => h.shape && h.shape !== "unknown") && <label>Shape<select value={filters.shape} onChange={(e) => update("shape", e.target.value)}><option value="">Any shape</option><option value="loop">Loop</option><option value="out-and-back">Out and back</option></select></label>}<label>Length<select value={filters.length} onChange={(e) => update("length", e.target.value)}><option value="">Any length</option><option value="3">Up to 3 mi</option><option value="5">Up to 5 mi</option><option value="10">Up to 10 mi</option></select></label><label>Gain<select value={filters.gain} onChange={(e) => update("gain", e.target.value)}><option value="">Any gain</option><option value="500">Up to 500 ft</option><option value="1000">Up to 1,000 ft</option></select></label><label>Time<select value={filters.time} onChange={(e) => update("time", e.target.value)}><option value="">Any time</option><option value="2">Up to 2 hours</option><option value="4">Up to 4 hours</option></select></label>{([ ["dogs", "Dogs reported OK"], ["kids", "Short and easy"] ] as const).map(([key, label]) => <label className="og-hike__check" key={key}><input type="checkbox" checked={filters[key]} onChange={(e) => update(key, e.target.checked)} />{label}</label>)}<p>Filters match mapped facts only. Short and easy means up to 3 miles, 500 feet of gain and the easiest OSM hiking grade, not a check that a trail suits children. Dog access comes from OpenStreetMap tags; check posted rules.</p><button onClick={() => setFilters(initial)}>Clear filters</button></section>}
    <section className="og-hike__results" aria-live="polite">{status && <p>{status}</p>}{origin && !status && <><p className="og-hike__count">{more > 0 ? `Showing ${results.length} of ${ranked.length} nearby trails` : `${results.length} ${results.length === 1 ? "trail" : "trails"} nearby`} · over 0.5 mi{loading ? " · measuring elevation…" : ""}</p>{results.length === 0 && !loading && <p>No matching trails with known data in these results.</p>}{results.map((h) => <HikeCard key={h.id} hike={h} origin={origin} feature={features.get(h.id)} profile={profiles.get(h.id)} {...(mapboxToken ? { mapboxToken } : {})} />)}{more > 0 && <button onClick={() => setLimit((previous) => previous + 50)}>Show {Math.min(50, more)} more trails</button>}</>}</section>
  </main>;
}

export function HikeDetail({ id, mapboxToken }: { id: string; mapboxToken?: string }) {
  const router = useRouter();
  const feature = useGeometry(id);
  const [hike, setHike] = useState<HikeRecord | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { let active = true; fetch(`/api/hikes?id=${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() as Promise<{ hikes: HikeRecord[] }> : Promise.reject()).then((data) => { if (active) { setHike(data.hikes[0] ?? null); if (!data.hikes[0]) setStatus("Trail not found."); } }).catch(() => { if (active) setStatus("Trail catalog unavailable."); }); return () => { active = false; }; }, [id]);
  const lines = useMemo(() => feature ? linesOf(feature) : [], [feature]);
  const elevation = useElevationProfile(elevationSource, lines.length === 1 ? id : null, lines[0] ?? []);
  const profile = elevation?.status === "ready" ? elevation.profile : null;
  const seconds = hike?.toblerMinutes != null ? hike.toblerMinutes * 60 : profile ? profileTimeSeconds(profile) : null;
  const time = seconds === null ? null : hikeTime(seconds);
  async function openBreadcrumb() {
    const line = lines[0];
    if (lines.length !== 1 || !line || line.length < 2 || !hike) return;
    try {
      const now = new Date().toISOString();
      const base = createRideDocument({ now, title: nameOf(hike), provenance: { type: "catalog", sourceId: hike.id } });
      const breadcrumb = trailBreadcrumb(line, nameOf(hike));
      if (breadcrumb === null) throw new Error();
      const applied = applyRideCommand(base, { type: "breadcrumb.set", commandId: newCommandId(), rideId: base.rideId, baseRevision: base.revision, source: "map", label: "Open trail on the map", breadcrumb }, { now });
      if (applied.outcome !== "applied") throw new Error();
      const saved = await createRideRepository().saveRide(applied.document, { writerToken: `hike-${crypto.randomUUID()}` });
      if (!saved.ok) throw new Error();
      setActivityMode("hike");
      router.push("/");
    } catch { setStatus("Could not open this trail on the map."); }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: hike ? nameOf(hike) : "Trail", url: window.location.href }); else { await navigator.clipboard.writeText(window.location.href); setStatus("Trail link copied."); } } catch { setStatus("Could not share the trail link."); }
  }
  return <main id="main" className="og-explore og-hike"><AppBar current="/explore" /><div className="og-hike__detail"><div className="og-hike__detail-top"><Link href="/explore" className="og-hike__back">‹ Explore hikes</Link><AppMenu className="og-page-menu" /></div>{hike ? <><div className="og-hike__title"><p>TRAIL GUIDE</p><h1>{nameOf(hike)}</h1>{hike.operator && <span>{hike.operator}</span>}{hike.shape && hike.shape !== "unknown" && <span> · {hike.shape === "out-and-back" ? "Out and back" : hike.shape === "point-to-point" ? "Point to point" : "Loop"}</span>}</div><TrailMap feature={feature} {...(mapboxToken ? { mapboxToken } : {})} /><div className="og-hike__stats"><div><strong>{miles(hike.lengthMeters)}</strong><span>Length</span></div>{(profile || hike.elevationGainMeters !== null) && <div><strong>{formatFeet((hike.elevationGainMeters ?? profile?.climbMeters)!)}</strong><span>Gain</span></div>}{time && <div><strong>{time}</strong><span>Time</span></div>}</div>{(hike.sacScale || profile || hike.dog || hike.surface) && <section className="og-hike__section"><h2>About this trail</h2>{hike.sacScale && <p><strong>Difficulty: {hike.sacScale}.</strong> This is the mapped OSM hiking scale; terrain and conditions can vary.</p>}{profile && <p>Estimated with Tobler’s hiking function using terrain elevation and grade. Surface, conditions and your pace are not included.</p>}{(hike.dog || hike.surface) && <p>{[hike.dog && `Dogs: ${hike.dog}`, hike.surface && `Surface: ${hike.surface}`].filter(Boolean).join(" · ")}</p>}</section>}{elevation && elevation.status !== "unavailable" && <section className="og-hike__section"><h2>Elevation profile</h2><ElevationProfileChart state={elevation} line={lines[0]} /></section>}{hike.trailheads.length > 0 && <section className="og-hike__section"><h2>Trailhead &amp; parking</h2>{hike.trailheads.map((head, i) => <p key={i}>{head.name ?? (head.kind === "parking" ? "Parking" : "Trailhead")} · {Math.round(head.distanceMeters)} m from a trail end<br /><span>{head.coordinate.lat.toFixed(5)}, {head.coordinate.lon.toFixed(5)}</span></p>)}</section>}<section className="og-hike__section"><h2>Sources</h2>{hike.operator && <p>Operator: {hike.operator}</p>}{hike.sources.map((source) => <p key={`${source.sourceId}-${source.recordId}`}>{source.url ? <a href={source.url}>{source.sourceLabel} · {source.recordId} ↗</a> : `${source.sourceLabel} · ${source.recordId}`}{source.licence && <> · {source.licenceUrl ? <a href={source.licenceUrl}>{source.licence}</a> : source.licence}</>}</p>)}</section><div className="og-hike__actions">{lines.length === 1 ? <><button className="og-hike__primary" data-testid="hike-open-on-map" onClick={() => void openBreadcrumb()}>Plan this hike on the map</button><p>Opens the mapped trail line as your hike plan, ready to edit or re-plan on trails. It is saved to My rides.</p></> : feature ? <p>This trail is mapped as separate pieces that do not join, so it cannot open as one plan yet.</p> : null}<p>Trail downloads are not available yet. Before you lose signal, download the area in <Link href="/settings#settings-offline-title">Offline maps</Link>.</p><button onClick={() => void share()}>Share</button></div></> : <p>{status || "Loading trail…"}</p>}{status && hike && <p role="status">{status}</p>}</div></main>;
}
