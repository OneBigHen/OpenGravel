import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { PROVIDER_REGISTRY, providerStates } from "@/server/health/provider-registry";

const directories: string[] = [];
async function directory(): Promise<string> {
  const result = await mkdtemp(join(tmpdir(), "og-provider-"));
  directories.push(result);
  return result;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("provider registry", () => {
  it("declares every required connector exactly once and keeps unprobed services unknown", async () => {
    const states = await providerStates({ OGV_OFFLINE_REGION_ROOT: join(await directory(), "missing") });
    const ids = states.map((state) => state.id);
    expect(states.find((state) => state.id === "traffic-cameras")?.configurationKeys).toEqual(expect.arrayContaining(["PA511_VIDEO_ENABLED", "PA511_VIDEO_PROXY_SECRET", "TRAFFIC_CAMERA_VIDEO_PROXY_SECRET", "TRAFFIC_CAMERA_ALLOWED_ORIGINS_PA", "TRAFFIC_CAMERA_METADATA_ORIGINS_WV"]));
    for (const state of states) {
      expect(state.provenance).toEqual({ sourceId: state.id, sourceLabel: state.label });
      expect(state.failureBehavior.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(PROVIDER_REGISTRY.length);
    expect(ids).toEqual(expect.arrayContaining(["graphhopper", "photon", "valhalla", "tomtom", "nws", "curvature-db", "gravel-atlas", "places", "discover-osm", "wikimedia", "traffic-cameras", "road-authority", "spotify", "mapbox-token", "offline-regions", "advisor"]));
    expect(states.find((state) => state.id === "traffic-cameras")?.ttlMs).toBe(60_000);
    expect(states.find((state) => state.id === "overpass")?.ttlMs).toBe(3_600_000);
    expect(states.find((state) => state.id === "nws")?.cacheTtls["map-alerts"]).toBeGreaterThan(0);
    expect(states.find((state) => state.id === "nws")?.freshness).toBe("unknown");
    expect(states.filter((state) => state.required).map((state) => state.id)).toEqual(["graphhopper"]);
    expect(states.find((state) => state.id === "valhalla")).toMatchObject({ configured: false, status: "disabled" });
    for (const id of ["nws", "wikimedia", "photon"]) expect(states.find((state) => state.id === id)).toMatchObject({ configured: true, status: "unknown", lastSuccess: null });
  });

  it("requires Places credentials and reports camera/authority composition without credentials", async () => {
    const states = await providerStates({ OGV_PLACES_API_URL: "https://secret-service.invalid", TOMTOM_TRAFFIC_API_KEY: "secret-value", OGV_ROAD_AUTHORITY: " ON ", PTC_WZDX_API_KEY: "secret-value", TRAFFIC_CAMERAS_ENABLED: "1", TRAFFIC_CAMERAS_STATES: "PA,OH" });
    expect(states.find((state) => state.id === "places")).toMatchObject({ configured: false, status: "unconfigured" });
    expect(states.find((state) => state.id === "tomtom")).toMatchObject({ configured: true, status: "unknown" });
    expect(states.find((state) => state.id === "traffic-cameras")?.activeSources).toEqual(["PA"]);
    expect(states.find((state) => state.id === "road-authority")?.activeSources).toEqual(["usfs-mvum", "wzdx-states", "wzdx-ptc"]);
    expect(JSON.stringify(states)).not.toMatch(/secret-value|secret-service/);
  });

  it("distinguishes valid empty catalogues, missing files and invalid schemas", async () => {
    const root = await directory();
    const curvature = join(root, "curvature.sqlite");
    const database = new DatabaseSync(curvature);
    database.exec("create table segments (id text, name text, score real, geometry text, mid_lat real, mid_lon real)");
    database.close();
    const bad = join(root, "bad.sqlite");
    await writeFile(bad, "not a database");
    const states = await providerStates({ CURVATURE_DB_PATH: curvature, GRAVEL_ATLAS_DB_PATH: bad, OGV_DISCOVER_OSM_PLACES: join(root, "absent.json") });
    expect(states.find((state) => state.id === "curvature-db")).toMatchObject({ configured: true, status: "ok", evidence: "artifact", lastSuccess: null });
    expect(states.find((state) => state.id === "gravel-atlas")).toMatchObject({ configured: true, status: "unavailable", lastFailureCategory: "invalid-artifact" });
    expect(states.find((state) => state.id === "discover-osm")).toMatchObject({ status: "missing", lastFailureCategory: "missing-artifact" });
    expect(JSON.stringify(states)).not.toContain(root);
  });

  it("validates Discover index shape, including records, while permitting an empty built index", async () => {
    const file = join(await directory(), "index.json");
    await writeFile(file, JSON.stringify({ builtAt: "2026-10-02T00:00:00Z", places: [] }));
    expect((await providerStates({ OGV_DISCOVER_OSM_PLACES: file })).find((state) => state.id === "discover-osm")?.status).toBe("ok");
    await writeFile(file, JSON.stringify({ builtAt: "2026-10-02T00:00:00Z", places: [null] }));
    expect((await providerStates({ OGV_DISCOVER_OSM_PLACES: file })).find((state) => state.id === "discover-osm")?.status).toBe("unavailable");
    await writeFile(file, "{");
    expect((await providerStates({ OGV_DISCOVER_OSM_PLACES: file })).find((state) => state.id === "discover-osm")?.status).toBe("unavailable");
  });

  it("does not treat invalid/empty offline publication roots as available regions", async () => {
    const root = await directory();
    expect((await providerStates({ OGV_OFFLINE_REGION_ROOT: root })).find((state) => state.id === "offline-regions")?.status).toBe("missing");
    await mkdir(join(root, "pa-nj"));
    await writeFile(join(root, "pa-nj", "active.json"), JSON.stringify({ version: "../../private" }));
    expect((await providerStates({ OGV_OFFLINE_REGION_ROOT: root })).find((state) => state.id === "offline-regions")?.status).toBe("unavailable");
  });

  it("accepts valid active offline manifests without claiming tile delivery", async () => {
    const states = await providerStates({ OGV_OFFLINE_REGION_ROOT: resolve("tests/fixtures/offline-regions") });
    expect(states.find((state) => state.id === "offline-regions")).toMatchObject({ configured: true, status: "ok", evidence: "artifact" });
  });

  it("does not mistake a basemap selector for a Mapbox token", async () => {
    const states = await providerStates({ NEXT_PUBLIC_OGV_BASEMAP: "mapbox" });
    expect(states.find((state) => state.id === "mapbox-token")?.configured).toBe(false);
  });

  it("recognizes advisor alias keys and Spotify rider-owned client IDs without claiming provider health", async () => {
    const states = await providerStates({ OPENROUTER_API_KEY: "secret-value", OGV_SPOTIFY_SESSION_KEY: "ab".repeat(32), OGV_PUBLIC_ORIGIN: "https://opengravel.henning.rodeo" });
    for (const id of ["advisor", "spotify"]) expect(states.find((state) => state.id === id)).toMatchObject({ configured: true, status: "unknown" });
    expect(JSON.stringify(states)).not.toMatch(/secret-value|abababab/);
    expect((await providerStates({ OGV_SPOTIFY_SESSION_KEY: "bad", SPOTIFY_CLIENT_ID: "bad" })).find((state) => state.id === "spotify")?.configured).toBe(false);
  });
});
