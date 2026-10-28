import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { clickMapAtCoordinate, expectHealthyMap, openRefine, placeEndpoint } from "./map-helpers";

// Mock the upstream foot router, exercising the real API, validation and hike
// adapter. The ordinary route-plan fixture must never answer a hike request.
let server: Server;
let pointsSeen: number[][][] = [];
let failure: "none" | "no-route" | "outage" = "none";
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    let bytes = ""; for await (const chunk of request) bytes += chunk;
    const body = JSON.parse(bytes) as { profile: string; points: number[][] };
    if (body.profile !== "hike") { response.writeHead(500).end(); return; }
    pointsSeen.push(body.points);
    response.setHeader("content-type", "application/json");
    if (failure !== "none") { response.writeHead(failure === "outage" ? 503 : 400).end(JSON.stringify({ hints: [{ details: "com.graphhopper.util.exceptions.ConnectionNotFoundException" }] })); return; }
    const points = body.points.map(p => [...p]);
    points[0]![1]! += 0.006; // 0.4 mi from the requested start; no fake connector.
    response.end(JSON.stringify({ paths: [{ distance: 2400, time: 1000, points: { coordinates: points }, snapped_waypoints: { coordinates: points }, details: { road_class: [[0, 1, "tertiary"], ...(points.length > 2 ? [[1, points.length - 1, "path"]] : [])] } }] }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(3340, "127.0.0.1", resolve); });
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
test.beforeEach(async ({ page }) => {
  pointsSeen = []; failure = "none";
  await page.addInitScript(() => localStorage.setItem("og-activity-mode", "hike"));
  await page.goto("/"); await expectHealthyMap(page);
  await expect(page.getByTestId("hike-card")).toBeVisible();
});
test.setTimeout(60000);
const start = { lon: -75.4385, lat: 40.1385 }, finish = { lon: -75.4335, lat: 40.1325 };

test("hike A to B, ordered stops, there and back, and honest router failures", async ({ page }) => {
  await placeEndpoint(page, "start", start);
  await placeEndpoint(page, "finish", finish);
  await page.getByTestId("hike-plan").click();
  const summary = page.getByTestId("hike-route-summary");
  await expect(summary).toContainText("walking time from grade");
  await expect(summary).toContainText("ft");
  await expect(summary).toContainText("on roads");
  await expect(summary).toContainText("Starts 0.4 mi from the nearest trail");
  expect(pointsSeen.at(-1)).toHaveLength(2);
  await openRefine(page);
  await page.getByTestId("add-stop").click();
  await clickMapAtCoordinate(page, { lon: -75.436, lat: 40.136 });
  await expect.poll(() => pointsSeen.at(-1)?.length).toBe(3);
  await page.getByTestId("hike-there-and-back").check();
  await page.getByTestId("hike-plan").click();
  await expect(summary).toContainText(/\b3(\.0)? mi\b/);
  failure = "no-route";
  await page.getByTestId("hike-plan").click();
  await expect(page.getByTestId("hike-card")).toContainText("No trail route between these points.");
  failure = "outage";
  await page.getByTestId("hike-plan").click();
  await expect(page.getByTestId("hike-card")).toContainText("Hike routing unavailable.");
});

// Breadcrumbs are a phone workflow. KNOWN GAP (docs/vnext/HANDOFF-2026-10-28.md §4):
// on a phone the hike card covers the top of the map, so the hold that places the
// start lands on the card; on desktop the rider inspector still owns hike results.
// Un-fixme once the hike card is compact on phones.
test.describe("on a phone", () => {
test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
test.fixme("breadcrumb hands its ordered waypoints to the foot router", async ({ page }) => {
  await placeEndpoint(page, "start", start);
  await placeEndpoint(page, "finish", finish);
  await page.getByTestId("hike-plan").click();
  await expect(page.getByTestId("hike-route-summary")).toBeVisible();
  // The edit toolbar is the same accessible entry as riding.
  await page.getByTestId("map-edit-open").click();
  await page.getByTestId("map-edit-breadcrumb").click();
  await clickMapAtCoordinate(page, start);
  await clickMapAtCoordinate(page, { lon: -75.436, lat: 40.136 });
  await clickMapAtCoordinate(page, finish);
  await page.getByRole("toolbar", { name: "Breadcrumb", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("breadcrumb-plan-trails").click();
  await expect.poll(() => pointsSeen.at(-1)?.length).toBe(3);
  await expect(page.getByTestId("breadcrumb-summary")).toHaveCount(0);
  await expect(page.getByTestId("hike-route-summary")).toBeVisible();
});
});
