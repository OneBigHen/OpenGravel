/**
 * Provider secrets stay on the server (ROUTE-INTELLIGENCE-PROVIDER-MESH §12):
 * only `src/server` may read them, no `NEXT_PUBLIC_` twin may exist, and no
 * client module ("use client") may name them. Next.js inlines only
 * `NEXT_PUBLIC_*` into browser bundles, so these rules keep every key below
 * out of the client bundle.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const SECRETS = [
  "AIRNOW_API_KEY",
  "NASA_FIRMS_MAP_KEY",
  "DATA_GOV_API_KEY",
  "MAPILLARY_ACCESS_TOKEN",
  "MAPILLARY_CLIENT_SECRET",
  "PTC_WZDX_API_KEY",
  "TICKETMASTER_API_KEY",
];

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx|js|mjs)$/.test(entry) ? [full] : [];
  });
}

describe("provider secrets are server-only", () => {
  const sources = files(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, "utf8") }));

  it.each(SECRETS)("%s is read only under src/server and never as NEXT_PUBLIC_", (secret) => {
    const readers = sources.filter((source) => source.text.includes(secret)).map((source) => source.file);
    expect(readers.filter((file) => !file.startsWith("server/"))).toEqual([]);
    expect(sources.filter((source) => source.text.includes(`NEXT_PUBLIC_${secret}`))).toEqual([]);
  });

  it("no client module names a provider secret", () => {
    const client = sources.filter((source) => /^\s*["']use client["']/m.test(source.text));
    expect(client.filter((source) => SECRETS.some((secret) => source.text.includes(secret))).map((source) => source.file)).toEqual([]);
  });
});
