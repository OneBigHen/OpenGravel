import { expect, test } from "@playwright/test";

test("imports a redacted SwitchBack saved-ride GPX and shows its migration report", async ({ page }) => {
  await page.goto("/rides");
  await page.getByText("Import older saved rides (advanced)", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import older saved rides" })).toBeVisible();
  await page.getByLabel("SwitchBack GPX files").setInputFiles([
    "tests/fixtures/m10/switchback-track-waypoints.gpx",
    "tests/fixtures/m10/switchback-route-only.gpx",
  ]);
  await page.getByRole("button", { name: "Import selected rides" }).click();

  const report = page.getByTestId("switchback-import-report");
  await expect(report).toContainText("Imported 1 of 2 rides");
  await expect(report.locator(".og-switchback-import__report-items > li")).toHaveCount(2);
  await expect(report.locator('[data-file-result="imported"]')).toContainText("Redacted sample loop");
  await expect(report.locator('[data-file-result="skipped"]')).toContainText("route and cue exports contain no saved route line");
  const rideNotes = report.getByRole("list", { name: "Notes for Redacted sample loop" });
  await expect(rideNotes).toContainText("stop-versus-shaping semantics");
  await expect(rideNotes).toContainText("bike profile");
  await expect(rideNotes).toContainText("sample route profile");

  await page.setViewportSize({ width: 844, height: 390 });
  // RS-12: the ordinary GPX import comes first now, so the report sits below
  // it; once scrolled to, it must still fit a landscape phone whole.
  await report.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await expect(page.getByRole("heading", { name: "Batch report" })).toBeInViewport({ ratio: 1 });
  await expect(rideNotes.locator("li").last()).toBeInViewport({ ratio: 1 });
  await expect(report.locator(".og-switchback-import__report-items > li").last()).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("link", { name: "Settings" })).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });

  const ride = page.locator(".og-library__row").filter({ has: page.getByRole("textbox", { name: "Rename Redacted sample loop" }) });
  await expect(ride).toBeVisible();
  await ride.getByRole("button", { name: "View details for Redacted sample loop" }).click();
  await expect(ride).toContainText("Source: SwitchBack");

  await page.getByRole("button", { name: "Import another batch" }).click();
  await page.getByLabel("SwitchBack GPX files").setInputFiles("tests/fixtures/m10/switchback-track-waypoints.gpx");
  await page.getByRole("button", { name: "Import selected rides" }).click();
  await expect(page.getByTestId("switchback-import-report")).toContainText("Imported 0 of 1 rides");
  await expect(page.locator('[data-file-result="already-imported"]')).toContainText("already imported");
  await expect(page.locator(".og-library__row")).toHaveCount(1);
});
