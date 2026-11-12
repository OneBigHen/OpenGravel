import { expect, test, type Page } from "@playwright/test";

import { plannerMap, pressPlan, settledExtent } from "./map-helpers";

/**
 * R3-1 "Saved means exact": the ride I saved, imported or picked opens as
 * exactly that line.
 *
 * Before this, opening a saved loop from My rides planned it again (three of
 * three tries gave a different ride), and "Open in planner" on an imported loop
 * asked the router for a ride from a place to itself ("Planning failed").
 */

const PHONE = { width: 440, height: 956 };
const RIDER = { latitude: 40.8757, longitude: -75.7324 };
const TITLE = "Saved exact loop";
const LOOP_GPX = "tests/fixtures/import/loop.gpx";

test.use({ viewport: PHONE, hasTouch: true, geolocation: RIDER, permissions: ["geolocation"] });
// Plan, save, reload, reopen, then plan again: several fixture plans with their
// 2 s latency window, so this one story gets more than the 30 s default.
test.setTimeout(120_000);

/** Every `/api/route-plan` request from now on: each one is the router being asked. */
function countPlanRequests(page: Page): { readonly count: () => number } {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/route-plan")) count += 1;
  });
  return { count: () => count };
}

async function coldLoad(page: Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await settledExtent(page);
}

/** The planner's phone summary numbers: the big time, and the miles beside it. */
async function plannerNumbers(page: Page): Promise<{ readonly time: string; readonly miles: string }> {
  const summary = page.getByTestId("phone-ride-summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const time = (await summary.locator(".og-phone-summary__time").textContent())?.trim() ?? "";
  const facts = (await summary.locator(".og-phone-summary__arrive").textContent()) ?? "";
  const miles = /[\d.]+ mi/.exec(facts)?.[0] ?? "";
  return { time, miles };
}

test("a saved loop reopens from My rides as the same ride, with no new plan", async ({ page }, testInfo) => {
  await coldLoad(page);
  if (await page.getByTestId("ride-shape-loop").isVisible()) {
    await page.getByTestId("ride-shape-loop").check();
  } else {
    await page.getByTestId("loop-near-me").click();
  }
  await pressPlan(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  const planned = await plannerNumbers(page);
  expect(planned.time).not.toBe("");
  expect(planned.miles).not.toBe("");

  // On a phone, the summary's Save opens the sheet on the name box.
  await page.getByTestId("summary-save").click();
  await expect(page.getByTestId("named-ride-title")).toBeVisible();
  await page.getByTestId("named-ride-title").fill(TITLE);
  await page.getByTestId("save-named-ride").click();
  await expect(page.getByText("Named ride saved. Your active draft remains available.")).toBeVisible();
  await page.reload();
  await expect(plannerMap(page)).toBeVisible();

  await page.goto("/rides");
  const open = page.getByRole("button", { name: `Open ${TITLE}` });
  await expect(open).toBeVisible();
  const card = (await page.locator(".og-rides__row-open", { has: page.getByText(TITLE, { exact: true }) })
    .locator(".og-rides__meta").textContent()) ?? "";
  // The saved card states the numbers the planner showed when it was saved.
  expect(card).toContain(planned.miles);
  expect(card).toContain(planned.time);

  const plans = countPlanRequests(page);
  await open.click();
  await expect(page).toHaveURL(/\/$/);
  const reopened = await plannerNumbers(page);
  expect(reopened).toEqual(planned);
  await expect(page.getByTestId("start-ride")).toBeEnabled();
  await expect(page.getByText(/Restored your draft|Planning failed/)).toHaveCount(0);
  // Long enough for the restore rule and the settle window to have asked, if they would.
  await page.waitForTimeout(3_000);
  expect(plans.count()).toBe(0);
  expect(await plannerNumbers(page)).toEqual(planned);

  // Proof pictures for the PR (both themes); not compared against anything.
  await page.screenshot({ path: testInfo.outputPath("reopened-saved-phone-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.screenshot({ path: testInfo.outputPath("reopened-saved-phone-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });

  // "Plan it again" is the one way to ask the router, and it says what changed.
  // It is a secondary action, under the ride in the sheet: open the sheet to reach it.
  const planAgain = page.getByTestId("plan-it-again");
  const sheet = page.getByTestId("planner-sheet");
  for (let step = 0; step < 2 && (await sheet.getAttribute("data-detent")) !== "full"; step += 1) {
    await page.getByTestId("sheet-handle").click();
  }
  await planAgain.scrollIntoViewIfNeeded();
  await planAgain.click();
  await expect(page.getByTestId("status-line")).toContainText("Planned again", { timeout: 30_000 });
  expect(plans.count()).toBeGreaterThan(0);
});

test("an imported loop opens as its own line, never as a failed plan", async ({ page }, testInfo) => {
  await page.goto("/rides");
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles(LOOP_GPX);
  await page.getByRole("heading", { name: "Choose tracks" }).waitFor();
  await page.getByRole("button", { name: "Import separately" }).click();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();

  const plans = countPlanRequests(page);
  await page.getByRole("button", { name: "Open in planner" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("phone-ride-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("start-ride")).toBeEnabled();
  await expect(page.getByText(/Planning failed/)).toHaveCount(0);
  // A loop is a loop from its start, never "To" the place it began.
  await expect(page.getByTestId("phone-destination")).not.toHaveText(/^To /);
  await page.waitForTimeout(3_000);
  expect(plans.count()).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("imported-loop-phone-light.png") });
});
