"use client";

/**
 * The one ride summary (round 3, restructure call 3).
 *
 * Featured route: a loop, a destination, a curated "Ride this", a saved ride or
 * an imported track all read the same way, on the phone's Plan sheet and on the
 * desktop's chosen card: its name, the time and the miles, the three honest
 * lines, then Start, Save and Share. The name is the ride's own when it has one
 * (see `destination-line.ts`), so a curated loop is never titled "To <place>".
 *
 * Save is one tap (restructure call 4): the ride is kept under an automatic
 * name ("Rothrock loop, 53 mi"), the button turns into "Saved", and the name is
 * editable in place. There is no second save and no name box to fill first.
 *
 * Comparing swaps the summary for the options, one row each, named by what they
 * are — the most dirt, the twistiest, the fastest, else "Option 2" — with the
 * chosen route's colour, numbers and one-word character. A row is a real
 * `<button>` with `aria-pressed`, so picking one is a keyboard and screen-reader
 * action too, and the map highlights the line it names — never colour alone.
 *
 * The short ride style sits under the comparison on a phone, so the ride can be
 * reshaped without leaving the options.
 */

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type FormEvent } from "react";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { rideTruth, type RideTruth } from "@/application/planner/ride-truth";
import { compareChoiceNames } from "@/application/planner/route-choice-words";
import { surfaceFacts } from "@/application/planner/surface-facts";
import { longestUnpaved, stretchExtent } from "@/application/planner/stretch-extent";
import type { MapExtent } from "@/application/map/build-map-scene";
import type { ElevationSource } from "@/application/elevation/profile";
import { waypointsFromIntent, type LibraryServicePort } from "@/application/library/library-service";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import type { ShareServicePort } from "@/application/sharing/share-commands";
import { shareSourceFromRide } from "@/domain/sharing/from-ride";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { RideStyleControlsModel } from "@/ui/planner/RideStyleControls";
import type { RouteExplanation } from "@/application/planner/route-explanation";
import type { RideActionsProps } from "./RideActions";
import { RouteDecisionCard, WhyThisRide } from "./RouteDecisionCard";
import { PhoneQuickStyle } from "./PhoneQuickStyle";
import { RouteContext } from "./RouteContext";
import { RideTruthLines } from "./RideTruthLines";
import { useElevationProfile } from "./useElevationProfile";
import { useOneTapSave } from "./useOneTapSave";

const ShareSheet = dynamic(() => import("@/ui/sharing/ShareSheet").then((mod) => mod.ShareSheet), { loading: () => <p className="og-composer__reason" role="status">Opening sharing…</p> });

const NO_LINE: readonly Coordinate[] = [];

