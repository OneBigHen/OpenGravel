/**
 * Server composition for road authority (route intelligence RI-1).
 *
 * Off unless `OGV_ROAD_AUTHORITY=on`: no deployment needs a new credential or
 * network dependency to plan (§17). When on, the sources that need no key
 * (USFS MVUM, every keyless state WZDx feed in the USDOT registry) are
 * live; the Pennsylvania Turnpike WZDx feed joins when `PTC_WZDX_API_KEY` is
 * set.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createRoadAuthorityCoordinator,
  type RoadAuthorityCoordinator,
} from "@/application/route-intelligence/coordinator";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type { RoadAuthorityRecord } from "@/application/route-intelligence/types";
import { createMvumSource } from "@/infrastructure/route-intelligence/usfs-mvum/mvum-source";
import { createWzdxRegistrySource } from "@/infrastructure/route-intelligence/wzdx/wzdx-registry-source";
import { createWzdxSource } from "@/infrastructure/route-intelligence/wzdx/wzdx-source";

type Env = Readonly<Record<string, string | undefined>>;

const PTC_WZDX_URL = "https://atms.paturnpike.com/api/WZDxWorkZoneFeed";

function cellStore(directory: string) {
  const file = (key: string): string => path.join(directory, `mvum-${key.replace(/[^0-9.:-]/g, "").replace(/:/g, "_")}.json`);
  return {
    async read(key: string) {
      try {
        return JSON.parse(await readFile(file(key), "utf8")) as { fetchedAt: string; records: readonly RoadAuthorityRecord[] };
      } catch {
        return null;
      }
    },
    async write(key: string, value: { fetchedAt: string; records: readonly RoadAuthorityRecord[] }) {
      await mkdir(directory, { recursive: true });
      const target = file(key);
      await writeFile(`${target}.tmp`, JSON.stringify(value));
      await rename(`${target}.tmp`, target);
    },
  };
}

export function roadAuthoritySourcesFromEnv(env: Env): readonly RoadAuthoritySource[] {
  const userAgent = env["NWS_USER_AGENT"]?.trim() || "OpenGravel (route intelligence)";
  const cacheDirectory = env["OGV_ROAD_AUTHORITY_CACHE_DIR"]?.trim();
  const ptcKey = env["PTC_WZDX_API_KEY"]?.trim();
  return [
    createMvumSource({
      userAgent,
      ...(cacheDirectory === undefined || cacheDirectory === "" ? {} : { store: cellStore(cacheDirectory) }),
    }),
    // Every keyless state feed in the USDOT registry (NJ, NY, MD, DE, NC,
    // New England and ~20 more).
    createWzdxRegistrySource({ userAgent }),
    createWzdxSource({
      info: {
        id: "wzdx-ptc",
        label: "Pennsylvania Turnpike work zones",
        authority: "authoritative-operational",
        coverage: [{ west: -80.52, south: 39.72, east: -74.69, north: 42.27 }],
        precedence: 1,
      },
      url: ptcKey === undefined || ptcKey === "" ? null : `${PTC_WZDX_URL}?api_key=${encodeURIComponent(ptcKey)}`,
      userAgent,
    }),
  ];
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
