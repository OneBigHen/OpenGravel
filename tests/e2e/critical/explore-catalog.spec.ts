import { expect, test } from "@playwright/test";

const ROUTE_ID = "sample-ridge-loop";
const ROUTE_NAME = "Sample Ridge Loop";

test("filters the catalog, opens a route, uses its community forms, exports GPX, and plans it", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.locator(".og-explore-card")).toHaveCount(3);
  await page.getByRole("searchbox", { name: "Search routes" }).fill("sample ridge loop");
  const routeLink = page.getByRole("link", { name: new RegExp(ROUTE_NAME) });
  await expect(routeLink).toBeVisible();
  await expect(page.locator(".og-explore-card")).toHaveCount(1);
  await routeLink.click();
  await expect(page).toHaveURL(new RegExp(`/explore/${ROUTE_ID}$`));
  await expect(page.getByRole("heading", { name: ROUTE_NAME })).toBeVisible();
  await expect(page.getByRole("region", { name: "Catalog variants and tracks" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Catalog variants and tracks" })).toContainText("2 exports");
  await expect(page.getByTestId("roads-none-matched")).toContainText("no road-by-road surface");
  await expect(page.getByLabel("Curvature not computed")).toHaveText("—");
  await expect(page.getByText("Posted from this device. No account is required.")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GPX" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.gpx$/i);

  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.getByRole("status")).toContainText("Rating saved.");
  await page.getByRole("textbox", { name: "Leave a comment" }).fill("This synthetic sample opened correctly.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("status")).toContainText("Comment sent for review. It will appear after approval.");
  await expect(page.getByRole("list", { name: "Route comments" })).toBeEmpty();
  await page.getByRole("combobox", { name: "Road condition" }).selectOption("rough");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText("Road condition report sent for review.");

  await expect(page.getByText("Planning follows this line through a few checkpoints, so the road route may differ. GPX export keeps the full line.")).toBeVisible();
  const planRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/api/route-plan"));
  await page.getByRole("button", { name: "Plan this ride" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("active-ride-title")).toHaveText(`${ROUTE_NAME} copy`);
  const requestBody = (await planRequest).postDataJSON() as { readonly request?: { readonly shaping?: readonly unknown[] } };
  expect(requestBody.request?.shaping).toHaveLength(23);
  expect(consoleErrors).toEqual([]);
});
