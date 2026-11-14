import { expect, test } from "@playwright/test";
import vermont from "../../fixtures/route-plan/basic-route-vermont.json";
import type { RoutePlanRequestBody } from "../../../src/application/planner/ports/route-plan-contract";
import { plannerMap } from "./map-helpers";

/**
 * A ride outside the tuned area (PA, NJ, NY) is planned as a plain motorcycle
 * route and says so in plain English, instead of "No route yet". The server
 * side is unit-tested and was checked live; this spec proves what the rider sees.
 * The route answer is a recorded live basic route from Montpelier to Stowe, VT.
 */
const MONTPELIER = { latitude: 44.260106, longitude: -72.575388 };
const STOWE = { lat: 44.469698, lon: -72.802607 };
const LABEL = "Basic route — OpenGravel's curvy and gravel tuning covers PA, NJ and NY only.";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, geolocation: MONTPELIER, permissions: ["geolocation"] });

/** The search fixture's places live in PA; this ride's destination is in Vermont. */
function toStowe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStowe);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record["name"] === "string" && typeof record["coordinate"] === "object") {
    return { ...record, name: "Stowe", context: "Lamoille County, VT", label: "Stowe, VT", coordinate: STOWE };
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, toStowe(item)]));
}

test("a far-away ride gets a labelled basic route", async ({ page }, testInfo) => {
  await page.route("**/api/geocode**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: toStowe(await response.json()) });
  });
  await page.route("**/api/route-plan", async (route) => {
    const { identity } = route.request().postDataJSON() as RoutePlanRequestBody;
    await route.fulfill({ json: { identity, bundle: vermont.bundle, diagnostics: vermont.diagnostics } });
  });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await page.getByTestId("top-place-search").fill("Hawk Mountain Sanctuary");
  await page.getByTestId("top-place-search").press("Enter");
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("route-summary")).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: testInfo.outputPath("basic-route-390.png") });
  await expect(page.getByText(LABEL).first()).toBeVisible();
  await expect(page.getByText("Basic routing").first()).toBeVisible();
  await expect(page.getByText("No route yet")).toHaveCount(0);
});
