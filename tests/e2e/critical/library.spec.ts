import { expect, test, type Page } from "@playwright/test";

import {
  placeEndpoint,
  plannerMap,
  pressPlan,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };
const TITLE = "Sunday Pine Barrens";
const RENAMED = "Sunday Pine Barrens renamed";

function rideRow(page: Page, title: string) {
  return page.locator(".og-library__row").filter({
    has: page.getByRole("button", { name: `Open ${title}` }),
  });
}

async function openRideMenu(page: Page, title: string) {
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
}

test("keeps named rides separate from the active draft and protects sources", async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);

  await page.getByTestId("named-ride-title").fill(TITLE);
  await page.getByTestId("save-named-ride").click();
  await expect(page.getByText("Named ride saved. Your active draft remains available.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Restored your draft")).toBeVisible();
  await expect(page.getByTestId("named-ride-title")).toHaveValue("");
  await expect(page.getByTestId("save-named-ride")).toBeDisabled();
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");

  await page.goto("/rides");
  const row = rideRow(page, TITLE);
  await expect(row.getByRole("button", { name: `Open ${TITLE}` })).toBeVisible();
  const updatedBeforeBrowse = await row.locator(".og-rides__meta").textContent();
  await openRideMenu(page, TITLE);
  await page.getByRole("menuitem", { name: "Details" }).click();
  await expect(row.getByText("Planned", { exact: true })).toBeVisible();
  await expect(row.locator(".og-rides__meta")).toHaveText(updatedBeforeBrowse ?? "");

  await row.getByRole("button", { name: `Open ${TITLE}` }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");

  await page.goto("/rides");
  await openRideMenu(page, TITLE);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renamedTitle = page.getByRole("textbox", { name: `Rename ${TITLE}` });
  await renamedTitle.fill(RENAMED);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: `Open ${RENAMED}` })).toBeVisible();

  await openRideMenu(page, RENAMED);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: `Confirm delete ${RENAMED}` }).click();
  await expect(page.getByRole("button", { name: `Open ${RENAMED}` })).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
});
