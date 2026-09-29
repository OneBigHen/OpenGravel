import { expect, test } from "@playwright/test";

import { clickMapAtCoordinate, plannerMap, settledExtent } from "./map-helpers";

const START = { lon: -75.4385, lat: 40.1385 };
const FINISH = { lon: -75.4335, lat: 40.1325 };

test("no TomTom key keeps preparation and route traffic surfaces unknown", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByText("Traffic unknown", { exact: true })).toBeVisible();

  const trafficResponse = await page.request.post("/api/route-traffic", {
    data: {
      corridor: [START, FINISH],
      departureTime: "2026-09-17T14:00:00.000Z",
    },
  });
  expect(trafficResponse.ok()).toBe(true);
  const trafficBody = await trafficResponse.json() as {
    traffic: { availability: string; label: string };
  };
  expect(trafficBody.traffic.availability).toBe("unavailable");
  expect(trafficBody.traffic.label).toBe("Traffic unknown");

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await clickMapAtCoordinate(page, START);
  await clickMapAtCoordinate(page, FINISH);
  await page.getByTestId("compose-create").click();
  // Unknown traffic is stated once for the list, never implied per card.
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("route-traffic-status")).toHaveCount(0);
  await expect(page.getByTestId("route-unknowns-note")).toContainText("live traffic");
  await expect(page.getByText("Traffic clear", { exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
