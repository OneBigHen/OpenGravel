"use client";

/**
 * The planner's page frame: identity header, map canvas and responsive body.
 *
 * The child surfaces compose inside the body; the map remains a declarative
 * renderer and receives the existing MapIntent callback from the workspace.
 */

import { useEffect, type ComponentProps, type ReactNode, type RefObject } from "react";

import type { RideDocument } from "@/domain/ride/types";
import type { LibraryServicePort } from "@/application/library/library-service";
import { PlannerMap, TOOL_HINTS } from "@/ui/map/PlannerMap";
import type { MapLayersProps } from "@/ui/layers/LayeredMap";
import { PlannerPlacesMap, type PlannerPlacesProps } from "@/ui/places/PlannerPlacesMap";
import { PrimaryNav } from "@/ui/nav/PrimaryNav";
import { PlannerMapEditBar, type PlannerMapEditBarProps } from "@/ui/planner/MapEditBar";
import type { PlannerLocateMe } from "@/ui/planner/usePlannerPlaces";
import { useRouteScrub } from "@/ui/stores/route-scrub-store";

type PlannerMapProps = ComponentProps<typeof PlannerMap>;

export interface PlannerWorkspaceFrameProps {
  readonly document: RideDocument;
  readonly libraryService?: LibraryServicePort;
  readonly headerRef: RefObject<HTMLElement | null>;
  readonly mapSlotRef: RefObject<HTMLDivElement | null>;
  readonly map: Omit<PlannerMapProps, "hint">;
  readonly armedTool: keyof typeof TOOL_HINTS | null;
  readonly missingTarget: keyof typeof TOOL_HINTS | null;
  readonly retryingMap: boolean;
  /** The places overlay (sample places provider), when the app composes a source. */
  readonly places?: PlannerPlacesProps | undefined;
  /** The rider's map layers (phase 8), when the app composes a source. */
  readonly layers?: MapLayersProps | undefined;
  readonly onShowWholeRide: () => void;
  /** "Center on me", when the surface can locate the rider. */
  readonly locateMe?: PlannerLocateMe | undefined;
  /** The route-editing bar over the map (Draw, Add stop, the pen's controls). */
  readonly editBar?: PlannerMapEditBarProps | undefined;
  readonly children: ReactNode;
}

/** Where the open ride came from, in words; internal ids stay out. */
const PROVENANCE_TEXT: Readonly<Record<RideDocument["provenance"]["type"], string>> = {
  new: "Planned here",
  import: "Imported from a file",
  catalog: "Copied from the catalog",
  shared: "Shared with you",
  recorded: "Recorded on a ride",
  "recreated-from-track": "Rebuilt from a recorded track",
  derived: "Opened from My rides",
};

