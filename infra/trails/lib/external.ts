/**
 * USFS National Forest System Trails and NPS trails adapters.
 *
 * Both datasets are public domain and are published as GeoJSON with their own
 * attribute spelling (`TRAIL_NAME`, `TRAIL_NO`, …). Each field is mapped from a
 * list of candidate keys, and anything not present stays `null` — an agency
 * export that never mentions a surface leaves the surface unknown rather than
 * assumed.
 */

import {
  linesFromGeometry,
  linesLengthMeters,
} from "./geometry";
import type { OsmFeature } from "./osm-input";
import { readFeatureFile } from "./osm-input";
import type { TrailAttributes, TrailCandidate, TrailSourceId } from "./types";

export interface ExternalSourceSpec {
  readonly sourceId: Extract<TrailSourceId, "usfs" | "nps">;
  readonly sourceLabel: string;
  readonly nameKeys: readonly string[];
  readonly refKeys: readonly string[];
  readonly operatorKeys: readonly string[];
  readonly surfaceKeys: readonly string[];
  readonly sacScaleKeys: readonly string[];
  readonly dogKeys: readonly string[];
  readonly accessKeys: readonly string[];
  readonly visibilityKeys: readonly string[];
  readonly recordIdKeys: readonly string[];
  /** Values that mean "not a trail on the ground"; such features are skipped. */
  readonly statusKeys: readonly string[];
  readonly nonExistingStatuses: readonly string[];
}

const TRAIL_STATUS_NOT_ON_GROUND = ["PROPOSED", "PLANNED", "DECOMMISSIONED", "DECOMMISSIONED CLOSED", "CLOSED"];

export const USFS_TRAILS: ExternalSourceSpec = {
  sourceId: "usfs",
  sourceLabel: "USDA Forest Service",
  nameKeys: ["trail_name", "trailname", "name"],
  refKeys: ["trail_no", "trailno", "trail_number", "ref"],
  operatorKeys: ["admin_org", "managing_org", "operator", "forest_name"],
  surfaceKeys: ["surface", "trail_surface"],
  sacScaleKeys: ["sac_scale"],
  dogKeys: ["dog"],
  accessKeys: ["access", "restrictions"],
  visibilityKeys: ["trail_visibility", "trail_class"],
  recordIdKeys: ["trail_no", "trailno", "trail_number", "objectid", "gis_id"],
  statusKeys: ["trail_status", "status"],
  nonExistingStatuses: TRAIL_STATUS_NOT_ON_GROUND,
};

export const NPS_TRAILS: ExternalSourceSpec = {
  sourceId: "nps",
  sourceLabel: "National Park Service",
  nameKeys: ["name", "trailname", "trail_name", "label"],
  refKeys: ["ref", "trail_no", "trailno", "route_id"],
  operatorKeys: ["operator", "parkname", "unit_name", "managing_org"],
  surfaceKeys: ["surface", "trail_surface"],
  sacScaleKeys: ["sac_scale"],
  dogKeys: ["dog", "pets"],
  accessKeys: ["access", "restrictions"],
  visibilityKeys: ["trail_visibility", "trail_class"],
  recordIdKeys: ["objectid", "fid", "route_id", "globalid"],
  statusKeys: ["status", "trail_status"],
  nonExistingStatuses: TRAIL_STATUS_NOT_ON_GROUND,
};

/** Case-insensitive property lookup: agency exports are not consistent about case. */
export function propertyValue(properties: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    for (const [name, raw] of Object.entries(properties)) {
      if (name.toLowerCase() !== key) continue;
      if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    }
  }
  return null;
}

export function attributesOf(properties: Record<string, unknown>, spec: ExternalSourceSpec): TrailAttributes {
  return {
    name: propertyValue(properties, spec.nameKeys),
    ref: propertyValue(properties, spec.refKeys),
    operator: propertyValue(properties, spec.operatorKeys),
    sacScale: propertyValue(properties, spec.sacScaleKeys),
    surface: propertyValue(properties, spec.surfaceKeys),
    trailVisibility: propertyValue(properties, spec.visibilityKeys),
    dog: propertyValue(properties, spec.dogKeys),
    access: propertyValue(properties, spec.accessKeys),
  };
}

export interface ExternalIngest {
  readonly trails: readonly TrailCandidate[];
  readonly skippedNotOnGround: number;
}

export function ingestExternal(features: readonly OsmFeature[], spec: ExternalSourceSpec): ExternalIngest {
  const trails: TrailCandidate[] = [];
  let skippedNotOnGround = 0;
  features.forEach((feature, index) => {
    const properties = feature.properties;
    const status = propertyValue(properties, spec.statusKeys)?.toUpperCase() ?? null;
    if (status !== null && spec.nonExistingStatuses.includes(status)) {
      skippedNotOnGround += 1;
      return;
    }
    const lines = linesFromGeometry(feature.geometry);
    if (lines.length === 0) return;
    const attributes = attributesOf(properties, spec);
    if (attributes.name === null && attributes.ref === null) return;
    const recordId =
      propertyValue(properties, spec.recordIdKeys) ?? `${spec.sourceId}-${(index + 1).toString()}-${Math.round(linesLengthMeters(lines))}`;
    trails.push({
      sourceId: spec.sourceId,
      recordId,
      // Agency downloads are not per-record pages: no URL is better than a guess.
      url: null,
      lines,
      attributes,
    });
  });
  return { trails, skippedNotOnGround };
}

export async function readExternalSource(path: string, spec: ExternalSourceSpec): Promise<ExternalIngest> {
  return ingestExternal(await readFeatureFile(path), spec);
}
