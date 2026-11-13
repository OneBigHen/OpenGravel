import { expect, test } from "@playwright/test";
import { placeEndpoint, plannerMap, pressPlan, settledExtent } from "./map-helpers";

// TEMPORARY measurement spec (delete before merge): names every element that
// sticks out of the sheet's scrolling column at 320 wide.
test("measure: what overflows the sheet at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await placeEndpoint(page, "start", { lat: 40.1385, lon: -75.4385 });
  await placeEndpoint(page, "finish", { lat: 40.1325, lon: -75.4335 });
  await pressPlan(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await page.getByTestId("sheet-handle").click();
  const report = await page.getByTestId("sheet-scroll").evaluate((root) => {
    const base = root.getBoundingClientRect();
    const out: string[] = [`scroll viewport=${root.clientWidth} content=${root.scrollWidth}`];
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0) continue;
      const over = Math.round(box.right - base.right);
      if (over > 0) {
        out.push(`+${over}px ${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? "").trim().slice(0, 60)}"`);
      }
      if (element.scrollWidth > element.clientWidth + 1) {
        out.push(`inner ${element.tagName.toLowerCase()}.${element.className} client=${element.clientWidth} scroll=${element.scrollWidth}`);
      }
    }
    return out.slice(0, 40).join("\n");
  });
  console.log(report);
});
