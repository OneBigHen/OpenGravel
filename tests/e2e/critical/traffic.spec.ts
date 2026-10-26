import { expect, test } from "@playwright/test";

import { placeEndpoint, plannerMap, pressPlan, settledExtent } from "./map-helpers";

const START = { lon: -75.4385, lat: 40.1385 };
const FINISH = { lon: -75.4335, lat: 40.1325 };

test("no TomTom key leaves traffic off the rider surfaces instead of claiming it clear", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/explore/sample-ridge-loop");
  // A check the host could not make is left off the page, not listed as
  // "unknown" and never turned into an all-clear.
  await expect(page.getByText("Traffic unknown", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Not available yet", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Traffic clear/i)).toHaveCount(0);

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
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await pressPlan(page);
  // Unknown traffic is left off the cards instead of being implied or turned
  // into a status paragraph under the list.
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("route-traffic-status")).toHaveCount(0);
  await expect(page.getByTestId("route-unknowns-note")).toHaveCount(0);
  await expect(page.getByText("Traffic clear", { exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
