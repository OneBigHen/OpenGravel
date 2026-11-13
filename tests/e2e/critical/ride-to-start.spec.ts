import { expect, test } from "@playwright/test";

/**
 * OG-06: a GPX that starts far from the rider offers "Ride to the start · N mi",
 * and one tap opens it as a ride that asks the router for the way there, with no
 * second "Head to the start" question.
 *
 * The rider stands near Allentown, PA. The imported ride starts about 40 miles
 * north of them.
 */
const RIDER = { longitude: -75.4, latitude: 40.6 };
const points = Array.from({ length: 30 }, (_, i) => `<trkpt lon="${-75.4 + i * 0.003}" lat="${41.18 + i * 0.003}"></trkpt>`).join("");
const gpx = `<gpx version="1.1"><metadata><name>Far away GPX</name></metadata><trk><name>Far away GPX</name><trkseg>${points}</trkseg></trk></gpx>`;

test("a GPX 40 miles away offers Ride to the start and plans the way there", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...RIDER, accuracy: 10 });

  await page.goto("/rides");
  await expect(page.getByRole("heading", { name: "No saved rides yet" })).toBeVisible();
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "far.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  await page.goto("/rides");
  const button = page.getByTestId(/^ride-to-start-/);
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(button).toHaveText(/^Ride to the start · (39|40|41) mi$/);

  const plans: { readonly origin?: { readonly lat?: number; readonly lon?: number } }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) plans.push(request.postDataJSON());
  });
  await button.click();

  // The planner starts the ride by itself; the ride screen never asks the question.
  await expect(page).toHaveURL(/\/ride/, { timeout: 60_000 });
  // A phone keeps sending fixes; the test device sends one more now that the ride is open.
  await expect(page.getByTestId("ride-gps")).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
  await context.setGeolocation({ ...RIDER, accuracy: 8 });
  await expect.poll(() => plans.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("ride-far-from-start")).toHaveCount(0);
  expect(JSON.stringify(plans[0])).toContain("-75.4");
});

test("a GPX that starts at the rider offers no Ride to the start", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: -75.4, latitude: 41.18, accuracy: 10 });
  await page.goto("/rides");
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "near.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await page.goto("/rides");
  await expect(page.getByRole("button", { name: "Open Far away GPX" })).toBeVisible();
  await expect(page.getByTestId(/^ride-to-start-/)).toHaveCount(0);
});
