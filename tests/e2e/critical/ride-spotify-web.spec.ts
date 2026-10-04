import { expect, test } from "@playwright/test";
import { clickInRideSheet, openRideSheet } from "./ride-focus-helpers";

test.use({ viewport: { width: 440, height: 956 } });

test("browser Spotify controls show device recovery and preserve Free Ride", async ({ page }, testInfo) => {
  // Deterministic API/UI evidence; actual Spotify authorization and playback
  // require a real allowlisted Premium account and are separate release gates.
  let isPlaying = true;
  const commands: string[] = [];
  const connected = () => ({
    connection: "connected", accountConnected: true, isPlaying,
    track: { uri: "spotify:track:fixture", title: "Open Road", artist: "Fixture Artist", artworkDataUrl: null },
    errorMessage: null,
  });
  await page.route("**/api/spotify/state", route => route.fulfill({ json: connected() }));
  await page.route("**/api/spotify/command", async route => {
    const command = (route.request().postDataJSON() as { command: string }).command;
    commands.push(command);
    if (command === "pause") isPlaying = false;
    if (command === "play") isPlaying = true;
    if (command === "next") {
      await route.fulfill({ status: 404, json: { code: "no_device", message: "Open Spotify on a device and start playback first." } });
      return;
    }
    await route.fulfill({ json: connected() });
  });
  await page.route("**/api/spotify/logout", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await page.getByTestId("just-ride").click();
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  await openRideSheet(page);
  await expect(page.getByTestId("ride-spotify-track")).toContainText("Open Road");
  await clickInRideSheet(page, "spotify-play-pause");
  await expect(page.getByTestId("spotify-play-pause")).toHaveText("Play");
  await clickInRideSheet(page, "spotify-next");
  await expect(page.getByTestId("ride-spotify-status")).toHaveText("Open Spotify on a device and start playback first.");
  await expect(page.getByRole("link", { name: "Spotify setup" })).toHaveAttribute("href", "/settings#spotify");
  await expect(page.getByTestId("ride-activity")).toHaveText("Free ride");
  await openRideSheet(page);
  await page.getByTestId("ride-spotify-player").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("spotify-web-controls.png") });
  await clickInRideSheet(page, "spotify-disconnect");
  await expect(page.getByTestId("ride-spotify-status")).toHaveText("Disconnected");
  expect(commands).toEqual(["pause", "next"]);
  await expect(page.getByTestId("ride-activity")).toHaveText("Free ride");
});

test("Spotify setup accepts only a public client ID and explains the exact browser callback", async ({ page }, testInfo) => {
  await page.goto("/settings#spotify");
  const setup = page.locator("#spotify");
  await expect(setup).toContainText(`${new URL(page.url()).origin}/api/spotify/callback`);
  // The developer setup sits behind an "advanced" disclosure.
  await setup.getByText("Use your own Spotify app (advanced)").click();
  const input = page.getByTestId("spotify-client-id");
  await input.fill("invalid");
  await setup.getByRole("button", { name: "Save app ID" }).click();
  await expect(setup).toContainText("32-character");
  await input.fill("0123456789abcdef0123456789abcdef");
  await setup.getByRole("button", { name: "Save app ID" }).click();
  await page.reload();
  await expect(input).toHaveValue("0123456789abcdef0123456789abcdef");
  await setup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("spotify-self-setup.png") });
});

test("a full-page Spotify sign-in round trip restores the same recording paused", async ({ page, context }) => {
  // Provider consent is simulated. The app still leaves the page and restores
  // its real durable journal, so this covers the recording boundary that a
  // command-only API mock cannot prove.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 40.14, longitude: -75.44, accuracy: 5 });
  let authorized = false;
  await page.route("**/api/spotify/state", route => route.fulfill({ json: {
    connection: authorized ? "connected" : "disconnected", accountConnected: authorized,
    isPlaying: false, track: null, errorMessage: null,
  } }));
  await page.route("**/api/spotify/login?*", async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("return_to")).toBe("/ride");
    expect(url.searchParams.has("client_secret")).toBe(false);
    // A fresh navigation lets Playwright intercept provider consent separately;
    // redirect-chain requests are not routed again by Playwright.
    await route.fulfill({ contentType: "text/html", body: '<script>location.assign("https://accounts.spotify.com/authorize?fixture=consent")</script>' });
  });
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  // Keep the origin fixed across the external provider navigation.
  await page.route("https://accounts.spotify.com/authorize?fixture=consent", async route => {
    authorized = true;
    await route.fulfill({ contentType: "text/html", body: `<script>location.assign(${JSON.stringify(`${origin}/ride?spotify=connected`)})</script>` });
  });
  await page.getByTestId("record-a-ride").click();
  await expect(page.getByTestId("ride-activity")).toHaveText("Recording");
  const pointer = await page.evaluate(() => JSON.parse(localStorage.getItem("opengravel.vnext.ride-focus")!) as { sessionId: string; rideId: string });
  const recordingIds = () => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open("opengravel-vnext");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("recordings", "readonly").objectStore("recordings").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(request.result.map((row: { recordingId: string }) => row.recordingId)); };
    };
  }));
  await expect.poll(recordingIds).toHaveLength(1);
  const before = await recordingIds();
  await clickInRideSheet(page, "spotify-connect");
  await expect(page).toHaveURL(/\/ride\?spotify=connected$/);
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("ride-activity")).toHaveText("Paused");
  await expect(page.getByTestId("ride-status")).toContainText("Recovered recording");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opengravel.vnext.ride-focus")!) as { sessionId: string; rideId: string })).toMatchObject({ sessionId: pointer.sessionId, rideId: pointer.rideId });
  expect(await recordingIds()).toEqual(before);
  await openRideSheet(page);
  await expect(page.getByTestId("ride-spotify-status")).toHaveText("Connected");
});
