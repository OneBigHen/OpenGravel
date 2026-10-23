"use client";

/**
 * The follower's whole screen: one map, one slim card, and — only when the rider's
 * own screen raised one — a red banner.
 *
 * What matters here is what it refuses to do:
 *
 * - **It shows the last thing the rider reported, with its age.** The card says
 *   "updated 40 s ago", the map marks a stale fix as stale, and three minutes of
 *   silence becomes a sentence instead of a dot that merely sits there.
 * - **It follows the rider until the viewer takes the camera.** A pan or a pinch
 *   stops the follow (the map host reports that as `camera-changed`), and the card
 *   then offers the follow back. Nobody's map moves under their finger.
 * - **It polls only while the page is visible**, ten seconds apart, and keeps the
 *   last known facts when a poll fails: a follower on a weak signal sees the ride
 *   they already had instead of an empty page.
 * - **Nothing is public that was not shared.** There is no account, no name of
 *   the viewer, and the only handle in the URL is the follow token.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildFollowScene, followCameraFor } from "@/application/live/follow-scene";
import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import type { MapIntent } from "@/application/map/types";
import type { LiveFollowSnapshot } from "@/domain/live/types";
import { PlannerMap } from "@/ui/map/PlannerMap";

import { followCard, mapsUrl } from "./follow-status";
import styles from "./follow.module.css";

/** How often the follower asks for news, while the page is visible. */
export const FOLLOW_POLL_MS = 10_000;
/** How often "updated 40 s ago" is re-read from the clock. */
const CLOCK_TICK_MS = 5_000;

export interface FollowScreenProps {
  /** The public handle from the URL. */
  readonly token: string;
  /** What the server already read, so the first paint needs no request. */
  readonly initial: LiveFollowSnapshot;
  /** The server's clock at render, so the first paint hydrates to the same text. */
  readonly initialNow: number;
  /** How this surface obtains its renderer (injected by the composition root). */
  readonly hostFactory: MapHostFactory;
  readonly basemap: BasemapMode;
  /** Deployment prefix for the vendored map assets and the API. */
  readonly assetBasePath?: string;
  readonly pollMs?: number;
}

function apiUrl(base: string | undefined, token: string): string {
  const prefix = (base ?? "").replace(/\/+$/, "");
  return `${prefix}/api/live/follow/${encodeURIComponent(token)}`;
}

export function FollowScreen({
  token,
  initial,
  initialNow,
  hostFactory,
  basemap,
  assetBasePath,
  pollMs = FOLLOW_POLL_MS,
}: FollowScreenProps) {
  const [snapshot, setSnapshot] = useState<LiveFollowSnapshot>(initial);
  const [now, setNow] = useState(initialNow);
  const [ended, setEnded] = useState(false);
  /**
   * Whether the camera follows the rider. A viewer's pan turns it off; the
   * card's button turns it back on, which is the only way a camera should start
   * moving again.
   */
  const [following, setFollowing] = useState(true);
  const [followNonce, setFollowNonce] = useState(0);
  const card = followCard({ snapshot, now });

  // --- Polling ------------------------------------------------------------

  useEffect(() => {
    const url = apiUrl(assetBasePath, token);
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const load = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (response.status === 404) {
          // The ride was pruned (24 h after its last point) or the link is gone.
          setEnded(true);
          stop();
          return;
        }
        if (!response.ok) return;
        setSnapshot((await response.json()) as LiveFollowSnapshot);
        setNow(Date.now());
      } catch {
        // Offline or a dropped cell: the last known facts stay up, and the next
        // poll asks again. A follower must never be shown a blank page for a
        // network blip.
      }
    };

    const start = (): void => {
      stop();
      timer = setInterval(() => void load(), pollMs);
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        stop();
        return;
      }
      void load();
      start();
    };

    void load();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, assetBasePath, pollMs]);

  // The card's relative times ("updated 40 s ago") advance without a poll, so the
  // reading never claims to be fresher than it is.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // --- The map ------------------------------------------------------------

  const scene = useMemo(() => buildFollowScene(snapshot, now), [snapshot, now]);

  const camera = useMemo(() => followCameraFor(snapshot), [snapshot]);

  const onIntent = useCallback((intent: MapIntent): void => {
    // Everything else the map can report (a tap on a line, a long press) means
    // nothing to a follower; a camera move is the one gesture that does.
    if (intent.type === "camera-changed") setFollowing(false);
  }, []);

  const followKey = `${snapshot.last?.t ?? "none"}:${followNonce}`;
  const followCamera = following && camera !== null ? { key: followKey, camera } : null;

  const resumeFollow = useCallback((): void => {
    setFollowing(true);
    setFollowNonce((value) => value + 1);
  }, []);

  const last = snapshot.last;
  const mapsHref = last === null ? null : mapsUrl(last);

  return (
    <main id="main" className={styles.page} data-testid="follow-page">
      <h1 className="og-visually-hidden">Following {snapshot.riderName}&rsquo;s ride</h1>

      <div className={styles.map}>
        <PlannerMap
          scene={scene}
          onIntent={onIntent}
          hostFactory={hostFactory}
          {...(assetBasePath === undefined ? {} : { assetBasePath })}
          basemap={basemap}
          activeTool="pan"
          label={`Map of ${snapshot.riderName}'s ride, their planned route and where they are now`}
          followCamera={followCamera}
        />
      </div>

      <div className={styles.top}>
        {card.alert === null ? null : (
          <section className={styles.alert} role="alert" data-testid="follow-alert">
            <p className={styles.alertText}>{card.alert.text}</p>
            <div className={styles.alertActions}>
              {mapsHref === null ? null : (
                <a className={styles.alertAction} href={mapsHref} target="_blank" rel="noopener noreferrer">
                  Open in Maps
                </a>
              )}
              {card.alert.emergency ? (
                <a className={`${styles.alertAction} ${styles.alertCall}`} href="tel:911">
                  Call 911
                </a>
              ) : null}
            </div>
          </section>
        )}

        <header className={styles.card} data-kind={card.kind} data-testid="follow-card">
          <div className={styles.copy}>
            <p className={styles.title} role="status" aria-live="polite">{card.title}</p>
            <p className={styles.detail}>{card.detail}</p>
            {ended ? (
              <p className={styles.ended} role="status">
                This live link has ended. Ask {snapshot.riderName} for a new one next ride.
              </p>
            ) : null}
          </div>
          {following ? null : (
            <button type="button" className={styles.followButton} onClick={resumeFollow}>
              Follow the rider
            </button>
          )}
        </header>
      </div>
    </main>
  );
}
