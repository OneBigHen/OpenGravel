import { expect, test } from "@playwright/test";

import { clickInRideSheet, openRideSheet, startRide } from "./ride-focus-helpers";

/**
 * Every ride is kept, and it ends with a ride card (R3-2).
 *
 * Recording is on from Start now, so this gate starts a planned ride the way a
 * rider does — no switch, no Menu — lets the fixture rider move for a minute,
 * ends the ride and saves it. The card is then the whole assertion: miles above
 * zero, "Ride finished" said once, and the ride kept in My rides under Ridden,
 * where its own row opens the same card again.
 *
 * `NEXT_PUBLIC_OGV_RIDE_FIXTURE=1` walks the route at 12 m/s once a second (see
 * `src/infrastructure/ride/fixture-position-source.ts`), which is what the 60 s
 * wait is for: the recording must have a real distance, not a fixture number.
 */
test("a planned ride ends with one ride card, and the ride is kept under Ridden", async ({ page }) => {
  // A minute of riding plus a started build and a library load.
  test.setTimeout(240_000);
  // The owner's phone: 440 × 956, the shape the card is drawn for.
  await page.setViewportSize({ width: 440, height: 956 });

  await startRide(page);
  // Recording begins with the ride: the activity is the guided ride, and the
  // recording HUD is already there without a tap.
  await expect(page.getByTestId("ride-activity")).toHaveText("Guided ride");
  await openRideSheet(page);
  await expect(page.getByTestId("recording-hud")).toBeVisible();

  // 60 s of fixture positions: 12 m a second, about 0.4 mi.
  await page.waitForTimeout(60_000);
  await expect
    .poll(async () => Number.parseFloat(await page.getByTestId("recording-distance").innerText()))
    .toBeGreaterThan(0);

  // End ride, and the first choice saves it.
  await clickInRideSheet(page, "ride-stop", "ride-stop-confirm");
  await page.getByTestId("ride-finish").click();

  const card = page.getByTestId("ride-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId("ride-card-headline")).toHaveText("Ride finished");
  // "Ride finished" is said once on the whole screen, by the card.
  await expect(page.getByText("Ride finished")).toHaveCount(1);

  const miles = Number.parseFloat(
    await card.getByTestId("ride-card-miles").locator(".og-ride-card__number").innerText(),
  );
  expect(miles).toBeGreaterThan(0);
  await expect(card.getByTestId("ride-card-moving")).not.toHaveText("—");
  await expect(card.getByTestId("ride-card-line")).toBeVisible();
  // No metres in a miles app, anywhere on the card or under it.
  await expect(page.getByText(/\d+ m to My rides/)).toHaveCount(0);

  // Done keeps the ride: My rides, Ridden tab, one row.
  await card.getByTestId("ride-summary-rides").click();
  await expect(page).toHaveURL(/\/rides\?tab=ridden$/);
  await expect(page.getByRole("button", { name: "Ridden", exact: true })).toHaveAttribute("aria-pressed", "true");
  const row = page.locator(".og-library__row").filter({ has: page.getByTestId("recorded-ride-summary") });
  await expect(row).toHaveCount(1);

  // The row opens the same card, here, without turning the ride into a draft.
  await row.getByRole("button", { name: /^Open / }).click();
  await expect(page.getByTestId("ride-card")).toBeVisible();
  await expect(page.getByTestId("ride-card-headline")).toHaveCount(0);
  await expect(page.getByTestId("ride-card-title")).toHaveText("Recorded ride");
  await expect(page).toHaveURL(/\/rides\?tab=ridden$/);
});
