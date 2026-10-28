"use client";

/**
 * "Share live location" in the ride sheet: one button starts a follow link and
 * opens the phone's share sheet (Messages, WhatsApp, …) so a loved one can
 * watch the ride live. While sharing, crash detection is on and the panel says
 * when positions last reached the link. The "Are you OK?" screen is rendered
 * by `RideSafetyOverlay` over everything else.
 *
 * The link also carries the road ahead and the finish time the rider expects, so
 * a follower can see the route and knows when to worry. The finish time starts
 * at the route's own estimate plus a margin and belongs to the rider: they may
 * move it, and leaving it empty shares no finish time at all — the follower page
 * then says nothing about being due or overdue.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import { shareRouteGeometry } from "@/application/live/share-plan";
import { LIVE_RIDER_NAME_STORAGE_KEY as NAME_KEY } from "@/application/live/storage-keys";
import type { RideSafety, RideSafetySnapshot } from "@/application/safety/ride-safety";
import {
  defaultExpectedFinishAt,
  expectedFinishAtFromTimeOfDay,
  timeOfDayValue,
} from "@/domain/live/expected-finish";
import type { Coordinate } from "@/domain/ride/types";
import { CrashCheckOverlay } from "@/ui/safety/CrashCheckOverlay";


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

/** `"16:40"` in the rider's own timezone, as a clock time for a sentence. */
function clockOf(atMs: number): string {
  return new Date(atMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  /** The line the ride follows, shared so a follower sees the road ahead. */
  readonly routeLine?: readonly Coordinate[];
  /** The route's own time left, which is where the expected finish starts from. */
  readonly remainingDurationSeconds?: number | null;
}

export function RideSafetyPanel({
  safety,
  requestMotion,
  routeLine,
  remainingDurationSeconds = null,
}: RideSafetyPanelProps) {
  const { live } = useSafety(safety);
  const [name, setName] = useState("");
  const saved = useSyncExternalStore(subscribeNothing, readName, () => "");
  const typedName = name !== "" ? name : saved;
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /**
   * The finish time this panel sent with the link, once it has made one. `null`
   * before that — including after a reload, where the link already exists and
   * only the follower page knows what it carries — so the panel never claims a
   * finish time was or was not shared when it cannot tell.
   */
  const [sentFinishAt, setSentFinishAt] = useState<{ readonly at: number | null } | null>(null);
  /**
   * The rider's own finish time (`input[type=time]` shape) once they have
   * touched it, or `null` while the panel still offers its own suggestion.
   */
  const [editedFinish, setEditedFinish] = useState<{ readonly value: string; readonly passed: boolean } | null>(null);
  /**
   * False during the server render and the hydration pass, true afterwards.
   * The suggested finish is read from the device's clock, so it must not take
   * part in the first paint: the server has a different clock, and a value that
   * differed between the two renders would be a hydration error.
   */
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const suggestedFinish = mounted && remainingDurationSeconds !== null
    ? timeOfDayValue(defaultExpectedFinishAt(now, remainingDurationSeconds * 1000) ?? Number.NaN)
    : "";
  const finish = editedFinish ?? { value: suggestedFinish, passed: false };

  const editFinish = (value: string): void => {
    const at = value === "" ? null : expectedFinishAtFromTimeOfDay(value, Date.now());
    setEditedFinish({ value, passed: at !== null && at <= Date.now() });
  };

  // The clock the panel reads. It ticks whether or not this ride is sharing,
  // because the suggested finish time is "the route's estimate from now, plus
  // the margin": read once at mount, it would creep into the past over a long
  // ride, and read during render it would be a different value on the server.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const share = async (): Promise<void> => {
    setNote(null);
    void requestMotion?.();
    const riderName = typedName.trim();
    if (riderName !== "") writeName(riderName);
    const finishAt = finish.value === "" ? null : expectedFinishAtFromTimeOfDay(finish.value, Date.now());
    const plan = finishAt === null ? null : { expectedFinishAt: finishAt };
    // Only creating the link sends these; re-sending an existing one sends nothing
    // new, so the panel only claims what it actually handed the server.
    const creating = live.followUrl === null;
    const url = live.followUrl ?? (await safety.startSharing({
      riderName: riderName === "" ? "Your rider" : riderName,
      route: routeLine === undefined ? null : shareRouteGeometry(routeLine),
      plan,
    }));
    if (url === null) return;
    if (creating) setSentFinishAt({ at: finishAt });
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
        {sentFinishAt === null ? null : sentFinishAt.at === null ? (
          <p className="og-ride__safety-note" data-testid="ride-live-finish">
            Followers see your route and where you are. This link carries no expected finish time.
          </p>
        ) : (
          <p className="og-ride__safety-note" data-testid="ride-live-finish">
            Followers expect you to finish by {clockOf(sentFinishAt.at)}.
          </p>
        )}
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
      <label className="og-ride__safety-field">
        <span>Expected finish (optional)</span>
        <input
          type="time"
          value={finish.value}
          data-testid="ride-live-finish-input"
          onChange={(event) => editFinish(event.target.value)}
        />
      </label>
      <p className="og-ride__safety-note" data-testid="ride-live-finish-note">
        {finish.value === ""
          ? "Leave this empty to share only your live location."
          : finish.passed
            ? "That time has already passed — followers will see you as overdue until you finish."
            : "Your route's estimate plus 30 min. Followers see “overdue” once this passes and you have not finished."}
      </p>
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
