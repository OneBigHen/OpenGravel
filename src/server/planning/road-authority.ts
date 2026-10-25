/**
 * Server composition for road authority (route intelligence RI-1).
 *
 * Off unless `OGV_ROAD_AUTHORITY=on`: no deployment needs a new credential or
 * network dependency to plan (§17). When on, the sources that need no key
 * (USFS MVUM, PA Game Commission roads, PA DCNR seasonal forest roads,
 * NJ Fish & Wildlife WMA roads, and every keyless state WZDx feed in the
 * USDOT registry) are live; the Pennsylvania Turnpike WZDx feed is composed
 * only when `PTC_WZDX_API_KEY` is set, so a deployment without the key never
 * asks for it and never reports it as a failure.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createRoadAuthorityCoordinator,
  type RoadAuthorityCoordinator,
} from "@/application/route-intelligence/coordinator";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type { AuthorityFeedSnapshot } from "@/application/route-intelligence/types";
import { createDcnrSeasonalRoadsSource } from "@/infrastructure/route-intelligence/pa-dcnr/dcnr-seasonal-source";
import { createPgcSeasonalRoadsSource } from "@/infrastructure/route-intelligence/pa-pgc/pgc-source";
import { createNjWmaRoadsSource } from "@/infrastructure/route-intelligence/nj-wma/wma-road-source";
import { createMvumSource } from "@/infrastructure/route-intelligence/usfs-mvum/mvum-source";
import { createWzdxRegistrySource, type WzdxRegistryListing, type WzdxRegistryStore } from "@/infrastructure/route-intelligence/wzdx/wzdx-registry-source";
import { createWzdxSource } from "@/infrastructure/route-intelligence/wzdx/wzdx-source";

type Env = Readonly<Record<string, string | undefined>>;

const PTC_WZDX_URL = "https://atms.paturnpike.com/api/WzDXWorkZoneFeed";

/** One JSON file per snapshot key, so a restart can answer before any network call. */
function fileStore<T>(directory: string, prefix: string) {
  const file = (key: string): string => path.join(directory, `${prefix}-${key.replace(/[^0-9A-Za-z.:_-]/g, "").replace(/:/g, "_")}.json`);
  return {
    async read(key: string) {
      try {
        return JSON.parse(await readFile(file(key), "utf8")) as T;
      } catch {
        return null;
      }
    },
    async write(key: string, value: T) {
      await mkdir(directory, { recursive: true });
      const target = file(key);
      await writeFile(`${target}.tmp`, JSON.stringify(value));
      await rename(`${target}.tmp`, target);
    },
  };
}

/** Registry listings and feed snapshots share the `wzdx-` file prefix with the MVUM cells kept apart. */
function wzdxStore(directory: string): WzdxRegistryStore {
  const registry = fileStore<WzdxRegistryListing>(directory, "wzdx");
  const feeds = fileStore<AuthorityFeedSnapshot>(directory, "wzdx");
  return {
    readRegistry: () => registry.read("registry"),
    writeRegistry: (value) => registry.write("registry", value),
    readFeed: (id) => feeds.read(`feed-${id}`),
    writeFeed: (id, value) => feeds.write(`feed-${id}`, value),
  };
}

export function roadAuthoritySourcesFromEnv(env: Env): readonly RoadAuthoritySource[] {
  const userAgent = env["NWS_USER_AGENT"]?.trim() || "OpenGravel (route intelligence)";
  const cacheDirectory = env["OGV_ROAD_AUTHORITY_CACHE_DIR"]?.trim();
  const directory = cacheDirectory === undefined || cacheDirectory === "" ? null : cacheDirectory;
  const ptcKey = env["PTC_WZDX_API_KEY"]?.trim();
  const sources: RoadAuthoritySource[] = [
    createMvumSource({
      userAgent,
      ...(directory === null ? {} : { store: fileStore<AuthorityFeedSnapshot>(directory, "mvum") }),
    }),
    createPgcSeasonalRoadsSource(),
    createDcnrSeasonalRoadsSource(),
    createNjWmaRoadsSource(),
    // Every keyless state feed in the USDOT registry (NJ, NY, MD, DE, NC,
    // New England and ~20 more).
    createWzdxRegistrySource({
      userAgent,
      ...(directory === null ? {} : { store: wzdxStore(directory) }),
    }),
  ];
  // No key, no source: an unconfigured feed is not a feed that failed.
  if (ptcKey !== undefined && ptcKey !== "") {
    sources.push(createWzdxSource({
      info: {
        id: "wzdx-ptc",
        label: "Pennsylvania Turnpike work zones",
        authority: "authoritative-operational",
        coverage: [{ west: -80.52, south: 39.72, east: -74.69, north: 42.27 }],
        precedence: 1,
      },
      url: `${PTC_WZDX_URL}?api_key=${encodeURIComponent(ptcKey)}`,
      userAgent,
      ...(directory === null ? {} : { store: fileStore<AuthorityFeedSnapshot>(directory, "wzdx-ptc") }),
    }));
  }
  return sources;
}

let shared: { readonly key: string; readonly coordinator: RoadAuthorityCoordinator | null } | null = null;

/** One coordinator per server process, so feed caches are shared across plans. */
export function roadAuthorityFromEnv(env: Env): RoadAuthorityCoordinator | null {
  // The key only decides whether to rebuild; it is never stored or logged.
  const key = [
    env["OGV_ROAD_AUTHORITY"],
    env["OGV_ROAD_AUTHORITY_CACHE_DIR"],
    env["PTC_WZDX_API_KEY"] === undefined ? "" : "ptc",
  ].join("|");
  if (shared?.key !== key) {
    const on = env["OGV_ROAD_AUTHORITY"]?.trim().toLowerCase() === "on";
    shared = { key, coordinator: on ? createRoadAuthorityCoordinator({ sources: roadAuthoritySourcesFromEnv(env) }) : null };
  }
  return shared.coordinator;
}
