"use client";

/**
 * "Share live location" in the ride sheet: one button starts a follow link and
 * opens the phone's share sheet (Messages, WhatsApp, …) so a loved one can
 * watch the ride live. While sharing, crash detection is on and the panel says
 * when positions last reached the link. The "Are you OK?" screen is rendered
 * by `RideSafetyOverlay` over everything else.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import type { RideSafety, RideSafetySnapshot } from "@/application/safety/ride-safety";
import { CrashCheckOverlay } from "@/ui/safety/CrashCheckOverlay";

const NAME_KEY = "og.live.riderName";

/** The saved name never changes under the panel; there is nothing to watch. */
function subscribeNothing(): () => void {
  return () => undefined;
}

function readName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private window keeps the name for this ride only.
  }
}

/** What the server render (and hydration) shows: nothing shared, no check. */
const SERVER_SNAPSHOT: RideSafetySnapshot = {
  live: { status: "off", followUrl: null, alert: null, lastSentAt: null, pending: 0, error: null },
  crash: { phase: "idle", suspected: null, secondsRemaining: null },
};

function useSafety(safety: RideSafety): RideSafetySnapshot {
  return useSyncExternalStore(
    (listener) => safety.subscribe(listener),
    () => safety.snapshot(),
    () => SERVER_SNAPSHOT,
  );
}

function agoText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

/** Opens the share sheet; falls back to copying the link. */
async function sendLink(url: string, name: string): Promise<"shared" | "copied" | "failed"> {
  const text = `${name === "" ? "I'm" : `${name} is`} riding — follow live on OpenGravel`;
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: "Follow my ride", text, url });
      return "shared";
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "failed";
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

export interface RideSafetyPanelProps {
  readonly safety: RideSafety;
  /** Asked from the Share tap itself: iOS only grants motion inside a gesture. */
  readonly requestMotion?: () => Promise<unknown>;
}

export function RideSafetyPanel({ safety, requestMotion }: RideSafetyPanelProps) {
  const { live } = useSafety(safety);
  const [name, setName] = useState("");
  const saved = useSyncExternalStore(subscribeNothing, readName, () => "");
  const typedName = name !== "" ? name : saved;
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (live.status !== "sharing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [live.status]);

  const share = async (): Promise<void> => {
    setNote(null);
    void requestMotion?.();
    const riderName = typedName.trim();
    if (riderName !== "") writeName(riderName);
    const url = live.followUrl ?? (await safety.startSharing({ riderName: riderName === "" ? "Your rider" : riderName }));
    if (url === null) return;
    const sent = await sendLink(url, riderName);
    if (sent === "copied") setNote("Link copied — paste it into a message.");
  };

  if (live.status === "sharing" && live.followUrl !== null) {
    const status = live.error ?? (live.lastSentAt === null
      ? "Waiting for your first position…"
      : `Updated ${agoText(now - live.lastSentAt)}${live.pending > 5 ? ` · ${live.pending} positions waiting` : ""}`);
    return (
      <section className="og-ride__safety" data-testid="ride-live-share" aria-label="Live location">
        <div className="og-ride__safety-head">
          <span className="og-ride__safety-dot" aria-hidden="true" />
          <div>
            <strong>Sharing live location</strong>
            <p className="og-ride__safety-status" role="status">{status}</p>
          </div>
        </div>
        <p className="og-ride__safety-note">Crash detection is on while you share.</p>
        <div className="og-ride__safety-actions">
          <button type="button" className="og-ride__action og-ride__action--primary" data-testid="ride-live-send" onClick={() => void share()}>
            Send link
          </button>
          <button type="button" className="og-ride__action" data-testid="ride-live-stop" onClick={() => void safety.stopSharing()}>
            Stop sharing
          </button>
        </div>
        {note === null ? null : <p className="og-ride__safety-status" role="status">{note}</p>}
      </section>
    );
  }

  return (
    <section className="og-ride__safety" data-testid="ride-live-share" aria-label="Live location">
      <label className="og-ride__safety-name">
        <span>Your name for the link</span>
        <input
          type="text"
          value={typedName}
          maxLength={40}
          autoComplete="given-name"
          placeholder="Zac"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="og-ride__action og-ride__action--primary"
        data-testid="ride-live-start"
        disabled={live.status === "starting"}
        onClick={() => void share()}
      >
        {live.status === "starting" ? "Starting…" : "Share live location"}
      </button>
      <p className="og-ride__safety-note">
        Send a link by text. They see where you are, and get an alert if a crash is detected.
      </p>
      {live.error === null ? null : <p className="og-ride__safety-status" role="alert">{live.error}</p>}
      {note === null ? null : <p className="og-ride__safety-status" role="status">{note}</p>}
    </section>
  );
}

/** The "Are you OK?" screen, over the whole ride screen while a check is live. */
export function RideSafetyOverlay({ safety }: { readonly safety: RideSafety }) {
  const { crash } = useSafety(safety);
  const [, tick] = useState(0);
  const live = crash.phase === "countdown" || crash.phase === "escalated";
  useEffect(() => {
    if (crash.phase !== "countdown") return;
    const timer = window.setInterval(() => tick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [crash.phase]);
  if (!live) return null;
  const current = safety.crashNow();
  return (
    <CrashCheckOverlay
      status={crash.phase === "escalated" ? "escalated" : "countdown"}
      secondsRemaining={current.secondsRemaining ?? 0}
      onImOkay={() => safety.imOkay()}
      onAlertNow={() => safety.alertNow()}
      onImOkayNow={() => safety.imOkayNow()}
    />
  );
}
