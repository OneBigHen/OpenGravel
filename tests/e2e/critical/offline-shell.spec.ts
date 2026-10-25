import { expect, test } from "@playwright/test";
import { expectHealthyMap, plannerMap } from "./map-helpers";
import { startRide } from "./ride-focus-helpers";

/** A real lost-signal reload/cold tab, using the production service worker.
 * The existing fixture area includes the road graph, map archive and labels.
 * This gate must run against next start, never a development server. */
test("a downloaded area remains reachable after reload and reopening with no signal (offline-3)", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto("/settings");
  const row = page.getByTestId("offline-region-lehigh-fixture");
  await row.getByRole("button", { name: /^Download/ }).click();
  await expect(page.getByTestId("offline-maps-message")).toContainText("is ready");
  await expect(row).toContainText("On this device");
  // clients.claim() happens only after all five documents and their assets
  // have been cached. A registration alone cannot satisfy this gate.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);
  await expect(page.getByTestId("offline-shell-disclosure")).toContainText("reopen OpenGravel without signal");

  await context.setOffline(true);
  try {
    const reloaded = await page.reload();
    expect(reloaded?.fromServiceWorker()).toBe(true);
    await expect(row).toContainText("On this device");
    await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();

    // The planner was never visited online in this context: its full initial
    // route payload, lazy chunks, fonts and MapLibre worker must be precached.
    const response = await page.goto("/");
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(plannerMap(page)).toHaveAttribute("data-basemap", "offline");
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
    await expectHealthyMap(page);

    // Closing the tab clears its in-memory router/module state. IndexedDB and
    // the service worker remain, as when a phone discards a tab on a ride.
    await page.close();
    const reopened = await context.newPage();
    const coldResponse = await reopened.goto("/");
    expect(coldResponse?.fromServiceWorker()).toBe(true);
    await expect(plannerMap(reopened)).toHaveAttribute("data-basemap", "offline");
    await expect(plannerMap(reopened)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
    await expectHealthyMap(reopened);
    // Exercise a real Next Link too: an uncached Flight request must fall
    // back to the cached document rather than be blocked by OfflineNavGuard.
    await reopened.getByTestId("primary-nav").getByRole("link", { name: "My rides", exact: true }).click();
    await expect(reopened).toHaveURL(/\/rides$/);
    await expect(reopened.getByRole("heading", { name: "My rides", exact: true })).toBeVisible();
    await reopened.goto("/ride");
    await expect(reopened.getByTestId("ride-focus")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("a ride already in progress can be reloaded and reopened with its downloaded map offline", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto("/settings");
  await page.getByTestId("offline-region-lehigh-fixture").getByRole("button", { name: /^Download/ }).click();
  await expect(page.getByTestId("offline-maps-message")).toContainText("is ready");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);
  // The fixture ride uses the same real planner -> durable session handoff
  // as other Ride Focus critical tests; no session/storage fields are forged.
  await startRide(page);
  await context.setOffline(true);
  try {
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await expect(plannerMap(page)).toHaveAttribute("data-basemap", "offline");
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
    await expectHealthyMap(page);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto("/ride");
    await expect(reopened.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await expect(plannerMap(reopened)).toHaveAttribute("data-basemap", "offline");
    await expect(plannerMap(reopened)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
    await expectHealthyMap(reopened);
  } finally {
    await context.setOffline(false);
  }
});
