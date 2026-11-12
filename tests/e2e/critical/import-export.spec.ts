import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ONE_TRACK = path.resolve("tests/fixtures/import/loop.gpx");
const MULTI_TRACK = path.resolve("tests/fixtures/import/multi-track-gap.gpx");

/** The words that belong inside "More import options", never on the plain flow. */
const SPEC_WORDS = [/breadcrumb/i, /geometry/i, /metadata/i, /source of truth/i];

test("a file with one line is one tap to a ready ride, with the extra words kept away", async ({ page }) => {
  await page.goto("/rides");

  // The page speaks in plain words until the rider opens the one closed line.
  for (const word of SPEC_WORDS) await expect(page.getByText(word)).toHaveCount(0);
  await page.getByRole("button", { name: "More import options" }).click();
  await expect(page.getByRole("heading", { name: "Import older saved rides" })).toBeVisible();
  for (const word of SPEC_WORDS) await expect(page.getByText(word)).toHaveCount(0);
  await page.getByRole("button", { name: "More import options" }).click();
  await expect(page.getByRole("heading", { name: "Import older saved rides" })).toHaveCount(0);

  // Choose the file and nothing else: it is saved and opened on the map.
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles(ONE_TRACK);
  await expect(page).toHaveURL(/\/$/);
  // One line of confirmation, in the rider's words.
  await expect(page.getByTestId("status-line")).toContainText("Added: Hilltop loop", { timeout: 30_000 });
  await expect(page.getByTestId("start-ride")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(1);
  await expect(page.getByTestId("route-distance")).not.toHaveText("");
  for (const word of SPEC_WORDS) await expect(page.getByText(word)).toHaveCount(0);

  // It is in My rides under the file's own name.
  await page.goto("/rides");
  await expect(page.getByRole("button", { name: "Open Hilltop loop" })).toBeVisible();
});

test("a file with several lines is a list, one Add button, and a plain confirmation", async ({ page }) => {
  const originalBytes = await readFile(MULTI_TRACK);
  await page.goto("/rides");

  const picker = page.getByLabel("Import GPX, KML, or KMZ");
  await picker.setInputFiles({
    name: "Multi Track & <Gap>.gpx",
    mimeType: "application/gpx+xml",
    buffer: originalBytes,
  });
  await expect(page.getByRole("heading", { name: "Choose tracks" })).toBeVisible();
  await expect(page.getByText("North Track")).toBeVisible();
  await expect(page.getByText("South Track")).toBeVisible();
  // One list, one button: no second import decision on the surface.
  const addBoth = page.getByRole("button", { name: "Add 2 rides" });
  await expect(addBoth).toBeEnabled();
  for (const word of SPEC_WORDS) await expect(page.getByText(word)).toHaveCount(0);

  // The one-ride and road-route choices stay behind More import options; this
  // file's tracks are 150 km apart, so they cannot be one ride.
  await page.getByRole("button", { name: "More import options" }).click();
  await expect(page.getByRole("button", { name: "Add them as one ride" })).toBeDisabled();
  await expect(page.getByText(/within the gap tolerance/i)).toBeVisible();

  await page.getByLabel("Select South Track").uncheck();
  await page.getByRole("button", { name: "Add 1 ride" }).click();
  await expect(page.getByTestId("import-result")).toHaveText("Added: North Track, 0.1 mi");

  // The waypoint note and the original file live behind the closed line.
  for (const word of SPEC_WORDS) await expect(page.getByText(word)).toHaveCount(0);
  await page.getByRole("button", { name: "More import options" }).click();
  await expect(page.getByText(/Preserved 1 GPX waypoint as metadata/i)).toBeVisible();
  await expect(page.getByText(/original file stays available/i)).toBeVisible();
  // RS-06: the ride is named after the chosen track, not the file.
  await expect(page.getByRole("button", { name: "Open North Track" })).toBeVisible();

  await page.getByRole("button", { name: "More actions for North Track" }).click();
  await page.getByRole("menuitem", { name: "Other formats" }).click();
  const plannedDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "GPX route" }).click();
  const plannedDownload = await plannedDownloadPromise;
  expect(plannedDownload.suggestedFilename()).toBe("opengravel-north-track-planned-route.gpx");
  const plannedBytes = await readFile((await plannedDownload.path())!);
  const plannedXml = plannedBytes.toString("utf8");
  expect(plannedXml).toContain("<rte>");
  // The line is written once. A route file that also carried the same <trk>
  // re-imported as two identical tracks and forced a chooser between them.
  expect(plannedXml).not.toContain("<trk>");
  expect(plannedXml.match(/<rtept[\s>/]/g)?.length ?? 0).toBeLessThanOrEqual(250);

  await page.getByRole("button", { name: "More actions for North Track" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Rename North Track" }).fill("Original multi-track-gap");
  await page.getByRole("textbox", { name: "Rename North Track" }).press("Enter");
  await expect(page.getByRole("button", { name: "Open Original multi-track-gap" })).toBeVisible();

  await picker.setInputFiles({
    name: plannedDownload.suggestedFilename(),
    mimeType: "application/gpx+xml",
    buffer: plannedBytes,
  });
  // The exported route has one line, so it is one tap straight to the map.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("start-ride")).toBeEnabled({ timeout: 30_000 });
  await page.goto("/rides");

  await page.getByRole("button", { name: "More actions for Original multi-track-gap" }).click();
  await page.getByRole("menuitem", { name: "Other formats" }).click();
  const originalDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Original file" }).click();
  const originalDownload = await originalDownloadPromise;
  const reExportedOriginal = await readFile((await originalDownload.path())!);
  expect(reExportedOriginal.equals(originalBytes)).toBe(true);
});
