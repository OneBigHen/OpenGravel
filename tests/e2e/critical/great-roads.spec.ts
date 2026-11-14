import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, test, type Page } from "@playwright/test";

import { decodeLine, splitSegments } from "../../../src/application/route-library/geometry";
import { lineLengthMeters } from "../../../src/application/map-layers/along";
import type { Coordinate } from "../../../src/domain/ride/types";
import { placeEndpoint, plannerMap, pressPlan, settledExtent } from "./map-helpers";

/**
 * Great roads show along a route that is already planned (L6).
 *
 * The server has the national library only while this file runs: the fixture
 * pack is copied to the path `playwright.config.ts` points it at, then removed.
 * The planned line is a real line from that pack (Lancaster County Loop Tour),
 * returned by the router fixture, so the browser is showing library geometry,
 * not a made-up shape.
 */
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
const FIXTURE = join(process.cwd(), "tests/fixtures/route-library/pack.sqlite");
const RIDE_ID = "pa-lancaster-county-loop-tour-ephrata-parkesburg-holtwood-marietta";
const RIDE_NAME = "Lancaster County Loop Tour";

test.setTimeout(120_000);
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(FIXTURE, PACK);
});

test.afterAll(() => {
  rmSync(dirname(PACK), { recursive: true, force: true });
});

/** The stored line of one real library ride, in travel order. */
function libraryLine(): readonly Coordinate[] {
  const db = new DatabaseSync(FIXTURE, { readOnly: true });
  try {
    const row = db.prepare("select line from ride where id = ?").get(RIDE_ID) as { line?: string } | undefined;
    if (row?.line === undefined) throw new Error(`fixture pack has no line for ${RIDE_ID}`);
    return splitSegments(row.line).flatMap((part) => decodeLine(part));
  } finally {
    db.close();
  }
}

/**
 * Answer the next plan with the library line. The fixture router's answer is
 * real in shape but not near any library ride, so this rewrites only its
 * geometry and its measured totals; the server still produced the envelope.
 */
async function planAlongTheLibrary(page: Page): Promise<void> {
  const line = libraryLine();
  const distanceMeters = lineLengthMeters(line.map((point) => [point.lon, point.lat] as const));
  const durationSeconds = distanceMeters / ((28 * 1609.344) / 3600);
  await page.route("**/api/route-plan", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as {
      readonly error?: unknown;
      readonly bundle?: { readonly candidates: readonly Record<string, unknown>[] };
    };
    if (body.error !== undefined || body.bundle === undefined) {
      await route.fulfill({ response, json: body });
      return;
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        bundle: {
          ...body.bundle,
          candidates: body.bundle.candidates.map((candidate) => ({
            ...candidate,
            geometry: line,
            distanceMeters,
            durationSeconds,
          })),
        },
      },
    });
  });
}

async function openFullSheet(page: Page): Promise<void> {
  const dock = page.getByTestId("planner-dock");
  for (let step = 0; step < 3; step += 1) {
    if ((await dock.getAttribute("data-detent")) === "full") return;
    await page.getByTestId("sheet-handle").click();
    await page.waitForTimeout(250);
  }
  await expect(dock).toHaveAttribute("data-detent", "full");
}

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const) {
  test(`a planned route names and draws its great roads at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await planAlongTheLibrary(page);

    // The plan itself is the fixture's endpoints; the line is the library's own.
    await placeEndpoint(page, "start", { lat: 40.1385, lon: -75.4385 });
    await placeEndpoint(page, "finish", { lat: 40.1325, lon: -75.4335 });
    await pressPlan(page);

    await openFullSheet(page);
    const section = page.getByTestId("great-roads-along");
    await expect(section).toBeAttached({ timeout: 45_000 });
    await section.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByRole("heading", { name: "Great roads near your route" })).toBeVisible();
    await expect(section).toContainText(`${RIDE_NAME}`);
    await expect(section).toContainText("Great ride · Twisty");
    await expect(section).toContainText("On route");
    await expect(section).toContainText("Route from");
    await expect(section.getByRole("link", { name: "Open" })).toHaveAttribute("href", `/explore/${RIDE_ID}`);

    // The same ride's own line is on the map: the overlay reports what it drew.
    await expect(page.getByTestId("great-roads-on-map")).toHaveAttribute("data-count", "1", { timeout: 20_000 });

    // Nothing runs off the phone: the row, the heading and the page stay inside.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const clipped = await section.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(clipped, "the great roads section fits the sheet").toBe(false);
    const shots = process.env.OG_SHOTS_DIR;
    if (shots !== undefined && shots !== "") await page.screenshot({ path: `${shots}/great-roads-${size.width}x${size.height}.png` });
  });
}
