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
  await expect(page.getByRole("textbox", { name: /Rename North Track/ })).toBeVisible();

  const exportMenu = page.getByRole("button", { name: "Export North Track" });
  await exportMenu.click();
  const plannedDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Planned route GPX" }).click();
  const plannedDownload = await plannedDownloadPromise;
  expect(plannedDownload.suggestedFilename()).toBe("opengravel-north-track-planned-route.gpx");
  const plannedBytes = await readFile((await plannedDownload.path())!);
  expect(plannedBytes.toString("utf8")).toContain("<rte>");

  await page.getByRole("textbox", { name: /Rename North Track/ }).fill("Original multi-track-gap");
  await page.getByRole("textbox", { name: /Rename North Track/ }).press("Enter");
  await expect(page.getByRole("textbox", { name: "Rename Original multi-track-gap" })).toBeVisible();

  await picker.setInputFiles({
    name: plannedDownload.suggestedFilename(),
    mimeType: "application/gpx+xml",
    buffer: plannedBytes,
  });
  await expect(page.getByRole("heading", { name: "Choose tracks" })).toBeVisible();
  await expect(page.getByText("North Track").first()).toBeVisible();
  await page.getByRole("button", { name: "Select none" }).click();
  const reimportTracks = page.getByRole("checkbox", { name: /Select North Track/ });
  await expect(reimportTracks).toHaveCount(2);
  await reimportTracks.first().check();
  await expect(page.locator(".og-import__tracks input[type=checkbox]:checked")).toHaveCount(1);
  await page.getByRole("button", { name: /import separately/i }).click();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();

  const originalMenu = page.getByRole("button", { name: "Export Original multi-track-gap" });
  await originalMenu.click();
  const originalDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Original file" }).click();
  const originalDownload = await originalDownloadPromise;
  const reExportedOriginal = await readFile((await originalDownload.path())!);
  expect(reExportedOriginal.equals(originalBytes)).toBe(true);
});
