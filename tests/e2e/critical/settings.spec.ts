import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

test("planner content is server-rendered before browser hydration", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();

  expect(html).toContain('class="og-planner"');
  expect(html).not.toContain("Loading planner…");
});

test("active bike carries into a new ride and local data can be exported or deleted", async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: -75.44, latitude: 40.14, accuracy: 6 });
  await page.getByTestId("settings-save-home").click();
  await expect(page.getByRole("status")).toContainText("saved as Home on this device");
  await expect(page.getByTestId("settings-clear-home")).toBeEnabled();
  await page.getByTestId("settings-clear-home").click();
  await expect(page.getByRole("status")).toContainText("Saved Home was cleared");
  await expect(page.getByTestId("settings-clear-home")).toBeDisabled();
  await page.getByTestId("settings-save-home").click();
  await expect(page.getByRole("status")).toContainText("saved as Home on this device");

  await page.getByRole("button", { name: "Add bike" }).click();
  await page.getByLabel("Bike name").fill("Trail bike");
  await page.getByLabel("Category").selectOption("adventure");
  await page.getByLabel("Fuel range (miles)").fill("60");
  await page.getByLabel("Reserve (miles)").fill("30");
  await page.getByRole("button", { name: "Save bike" }).click();
  await page.getByRole("button", { name: "Make active" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  // Location is granted, so a fresh ride starts at the rider (UX rework 2, #6);
  // changing it is one tap on the start.
  await page.getByTestId("start-change").click();
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await page.getByTestId("finish-search").fill("hawk mountain s");
  await page.getByTestId("finish-search").press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  const prepare = page.getByTestId("prepare");
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  await expect(page.getByText("Riding: Trail bike · 60 mi range")).toBeVisible();
  await expect(page.getByTestId("preparation-state-fuel")).toBeVisible();
  await expect(page.getByText("30 mi range", { exact: true })).toBeVisible();

  await page.getByTestId("named-ride-title").fill("Trail bike test ride");
  await page.getByTestId("save-named-ride").click();
  await expect(page.getByText("Named ride saved. Your active draft remains available.")).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Export all data" }).click();
  await expect(page.getByRole("status")).toContainText("export was downloaded");
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("status")).toContainText("Deleted this device's OpenGravel data");
  await expect(page.getByRole("status")).toContainText("rides, route geometry, sessions, recordings, imports, road and share records, bikes, Home, map and telemetry preferences, saved place names, and ride pointers");
  await page.getByRole("link", { name: "My rides" }).click();
  await expect(page).toHaveURL(/\/rides$/);
  await expect(page.getByRole("heading", { name: "Your library is ready for its first ride." })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
