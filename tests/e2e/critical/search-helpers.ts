import { expect, type Page } from "@playwright/test";

export async function searchPlace(page: Page, query: string, slot: "start" | "finish" = "finish") {
  const compact = (page.viewportSize()?.width ?? 1440) <= 1180;
  const field = page.getByTestId(compact ? "top-place-search" : `${slot}-search`);
  await field.fill(query);
  await field.press("Enter");
  await expect(page.getByTestId("place-sheet")).toBeVisible();
}

export async function directionsTo(page: Page, query = "Hawk Mountain Sanctuary") {
  await page.context().setGeolocation({ latitude: 40.8757, longitude: -75.7324 });
  await page.context().grantPermissions(["geolocation"]);
  await searchPlace(page, query);
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("place-sheet")).toHaveCount(0);
}

export async function chooseStart(page: Page, query = "Jim Thorpe") {
  await searchPlace(page, query, "start");
  await page.getByTestId("place-sheet").getByRole("button", { name: "Start here" }).click();
}
