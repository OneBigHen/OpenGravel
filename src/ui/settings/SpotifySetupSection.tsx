"use client";

import { useEffect, useState } from "react";
import { validSpotifyClientId } from "@/application/spotify/client-id";
import type { SpotifyPlayerPort, SpotifyPlayerSnapshot } from "@/application/ride-session/ports/spotify-player";

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

  return (
    <section id="spotify" className="og-settings__section" aria-labelledby="settings-spotify-title">
      <div className="og-settings__section-heading">
        <div><p className="og-settings__eyebrow">OPTIONAL MUSIC</p><h2 id="settings-spotify-title">Spotify</h2></div>
      </div>
      <p className="og-settings__section-copy">Control your music from the ride screen. OpenGravel never sees your Spotify password. Playback controls need Spotify Premium.</p>
      <div className="og-settings__editor-actions">
        {nativeSnapshot?.connection === "connected" || nativeSnapshot?.connection === "connecting" ? (
          <button className="og-settings__button" type="button" onClick={() => void nativePlayer?.disconnect()}>{nativeSnapshot.connection === "connecting" ? "Cancel" : "Disconnect Spotify"}</button>
        ) : (
          <button className="og-settings__button" type="button" disabled={nativePlayer !== undefined && nativeSnapshot?.connection === "unavailable"} onClick={connect}>Connect Spotify</button>
        )}
      </div>
      {/* The developer setup is for people running their own Spotify app; it
          used to be the first thing on Settings (owner review 2026-10-04). */}
      <details className="og-settings__advanced" open={clientId.length > 0 ? true : undefined}>
        <summary>Use your own Spotify app (advanced)</summary>
        <ol className="og-settings__section-copy">
          <li>In the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a>, create an app and enable Web API.</li>
          <li>Add this exact callback URL:</li>
        </ol>
        <p className="og-settings__spotify-callback"><code id="spotify-callback-url">{callbackUrl}</code> <button className="og-settings__text-button" type="button" onClick={() => void copyCallback()}>Copy</button></p>
        <ol className="og-settings__section-copy" start={3}>
          <li>While the app is in Development Mode, add your Spotify account to its allowed users (up to five; the app owner needs Premium).</li>
          <li>Paste the app&apos;s public client ID here and save.</li>
        </ol>
        <label htmlFor="spotify-client-id">Public client ID</label>
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
        <p className="og-settings__section-copy">Only the public client ID is stored, in this browser. Never paste a client secret. The iPhone app uses its own built-in registration.</p>
        <div className="og-settings__editor-actions">
          <button className="og-settings__button og-settings__button--quiet" type="button" onClick={save}>Save app ID</button>
        </div>
      </details>
      {nativeSnapshot === null ? null : <p className="og-settings__section-copy" role="status">{nativeSnapshot.errorMessage ?? (nativeSnapshot.connection === "connected" ? "Spotify is connected on this iPhone." : nativeSnapshot.connection === "connecting" ? "Connecting…" : nativeSnapshot.connection === "unavailable" ? "Spotify is unavailable in this iPhone build." : "Spotify is disconnected on this iPhone.")}</p>}
      {saved ? <p className="og-settings__section-copy" role="status">Saved.</p> : null}
      {message === null ? null : <p className="og-settings__section-copy" role="status">{message}</p>}
    </section>
  );
}
