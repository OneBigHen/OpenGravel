import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";

// The server reads this path (playwright.config.ts); the fixture pack is copied in for this spec only.
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
test.beforeAll(() => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(join(process.cwd(), "tests/fixtures/route-library/dedupe-pack.sqlite"), PACK);
});
test.afterAll(() => {
  rmSync(dirname(PACK), { recursive: true, force: true });
});

/**
 * One road listed by three sites is one card (L2a). The fixture pack
 * (tests/fixtures/route-library/dedupe-pack.sqlite)
 * holds a single card for PA 231 with two other sites credited, and its two merged-away ids
 * as aliases, so an old link opens the same card.
 */
const CARD_ID = "pa-pa-231-prosperity-avella";
const OLD_ID = "pa-231-prosperity-avella-mcr";

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`a merged card lists every other site it is on at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    // The merged-away id is an old link: it must open the merged card.
    await page.goto(`/explore/${OLD_ID}`);
    await expect(page).toHaveURL(new RegExp(`/explore/${CARD_ID}$`));
    await expect(page.getByRole("heading", { name: "PA 231: Prosperity to Avella" })).toBeVisible();

    const credit = page.getByTestId("ride-credit");
    await expect(credit).toContainText("Route by PenDutch");
    await expect(credit.getByRole("link", { name: /BestBikingRoads/ })).toHaveAttribute("href", /bestbikingroads\.com/);

    const alsoOn = page.getByTestId("also-on");
    await expect(alsoOn).toBeVisible();
    await expect(alsoOn).toContainText("Also on:");
    const sites = alsoOn.getByTestId("also-on-site");
    await expect(sites).toHaveCount(2);
    await expect(alsoOn.getByRole("link", { name: /MotorcycleRoads\.com/ })).toHaveAttribute(
      "href",
      "https://www.motorcycleroads.com/motorcycle-roads/pennsylvania/pa-231-prosperity-avella",
    );
    await expect(alsoOn.getByRole("link", { name: /OzarkRides\.com/ })).toHaveAttribute("href", "https://www.ozarkrides.com/rides/pa-231");
    // The second site's author is credited next to its link.
    await expect(alsoOn).toContainText("usagiyo11");

    // The line wraps instead of pushing the page sideways, and stays inside the screen.
    const box = await alsoOn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("the new id and the old id are the same card", async ({ page }) => {
  const viaNew = await page.request.get(`/api/catalog/${CARD_ID}`);
  const viaOld = await page.request.get(`/api/catalog/${OLD_ID}`);
  expect(viaNew.status()).toBe(200);
  expect(viaOld.status()).toBe(200);
  const newBody = (await viaNew.json()) as { route: { id: string; alsoOn?: { sourceName: string }[] } };
  const oldBody = (await viaOld.json()) as { route: { id: string } };
  expect(oldBody.route.id).toBe(CARD_ID);
  expect(newBody.route.alsoOn?.map((credit) => credit.sourceName).sort()).toEqual(["MotorcycleRoads.com", "OzarkRides.com"]);
});
