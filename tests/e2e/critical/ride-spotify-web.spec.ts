import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 440, height: 956 } });

/**
 * Browser Spotify on the ride screen.
 *
 * The ride shows music and nothing else: while Spotify is not connected there is
 * no row at all, and a connected row carries what is playing plus play/pause and
 * next. Connecting, disconnecting and the client-ID setup belong to Settings,
 * one screen away; the ride never explains a provider.
 */
test("browser Spotify: the ride shows what is playing and its controls reach Spotify", async ({ page }, testInfo) => {
  // Deterministic API/UI evidence; actual Spotify authorization and playback
  // require a real allowlisted Premium account and are separate release gates.
  let isPlaying = true;
  const commands: string[] = [];
  const connected = () => ({
    connection: "connected", accountConnected: true, isPlaying,
    track: { uri: "spotify:track:fixture", title: "Open Road", artist: "Fixture Artist", artworkDataUrl: null },
    errorMessage: null,
  });
  await page.route("**/api/spotify/state", (route) => route.fulfill({ json: connected() }));
  await page.route("**/api/spotify/command", async (route) => {
    const command = (route.request().postDataJSON() as { command: string }).command;
    commands.push(command);
    if (command === "pause") isPlaying = false;
    if (command === "play") isPlaying = true;
    if (command === "next") {
      // A device that cannot take the command. The ride does not repeat the
      // provider's sentence over the road; it keeps naming the track.
      await route.fulfill({ status: 404, json: { code: "no_device", message: "Open Spotify on a device and start playback first." } });
      return;
    }
    await route.fulfill({ json: connected() });
  });
  await page.goto("/");
  await page.getByTestId("just-ride").click();
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");

  // One row on the map, already connected: the track, pause and next.
  const music = page.getByTestId("ride-music");
  await expect(music).toBeVisible();
  await expect(page.getByTestId("ride-music-line")).toHaveText("Open Road · Fixture Artist");
  await expect(page.getByTestId("ride-music-play")).toHaveAccessibleName("Pause");

  await page.getByTestId("ride-music-play").click();
  await expect(page.getByTestId("ride-music-play")).toHaveAccessibleName("Play");
  await page.getByTestId("ride-music-next").click();
  await expect.poll(() => commands).toEqual(["pause", "next"]);

  // A refused command is not a claim about the road: the row still names the
  // track, no setup sentence appears on the ride, and the ride is still a free
  // ride (music never starts, pauses or ends one).
  await expect(page.getByTestId("ride-music-line")).toHaveText("Open Road · Fixture Artist");
  await expect(music).not.toContainText(/Open Spotify on a device|not registered|Spotify setup/i);
  await expect(music.getByRole("link")).toHaveCount(0);
  await expect(page.getByTestId("ride-activity")).toHaveText("Free ride");
  await music.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ride-music-connected.png") });
});

test("Spotify setup lives in Settings and takes only a public client ID", async ({ page }, testInfo) => {
  // The ride and Settings share one address for setting music up; the ride's own
  // doc comment names it, so the anchor has to resolve to the Music group.
  await page.goto("/settings#settings-music-title");
  const setup = page.getByRole("region", { name: "Music" });
  await expect(setup).toBeVisible();
  await expect(setup).toContainText(`${new URL(page.url()).origin}/api/spotify/callback`);
  // The developer setup sits behind a disclosure row.
  await setup.getByText("Use your own Spotify app").click();
  const input = page.getByTestId("spotify-client-id");
  await input.fill("invalid");
  await setup.getByRole("button", { name: "Save app ID" }).click();
  await expect(setup).toContainText("32-character");
  await input.fill("0123456789abcdef0123456789abcdef");
  await setup.getByRole("button", { name: "Save app ID" }).click();
  await expect(setup).toContainText("Your public Spotify app ID is saved on this device.");
  await page.reload();
  await expect(page.getByTestId("spotify-client-id")).toHaveValue("0123456789abcdef0123456789abcdef");
  await setup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("spotify-self-setup.png") });
});

test("a full-page Spotify sign-in from Settings restores the same recording paused", async ({ page, context }) => {
  // Provider consent is simulated. The app still leaves the page and restores
  // its real durable journal, so this covers the recording boundary that a
  // command-only API mock cannot prove.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 40.14, longitude: -75.44, accuracy: 5 });
  let authorized = false;
  await page.route("**/api/spotify/state", (route) => route.fulfill({ json: {
    connection: authorized ? "connected" : "disconnected", accountConnected: authorized,
    isPlaying: false, track: null, errorMessage: null,
  } }));
  await page.route("**/api/spotify/login?*", async (route) => {
    const url = new URL(route.request().url());
    // A rider connects from Settings, so that is where the provider comes back to.
    expect(url.searchParams.get("return_to")).toBe("/settings");
    expect(url.searchParams.has("client_secret")).toBe(false);
    // A fresh navigation lets Playwright intercept provider consent separately;
    // redirect-chain requests are not routed again by Playwright.
    await route.fulfill({ contentType: "text/html", body: '<script>location.assign("https://accounts.spotify.com/authorize?fixture=consent")</script>' });
  });
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  // Keep the origin fixed across the external provider navigation.
  await page.route("https://accounts.spotify.com/authorize?fixture=consent", async (route) => {
    authorized = true;
    await route.fulfill({ contentType: "text/html", body: `<script>location.assign(${JSON.stringify(`${origin}/settings?spotify=connected`)})</script>` });
  });
  await page.getByTestId("record-a-ride").click();
  await expect(page.getByTestId("ride-activity")).toHaveText("Recording");
  // Not connected: the ride shows no music row at all, so nothing on the road
  // asks the rider to set Spotify up.
  await expect(page.getByTestId("ride-music")).toHaveCount(0);
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

  await page.goto("/settings#settings-music-title");
  await page.getByRole("button", { name: "Connect Spotify" }).click();
  await expect(page).toHaveURL(/\/settings\?spotify=connected$/);
  await expect(page.getByRole("region", { name: "Music" })).toContainText("Spotify is connected for this browser.");

  // Back on the ride: the same recording, paused where the rider left it, and
  // the music row is now there because Spotify really is connected.
  await page.goto("/ride");
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("ride-activity")).toHaveText("Paused");
  await expect(page.getByTestId("ride-status")).toContainText("Recovered recording");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opengravel.vnext.ride-focus")!) as { sessionId: string; rideId: string })).toMatchObject({ sessionId: pointer.sessionId, rideId: pointer.rideId });
  expect(await recordingIds()).toEqual(before);
  await expect(page.getByTestId("ride-music")).toBeVisible();
});
