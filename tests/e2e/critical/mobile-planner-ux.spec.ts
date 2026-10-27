import { directionsTo } from "./search-helpers";
import { expect, test, type Page } from "@playwright/test";
import { placeEndpoint, plannerMap, pressPlan, settledExtent } from "./map-helpers";

/** Layout evidence uses the labeled geocoder/router fixtures. It does not
 * establish real-road quality or physical-phone acceptance. */
async function chooseEndpoints(page: Page) { await directionsTo(page); }

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
  test(`top search and categories stay reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.getByTestId("top-place-search").fill("Jim Thorpe");
    await expect(page.getByTestId("top-place-search-results").getByTestId("place-option")).toBeVisible();
    await expect(page.getByTestId("search-chip-gas")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("top-place-search")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("finish-search")).toHaveCount(0);
  });

  test(`endpoint controls have separate targets at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await chooseEndpoints(page);
    // Edit the ride once it is found: an answer that lands mid-edit swaps the
    // sheet back to the route options.
    await expect(page.getByTestId("start-ride")).toBeVisible();
    await page.getByTestId("trip-edit").click();
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

test("small-phone ride style has a named entry and the plan stays visible while editing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await chooseEndpoints(page);
  await page.getByTestId("route-options-settings").click();
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
  const replan = page.waitForRequest((request) => request.url().includes("/api/route-plan") && request.method() === "POST"
    && request.postDataJSON().request.options.roadCharacter === "curvy");
  await page.getByTestId("road-character-curvy").check();
  await replan;
  const sheetBody = page.getByTestId("sheet-scroll");
  await sheetBody.evaluate((element) => { element.scrollTop = 0; });
  // The style change plans by itself once the rider stops changing it (04 §21), so
  // what has to stay visible in the edited sheet is the plan itself — its status
  // line and the ride it produces — rather than a commitment button the pick
  // already pressed.
  await page.getByTestId("back-to-options").click();
  await page.getByTestId("start-ride").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
});

test("320px comparison fits its sheet and keeps the header controls on one row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  // The comparison only renders on the explicit debug page.
  await page.goto("/?debug=routing");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  // Explicit map authoring keeps the debug comparison in the composer.
  await placeEndpoint(page, "start", { lat: 40.1385, lon: -75.4385 });
  await placeEndpoint(page, "finish", { lat: 40.1325, lon: -75.4335 });
  await pressPlan(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await page.getByTestId("sheet-handle").click();
  const head = page.getByTestId("planner-sheet");
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
  expect(clear.height).toBeGreaterThanOrEqual(48);
  // Google's slim grab bar: 24px drawn, plus a 12px lip over the sheet's edge.
  expect(handle.height).toBeGreaterThanOrEqual(24);
  for (const { id, ...box } of boxes.filter((box) => box.id !== "sheet-handle")) {
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
  // The tab bar belongs to the home screen; an open route hides it (Google's
  // directions view), so the labels are measured with no route on the map.
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
  }).toBeGreaterThanOrEqual(0);
  const size = await page.getByTestId("sheet-scroll").evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.width + 1);
  for (const link of await nav.locator("a").all()) await expect(link).toBeInViewport({ ratio: 1 });
});

test("320px library segments remain usable with 200 percent text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/rides");
  await expect(page.getByRole("heading", { name: "No saved rides yet" })).toBeVisible();
  // An empty library has nothing to segment, so the switch waits for a ride.
  await expect(page.getByRole("button", { name: "Planned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recorded" })).toHaveCount(0);
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "short.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from('<gpx version="1.0"><name>Short ride</name><rte><rtept lon="-75" lat="40"/><rtept lon="-74.9" lat="40.1"/></rte></gpx>') });
  await page.getByRole("heading", { name: "Choose tracks" }).waitFor();
  await page.getByRole("button", { name: "Import separately" }).click();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  await expect(page.getByRole("button", { name: "Open Short ride" })).toBeVisible();
  await doubleTextSize(page);
  const planned = page.getByRole("button", { name: "Planned" });
  await planned.scrollIntoViewIfNeeded();
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBeLessThanOrEqual(width.viewport + 1);
  await expect(planned).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Recorded" }).click();
  await expect(page.getByRole("button", { name: "Recorded" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No recorded rides yet.")).toBeVisible();
  await planned.click();
  await expect(page.getByRole("button", { name: "Open Short ride" })).toBeVisible();
});
