import { expect, test } from "@playwright/test";

const ROUTE_ID = "sample-ridge-loop";
const ROUTE_NAME = "Sample Ridge Loop";

test("filters the catalog, opens a route, uses its community forms, exports GPX, and rides it", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  // A route the rider already read must not be planned again to be ridden.
  const planRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) planRequests.push(request.url());
  });

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
  // With no road matched to our data there is no road-by-road surface, so the
  // section is absent rather than heading an explanation of its own absence.
  await expect(page.getByRole("heading", { name: "Roads on this ride" })).toHaveCount(0);
  await expect(page.getByLabel("Curvature not computed")).toHaveText("—");
  await expect(page.getByRole("heading", { name: "Route notes" })).toBeVisible();
  // The rating count is stated once ("No ratings yet", never "No ratings yet · 0 ratings").
  await expect(page.locator(".og-route-community__meta")).toBeVisible();
  await expect(page.getByText(/·\s*0 ratings/)).toHaveCount(0);
  // Posting needs no account and no location, and the screen no longer explains that.
  await expect(page.getByText(/Posted from this device/)).toHaveCount(0);
  await expect(page.getByText(/do not request your GPS location/)).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GPX" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.gpx$/i);

  await page.getByRole("radio", { name: "4 stars" }).click();
  await expect(page.getByText("Thanks. Your rating is saved.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await page.getByRole("textbox", { name: "Leave a comment" }).fill("This synthetic sample opened correctly.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("status")).toContainText("Comment sent for review. It will appear after approval.");
  await expect(page.getByRole("list", { name: "Route comments" })).toBeEmpty();
  await page.getByRole("combobox", { name: "Report a road condition" }).selectOption("rough");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText("Road condition report sent for review.");

  // Planning mechanics are not something a rider reads before a ride.
  await expect(page.getByText(/Planning follows this line/)).toHaveCount(0);
  await page.getByRole("button", { name: "Ride this" }).click();
  await expect(page).toHaveURL(/\/$/);
  // The ride keeps the route's own name; "copy" was never something a rider
  // asked to see, and it is not a different ride from the one they read.
  await expect(page.getByTestId("active-ride-title")).toHaveText(ROUTE_NAME);
  await expect(page.getByTestId("active-ride-title")).not.toHaveText(/copy/i);
  // The route the rider was reading is the answer: its own card, with the
  // catalog's distance and time, and Start ride already there.
  const card = page.locator('[data-testid^="route-card-"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("17 mi");
  await expect(card).toContainText("58 min");
  await expect(page.getByTestId("start-ride")).toBeEnabled({ timeout: 2_000 });
  // Nothing asked the router to plan this ride again.
  expect(planRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
