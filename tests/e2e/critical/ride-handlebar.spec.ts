import { expect, test, type Page } from "@playwright/test";

import type { RoutePlanSuccessBody } from "../../../src/application/planner/ports/route-plan-contract";
import { openRideSheet, rideMapReady, startRide } from "./ride-focus-helpers";

/**
 * The handlebar ride screen (next round, N2): "On the bars I see the next turn,
 * the surface coming up, three numbers and three big buttons. Nothing else."
 *
 * Read on a phone, 440 x 956, in both themes, on the fixture ride:
 *
 * - the right rail holds at most three buttons (Recenter, Stops, Mute), with
 *   no zoom and no compass on a phone;
 * - every ride control is at least 56 x 56 px;
 * - the maneuver card, the strip and the rail together cover at most 20% of
 *   the screen;
 * - the Menu opens on Emergency, in one grouped list, with no input element;
 * - the surface-ahead line appears when the plan measured the surface and is
 *   absent when it did not;
 * - Night is dark chrome.
 *
 * The fixture plan carries no measured surface, so the "with a surface" rides
 * add three stretches (paved, gravel, paved) to the planned answer the same way
 * the routing-comparison spec adds its evidence; live road evidence is proven by
 * the real-router gate.
 */

const VIEWPORT = { width: 440, height: 956 } as const;
const TARGET = 56;
/** The brief's budget for opaque chrome: card + strip + rail, of the screen. */
const CHROME_SHARE = 0.2;
const CARD_HEIGHT = 96;

test.use({ viewport: VIEWPORT });

/** Adds a paved, a gravel and a paved stretch to every planned candidate. */
async function planWithSurface(page: Page): Promise<void> {
  await page.route("**/api/route-plan", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as RoutePlanSuccessBody;
    const candidates = body.bundle.candidates.map((candidate) => {
      const total = Math.round(candidate.distanceMeters);
      const first = Math.round(total * 0.35);
      const gravel = Math.round(total * 0.3);
      const last = total - first - gravel;
      return {
        ...candidate,
        evidence: {
          ...candidate.evidence,
          surfaceMix: {
            value: {
              surface: "paved",
              pavedMeters: first + last,
              inferredPavedMeters: 0,
              gravelMeters: gravel,
              dirtMeters: 0,
              unknownMeters: 0,
              unit: 0.8,
              unpavedShare: gravel / total,
              runs: [[first, "paved"], [gravel, "gravel"], [last, "paved"]],
            },
            status: "estimated" as const,
            confidence: 0.8,
            coverage: 1,
            provenance: [],
          },
        },
      };
    });
    await route.fulfill({ response, json: { ...body, bundle: { ...body.bundle, candidates } } });
  });
}

/** Starts the fixture ride in this theme and waits for the card to carry a turn. */
async function rideWithAFix(page: Page, theme: "day" | "night"): Promise<void> {
  await page.addInitScript(
    ([mode]) => {
      window.localStorage.setItem("og-appearance", mode as string);
      // Hold the fixture rider still after a few fixes so the readings settle.
      window.localStorage.setItem("og.rideFixture.maxFixes", "6");
    },
    [theme],
  );
  await startRide(page);
  await rideMapReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "maneuver", { timeout: 30_000 });
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The boxes of the visible elements matching `selector`, measured in one step. */
async function visibleBoxes(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((query) => {
    return [...document.querySelectorAll(query)]
      .filter((element) => element.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })
      .filter((box) => box.width > 0 && box.height > 0);
  }, selector);
}

/** Relative luminance of a computed `rgb()` colour, 0 (black) to 1 (white). */
function luminance(color: string): number {
  const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const [red = 0, green = 0, blue = 0] = channels.map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function backgroundOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((element) => getComputedStyle(element).backgroundColor);
}

