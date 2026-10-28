import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

test("a hike drawing remains on the map after reload without a road plan", async ({ page }) => {
  let planRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) planRequests += 1;
  });
  await page.goto("/");
  const map = page.locator("[data-map-load]").first();
  await expect(map).toHaveAttribute("data-map-load", "ready", { timeout: 45_000 });
  // Riders see no hike chrome on the map; the switch lives in the menu.
  await expect(page.getByTestId("hike-card")).toHaveCount(0);
  await page.getByTestId("app-menu").click();
  await page.getByTestId("activity-hike").click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Trail routing is coming. Draw your hike on the map.")).toBeVisible();
  await page.getByTestId("hike-draw-start").click();
  await expect(page.getByTestId("hike-draw-done")).toBeVisible();
  // Let the camera settle out of the gesture quiet window before the stroke.
  await page.waitForTimeout(750);
  await page.mouse.move(70, 400);
  await page.mouse.down();
  for (const [x, y] of [[90, 410], [115, 430], [140, 455], [165, 470], [190, 480], [220, 500], [250, 520]]) {
    await page.mouse.move(x!, y!, { steps: 3 });
  }
  await page.mouse.up();
  await expect(map).toHaveAttribute("data-map-scene", /sketchDraft:1/);
  await page.waitForTimeout(1_500);
  await page.getByTestId("hike-draw-done").click();
  await expect(map).toHaveAttribute("data-map-scene", /sketch:1,sketchDraft:0/, { timeout: 15_000 });
  expect(planRequests).toBe(0);
  // The draft is written to disk shortly after the edit; a reload before then
  // would test a race, not the feature. The app marks the draft dirty until the
  // durable write lands, so wait for that marker to clear.
  const dirty = (): Promise<string | null> => page.evaluate(() => window.localStorage.getItem("opengravel-vnext-draft-dirty"));
  await expect.poll(dirty, { timeout: 5_000 }).toBe("1").catch(() => undefined);
  await expect.poll(dirty, { timeout: 15_000 }).not.toBe("1");
  await page.reload();
  await expect(page.getByTestId("hike-card")).toBeVisible();
  await expect(map).toHaveAttribute("data-map-scene", /sketch:1,sketchDraft:0/, { timeout: 20_000 });
  expect(planRequests).toBe(0);
});