/** "Back 12:04 PM" for a loop, "Arrive 12:04 PM" for a destination (Google's arrival line). */
function arrivalLine(seconds: number | undefined, loop: boolean): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  const at = new Date(Date.now() + seconds * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${loop ? "Back" : "Arrive"} ${at}`;
}

/**
 * The three lines, always. A card from the view model carries them; an injected
 * one may not, so the surface line is rebuilt from the strip it does carry and
 * the rest say plainly that they were not checked. Unknown is never silent.
 */
function truthOf(card: RouteCardVm): RideTruth {
  if (card.truth !== undefined) return card.truth;
  const base = rideTruth({ distanceMeters: card.distanceMeters });
  if (card.surfaceStrip === undefined) return base;
  const facts = surfaceFacts(card.surfaceStrip, card.distanceMeters);
  if (facts.line === "surface unknown") return base;
  return [{ tone: card.surfaceStrip.unknown > 0 ? "warn" : "good", text: facts.line }, base[1], base[2]];
}

/** The quick actions around the ride; each is absent when the page cannot offer it. */
export interface RideSummaryQuickActions {
  readonly onStyle?: (() => void) | undefined;
  /** Flies the map to a stretch of the ride; absent where there is no map to move. */
  readonly onShowExtent?: ((extent: MapExtent) => void) | undefined;
}

const Glyph = ({ d }: { readonly d: string }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
const SLIDERS = "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4";
const SHARE = "M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6";
const NAV = "M12 3 5 20l7-3.5 7 3.5z";
const BOOKMARK = "M7 3h10v18l-5-3.5L7 21z";
const SAVED = "M4.5 10.5 8 14l7.5-8";

export interface RideSummaryProps {
  readonly card: RouteCardVm;
  /**
   * A new answer is on its way and `card` is the previous one (OG-05): every
   * number is a skeleton until it lands, so "Finding roads…" never sits beside
   * a full set of stats that are about to change.
   */
  readonly computing?: boolean;
  readonly cards: readonly RouteCardVm[];
  readonly start: RideActionsProps["start"];
  /** The ride's name, already resolved by `destinationLineFor`. */
  readonly title: string;
  /** The name one Save tap writes, from `automaticRideName`. */
  readonly automaticName: string;
  readonly document: RideDocument;
  readonly libraryService: LibraryServicePort | undefined;
  readonly shareService: ShareServicePort | undefined;
  /** The chosen line, saved with the ride so it reopens exactly (R3-1). */
  readonly route: SelectedOfflineRoute | null;
  readonly routeLine: { readonly routeId: string; readonly geometry: readonly Coordinate[] } | null;
  readonly elevationSource: ElevationSource | undefined;
  readonly comparing: boolean;
  readonly onCompare: () => void;
  readonly onSelect: (id: RouteCandidateId) => void;
  /** The composer's ride style, so reshaping here is the same state as there. */
  readonly rideStyle?: RideStyleControlsModel;
  readonly weatherLine: string | null;
  readonly quick?: RideSummaryQuickActions;
  /** False on a wide screen, where the ride style lives in the rail's own rows. */
  readonly showQuickStyle?: boolean;
  /** The chosen ride's deterministic explanation, offered as "Why this ride?". */
  readonly explanation?: RouteExplanation | null;
}

export function RideSummary({
  card,
  computing = false,
  cards,
  start,
  title,
  automaticName,
  document,
  libraryService,
  shareService,
  route,
  routeLine,
  elevationSource,
  comparing,
  onCompare,
  onSelect,
  rideStyle,
  weatherLine,
  quick = {},
  showQuickStyle = true,
  explanation = null,
}: RideSummaryProps) {
  const geometry = routeLine?.geometry ?? NO_LINE;
  const elevation = useElevationProfile(elevationSource, routeLine?.routeId ?? null, geometry);
  const names = useMemo(() => compareChoiceNames(cards), [cards]);
  const strip = card.surfaceStrip;
  const meta = [card.badges.find((badge) => /curv|twist/i.test(badge)) ?? card.curviness?.label];
  if (elevation?.status === "ready") meta.push(`↗ ${Math.round(elevation.profile.climbMeters * 3.28084).toLocaleString("en-US")} ft`);
  const showStretch = quick.onShowExtent === undefined ? undefined : (stretch: { readonly fromMeters: number; readonly toMeters: number }) => {
    const extent = stretchExtent(geometry, stretch.fromMeters, stretch.toMeters);
    if (extent !== null) quick.onShowExtent?.(extent);
  };
  const unpavedStretch = longestUnpaved(card.surfaceRuns, card.distanceMeters);
  const stripLabel = strip === undefined ? "" : `Surface: ${(["paved", "gravel", "dirt", "unknown"] as const).map((kind) => `${Math.round(strip[kind] * 100)}% ${kind}`).join(", ")}`;
  const stripKinds = strip === undefined ? null : (["paved", "gravel", "dirt", "unknown"] as const).map((kind) => strip[kind] <= 0 ? null : <span key={kind} data-surface={kind} style={{ flexGrow: strip[kind] }} />);
  const bar = strip === undefined ? null : showStretch !== undefined && unpavedStretch !== null
    ? <button type="button" className="og-route-card__strip og-phone-summary__strip" data-testid="phone-surface-strip"
        aria-label={`${stripLabel}. Show the longest unpaved stretch on the map`} onClick={() => showStretch(unpavedStretch)}>{stripKinds}</button>
    : <span className="og-route-card__strip og-phone-summary__strip" data-testid="phone-surface-strip" role="img" aria-label={stripLabel}>{stripKinds}</span>;
  const arrival = arrivalLine(card.durationSeconds, rideStyle?.view.shape === "loop");
  // Three lines, always: a card that carries none (an injected view model) gets
  // the neutral answer to the same questions rather than no lines at all.
  const truth = truthOf(card);

  const saving = useOneTapSave({ document, libraryService, route, automaticName });
  const saveState = saving.state;
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  const shareSource = useMemo(
    () =>
      route === null
        ? null
        : shareSourceFromRide(document, { segments: [route.geometry] }, route.summary, null),
    [document, route],
  );

  const shownTitle = saving.savedTitle ?? title;
  const save = saving.save;

  const commitTitle = async (next: string): Promise<void> => {
    // Enter submits and the field's blur follows it: the name is kept once.
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    await saving.rename(next);
  };

  const onRenameSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void commitTitle(draftTitle);
  };

  return <section className="og-phone-summary" data-testid="route-summary" data-comparing={comparing ? "true" : "false"} aria-label="Your ride">
    {/* The way back leads the comparison, so the sticky ride style under the
        list can never cover it (the old link sat under it and was clipped). */}
    {comparing ? <button type="button" className="og-phone-summary__compare" data-testid="compare-rides" onClick={onCompare}><span aria-hidden="true">‹ </span>Back to ride</button> : null}
    {comparing ? <ul className="og-phone-alternatives" data-testid="phone-alternatives" aria-label="Compare rides">
      {cards.map((choice) => <RouteDecisionCard compact key={choice.routeId} card={choice} onSelect={onSelect}
        compactLabel={names[choice.routeId] ?? choice.roleLabel} compactReason={null}/>) }
    </ul> : <div className="og-phone-summary__ride">
      <div className="og-phone-summary__head">
        {editing ? <form className="og-phone-summary__rename" onSubmit={onRenameSubmit}>
          <label className="og-visually-hidden" htmlFor="ride-summary-title-input">Ride name</label>
          <input
            id="ride-summary-title-input"
            data-testid="ride-title-input"
            type="text"
            value={draftTitle}
            autoFocus
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => void commitTitle(draftTitle)}
          />
          <button type="submit" className="og-phone-summary__icon" data-testid="ride-title-done" aria-label="Keep this name" title="Keep this name"><Glyph d={SAVED}/></button>
        </form> : <><p className="og-phone-summary__where" data-testid="phone-destination">{shownTitle}</p>
          {saveState === "saved" ? <button type="button" className="og-phone-summary__rename-open" data-testid="ride-title-edit" aria-label="Rename this ride" title="Rename this ride" onClick={() => { setDraftTitle(shownTitle); editingRef.current = true; setEditing(true); }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>
          </button> : null}</>}
        {quick.onStyle === undefined ? null : <button type="button" className="og-phone-summary__icon" data-testid="summary-style" aria-label="Ride options" title="Ride options" onClick={quick.onStyle}><Glyph d={SLIDERS}/></button>}
      </div>
      {computing ? <div className="og-phone-summary__eta" data-testid="summary-computing" aria-busy="true">
        <span className="og-visually-hidden" role="status">Finding your ride…</span>
        <span className="og-phone-summary__skeleton og-phone-summary__skeleton--time" aria-hidden="true" />
        <div className="og-phone-summary__facts" aria-hidden="true">
          <span className="og-phone-summary__skeleton" />
          <span className="og-phone-summary__skeleton og-phone-summary__skeleton--short" />
        </div>
      </div> : <div className="og-phone-summary__eta">
        <h2 className="og-phone-summary__time">{card.durationLabel}</h2>
        <div className="og-phone-summary__facts">
          <p className="og-phone-summary__arrive">{arrival === null ? card.distanceLabel : `${arrival} · ${card.distanceLabel}`}</p>
          <p className="og-phone-summary__meta"><span className="og-phone-summary__meta-text">{meta.filter(Boolean).join(" · ")}</span>{geometry.length > 1 && card.durationSeconds !== undefined ? <> <RouteContext route={{ geometry, durationSeconds: card.durationSeconds }} intent={document.intent} /></> : null}</p>
        </div>
      </div>}
      {/* The three honest lines (N3): surface with its bar, bike, checked. */}
      {computing ? null : <RideTruthLines truth={truth} surfaceBar={bar} {...(showStretch === undefined ? {} : { onShowStretch: showStretch })} />}
      {explanation === null ? null : <WhyThisRide explanation={explanation} whyKey={card.whyKey} />}
    </div>}
    {/* Start, Save, Share: the whole answer to the ride, in one row. */}
    <div className="og-phone-summary__actions">
      {start === null ? null : <button className="og-primary" type="button" data-testid="start-ride" aria-label={start.starting ? undefined : "Start ride"} disabled={start.starting || start.refusal !== null} onClick={start.onStart}><Glyph d={NAV}/>{start.starting ? "Starting…" : "Start"}</button>}
      <button type="button" className="og-phone-summary__pill" data-testid="summary-save" data-state={saveState} disabled={!saving.canSave} onClick={() => void save()}>
        <Glyph d={BOOKMARK}/><span className="og-phone-summary__pill-label">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}</span>
      </button>
      {shareService === undefined || shareSource === null ? null : <button type="button" className="og-phone-summary__pill" data-testid="open-share" onClick={() => setShareOpen(true)}><Glyph d={SHARE}/><span className="og-phone-summary__pill-label">Share</span></button>}
    </div>
    {start === null || start.refusal === null ? null : <p className="og-composer__reason" data-testid="start-ride-reason">{start.refusal}</p>}
    {start === null || start.error === null ? null : <p className="og-planner__error" role="alert">{start.error}</p>}
    {saving.error === null ? null : <p className="og-planner__error" role="alert" data-testid="ride-save-error">{saving.error}</p>}
    {/* The comparison switch only appears when there is a second choice. */}
    {!comparing && cards.length > 1 ? <button type="button" className="og-phone-summary__compare" data-testid="compare-rides" onClick={onCompare}>{`Compare rides (${cards.length})`}</button> : null}
    {showQuickStyle && rideStyle !== undefined ? <PhoneQuickStyle model={rideStyle} /> : null}
    {weatherLine === null ? null : <p className="og-phone-summary__weather" data-testid="phone-weather">{weatherLine}</p>}
    {shareOpen && shareSource !== null && shareService !== undefined ? <ShareSheet
      service={shareService}
      source={shareSource.title.trim() === "" ? { ...shareSource, title: shownTitle } : shareSource}
      waypoints={waypointsFromIntent(document.intent)}
      onClose={() => setShareOpen(false)}
    /> : null}
  </section>;
}
