import { expect, test } from "@playwright/test";
import { useConnectedRouteFixture } from "./connected-route-fixture";
import { plannerMap, settledExtent } from "./map-helpers";

// TEMPORARY measurement spec (delete before merge).
test("measure: ride summary heights at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await useConnectedRouteFixture(page);
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.getByTestId("search-chip-gas").click();
  await page.getByTestId("category-result").first().click();
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("route-summary")).toBeVisible();
  const report = await page.evaluate(() => {
    const lines: string[] = [];
    const sheet = document.querySelector<HTMLElement>('[data-testid="planner-sheet"]');
    const box = (element: Element | null) => {
      if (element === null) return "absent";
      const r = element.getBoundingClientRect();
      return `y=${Math.round(r.y)} b=${Math.round(r.bottom)} h=${Math.round(r.height)}`;
    };
    lines.push(`sheet ${box(sheet)}`);
    for (const id of ["route-summary", "start-ride", "compare-rides", "phone-surface-legend", "sheet-scroll"]) {
      lines.push(`${id} ${box(document.querySelector(`[data-testid="${id}"]`))}`);
    }
    for (const selector of [".og-phone-summary__eta", ".og-phone-summary__facts", ".og-phone-summary__meta", ".og-phone-summary__arrive", ".og-truth", ".og-phone-summary__strip"]) {
      lines.push(`${selector} ${box(document.querySelector(selector))} lines=${document.querySelectorAll(selector).length}`);
    }
    const meta = document.querySelector<HTMLElement>(".og-phone-summary__meta");
    if (meta !== null) {
      lines.push(`meta children: ${Array.from(meta.children).map((child) => `${child.className}=${box(child)}`).join(" | ")}`);
    }
    return lines.join("\n");
  });
  console.log(report);
});
