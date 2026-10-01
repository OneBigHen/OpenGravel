import { expect, test, type Page } from "@playwright/test";
import type { RoutePlanSuccessBody } from "../../../src/application/planner/ports/route-plan-contract";
import { plannerMap, settledExtent } from "./map-helpers";

/** UI fixtures supplement the labeled planning fixture with synthetic aggregate
 * evidence. Live road geometry/evidence is verified by the real-router gate. */
async function planComparison(page: Page) {
  await page.route("**/api/route-plan", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as RoutePlanSuccessBody;
    const candidates = body.bundle.candidates;
    const fastest = [...candidates].sort((left, right) => left.durationSeconds - right.durationSeconds)[0]!;
    const compared = candidates.map((candidate) => {
      const longest = candidate.id === fastest.id ? 500 : 50;
      const component = (key: "curvature" | "backroad" | "surfaceFit") => ({ ...candidate.score.components[key], input: 0.8, evidenceStatus: "estimated" as const });
      return {
        ...candidate,
        evidence: { ...candidate.evidence, curvature: {
          value: { unit: 0.8, curvyMeters: 700, totalMeters: candidate.distanceMeters, longestRunMeters: longest, continuityShare: longest / 700 },
          status: "estimated" as const, confidence: 0.8, coverage: 1, provenance: [],
        } },
        score: { ...candidate.score, components: { ...candidate.score.components, curvature: component("curvature"), backroad: component("backroad"), surfaceFit: component("surfaceFit") } },
      };
    });
    const enriched = {
      ...body, bundle: { ...body.bundle, candidates: compared },
      diagnostics: { ...body.diagnostics, funCharacter: { fingerprint: fastest.fingerprint, label: "TWISTY", confidence: 0.91, model: "jev-1.13.0", policyVersion: "test-fixture" } },
    };
    await route.fulfill({ response, json: enriched });
  });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await page.getByTestId("finish-search").fill("hawk mountain s");
  await page.getByTestId("finish-search").press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await page.getByTestId("compose-create").click();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  const sheet = page.locator(".og-planner__sheet");
  const handle = page.getByTestId("sheet-handle");
  if (await handle.isVisible() && await sheet.getAttribute("data-detent") !== "expanded") {
    await expect(page.getByTestId("routing-method-comparison")).not.toBeVisible();
    await handle.click();
  }
  // The fixture's classic recommendation is also fastest. Start by manually
  // choosing its other valid route so the comparison exercises a real switch.
  await page.locator('[data-testid^="route-card-"][aria-pressed="false"]').first().click();
  const comparison = page.getByTestId("routing-method-comparison");
  await comparison.locator("summary").first().click();
  return comparison;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`method comparison stays manual and readable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const comparison = await planComparison(page);
    const selectedCard = page.locator('[data-testid^="route-card-"][aria-pressed="true"]');
    const selectedBefore = await selectedCard.getAttribute("data-testid");
    const sustained = page.getByTestId("routing-method-sustained-curves");
    await sustained.getByRole("radio").check();
    // Reading a method must not select its route.
    await expect(selectedCard).toHaveAttribute("data-testid", selectedBefore!);
    await expect(sustained).toContainText("mapped route geometry");
    await sustained.getByRole("button", { name: "Show this route" }).click();
    await expect(sustained.getByRole("button", { name: "Already selected" })).toBeDisabled();
    await expect(comparison).toContainText(/Model confidence.*91%/);
    await expect(comparison).toContainText("uncalibrated");
    await comparison.getByText("How these options work", { exact: true }).click();
    await expect(comparison).toContainText("licensed contiguous road data");
    await expect(comparison).toContainText("Ride Arc");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    const widths = await comparison.locator("button, summary, label").evaluateAll((elements) => elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
    expect(widths.every((box) => box.width > 0)).toBe(true);
  });
}

test("keyboard inspection uses native radios and failure disables retained comparisons", async ({ page }) => {
  const comparison = await planComparison(page);
  const classic = page.getByTestId("routing-method-classic").getByRole("radio");
  await classic.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("routing-method-frontier").getByRole("radio")).toBeChecked();
  await page.unroute("**/api/route-plan");
  await page.route("**/api/route-plan", (route) => route.fulfill({ status: 503, json: { error: { code: "provider-unavailable", message: "The route planner could not be reached.", recoverable: true } } }));
  await page.getByTestId("road-character-curvy").check();
  await expect(page.getByTestId("status-line")).toContainText("previous ride");
  await expect(comparison).toContainText("Showing the previous ride");
  const selected = page.getByTestId("routing-method-frontier").getByRole("button");
  await expect(selected).toBeDisabled();
  await expect(comparison).toContainText("No Jev reading for this plan");
});
