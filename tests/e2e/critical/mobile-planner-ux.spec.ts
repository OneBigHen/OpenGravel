import { expect, test, type Page } from "@playwright/test";
import { plannerMap, settledExtent } from "./map-helpers";

/** Layout evidence uses the labeled geocoder/router fixtures. It does not
 * establish real-road quality or physical-phone acceptance. */
async function chooseEndpoints(page: Page) {
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search-results").getByTestId("place-option").click();
  await page.getByTestId("finish-search").fill("Hawk Mountain Sanctuary");
  await page.getByTestId("finish-search-results").getByTestId("place-option").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`search pin stays beside the input at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.getByTestId("start-search").fill("Jim Thorpe");
    await expect(page.getByTestId("start-search-results").getByTestId("place-option")).toBeVisible();
    const input = await page.getByTestId("start-search").boundingBox();
    const pin = await page.getByTestId("start-chip").boundingBox();
    if (input === null || pin === null) throw new Error("search controls must be measurable");
    expect(Math.abs(pin.y - input.y)).toBeLessThanOrEqual(2);
  });
}

test("small-phone ride style has a named entry and planning stays visible while editing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await chooseEndpoints(page);
  const handle = page.getByTestId("sheet-handle");
  await expect.soft(handle).toHaveAccessibleName("Show ride style");
  await handle.click();
  await page.getByTestId("ride-style-toggle").click();
  await page.getByTestId("road-character-curvy").check();
  const sheetBody = page.getByTestId("sheet-scroll");
  await sheetBody.evaluate((element) => { element.scrollTop = 0; });
  await expect.soft(page.getByTestId("compose-create")).toBeInViewport({ ratio: 1 });
  await page.getByTestId("compose-create").click();
  await expect(page.getByTestId("cancel-planning")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
});

test("320px comparison fits its sheet and keeps the header controls on one row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await chooseEndpoints(page);
  await page.getByTestId("compose-create").click();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await page.getByTestId("sheet-handle").click();
  const head = page.getByTestId("sheet-head");
  const handle = await page.getByTestId("sheet-handle").boundingBox();
  const clear = await page.getByTestId("clear-ride").boundingBox();
  if (handle === null || clear === null) throw new Error("sheet controls must be measurable");
  expect.soft(Math.abs(handle.y + handle.height / 2 - clear.y - clear.height / 2)).toBeLessThanOrEqual(2);
  for (const id of ["undo", "redo", "clear-ride", "sheet-handle"]) {
    const box = await head.getByTestId(id).boundingBox();
    if (box === null) throw new Error(`${id} must be measurable`);
    expect.soft(box.height, `${id} touch height`).toBeGreaterThanOrEqual(44);
    expect.soft(box.width, `${id} touch width`).toBeGreaterThanOrEqual(44);
  }
  const comparison = page.getByTestId("routing-method-comparison");
  await comparison.locator("summary").first().click();
  await page.getByTestId("routing-method-frontier").getByRole("radio").check();
  const sizes = await page.getByTestId("sheet-scroll").evaluate((element) => ({
    viewport: element.clientWidth, content: element.scrollWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
});

test("200 percent text keeps navigation labels and the planner sheet separate", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await chooseEndpoints(page);
  await page.getByTestId("compose-create").click();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await page.getByTestId("sheet-handle").click();
  // Snapshot sizes before changing them so nested text is doubled only once.
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(
      "p, span, button, a, label, legend, h1, h2, h3, input, select, summary, .og-planner__nav-shell",
    )).filter((element) => !element.closest("svg") && element.textContent?.trim());
    const sizes = elements.map((element) => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`;
  });
  const nav = page.getByTestId("primary-nav");
  const labelsFit = () => nav.locator("a").evaluateAll((links) => links.every((link) => {
    const label = link.querySelector(".og-nav__label");
    if (label === null) return false;
    const target = link.getBoundingClientRect();
    const text = label.getBoundingClientRect();
    return text.left >= target.left - 1 && text.right <= target.right + 1 && text.bottom <= target.bottom + 1;
  }));
  await expect.soft.poll(labelsFit).toBe(true);
  await expect.poll(async () => {
    const bar = await nav.boundingBox();
    const sheet = await page.getByTestId("planner-sheet").boundingBox();
    if (bar === null || sheet === null) throw new Error("navigation and sheet must be measurable");
    return bar.y - sheet.y - sheet.height;
  }).toBeGreaterThanOrEqual(5);
  const body = await page.getByTestId("sheet-scroll").boundingBox();
  const heading = await page.getByTestId("sheet-handle-label").boundingBox();
  if (body === null || heading === null) throw new Error("sheet heading must be measurable");
  expect(heading.y + heading.height).toBeLessThanOrEqual(body.y);
  const fade = await page.getByTestId("planner-sheet").evaluate((sheet) => {
    const head = sheet.querySelector<HTMLElement>(".og-sheet__head");
    if (head === null) throw new Error("sheet head is missing");
    const fades = [sheet, head].flatMap((element) => {
      const style = getComputedStyle(element, "::after");
      if (style.content === "none" || style.position !== "absolute" || parseFloat(style.height) <= 0) return [];
      return [element.getBoundingClientRect().top + parseFloat(style.top)];
    });
    return { tops: fades, headBottom: head.getBoundingClientRect().bottom };
  });
  expect(fade.tops).toHaveLength(1);
  expect.soft(fade.tops[0]).toBeGreaterThanOrEqual(fade.headBottom - 1);
  expect(fade.tops[0]).toBeLessThanOrEqual(body.y + 1);
  for (const link of await nav.locator("a").all()) await expect(link).toBeInViewport({ ratio: 1 });
});
