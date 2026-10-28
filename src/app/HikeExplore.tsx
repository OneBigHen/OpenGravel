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
import { useElevationProfile } from "@/ui/planner/useElevationProfile";
import { ElevationProfileChart } from "@/ui/planner/ElevationProfileChart";
import { toblerSeconds } from "@/domain/breadcrumb/route";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";

function linesOf(feature: TrailFeature): Coordinate[][] {
  const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return lines.map((line) => line.map(([lon, lat]) => ({ lon, lat })));
}
function miles(meters: number): string { return `${(meters / 1609.344).toFixed(1)} mi`; }
function nameOf(hike: HikeRecord): string { return hike.name ?? hike.ref ?? "Unnamed trail"; }
function useGeometry(id: string) {
  const [feature, setFeature] = useState<TrailFeature | null>(null);
  useEffect(() => { let active = true; fetch(`/api/hikes/geometry?id=${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() as Promise<TrailFeature> : null).then((f) => { if (active) setFeature(f); }).catch(() => undefined); return () => { active = false; }; }, [id]);
  return feature;
}
function TrailMap({ feature, thumbnail = false }: { feature: TrailFeature | null; thumbnail?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
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
      const night = document.documentElement.dataset.theme === "night";
      const currentMap = new maplibregl.Map({ container: ref.current, style: `https://tiles.openfreemap.org/styles/${night ? "dark" : "liberty"}`, interactive: !thumbnail, attributionControl: thumbnail ? false : {} });
      map = currentMap;
      const geometry = feature.geometry;
      currentMap.on("load", () => {
        if (!map) return;
        map.addSource("trail", { type: "geojson", data: { type: "Feature", properties: {}, geometry } });
        map.addLayer({ id: "trail-casing", type: "line", source: "trail", paint: { "line-color": "#ffffff", "line-width": thumbnail ? 5 : 7 } });
        map.addLayer({ id: "trail-line", type: "line", source: "trail", paint: { "line-color": "#7b4fa0", "line-width": thumbnail ? 3 : 4 } });
      });
      const bounds = new maplibregl.LngLatBounds();
      for (const line of linesOf(feature)) for (const point of line) bounds.extend([point.lon, point.lat]);
      if (!bounds.isEmpty()) currentMap.fitBounds(bounds, { padding: thumbnail ? 12 : 35, maxZoom: 15, duration: 0 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [feature, thumbnail, visible]);
  return <div className={thumbnail ? "og-hike__thumb" : "og-hike__map"} ref={ref} role="img" aria-label={feature ? "Map of trail" : "Trail map unavailable"}>{!feature && <span>Map unavailable</span>}</div>;
}
function HikeCard({ hike, origin }: { hike: HikeRecord; origin: Coordinate }) {
  const feature = useGeometry(hike.id);
  const distance = haversine(origin, hike.start);
  return <Link className="og-hike__card" href={`/explore/hikes/${encodeURIComponent(hike.id)}`}>
    <TrailMap feature={feature} thumbnail />
    <span className="og-hike__card-body"><strong>{nameOf(hike)}</strong><span>{miles(distance)} to start</span><span>{miles(hike.lengthMeters)} · {hike.elevationGainMeters === null ? "— gain" : `${Math.round(hike.elevationGainMeters * 3.28084)} ft gain`} · — time</span><span>Difficulty: {hike.sacScale ?? "unknown"}</span></span>
  </Link>;
}

type Filters = { length: string; gain: string; time: string; shape: string; dogs: boolean; waterfalls: boolean; views: boolean; kids: boolean };
const initial: Filters = { length: "", gain: "", time: "", shape: "", dogs: false, waterfalls: false, views: false, kids: false };
export function HikeExplore() {
  const [origin, setOrigin] = useState<Coordinate | null>(null);
  const [hikes, setHikes] = useState<HikeRecord[]>([]);
  const [status, setStatus] = useState("Choose your location to find nearby hikes.");
  const [filters, setFilters] = useState(initial);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(20);
  function locate() {
    if (!navigator.geolocation) { setStatus("Location is unavailable on this device."); return; }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(({ coords }) => setOrigin({ lon: coords.longitude, lat: coords.latitude }), () => setStatus("Location unavailable. Allow location access to find nearby hikes."));
  }
  useEffect(() => { if (navigator.permissions?.query) void navigator.permissions.query({ name: "geolocation" }).then((p) => { if (p.state === "granted") locate(); }).catch(() => undefined); }, []);
  useEffect(() => {
    if (!origin) return;
    let active = true;
    const bbox = [origin.lon - 0.5, origin.lat - 0.4, origin.lon + 0.5, origin.lat + 0.4].join(",");
    fetch(`/api/hikes?bbox=${bbox}`).then(async (r) => { if (!r.ok) throw new Error(); return r.json() as Promise<{ enabled: boolean; hikes: HikeRecord[] }>; }).then((data) => { if (active) { setHikes(data.hikes); setStatus(data.enabled ? "" : "Hike catalog is not configured."); } }).catch(() => { if (active) setStatus("Hike catalog unavailable. Try again later."); });
    return () => { active = false; };
  }, [origin]);
  const results = useMemo(() => origin ? hikes.filter((h) => {
    if (filters.length && h.lengthMeters > Number(filters.length) * 1609.344) return false;
    if (filters.gain && (h.elevationGainMeters === null || h.elevationGainMeters > Number(filters.gain) / 3.28084)) return false;
    if (filters.time || filters.shape || filters.waterfalls || filters.views) return false;
    if (filters.dogs && h.dog !== "yes" && h.dog !== "leashed") return false;
    if (filters.kids && !(h.lengthMeters <= 4828 && h.elevationGainMeters !== null && h.elevationGainMeters <= 152.4 && h.sacScale === "hiking")) return false;
    return true;
  }).sort((a, b) => haversine(origin, a.start) - haversine(origin, b.start)) : [], [origin, hikes, filters]);
  const update = (key: keyof Filters, value: string | boolean) => setFilters((old) => ({ ...old, [key]: value }));
  return <main id="main" className="og-explore og-hike"><AppBar current="/explore" /><header className="og-explore__header"><div className="og-explore__heading-row"><div><h1>Explore hikes</h1><p className="og-hike__sub">Find a trail near you</p></div><AppMenu className="og-page-menu" /></div><div className="og-hike__tools"><button onClick={locate}>⌖ {origin ? "Update location" : "Use my location"}</button><button onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>Filters {showFilters ? "−" : "+"}</button></div></header>
    {showFilters && <section className="og-hike__filters" aria-label="Hike filters"><label>Length<select value={filters.length} onChange={(e) => update("length", e.target.value)}><option value="">Any length</option><option value="3">Up to 3 mi</option><option value="5">Up to 5 mi</option><option value="10">Up to 10 mi</option></select></label><label>Gain<select value={filters.gain} onChange={(e) => update("gain", e.target.value)}><option value="">Any gain</option><option value="500">Up to 500 ft</option><option value="1000">Up to 1,000 ft</option></select></label><label>Time<select value={filters.time} onChange={(e) => update("time", e.target.value)}><option value="">Any time</option><option value="2">Up to 2 hours</option><option value="4">Up to 4 hours</option></select></label><label>Route type<select value={filters.shape} onChange={(e) => update("shape", e.target.value)}><option value="">Any type</option><option value="loop">Loop</option><option value="out-back">Out and back</option></select></label>{([ ["dogs", "Dogs allowed"], ["waterfalls", "Waterfalls"], ["views", "Views"], ["kids", "Kid-friendly"] ] as const).map(([key, label]) => <label className="og-hike__check" key={key}><input type="checkbox" checked={filters[key]} onChange={(e) => update(key, e.target.checked)} />{label}</label>)}<p>Filters only match known catalog facts. Elevation, time, route type and features are not yet in this catalog.</p><button onClick={() => setFilters(initial)}>Clear filters</button></section>}
    <section className="og-hike__results" aria-live="polite">{status && <p>{status}</p>}{origin && !status && <><p className="og-hike__count">{results.length} trails · sorted by distance to start</p>{results.length === 0 && <p>No matching trails with known data.</p>}{results.slice(0, limit).map((h) => <HikeCard key={h.id} hike={h} origin={origin} />)}{results.length > limit && <button onClick={() => setLimit((previous) => previous + 20)}>Show more trails</button>}</>}</section>
  </main>;
}

export function HikeDetail({ id }: { id: string }) {
  const router = useRouter();
  const feature = useGeometry(id);
  const [hike, setHike] = useState<HikeRecord | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { let active = true; fetch(`/api/hikes?id=${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() as Promise<{ hikes: HikeRecord[] }> : Promise.reject()).then((data) => { if (active) { setHike(data.hikes[0] ?? null); if (!data.hikes[0]) setStatus("Trail not found."); } }).catch(() => { if (active) setStatus("Trail catalog unavailable."); }); return () => { active = false; }; }, [id]);
  const lines = useMemo(() => feature ? linesOf(feature) : [], [feature]);
  const source = useMemo(() => createMapterhornElevationSource(), []);
  const elevation = useElevationProfile(source, lines.length === 1 ? id : null, lines[0] ?? []);
  const profile = elevation?.status === "ready" ? elevation.profile : null;
  const seconds = profile?.points.slice(1).reduce((total, point, index) => {
    const previous = profile.points[index]!;
    const distance = point.distanceMeters - previous.distanceMeters;
    return total + (distance > 0 ? (toblerSeconds(distance, (point.elevationMeters - previous.elevationMeters) / distance) ?? 0) : 0);
  }, 0) ?? null;
  const time = seconds === null ? "—" : `~${Math.max(1, Math.round(seconds / 60))} min`;
  async function openBreadcrumb() {
    const line = lines[0];
    if (lines.length !== 1 || !line || line.length < 2 || !hike) return;
    try {
      const now = new Date().toISOString();
      const base = createRideDocument({ now, title: nameOf(hike), provenance: { type: "catalog", sourceId: hike.id } });
      const first = line[0]!; const last = line[line.length - 1]!;
      const applied = applyRideCommand(base, { type: "breadcrumb.set", commandId: newCommandId(), rideId: base.rideId, baseRevision: base.revision, source: "map", label: "Open trail as breadcrumb", breadcrumb: { waypoints: [{ id: "trail-start", coordinate: first }, { id: "trail-end", coordinate: last }], legs: [{ kind: "recorded", geometry: line }] } }, { now });
      if (applied.outcome !== "applied") throw new Error();
      const saved = await createRideRepository().saveRide(applied.document, { writerToken: `hike-${crypto.randomUUID()}` });
      if (!saved.ok) throw new Error();
      router.push("/");
    } catch { setStatus("Could not open this trail as a breadcrumb."); }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: hike ? nameOf(hike) : "Trail", url: window.location.href }); else { await navigator.clipboard.writeText(window.location.href); setStatus("Trail link copied."); } } catch { setStatus("Could not share the trail link."); }
  }
  return <main id="main" className="og-explore og-hike"><AppBar current="/explore" /><div className="og-hike__detail"><div className="og-hike__detail-top"><Link href="/explore" className="og-hike__back">‹ Explore hikes</Link><AppMenu className="og-page-menu" /></div>{hike ? <><div className="og-hike__title"><p>TRAIL GUIDE</p><h1>{nameOf(hike)}</h1><span>{hike.operator ?? "Operator unknown"}</span></div><TrailMap feature={feature} /><div className="og-hike__stats"><div><strong>{miles(hike.lengthMeters)}</strong><span>Length</span></div><div><strong>{profile ? `${Math.round(profile.climbMeters * 3.28084)} ft` : hike.elevationGainMeters === null ? "—" : `${Math.round(hike.elevationGainMeters * 3.28084)} ft`}</strong><span>Gain</span></div><div><strong>{time}</strong><span>Time</span></div></div><section className="og-hike__section"><h2>About this trail</h2><p><strong>Difficulty: {hike.sacScale ?? "unknown"}.</strong> {hike.sacScale ? "This is the mapped OSM hiking scale; terrain and conditions can vary." : "The catalog has no difficulty rating for this trail."}</p><p>{profile ? "Estimated with Tobler’s hiking function using terrain elevation and grade. Surface, conditions and your pace are not included." : "Time unknown. Tobler’s hiking function needs elevation and grade along the trail."}</p><p>Dogs: {hike.dog ?? "unknown"} · Surface: {hike.surface ?? "unknown"}</p></section><section className="og-hike__section"><h2>Elevation profile</h2>{elevation ? <ElevationProfileChart state={elevation} line={lines[0]} /> : <p>Elevation data is unavailable for multipart trails.</p>}</section><section className="og-hike__section"><h2>Trailhead &amp; parking</h2>{hike.trailheads.length ? hike.trailheads.map((head, i) => <p key={i}>{head.name ?? (head.kind === "parking" ? "Parking" : "Trailhead")} · {Math.round(head.distanceMeters)} m from a trail end<br /><span>{head.coordinate.lat.toFixed(5)}, {head.coordinate.lon.toFixed(5)}</span></p>) : <p>Trailhead and parking unknown.</p>}</section><section className="og-hike__section"><h2>Along the way</h2><p>Features have not been mapped in this catalog.</p></section><section className="og-hike__section"><h2>Sources</h2><p>Operator: {hike.operator ?? "unknown"}</p>{hike.sources.map((source) => <p key={`${source.sourceId}-${source.recordId}`}>{source.url ? <a href={source.url}>{source.sourceLabel} · {source.recordId} ↗</a> : `${source.sourceLabel} · ${source.recordId}`}</p>)}</section><div className="og-hike__actions"><button className="og-hike__primary" onClick={() => void openBreadcrumb()} disabled={lines.length !== 1}>Open as breadcrumb</button>{feature && lines.length !== 1 && <p>This trail has multiple separate segments; breadcrumb opening is not available for it yet.</p>}<button disabled>Download for offline</button><p>Trail corridor downloads are not available yet.</p><button onClick={() => void share()}>Share</button></div></> : <p>{status || "Loading trail…"}</p>}{status && hike && <p role="status">{status}</p>}</div></main>;
}
