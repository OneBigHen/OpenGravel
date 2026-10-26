import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 440, height: 956 } });

/**
 * The iPhone's own Spotify player, bridged through Capacitor.
 *
 * Settings is where a rider connects, cancels and disconnects; the ride shows the
 * one thing that matters while moving — what is playing, with play/pause and
 * next. Both render the same port, so this spec drives the deterministic native
 * plugin a real device would supply: the plugin, not the app, owns the account.
 */
test("native Spotify: Settings connects and cancels, and the ride controls the playing track", async ({ page }, testInfo) => {
  // This is bridge/UI evidence only. It does not claim Spotify app or physical
  // iPhone authorization: a deterministic native plugin supplies its replies.
  await page.addInitScript(() => {
    interface NativeState {
      connection: "disconnected" | "connecting" | "connected";
      isPlaying: boolean;
      track: { uri: string; title: string; artist: string } | null;
    }
    // The plugin owns the account, so its answer outlives a page load here the
    // way the real plugin's does on a phone.
    const KEY = "e2e.spotify.native.state";
    const read = (): NativeState => {
      const stored = window.sessionStorage.getItem(KEY);
      if (stored !== null) return JSON.parse(stored) as NativeState;
      const initial: NativeState = { connection: "disconnected", isPlaying: false, track: null };
      window.sessionStorage.setItem(KEY, JSON.stringify(initial));
      return initial;
    };
    let notify: (value: NativeState) => void = () => undefined;
    const write = (next: NativeState): NativeState => {
      window.sessionStorage.setItem(KEY, JSON.stringify(next));
      notify(next);
      return next;
    };
    // The authorize sheet answers on a later call, which is what the rider sees
    // when it comes back by itself after the first press.
    let attempts = 0;
    Object.assign(window, { Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: {
      isAvailable: async () => ({ available: true }),
      getState: async () => read(),
      addListener: (_event: string, listener: (value: NativeState) => void) => { notify = listener; return { remove: async () => undefined }; },
      connect: async () => {
        attempts += 1;
        return attempts === 1
          ? write({ connection: "connecting", isPlaying: false, track: null })
          : write({ connection: "connected", isPlaying: true, track: { uri: "spotify:track:fixture", title: "Open Road", artist: "Fixture Artist" } });
      },
      disconnect: async () => write({ connection: "disconnected", isPlaying: false, track: null }),
      togglePlayPause: async () => write({ ...read(), isPlaying: !read().isPlaying }),
      skipToPrevious: async () => write(read()),
      skipToNext: async () => write(read()),
      openSpotify: async () => undefined,
    } } } });
  });

  // Connecting is a Settings task: one row, one control, and a pending sign-in
  // can be called off.
  await page.goto("/settings#settings-music-title");
  const setup = page.getByRole("region", { name: "Music" });
  await setup.getByRole("button", { name: "Connect Spotify" }).click();
  await expect(setup).toContainText("Connecting…");
  await setup.getByRole("button", { name: "Cancel Spotify sign-in" }).click();
  await expect(setup).toContainText("Not connected on this iPhone.");
  await setup.getByRole("button", { name: "Connect Spotify" }).click();
  await expect(setup).toContainText("Connected on this iPhone.");

  // The ride renders the same port: the track, pause and next — and nothing that
  // asks the rider to set Spotify up.
  await page.goto("/");
  await page.getByTestId("just-ride").click();
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  const music = page.getByTestId("ride-music");
  await expect(music).toBeVisible();
  await expect(page.getByTestId("ride-music-line")).toHaveText("Open Road · Fixture Artist");
  await expect(page.getByTestId("ride-music-play")).toHaveAccessibleName("Pause");
  await expect(music.getByRole("link")).toHaveCount(0);
  await page.getByTestId("ride-music-play").click();
  await expect(page.getByTestId("ride-music-play")).toHaveAccessibleName("Play");
  await page.getByTestId("ride-music-next").click();
  // Music does not change the ride: it is still the free ride the rider started.
  await expect(page.getByTestId("ride-activity")).toHaveText("Free ride");
  await music.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("spotify-controls.png") });
});