export function PlannerWorkspaceFrame({
  document,
  headerRef,
  mapSlotRef,
  map,
  armedTool,
  missingTarget,
  retryingMap,
  places,
  layers,
  onShowWholeRide,
  locateMe,
  editBar,
  children,
}: PlannerWorkspaceFrameProps) {
  const hasDrawnRoute = map.scene.routes.some((route) => route.geometry.length >= 2);
  useSnapBackAfterKeyboard();
  useChromeAwayWhileMoving(mapSlotRef);
  // The elevation profile's scrub point, drawn on the route (UX rework phase 3).
  const scrub = useRouteScrub();
  const scene = scrub === null ? map.scene : { ...map.scene, scrubMarker: scrub };
  // The edit bar says what a stop tap does, so the map does not say it twice.
  const hint =
    armedTool !== null && armedTool !== missingTarget && !(armedTool === "stop" && editBar !== undefined)
      ? TOOL_HINTS[armedTool]
      : null;
  return (
    <main id="main" className="og-planner">
      <header className="og-planner__header" ref={headerRef}>
        <div className="og-planner__identity">
          <h1>OpenGravel</h1>
          <p className="og-tagline">Find the ride worth taking.</p>
          {document.title !== null ? (
            <p className="og-planner__ride-context og-planner__ride-title" data-testid="active-ride-title" title={document.title}>
              {document.title}
            </p>
          ) : null}
          {document.provenance.type !== "new" ? (
            <p className="og-planner__ride-context" data-testid="active-ride-provenance">
              {PROVENANCE_TEXT[document.provenance.type]}
            </p>
          ) : null}
        </div>
        <PrimaryNav current="/" />
      </header>

      <div className="og-planner__body">
        <div className="og-planner__map-slot" ref={mapSlotRef}>
          <PlannerPlacesMap {...map} scene={scene} hint={hint} places={places} layers={layers} />
          {editBar === undefined ? null : <PlannerMapEditBar {...editBar} />}
          {retryingMap ? (
            <span className="og-map__retrying" data-testid="map-retry-chip" role="status">
              Retrying the map…
            </span>
          ) : null}
          {hasDrawnRoute ? (
            <button
              type="button"
              className="og-map__whole-ride"
              data-testid="show-whole-ride"
              onClick={onShowWholeRide}
            >
              <svg
                className="og-map__ctl-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
              <span className="og-map__ctl-label">Show whole ride</span>
            </button>
          ) : null}
          {locateMe === undefined ? null : (
            <>
              <button
                type="button"
                className="og-map__locate"
                data-testid="map-locate-me"
                aria-label={locateMe.locating ? "Finding your location" : "Center on my location"}
                aria-busy={locateMe.locating}
                data-locating={locateMe.locating ? "true" : "false"}
                onClick={locateMe.onLocate}
              >
                <svg
                  className="og-map__ctl-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="6.5" />
                  <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
                  <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
                </svg>
              </button>
              {locateMe.failure === null ? null : (
                <p className="og-map__locate-failure" data-testid="map-locate-failure" role="status">
                  {locateMe.failure}
                </p>
              )}
            </>
          )}
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * iOS Safari leaves the page scrolled after the on-screen keyboard closes (the
 * owner's 2026-10-04 iPad screenshot: the map stopped short of the bottom and
 * the right-hand controls were cut off at the top). The planner is a fixed,
 * full-screen map, so it never wants a scroll offset: when focus leaves a text
 * field, or the visual viewport grows back, it snaps back to the top.
 */
function useSnapBackAfterKeyboard(): void {
  useEffect(() => {
    const snap = (): void => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(snap, 120);
    };
    window.addEventListener("focusout", later);
    window.visualViewport?.addEventListener("resize", later);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focusout", later);
      window.visualViewport?.removeEventListener("resize", later);
    };
  }, []);
}

/**
 * The tab bar gets out of the way while the rider moves the map (owner
 * 2026-10-04: "I can't hide the bottom bar"), like Safari's own toolbars: a
 * pan, pinch or wheel sets `data-chrome="away"` on <html>, and it comes back a
 * moment after the map settles. A tap never hides it.
 */
function useChromeAwayWhileMoving(slotRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    const root = document.documentElement;
    let origin: { x: number; y: number } | null = null;
    let restore: ReturnType<typeof setTimeout> | null = null;
    const onMap = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest(".og-map canvas, .og-map .maplibregl-canvas-container") !== null;
    const away = (): void => {
      if (restore !== null) clearTimeout(restore);
      restore = null;
      root.dataset["chrome"] = "away";
    };
    const back = (delay: number): void => {
      if (restore !== null) clearTimeout(restore);
      restore = setTimeout(() => {
        restore = null;
        delete root.dataset["chrome"];
      }, delay);
    };
    const onDown = (event: PointerEvent): void => {
      origin = onMap(event.target) ? { x: event.clientX, y: event.clientY } : null;
    };
    const onMove = (event: PointerEvent): void => {
      if (origin === null || root.dataset["chrome"] === "away") return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) away();
    };
    const onUp = (): void => {
      if (origin !== null && root.dataset["chrome"] === "away") back(1600);
      origin = null;
    };
    const onWheel = (event: WheelEvent): void => {
      if (!onMap(event.target)) return;
      away();
      back(1600);
    };
    slot.addEventListener("pointerdown", onDown, { passive: true });
    slot.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    slot.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      if (restore !== null) clearTimeout(restore);
      delete root.dataset["chrome"];
      slot.removeEventListener("pointerdown", onDown);
      slot.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      slot.removeEventListener("wheel", onWheel);
    };
  }, [slotRef]);
}
