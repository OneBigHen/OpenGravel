"use client";

/**
 * The planner's page frame: identity header, map canvas and responsive body.
 *
 * The child surfaces compose inside the body; the map remains a declarative
 * renderer and receives the existing MapIntent callback from the workspace.
 */

import type { ComponentProps, ReactNode, RefObject } from "react";

import type { RideDocument } from "@/domain/ride/types";
import type { LibraryServicePort } from "@/application/library/library-service";
import { PlannerMap, TOOL_HINTS } from "@/ui/map/PlannerMap";
import type { MapLayersProps } from "@/ui/layers/LayeredMap";
import { PlannerPlacesMap, type PlannerPlacesProps } from "@/ui/places/PlannerPlacesMap";
import { PrimaryNav } from "@/ui/nav/PrimaryNav";
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
  children,
}: PlannerWorkspaceFrameProps) {
  const hasDrawnRoute = map.scene.routes.some((route) => route.geometry.length >= 2);
  // The elevation profile's scrub point, drawn on the route (UX rework phase 3).
  const scrub = useRouteScrub();
  const scene = scrub === null ? map.scene : { ...map.scene, scrubMarker: scrub };
  const hint =
    armedTool !== null && armedTool !== missingTarget ? TOOL_HINTS[armedTool] : null;
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
