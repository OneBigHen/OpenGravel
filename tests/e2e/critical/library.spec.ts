import { expect, test } from "@playwright/test";

import { clickMapAtCoordinate, plannerMap, settledExtent, type Coordinate } from "./map-helpers";

const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };
const TITLE = "Sunday Pine Barrens";
const RENAMED = "Sunday Pine Barrens renamed";

test("keeps named rides separate from the active draft and protects sources", async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await clickMapAtCoordinate(page, START);
  await clickMapAtCoordinate(page, FINISH);
  await page.getByTestId("compose-create").click();
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
  await expect(page.getByRole("textbox", { name: `Rename ${TITLE}` })).toBeVisible();
  const updatedBeforeBrowse = await page
    .getByRole("textbox", { name: `Rename ${TITLE}` })
    .locator("..")
    .locator("..")
    .getByText(/Updated /)
    .textContent();
  await page.getByRole("button", { name: `View details for ${TITLE}` }).click();
  await expect(page.getByText(/Planned here/)).toBeVisible();
  await expect(
    page
      .getByRole("textbox", { name: `Rename ${TITLE}` })
      .locator("..")
      .locator("..")
      .getByText(/Updated /),
  ).toHaveText(updatedBeforeBrowse ?? "");

  await page.getByRole("button", { name: `Open ${TITLE}` }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");

  await page.goto("/rides");
  const renamedTitle = page.getByRole("textbox", { name: `Rename ${TITLE}` });
  await renamedTitle.fill(RENAMED);
  await page.getByRole("button", { name: `Rename ${TITLE}` }).click();
  await expect(page.getByRole("textbox", { name: `Rename ${RENAMED}` })).toHaveValue(RENAMED);

  await page.getByRole("button", { name: `Delete ${RENAMED}` }).click();
  await page.getByRole("button", { name: `Confirm delete ${RENAMED}` }).click();
  await expect(page.getByRole("textbox", { name: `Rename ${RENAMED}` })).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
});
