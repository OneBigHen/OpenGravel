import { expect, test, type CDPSession, type Page } from "@playwright/test";

import {
  fractionOf,
  placeEndpoint,
  plannerMap,
  readCoordinate,
  settledExtent,
} from "./map-helpers";

/**
 * The map never edits a ride by itself (maps-for-riders §1–2).
 *
 * The owner's complaint was "taps randomly set locations and pins": a stray
 * touch on the bars routed the rider somewhere, and a pan that began near a pin
 * moved it. These gestures are real touch input through Chrome's DevTools
 * protocol — the same pointer stream an iPhone sends — so a pan, a pinch, a
 * fling, a slow press or a tap that stops a glide is judged exactly as the
 * rider's hand would be.
 */

const PHONE = { width: 390, height: 844 };
const START_COORDINATE = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE = { lon: -75.4335, lat: 40.1325 };

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });
// Each gesture is real input with its own pacing; dozens of them need room.
test.setTimeout(150_000);

interface Point {
  readonly x: number;
  readonly y: number;
}

type TouchPhase = "touchStart" | "touchMove" | "touchEnd";

async function touch(cdp: CDPSession, type: TouchPhase, points: readonly Point[]): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })),
  });
}

async function pan(page: Page, cdp: CDPSession, from: Point, to: Point, steps: number, stepMs: number): Promise<void> {
  await touch(cdp, "touchStart", [from]);
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    await touch(cdp, "touchMove", [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
    await page.waitForTimeout(stepMs);
  }
  await touch(cdp, "touchEnd", []);
}

/** Two fingers; the first can stay still while the second does all the moving. */
async function pinch(page: Page, cdp: CDPSession, center: Point, from: number, to: number, firstStill: boolean): Promise<void> {
  const first = (gap: number): Point => (firstStill ? { x: center.x - from / 2, y: center.y } : { x: center.x - gap / 2, y: center.y });
  const second = (gap: number): Point => ({ x: first(gap).x + gap, y: center.y });
  await touch(cdp, "touchStart", [first(from)]);
  await touch(cdp, "touchStart", [first(from), second(from)]);
  for (let step = 1; step <= 6; step += 1) {
    const gap = from + ((to - from) * step) / 6;
    await touch(cdp, "touchMove", [first(gap), second(gap)]);
    await page.waitForTimeout(16);
  }
  // The second finger lifts first, then the first: its release must not tap.
  await touch(cdp, "touchEnd", [first(to)]);
  await page.waitForTimeout(40);
  await touch(cdp, "touchEnd", []);
}

async function press(page: Page, cdp: CDPSession, at: Point, holdMs: number): Promise<void> {
  await touch(cdp, "touchStart", [at]);
  await page.waitForTimeout(holdMs);
  await touch(cdp, "touchEnd", []);
}

/** A deterministic sequence, so a failure replays exactly. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

async function mapBox(page: Page): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  // Gestures stay above the sheet and away from the right-edge control column.
  const box = await plannerMap(page).boundingBox();
  const sheet = await page.getByTestId("planner-sheet").boundingBox();
  if (box === null || sheet === null) throw new Error("the map and the sheet must be measurable");
  const search = await page.getByTestId("top-search").boundingBox();
  const top = Math.max(box.y + 140, (search?.y ?? 0) + (search?.height ?? 0) + 16);
  return { x: box.x + 16, y: top, width: box.width - 96, height: Math.max(80, sheet.y - top - 40) };
}

/** A mix of everything a hand does to a map, except a deliberate long press. */
async function fuzz(page: Page, cdp: CDPSession, count: number, seed: number): Promise<void> {
  const random = seeded(seed);
  const area = await mapBox(page);
  const at = (): Point => ({ x: area.x + random() * area.width, y: area.y + random() * area.height });
  for (let index = 0; index < count; index += 1) {
    const kind = Math.floor(random() * 5);
    const from = at();
    if (kind === 0) await pan(page, cdp, from, at(), 8, 16);
    else if (kind === 1) {
      // Fling, then tap to stop the glide: the tap only stops the camera.
      await pan(page, cdp, from, { x: from.x + 140 * (random() - 0.5), y: from.y + 140 * (random() - 0.5) }, 3, 4);
      await press(page, cdp, at(), 60);
    } else if (kind === 2) await pinch(page, cdp, from, 60, 60 + 120 * random(), random() < 0.5);
    else if (kind === 3) {
      // Pan out and back to almost where it began.
      const away = { x: from.x + 50, y: from.y + 30 };
      await touch(cdp, "touchStart", [from]);
      await touch(cdp, "touchMove", [away]);
      await touch(cdp, "touchMove", [{ x: from.x + 3, y: from.y + 2 }]);
      await touch(cdp, "touchEnd", []);
    } else await press(page, cdp, from, 60 + 300 * random());
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("pans, pinches, flings and taps on an empty map author nothing", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await fuzz(page, cdp, 40, 20261025);
  await expect(page.getByTestId("start-value")).toHaveText("No start yet");
  await expect(page.getByTestId("finish-value")).toHaveText("No destination yet");
});

test("a touch pan that begins on a pin moves the map, never the pin", async ({ page }) => {
  await placeEndpoint(page, "start", START_COORDINATE);
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
  const start = await readCoordinate(page, "start-value");
  const finish = await readCoordinate(page, "finish-value");

  const cdp = await page.context().newCDPSession(page);
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const fraction = fractionOf(await settledExtent(page), START_COORDINATE);
  const pin = { x: box.x + fraction.x * box.width, y: box.y + fraction.y * box.height };
  // A quick drag from the pin itself, and one from just beside it.
  await pan(page, cdp, pin, { x: pin.x + 80, y: pin.y + 40 }, 8, 16);
  await settledExtent(page);
  await fuzz(page, cdp, 25, 7);

  expect(await readCoordinate(page, "start-value")).toEqual(start);
  expect(await readCoordinate(page, "finish-value")).toEqual(finish);
});
