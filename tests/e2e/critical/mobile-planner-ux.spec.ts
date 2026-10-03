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

async function doubleTextSize(page: Page) {
  // Snapshot sizes before changing them so nested text is doubled only once.
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(
      "p, span, button, a, label, legend, h1, h2, h3, input, select, summary, .og-planner__nav-shell",
    )).filter((element) => !element.closest("svg") && element.textContent?.trim());
    const sizes = elements.map((element) => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`;
  });
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

  test(`endpoint controls have separate targets at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await chooseEndpoints(page);
    await page.getByTestId("sheet-handle").click();
    const controls = await page.locator(".og-composer").evaluate((composer) => {
      const ids = ["start-chip", "finish-chip", "start-change", "finish-change", "swap-endpoints"];
      return ids.map((id) => {
        const control = composer.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (control === null) throw new Error(`${id} must be measurable`);
        const { left, right, top, bottom, width, height } = control.getBoundingClientRect();
        return { id, left, right, top, bottom, width, height };
      });
    });
    for (const control of controls) {
      expect(control.width, `${control.id} width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${control.id} height`).toBeGreaterThanOrEqual(44);
    }
    for (const [index, first] of controls.entries()) {
      for (const second of controls.slice(index + 1)) {
        const intersects = first.left < second.right && second.left < first.right
          && first.top < second.bottom && second.top < first.bottom;
        expect(intersects, `${first.id} overlaps ${second.id}`).toBe(false);
      }
    }
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
  // Measure together: separate protocol calls can sample different frames
  // while the expanding sheet's max-height transition moves the whole head.
  const boxes = await head.evaluate((element) => {
    const box = (id: string) => {
      const control = element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (control === null) throw new Error(`${id} must be measurable`);
      const { y, width, height } = control.getBoundingClientRect();
      return { id, y, width, height };
    };
    return ["undo", "redo", "clear-ride", "sheet-handle"].map(box);
  });
  const handle = boxes.find((box) => box.id === "sheet-handle")!;
  const clear = boxes.find((box) => box.id === "clear-ride")!;
  expect.soft(Math.abs(handle.y + handle.height / 2 - clear.y - clear.height / 2)).toBeLessThanOrEqual(2);
  for (const { id, ...box } of boxes) {
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
  await doubleTextSize(page);
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

test("320px library sort remains usable with 200 percent text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/rides");
  await expect(page.getByRole("heading", { name: "Your library is ready for its first ride." })).toBeVisible();
  await doubleTextSize(page);
  const sort = page.locator(".og-library__sort select");
  await sort.scrollIntoViewIfNeeded();
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBeLessThanOrEqual(width.viewport + 1);
  await sort.selectOption("updated-asc");
  await expect(sort).toHaveValue("updated-asc");
  await sort.selectOption("updated-desc");
  await expect(sort).toHaveValue("updated-desc");
});
