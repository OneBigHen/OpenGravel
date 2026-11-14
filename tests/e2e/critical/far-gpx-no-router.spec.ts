import { expect, test } from "@playwright/test";

/**
 * RMN-5, owner complaint 2: a saved/imported GPX opened far from the rider
 * (Palmerton to Bowmanstown, PA, about 3 miles, rider near Horsham) showed
 * "No route yet" and "The routing service ...". The ride's own line must show
 * straight from the file, with no question to the router at all; the router is
 * only for "Ride to the start".
 */
test.setTimeout(120_000);

const RIDER = { longitude: -75.14, latitude: 40.18 };
// Palmerton (-75.6155, 40.8037) to Bowmanstown (-75.6637, 40.7968), wiggly like a real track.
const points = Array.from({ length: 40 }, (_, i) => {
  const t = i / 39;
  return `<trkpt lon="${(-75.6155 + (-75.6637 + 75.6155) * t).toFixed(6)}" lat="${(40.8037 + (40.7968 - 40.8037) * t + 0.002 * Math.sin(t * 9)).toFixed(6)}"></trkpt>`;
}).join("");
const gpx = `<gpx version="1.1"><metadata><name>Palmerton to Bowmanstown</name></metadata><trk><name>Palmerton to Bowmanstown</name><trkseg>${points}</trkseg></trk></gpx>`;

test("a far-away GPX opens on its own line and never asks the router", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...RIDER, accuracy: 10 });
  let plans = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) plans += 1;
  });

  await page.goto("/rides");
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "pb.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  // Open it again from My rides, the way the owner did.
  await page.goto("/rides");
  await page.getByRole("button", { name: "Open Palmerton to Bowmanstown" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByTestId("start-ride")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(1);
  await page.waitForTimeout(10_000);
  await expect(page.getByText("No route yet")).toHaveCount(0);
  await expect(page.getByText(/routing service/i)).toHaveCount(0);
  expect(plans, "route-plan requests for a ride that already has its own line").toBe(0);
});
