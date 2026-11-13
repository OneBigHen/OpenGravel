import { expect, test } from "@playwright/test";

// Screenshot capture: Rides empty state and the Ride to the start button (390x844).
const DIR = process.env.SHOT_DIR ?? "test-results/rides-shots";
const points = Array.from({ length: 30 }, (_, i) => `<trkpt lon="${-75.4 + i * 0.003}" lat="${41.18 + i * 0.003}"></trkpt>`).join("");
const gpx = `<gpx version="1.1"><metadata><name>Far away GPX</name></metadata><trk><name>Far away GPX</name><trkseg>${points}</trkseg></trk></gpx>`;

test("rides shots", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: -75.4, latitude: 40.6, accuracy: 10 });
  await page.goto("/rides");
  await expect(page.getByRole("heading", { name: "No saved rides yet" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}-rides-empty.png` });
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "far.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await page.goto("/rides");
  await expect(page.getByTestId(/^ride-to-start-/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}-rides-to-start.png` });
});
