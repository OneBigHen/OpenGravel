import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

test("a ride typed into Where to? becomes a proposal, planned in one tap and one undo step", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/advisor", async (route) => {
    const request = route.request().postDataJSON() as {
      readonly rideId: string;
      readonly baseRevision: number;
      readonly context: { readonly localDate: string; readonly timeZone: string };
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          rideId: request.rideId,
          baseRevision: request.baseRevision,
          localDate: request.context.localDate,
          timeZone: request.context.timeZone,
          outcome: "proposal",
          clarification: null,
          fields: {
            shape: "loop",
            startPlace: "Jim Thorpe",
            finishPlace: null,
            stopPlace: null,
            stopArrivalIntent: null,
            rideTimeKind: "budget",
            rideTimeMinutes: 120,
            rideTimeDate: null,
            rideTimeLocalTime: null,
            roadCharacter: "backroads",
            surfacePreference: null,
            terrainLevel: null,
            avoidHighways: true,
            tollPolicy: null,
            departureKind: "unchanged",
            departureLocalDate: null,
            departureLocalTime: null,
          },
          resolvedPlaces: {
            start: {
              id: "photon:fixture-jim-thorpe",
              label: "Jim Thorpe, PA",
              name: "Jim Thorpe",
              context: "Carbon County, PA",
              coordinate: { lat: 40.8759, lon: -75.7324 },
              provider: "photon",
            },
            finish: null,
            stop: null,
          },
          notes: [],
        },
      }),
    });
  });

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  // One box: the "Where to?" search is also where a ride is described.
  const box = page.getByTestId("finish-search");
  await expect(box).toHaveAttribute("placeholder", "Where to, or a ride idea");
  await box.fill("Two hours of twisty backroads from Jim Thorpe, avoid highways");
  await expect(page.getByTestId("place-option-describe")).toBeVisible();
  await box.press("Enter");

  const proposal = page.getByTestId("advisor-proposal");
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText("From Jim Thorpe, PA");
  await expect(proposal).toContainText("2 hours");
  await expect(proposal).toContainText("No highways");
  await page.getByRole("button", { name: "Plan it" }).click();

  await expect(page.getByTestId("ride-shape-loop")).toBeChecked();
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await expect(page.getByTestId("undo")).toHaveText("Undo · Apply ride description");
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("ride-shape-destination")).toBeChecked();
  await expect(page.getByTestId("redo")).toHaveText("Redo · Apply ride description");
  expect(pageErrors).toEqual([]);
});
