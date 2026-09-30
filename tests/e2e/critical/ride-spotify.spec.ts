import { expect, test } from "@playwright/test";
import { clickInRideSheet, openRideSheet } from "./ride-focus-helpers";

test.use({ viewport: { width: 440, height: 956 } });

test("optional native Spotify controls cancel authorization and control playback without ending Free Ride", async ({ page }, testInfo) => {
  // This is bridge/UI evidence only. It does not claim Spotify app or physical
  // iPhone authorization: a deterministic native plugin supplies its replies.
  await page.addInitScript(() => {
    let attempts = 0;
    let state = { connection: "disconnected", isPlaying: false, track: null as null | { uri: string; title: string; artist: string } };
    let notify: (value: typeof state) => void = () => undefined;
    const publish = (): typeof state => { notify(state); return state; };
    Object.assign(window, { Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: {
      isAvailable: async () => ({ available: true }),
      getState: async () => state,
      addListener: (_event: string, listener: typeof notify) => { notify = listener; return { remove: async () => undefined }; },
      connect: async () => {
        attempts += 1;
        state = attempts === 1
          ? { connection: "connecting", isPlaying: false, track: null }
          : { connection: "connected", isPlaying: true, track: { uri: "spotify:track:fixture", title: "Open Road", artist: "Fixture Artist" } };
        return publish();
      },
      disconnect: async () => { state = { connection: "disconnected", isPlaying: false, track: null }; return publish(); },
      togglePlayPause: async () => { state = { ...state, isPlaying: !state.isPlaying }; return publish(); },
      skipToPrevious: async () => publish(),
      skipToNext: async () => publish(),
      openSpotify: async () => undefined,
    } } } });
  });
  await page.goto("/");
  await page.getByTestId("just-ride").click();
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  await clickInRideSheet(page, "spotify-connect");
  await expect(page.getByTestId("ride-spotify-status")).toHaveText("Connecting…");
  await clickInRideSheet(page, "spotify-disconnect");
  await expect(page.getByTestId("ride-spotify-status")).toHaveText("Disconnected");
  await clickInRideSheet(page, "spotify-connect");
  await expect(page.getByTestId("ride-spotify-track")).toContainText("Open Road");
  await expect(page.getByTestId("ride-spotify-track")).toContainText("Fixture Artist");
  await clickInRideSheet(page, "spotify-play-pause");
  await expect(page.getByTestId("spotify-play-pause")).toHaveText("Play");
  await expect(page.getByTestId("ride-activity")).toHaveText("Free ride");
  await openRideSheet(page);
  await page.getByTestId("ride-spotify-player").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("spotify-controls.png") });
});
