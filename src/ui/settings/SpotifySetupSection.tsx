"use client";

import { useEffect, useState } from "react";
import { validSpotifyClientId } from "@/application/spotify/client-id";

export interface SpotifySetupSectionProps {
  readonly readClientId: () => string | null;
  readonly saveClientId: (value: string) => boolean;
  readonly clearClientId: () => void;
}

export function SpotifySetupSection({ readClientId, saveClientId, clearClientId }: SpotifySetupSectionProps) {
  const [clientId, setClientId] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("https://your-open-gravel-host.example/api/spotify/callback");
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      <p className="og-settings__section-copy">Connect your own Spotify account to control playback from a ride. OpenGravel never receives your Spotify password or sends an access token to this page.</p>
      <p className="og-settings__section-copy">Leave this blank to use the server&apos;s configured app. To use your own app in the browser or PWA, create one in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a>, enable Web API, add the callback below, add your account to the app&apos;s allowed users when the app is in development mode, then save your public client ID. Development apps are limited to the owner and up to five invited users; playback controls require Spotify Premium.</p>
      <ol className="og-settings__section-copy">
        <li>Create an app and enable Web API.</li>
        <li>Add this exact callback URL:</li>
      </ol>
      <p><code id="spotify-callback-url">{callbackUrl}</code> <button className="og-settings__text-button" type="button" onClick={() => void copyCallback()}>Copy</button></p>
      <label htmlFor="spotify-client-id">Your public Spotify client ID (optional)</label>
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
      <p className="og-settings__section-copy">Only the public client ID is stored in this browser. This setting applies to the browser/PWA; the native iPhone app uses its built-in Spotify app registration. Do not paste a client secret here.</p>
      <div className="og-settings__editor-actions">
        <button className="og-settings__button og-settings__button--quiet" type="button" onClick={save}>Save app ID</button>
        <button className="og-settings__button" type="button" onClick={connect}>Connect Spotify</button>
      </div>
      {saved ? <p className="og-settings__section-copy" role="status">Saved.</p> : null}
      {message === null ? null : <p className="og-settings__section-copy" role="status">{message}</p>}
    </section>
  );
}
