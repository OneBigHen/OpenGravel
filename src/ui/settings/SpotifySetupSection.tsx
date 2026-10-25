"use client";

import { useEffect, useState } from "react";
import { validSpotifyClientId } from "@/application/spotify/client-id";
import type { SpotifyPlayerPort, SpotifyPlayerSnapshot } from "@/application/ride-session/ports/spotify-player";
import { Chevron, SettingsGroup } from "./SettingsGroup";

export interface SpotifySetupSectionProps {
  readonly readClientId: () => string | null;
  readonly saveClientId: (value: string) => boolean;
  readonly clearClientId: () => void;
  readonly nativePlayer?: SpotifyPlayerPort;
}

export function SpotifySetupSection({ readClientId, saveClientId, clearClientId, nativePlayer }: SpotifySetupSectionProps) {
  const [clientId, setClientId] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("https://your-open-gravel-host.example/api/spotify/callback");
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nativeSnapshot, setNativeSnapshot] = useState<SpotifyPlayerSnapshot | null>(() => nativePlayer?.snapshot() ?? null);

  useEffect(() => nativePlayer?.subscribe(setNativeSnapshot), [nativePlayer]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setClientId(readClientId() ?? "");
      setCallbackUrl(`${window.location.origin}/api/spotify/callback`);
      const status = new URLSearchParams(window.location.search).get("spotify");
      if (status === "connected") setMessage("Spotify is connected for this browser.");
      if (status === "cancelled") setMessage("Spotify sign-in was cancelled.");
      if (status === "error") setMessage("Spotify sign-in could not be completed.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clearClientId, readClientId]);

  function save(): void {
    const value = clientId.trim();
    if (value.length === 0) {
      clearClientId();
      setSaved(true);
      setMessage("Using OpenGravel's configured Spotify app.");
      return;
    }
    if (!validSpotifyClientId(value) || !saveClientId(value)) {
      setSaved(false);
      setMessage("Enter the 32-character public Spotify client ID.");
      return;
    }
    setClientId(value);
    setSaved(true);
    setMessage("Your public Spotify app ID is saved on this device.");
  }

  function connect(): void {
    if (nativePlayer !== undefined) {
      void nativePlayer.connect();
      return;
    }
    const value = clientId.trim();
    if (value.length > 0 && (!validSpotifyClientId(value) || !saveClientId(value))) {
      setMessage("Enter the 32-character public Spotify client ID first.");
      return;
    }
    if (value.length === 0) clearClientId();
    const url = new URL("/api/spotify/login", window.location.origin);
    url.searchParams.set("return_to", "/settings");
    if (value.length > 0) url.searchParams.set("client_id", value);
    window.location.assign(url.toString());
  }

  async function copyCallback(): Promise<void> {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setMessage("Callback URL copied.");
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      const element = document.getElementById("spotify-callback-url");
      if (element !== null) {
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
        setMessage("Callback URL selected; copy it from the browser.");
      }
    }
  }

  const connected = nativeSnapshot?.connection === "connected";
  const connecting = nativeSnapshot?.connection === "connecting";
  const unavailable = nativeSnapshot?.connection === "unavailable";
  const nativeStatus = nativeSnapshot === null
    ? null
    : nativeSnapshot.errorMessage ?? (connected ? "Connected on this iPhone." : connecting ? "Connecting…" : unavailable ? "Spotify is unavailable in this iPhone build." : "Not connected on this iPhone.");

  return (
    <SettingsGroup id="settings-music-title" label="Music">
      <div className="og-settings__row">
        <span className="og-settings__row-text">
          <span className="og-settings__row-label">Spotify</span>
          {/* The Premium requirement is the rider's business before they connect,
              not a permanent note once playback already works. */}
          {connected || connecting ? null : <span className="og-settings__row-meta">Playback controls need Spotify Premium.</span>}
          {nativeStatus === null ? null : <span className="og-settings__row-meta" role="status">{nativeStatus}</span>}
        </span>
        {connected || connecting ? (
          <button className="og-settings__row-action" type="button" aria-label={connecting ? "Cancel Spotify sign-in" : "Disconnect Spotify"} onClick={() => void nativePlayer?.disconnect()}>
            {connecting ? "Cancel" : "Disconnect"}
          </button>
        ) : (
          <button className="og-settings__row-action" type="button" aria-label="Connect Spotify" disabled={unavailable} onClick={connect}>
            Connect
          </button>
        )}
      </div>
      {/* The developer setup is for people running their own Spotify app; it is
          a disclosure row, never the first thing on the page. */}
      <details className="og-settings__disclosure" open={clientId.length > 0 ? true : undefined}>
        <summary className="og-settings__row og-settings__row--button">
          <span className="og-settings__row-text">
            <span className="og-settings__row-label">Use your own Spotify app</span>
            <span className="og-settings__row-meta">Advanced</span>
          </span>
          <Chevron />
        </summary>
        <div className="og-settings__disclosure-body">
          <ol className="og-settings__note">
            <li>In the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a>, create an app and enable Web API.</li>
            <li>Add this exact callback URL:</li>
          </ol>
          <p className="og-settings__spotify-callback"><code id="spotify-callback-url">{callbackUrl}</code> <button className="og-settings__text-button" type="button" onClick={() => void copyCallback()}>Copy</button></p>
          <ol className="og-settings__note" start={3}>
            <li>While the app is in Development Mode, add your Spotify account to its allowed users (up to five; the app owner needs Premium).</li>
            <li>Paste the app&apos;s public client ID here and save.</li>
          </ol>
          <label className="og-settings__field" htmlFor="spotify-client-id">Public client ID
            <input
              id="spotify-client-id"
              data-testid="spotify-client-id"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              placeholder="32-character client ID"
              onChange={(event) => { setClientId(event.target.value); setSaved(false); }}
            />
          </label>
          <p className="og-settings__note">Only the public client ID is stored, in this browser. Never paste a client secret. The iPhone app uses its own built-in registration.</p>
          <div className="og-settings__editor-actions">
            <button className="og-settings__button og-settings__button--quiet" type="button" onClick={save}>Save app ID</button>
          </div>
        </div>
      </details>
      {/* What the last action did stays on the row's group, not inside a
          disclosure the rider may have just closed. */}
      {saved ? <p className="og-settings__card-block og-settings__note" role="status">Saved.</p> : null}
      {message === null ? null : <p className="og-settings__card-block og-settings__note" role="status">{message}</p>}
    </SettingsGroup>
  );
}
