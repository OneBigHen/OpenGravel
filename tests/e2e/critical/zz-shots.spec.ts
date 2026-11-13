import { test } from "@playwright/test";
const points = Array.from({ length: 30 }, (_, i) => `<trkpt lon="${-75.4 + i * 0.003}" lat="${41.18 + i * 0.003}"></trkpt>`).join("");
const gpx = `<gpx version="1.1"><trk><name>Far away GPX</name><trkseg>${points}</trkseg></trk></gpx>`;
for (const [w, h] of [[390, 844], [320, 568]] as const) {
  test(`shots ${w}`, async ({ page, context }) => {
    await page.setViewportSize({ width: w, height: h });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ longitude: -75.4, latitude: 40.6, accuracy: 10 });
    const d = `test-results/shots/${w}`;
    await page.goto("/rides"); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${d}-rides-empty.png` });
    await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "far.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
    await page.waitForURL(/\/$/, { timeout: 30000 });
    await page.goto("/rides"); await page.waitForTimeout(3000);
    await page.screenshot({ path: `${d}-rides-to-start.png` });
    await page.getByTestId(/^ride-to-start-/).click();
    await page.waitForURL(/\/ride/, { timeout: 60000 });
    await context.setGeolocation({ longitude: -75.4, latitude: 40.6, accuracy: 8 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `${d}-ride-after-tap.png` });
    await page.goto("/explore/sample-ridge-loop"); await page.waitForTimeout(3000);
    await page.screenshot({ path: `${d}-explore-detail.png`, fullPage: true });
    await page.goto("/explore"); await page.waitForTimeout(2500);
    await page.screenshot({ path: `${d}-explore-list.png` });
  });
}
