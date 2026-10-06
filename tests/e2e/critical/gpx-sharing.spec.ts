import { expect, test } from "@playwright/test";
import sharp from "sharp";

const points = Array.from({ length: 40 }, (_, i) => `<trkpt lon="${-75 + i * 0.004}" lat="${40 + i * 0.004}"><time>2026-10-06T12:00:00Z</time></trkpt>`).join("");
const gpx = `<gpx version="1.1"><metadata><name>Weekend GPX</name></metadata><wpt lon="-75" lat="40"><name>Private waypoint</name></wpt><trk><name>Weekend GPX</name><trkseg>${points}</trkseg></trk></gpx>`;

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`private GPX upload and explicit group listing at ${viewport.width}x${viewport.height}`, async ({ page, browser }) => {
    await page.setViewportSize(viewport);
    const shares: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/community/routes")) shares.push(request.postDataJSON());
    });
    await page.goto("/rides");
    await expect(page.getByRole("heading", { name: "Upload your GPX ride" })).toBeVisible();
    await expect(page.getByText("Import from SwitchBack")).toHaveCount(0);
    await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "weekend.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
    await page.getByRole("heading", { name: "Choose tracks" }).waitFor();
    await page.getByRole("button", { name: "Import separately" }).click();
    await page.getByRole("button", { name: "Import selected tracks" }).click();
    await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
    expect(shares).toHaveLength(0);
    await page.reload();
    const card = page.locator(".og-library__row").filter({ has: page.getByRole("textbox", { name: "Rename Weekend GPX" }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Share with everyone" }).click();
    await expect(card.getByRole("checkbox", { name: "Hide the start (500 m)" })).toBeChecked();
    await expect(card.getByRole("img", { name: "Public route preview" })).toBeVisible();
    const publicName = `Weekend ${viewport.width} ${test.info().project.name}`;
    await card.getByRole("textbox", { name: "Public ride name" }).fill(publicName);
    await card.getByRole("spinbutton", { name: "Extra distance to remove from each end (meters)" }).fill("750");
    await card.getByRole("textbox", { name: "Ride notes (optional)" }).fill("A synthetic test ride. Fuel at the village.");
    await card.getByLabel("Ride photos (optional)").setInputFiles({ name: "test.png", mimeType: "image/png", buffer: await sharp({ create: { width: 16, height: 12, channels: 3, background: "green" } }).png().toBuffer() });
    await expect(card.getByRole("img", { name: "Photo 1 to publish" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/community/routes"));
    await card.getByRole("button", { name: "Share it" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const { id } = await response.json();
    await expect(card.getByText(/Shared with everyone/)).toBeVisible();
    expect(shares).toHaveLength(1);
    const shared = shares[0] as { name: string; geometry: number[][] };
    expect(Object.keys(shared).sort()).toEqual(["description", "geometry", "name", "photos"]);
    expect(shared.geometry[0]).not.toEqual([-75, 40]);
    expect(JSON.stringify(shared)).not.toContain("Private waypoint");
    const other = await browser.newContext();
    const reader = await other.newPage();
    await reader.goto(new URL(`/explore/${id}`, page.url()).href);
    await expect(reader.getByRole("heading", { name: publicName, exact: true })).toBeVisible();
    await expect(reader.getByText(/Not checked by OpenGravel/).first()).toBeVisible();
    await expect(reader.getByText("A synthetic test ride. Fuel at the village.", { exact: true })).toBeVisible();
    await expect(reader.getByRole("button", { name: "Open photo 1 of 1" })).toBeVisible();
    await expect(reader.locator('img[src^="/api/community/routes/"]')).toHaveJSProperty("naturalWidth", 16);
    await expect(reader.getByLabel("Leave a comment")).toBeVisible();
    if (viewport.width === 1440) {
      await reader.getByLabel("Leave a comment").fill("Synthetic test comment for review.");
      await reader.getByRole("button", { name: "Post comment" }).click();
      await expect(reader.getByText("Comment sent for review. It will appear after approval. Posted from this device.")).toBeVisible();
    }
    await other.close();
    // Publishing never replaces or renames the private saved ride.
    await expect(card.getByRole("textbox", { name: "Rename Weekend GPX" })).toHaveValue("Weekend GPX");
  });
}

test("ordinary GPX 1.0 route uploads work without migration-specific restrictions", async ({ page }) => {
  await page.goto("/rides");
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "other-app.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from('<gpx version="1.0"><name>Other app ride</name><rte><rtept lon="-75" lat="40"/><rtept lon="-74.9" lat="40.1"/></rte></gpx>') });
  await page.getByRole("heading", { name: "Choose tracks" }).waitFor();
  await page.getByRole("button", { name: "Import separately" }).click();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  await expect(page.getByRole("textbox", { name: "Rename Other app ride" })).toBeVisible();
});

test("rejects external entities without saving a ride, then accepts a corrected file", async ({ page }) => {
  await page.goto("/rides");
  const input = page.getByLabel("Import GPX, KML, or KMZ");
  await input.setInputFiles({ name: "bad.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from('<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx version="1.1"><name>&x;</name></gpx>') });
  await expect(page.locator(".og-import__error")).toContainText(/DOCTYPE|entities/i);
  await expect(page.locator(".og-library__row")).toHaveCount(0);
  await input.setInputFiles({ name: "good.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await expect(page.getByRole("heading", { name: "Choose tracks" })).toBeVisible();
});

test("renders hostile GPX names as text and rejects them as public names", async ({ page }) => {
  await page.goto("/rides");
  await page.getByLabel("Import GPX, KML, or KMZ").setInputFiles({ name: "literal.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx.replaceAll("Weekend GPX", "&lt;img src=x onerror=alert(1)&gt;")) });
  await page.getByRole("heading", { name: "Choose tracks" }).waitFor();
  expect(await page.locator(".og-import__tracks img").count()).toBe(0);
  await page.getByRole("button", { name: "Import separately" }).click();
  await page.getByRole("button", { name: "Import selected tracks" }).click();
  const card = page.locator(".og-library__row");
  await card.getByRole("button", { name: "Share with everyone" }).click();
  await card.getByRole("button", { name: "Share it" }).click();
  await expect(card.getByRole("alert")).toContainText(/plain-text/);
  await expect(card.getByRole("textbox", { name: "Public ride name" })).toBeEnabled();
});
