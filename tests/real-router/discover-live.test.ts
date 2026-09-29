/**
 * Discover against live Wikimedia and an optional built OSM index. Manual:
 * `OGV_DISCOVER_LIVE=1 npx vitest run --config vitest.realrouter.config.mts tests/real-router/discover-live.test.ts`
 * (optionally set OGV_DISCOVER_OSM_PLACES to a local index). Prints sample results.
 */
import { expect, it } from "vitest";
import { handleDiscoverCorridor, handleDiscoverNear } from "@/server/discover/handler";
const env = {
  ...(process.env.OGV_DISCOVER_OSM_PLACES === undefined ? {} : { OGV_DISCOVER_OSM_PLACES: process.env.OGV_DISCOVER_OSM_PLACES }),
  WIKIMEDIA_USER_AGENT: process.env.WIKIMEDIA_USER_AGENT ?? "OpenGravel/0.1 (https://github.com/OneBigHen/OpenGravel)",
};
const show = (label: string, r: { body: unknown }) => {
  const b = r.body as { places: { name: string; category: string; description: string | null; image: { license: string; author: string | null } | null; provenance: { sourceId: string }[]; distanceMeters?: number; detourMinutes?: number; facts: object }[]; sources: unknown[] };
  console.log(`\n== ${label}`, JSON.stringify(b.sources));
  for (const p of b.places.slice(0, 12)) console.log(` ${p.category.padEnd(12)} ${p.name} | ${p.distanceMeters ?? ""}${p.detourMinutes !== undefined ? ` ~${p.detourMinutes}min` : ""} | ${[...new Set(p.provenance.map((x) => x.sourceId))].join("+")} | img=${p.image ? `${p.image.license} by ${p.image.author}` : "-"} | ${JSON.stringify(p.facts)} | ${(p.description ?? "").slice(0, 70)}`);
};
it.skipIf(process.env["OGV_DISCOVER_LIVE"] !== "1")("live", async () => {
  let t = Date.now();
  const near = await handleDiscoverNear(new URL("https://x/?lat=40.5634&lon=-75.1293&radius=10000"), { env }, new AbortController().signal);
  show("near Ringing Rocks", near);
  expect((near.body as unknown as { places: unknown[] }).places.length).toBeGreaterThan(0);
  console.log("ms", Date.now() - t); t = Date.now();
  show("near Ringing Rocks (cached)", await handleDiscoverNear(new URL("https://x/?lat=40.5634&lon=-75.1293&radius=10000&limit=5"), { env }, new AbortController().signal));
  console.log("ms", Date.now() - t); t = Date.now();
  const line = [[-75.49, 40.6], [-75.35, 40.62], [-75.2, 40.66], [-75.05, 40.72]];
  show("corridor Allentown→Delaware", await handleDiscoverCorridor({ line, bufferMeters: 4000, categories: ["bridge", "waterfall", "quirky", "ruins", "viewpoint"] }, { env }, new AbortController().signal));
  console.log("ms", Date.now() - t);
}, 120000);