for (const theme of ["day", "night"] as const) {
  test.describe(`handlebar screen, ${theme}`, () => {
    test("shows at most three rail buttons, 56 px targets, and little chrome", async ({ page }) => {
      await planWithSurface(page);
      await rideWithAFix(page, theme);

      // The rail: Recenter, Stops, Mute. No zoom and no compass on a phone.
      const railButtons = await visibleBoxes(page, '[data-testid="ride-rail"] button');
      expect(railButtons.length).toBeGreaterThanOrEqual(2);
      expect(railButtons.length).toBeLessThanOrEqual(3);
      await expect(page.getByTestId("ride-mute")).toBeVisible();
      await expect(page.getByTestId("ride-zoom")).toBeHidden();
      await expect(page.getByTestId("ride-compass")).toBeHidden();
      // Emergency is no longer a rail disc; it is a Menu row.
      await expect(page.getByTestId("ride-emergency")).toBeHidden();

      // Every ride control is at least 56 x 56 px: the rail and the strip.
      const controls = await visibleBoxes(
        page,
        '[data-testid="ride-rail"] button, [data-testid="ride-strip-bar"] :is(button, a)',
      );
      expect(controls.length).toBeGreaterThanOrEqual(5);
      for (const box of controls) {
        expect(box.width).toBeGreaterThanOrEqual(TARGET - 0.5);
        expect(box.height).toBeGreaterThanOrEqual(TARGET - 0.5);
      }
      // The strip is the three readouts and Menu, and nothing else.
      await expect(page.getByTestId("ride-strip-bar").locator(".og-ride-metrics__slot")).toHaveCount(3);
      await expect(page.getByTestId("ride-strip-bar").getByRole("button")).toHaveCount(4);

      // The card is 96 px; the chrome stays under a fifth of the screen. A "then"
      // tab hangs below the card when a second turn is near; it is not the card.
      const [card] = await visibleBoxes(page, '[data-testid="ride-maneuver"]');
      const [strip] = await visibleBoxes(page, '[data-testid="ride-strip-bar"]');
      const [then] = await visibleBoxes(page, '[data-testid="ride-maneuver-then"]');
      expect(card).toBeDefined();
      expect(strip).toBeDefined();
      const cardHeight = then === undefined ? card!.height : CARD_HEIGHT;
      if (then === undefined) {
        expect(cardHeight).toBeGreaterThanOrEqual(CARD_HEIGHT - 0.5);
        expect(cardHeight).toBeLessThanOrEqual(CARD_HEIGHT + 4);
      }
      const left = Math.min(...railButtons.map((box) => box.x));
      const right = Math.max(...railButtons.map((box) => box.x + box.width));
      const top = Math.min(...railButtons.map((box) => box.y));
      const bottom = Math.max(...railButtons.map((box) => box.y + box.height));
      const covered = card!.width * cardHeight + strip!.width * strip!.height + (right - left) * (bottom - top);
      expect(covered / (VIEWPORT.width * VIEWPORT.height)).toBeLessThanOrEqual(CHROME_SHARE);

      // Night is dark all the way through the chrome; Day is light.
      const chrome = [
        await backgroundOf(page, "ride-focus"),
        await backgroundOf(page, "ride-strip-bar"),
        await page.getByTestId("ride-mute").evaluate((element) => getComputedStyle(element).backgroundColor),
      ];
      for (const color of chrome) {
        if (theme === "night") expect(luminance(color), color).toBeLessThan(0.15);
      }
      const stripColor = chrome[1] as string;
      if (theme === "day") expect(luminance(stripColor), stripColor).toBeGreaterThan(0.6);
    });

    test("opens the Menu on Emergency, in one grouped list, with no input field", async ({ page }) => {
      await rideWithAFix(page, theme);
      await openRideSheet(page);
      const panel = page.getByTestId("ride-panel");
      await expect(panel).toBeVisible();

      // No field of any kind on open: the live-share form waits behind More.
      await expect(panel.locator("input, textarea, select, [contenteditable]")).toHaveCount(0);

      // One list, in order: Emergency first, then Pause and End ride, then
      // Sound, Screen and More, all on 56 px rows. Read in one step because the
      // Menu closes itself when it is idle.
      const rows = await page.evaluate(() => {
        const visible = (element: Element): boolean =>
          element.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
        const rowsOf = [...document.querySelectorAll('[data-testid="ride-panel"] :is(button, summary, a)')]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { id: element.getAttribute("data-testid") ?? element.tagName, y: rect.y, width: rect.width, height: rect.height };
          });
        return rowsOf;
      });
      expect(rows[0]?.id).toBe("ride-emergency");
      const order = ["ride-emergency", "ride-pause", "ride-stop", "ride-sound", "ride-style", "ride-menu-more", "ride-exit"];
      const positions = order.map((id) => rows.find((row) => row.id === id)?.y);
      for (const [index, y] of positions.entries()) expect(y, order[index]).toBeDefined();
      expect([...positions]).toEqual([...positions].sort((a, b) => (a as number) - (b as number)));
      for (const row of rows) {
        expect(row.height, row.id).toBeGreaterThanOrEqual(TARGET - 0.5);
        expect(row.width, row.id).toBeGreaterThanOrEqual(TARGET - 0.5);
      }
      expect(await backgroundOf(page, "ride-panel")).toMatch(/^rgb/);
      if (theme === "night") expect(luminance(await backgroundOf(page, "ride-panel"))).toBeLessThan(0.15);

      // Behaviour is unchanged: Emergency still opens the emergency card.
      await page.getByTestId("ride-emergency").click();
      await expect(page.getByTestId("emergency-card")).toBeVisible();
      await page.getByTestId("emergency-close").click();
      await expect(page.getByTestId("emergency-card")).toHaveCount(0);

      // Live sharing only moved: one row under More, and its form opens on request.
      await openRideSheet(page);
      await page.getByTestId("ride-menu-more").locator("summary").first().click();
      await page.getByTestId("ride-share-live").click();
      await expect(page.getByTestId("ride-live-share")).toBeVisible();
      await expect(panel.locator("input")).toHaveCount(2);
    });

    test("names the surface coming up on the card, in the surface bar's colours", async ({ page }) => {
      await planWithSurface(page);
      await rideWithAFix(page, theme);

      const line = page.getByTestId("ride-maneuver").getByTestId("ride-surface-ahead");
      await expect(line).toBeVisible({ timeout: 30_000 });
      await expect(line).toHaveText(/^(Gravel|Pavement|Dirt) (in \d+(\.\d)? (mi|ft)|now)$|^Surface not known for /);
      // The fixture's measured stretch is gravel, and the swatch wears the
      // surface bar's gravel colour (the same token the route card's bar uses).
      const swatch = page.getByTestId("ride-surface-swatch");
      const kind = await swatch.getAttribute("data-surface");
      expect(["paved", "gravel", "dirt", "unknown"]).toContain(kind);
      const token: Record<string, string> = {
        paved: "--og-route-alt",
        gravel: "--og-warn",
        dirt: "--og-ink-2",
      };
      if (kind !== null && token[kind] !== undefined) {
        const expected = await page.evaluate((name) => {
          const probe = document.createElement("span");
          probe.style.color = `var(${name})`;
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        }, token[kind]);
        expect(await swatch.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(expected);
      }
      const [box] = await visibleBoxes(page, '[data-testid="ride-surface-swatch"]');
      expect(box?.width).toBeLessThanOrEqual(24);
    });

    test("shows no surface line on a ride with no measured surface", async ({ page }) => {
      await rideWithAFix(page, theme);
      // The card is on a turn with its distance and a reading in the strip, so
      // the line would be drawn by now if the ride had one.
      await expect(page.getByTestId("ride-maneuver-distance")).toBeVisible();
      await expect(page.getByTestId("ride-metric-value-1")).not.toHaveText("—");
      await expect(page.getByTestId("ride-surface-ahead")).toHaveCount(0);
      await expect(page.getByTestId("ride-surface-swatch")).toHaveCount(0);
    });
  });
}
