import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE = path.resolve("tests/fixtures/import/multi-track-gap.gpx");

test("imports a gapped multi-track GPX, exports, and preserves the original bytes", async ({ page }) => {
  const originalBytes = await readFile(FIXTURE);
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
  await expect(page.getByRole("button", { name: /import as one ride/i })).toBeDisabled();

  await page.getByLabel("Select South Track").uncheck();
  await page.getByRole("button", { name: /import separately/i }).click();
  await expect(page.getByRole("radio", { name: /follow original track/i })).toBeChecked();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
  await expect(page.getByText(/warnings kept with this import/i)).toBeVisible();
  await expect(page.getByText(/Preserved 1 GPX waypoint as metadata; they are not merged into the source track geometry\./i)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Choose tracks" })).toBeVisible();
  await expect(page.getByText("North Track").first()).toBeVisible();
  const reimportTracks = page.getByRole("checkbox", { name: /Select North Track/ });
  await expect(reimportTracks).toHaveCount(1);
  await page.getByRole("button", { name: /import separately/i }).click();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();

  await page.getByRole("button", { name: "More actions for Original multi-track-gap" }).click();
  await page.getByRole("menuitem", { name: "Other formats" }).click();
  const originalDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Original file" }).click();
  const originalDownload = await originalDownloadPromise;
  const reExportedOriginal = await readFile((await originalDownload.path())!);
  expect(reExportedOriginal.equals(originalBytes)).toBe(true);
});
