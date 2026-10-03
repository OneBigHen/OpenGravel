import { clipLineToBounds } from "@/application/map-layers/clip-line";
import type { InfoFeature, MapLayerBounds, MapLayerId } from "@/application/map-layers";
import type { SourceOutcome } from "@/application/route-intelligence/coordinator";
import { inSeason, isActive } from "@/application/route-intelligence/policy";
import { roadAuthorityFromEnv } from "@/server/planning/road-authority";
import type { LayerProvider } from "@/server/map-layers/providers";

/** Presentation only: consumes the very snapshots assessed by routing, with no new ingestion. */
export function projectAuthority(outcomes: readonly SourceOutcome[], layers: readonly MapLayerId[], at: string, bounds?: MapLayerBounds): readonly InfoFeature[] {
  return outcomes.flatMap(({ info, snapshot }) => snapshot.records.flatMap((record): InfoFeature[] => {
    const designation = record.kind === "motor-vehicle-designation";
    const layerId = designation ? "mvum" : "work-zones";
    if (!layers.includes(layerId) || (!designation && !isActive(record, at))) return [];
    let state = "access unknown";
    let weight = 0.5;
    if (designation) {
      const access = record.motorcycleAccess;
      if (access?.status === "closed") { state = "motorcycles prohibited by designation"; weight = 0; }
      else if (access?.status === "open") {
        if (access.seasons === null) { state = "motorcycles designated, year-round"; weight = 1; }
        else if (access.seasons.length === 0) state = "motorcycles designated; season dates unknown";
        else {
          const windows = access.seasons.map((season) => `${season.startMonth}/${season.startDay}–${season.endMonth}/${season.endDay}`).join(", ");
          const open = inSeason(access.seasons, at);
          state = `${open ? "within" : "outside"} published season (${windows}); UTC date ${at.slice(0, 10)}`;
          weight = open ? 1 : 0;
        }
      }
    } else state = `${record.kind}${record.allLanesClosed === true ? "; all lanes reported closed" : ""}; from ${record.validFrom ?? "unknown"} until ${record.validUntil ?? "unknown"}`;
    const projected: InfoFeature = {
      id: `authority:${record.sourceId}:${record.sourceRecordId}`, layerId,
      name: designation ? record.roadName ?? "MVUM designation" : `${record.kind === "closure" || record.allLanesClosed === true ? "Reported closure" : record.kind === "restriction" ? "Restriction" : "Work zone"} · ${record.roadName ?? "Road name unknown"}`,
      detail: `${info.label} · ${state} · ${record.description} · retrieved ${snapshot.fetchedAt ?? "unknown"}${snapshot.status === "stale" ? " (stale)" : ""}. ${designation ? "Legal designation is not proof of current passability." : "Unreported areas remain unknown."}`,
      weight,
      geometry: record.geometry.type === "point" ? { type: "Point", coordinates: [record.geometry.coordinate.lon, record.geometry.coordinate.lat] } : { type: "LineString", coordinates: record.geometry.coordinates.map((point) => [point.lon, point.lat] as const) },
    };
    if (bounds === undefined) return [projected];
    if (projected.geometry.type === "Point") {
      const [lon, lat] = projected.geometry.coordinates;
      return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north ? [projected] : [];
    }
    if (projected.geometry.type !== "LineString") return [];
    return clipLineToBounds(projected.geometry.coordinates, bounds).map((coordinates, index) => ({ ...projected, id: index === 0 ? projected.id : `${projected.id}:part${index}`, geometry: { type: "LineString" as const, coordinates } }));
  }));
}

export const authorityProvider: LayerProvider = {
  id: "authority", layers: ["mvum", "work-zones"], ttlMs: 60_000,
  async load() { return []; },
  async snapshot(bounds, layers, context) {
    const coordinator = roadAuthorityFromEnv(context.env);
    if (coordinator === null) throw new Error("Canonical road authority is disabled");
    const assessment = await coordinator.assess(bounds, context.signal ?? AbortSignal.timeout(10_000));
    const outcomes = assessment.sources.filter(({ info }) => layers.includes(info.facet === "access" ? "mvum" : "work-zones") && info.coverage.some((box) => box.west < bounds.east && box.east > bounds.west && box.south < bounds.north && box.north > bounds.south));
    const unavailable = outcomes.length === 0 || layers.some((layerId) => !outcomes.some(({ info }) => info.facet === (layerId === "mvum" ? "access" : "closures"))) || outcomes.some(({ snapshot }) => snapshot.status === "unavailable");
    return {
      features: projectAuthority(outcomes, layers, assessment.at, bounds), unavailable,
      freshness: layers.map((layerId) => {
        const relevant = outcomes.filter(({ info }) => info.facet === (layerId === "mvum" ? "access" : "closures"));
        const dates = relevant.flatMap(({ snapshot }) => snapshot.fetchedAt === null ? [] : [snapshot.fetchedAt]).sort();
        return { layerId, source: relevant.map(({ info }) => info.label).join(" / ") || "Canonical road authority", fetchedAt: dates[0] ?? assessment.at, observedAt: null, stale: relevant.some(({ snapshot }) => snapshot.status === "stale"), note: `Snapshot retrieval; individual source observation dates vary. ${unavailable ? "One or more requested authority sources unavailable. " : ""}Coverage is regional; unreported roads and coverage gaps remain unknown. Online only.` };
      }),
    };
  },
};
