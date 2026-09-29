import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { clickInRideSheet, openRideSheet } from "./ride-focus-helpers";

function distanceMiles(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

test.describe("recorded rides", () => {
  test("records a route-free ride, recovers after reload, saves it and exports GPX", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      longitude: -75.44,
      latitude: 40.14,
      accuracy: 5,
    });

    await page.goto("/");
    await page.getByTestId("record-a-ride").click();
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("ride-activity")).toHaveText("Recording");
    await expect(page).toHaveURL(/\/ride$/);
    await openRideSheet(page);
    await expect(page.getByTestId("recording-hud")).toBeVisible();
    await expect(page.getByTestId("ride-gps")).toContainText(/GPS fix/);

    // Emulated GPS advances along a straight one-mile trace. Each step is more
    // than the position smoother's unsmoothed recovery threshold.
    for (let index = 1; index <= 22; index += 1) {
      await context.setGeolocation({
        longitude: -75.44 + index * 0.0015,
        latitude: 40.14,
        accuracy: 5,
      });
      await page.waitForTimeout(120);
    }
    await expect
      .poll(async () => distanceMiles(await page.getByTestId("recording-distance").innerText()))
      .toBeGreaterThan(1);

    await clickInRideSheet(page, "ride-pause", "ride-resume");
    await expect(page.getByTestId("ride-activity")).toHaveText("Paused");
    await page.getByTestId("ride-resume").click();
    await expect(page.getByTestId("ride-activity")).toHaveText("Recording");
    await context.setGeolocation({
      longitude: -75.44 + 23 * 0.0015,
      latitude: 40.14,
      accuracy: 5,
    });
    await page.waitForTimeout(1_100);

    await page.reload();
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("ride-activity")).toHaveText("Paused");
    await expect(page.getByTestId("ride-status")).toContainText("Recovered recording");
    await expect
      .poll(async () => distanceMiles(await page.getByTestId("recording-distance").innerText()))
      .toBeGreaterThan(0.5);
    await page.getByTestId("ride-resume").click();
    await page.getByTestId("ride-end").click();
    await page.getByTestId("ride-finish").click();
    await expect(page.getByTestId("ride-terminal")).toContainText("Recorded ride saved");

    await page.goto("/rides");
    const row = page.locator(".og-library__row").filter({ has: page.getByTestId("recorded-ride-summary") });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Recorded", { exact: true })).toBeVisible();
    await expect(row.getByTestId("recorded-track-thumbnail")).toBeVisible();
    await expect(row.getByTestId("recorded-ride-summary")).toContainText("moving");
    await expect(row.getByTestId("recorded-ride-summary")).toContainText("total");

    await row.getByRole("button", { name: "Export Recorded ride" }).click();
    const downloadPromise = page.waitForEvent("download");
    await row.getByRole("menuitem", { name: "Recorded ride GPX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.gpx$/i);
    const output = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(output);
    const gpx = await readFile(output, "utf8");
    expect(gpx).toContain("<trkpt");
    expect(gpx).toContain("<time>");
  });

  test("discards a recording only after explicit confirmation", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("record-a-ride").click();
    await expect(page.getByTestId("ride-activity")).toHaveText("Recording");
    await page.getByTestId("ride-end").click();
    await page.getByTestId("ride-discard").click();
    await expect(page.getByTestId("ride-terminal")).toContainText("Recording discarded");
    await page.reload();
    await expect(page.getByTestId("ride-recovery")).toContainText("no ride in progress");
  });
});
