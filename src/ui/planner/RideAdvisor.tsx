"use client";

/**
 * The ride advisor, inside the planner rather than floating over the map
 * (UX rework 2, #7/#13).
 *
 * The composer, Map Ask sheet and planned-ride panel share one advisor session.
 * A proposal appears as an interpretation with one **Plan it** button, and
 * applying it uses the normal route-planning path. Map place search remains a
 * separate flow from this session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { appendAdvisorExchange, type AdvisorExchange } from "@/application/advisor/advisor-conversation";
import { summarizeAdvisorRide } from "@/application/advisor/advisor-ride-summary";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import { cachedElevationClimb } from "./useElevationProfile";
import { advisorRiderState } from "@/application/advisor/advisor-errors";
import { RIDE_DESCRIPTION_MAX_LENGTH } from "@/application/advisor/ride-description";
import type {
  AdvisorDraft,
  AdvisorDraftResult,
  AdvisorProposalClient,
  AdvisorRecovery,
} from "@/application/advisor";
import type { AdvisorProposalChange } from "@/application/advisor/advisor-proposal-commands";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import { ARRIVAL_INTENT_LABELS } from "@/ui/planner/arrival-intent";
import type { PlacesSource } from "@/application/places";
import { isPlanningInFlight } from "@/application/planner/planner-view-model";
import {
  ADVISOR_ROUTE_POSITION_LABELS,
  ADVISOR_STOP_CATEGORY_LABELS,
  buildAdvisorStopSelectionCommand,
  rankAdvisorStopCandidates,
  routeLengthMiles,
  type AdvisorReadyProposal,
  type AdvisorStopCandidate,
  type AdvisorStopSearchProposal,
  type AdvisorStopSearchRequest,
} from "@/application/advisor";
import "./advisor-conversation.css";
import "./advisor-ask-sheet.css";
import { emitTelemetry } from "@/ui/telemetry/emit-telemetry";
import { useActivityMode } from "@/ui/stores/activity-mode";

/** What happens after an applied proposal, in the rider's words. */
export type AdvisorAppliedNext =
  | { readonly kind: "planning" }
  | { readonly kind: "needs-point"; readonly point: "start" | "finish" };

/** Where the rider asked from: the composer, Map Ask, or the planned ride's sheet. */
export type AdvisorSurface = "composer" | "ride" | "map";

export interface RideAdvisor {
  /** Send a ride description or answer the latest clarification. */
  ask(text: string, surface?: AdvisorSurface): void;
  /** The surface that shows the conversation, so it never draws twice. */
  readonly surface: AdvisorSurface;
  readonly prompt: string;
  readonly conversation: readonly AdvisorExchange[];
  readonly pending: boolean;
  readonly proposal: AdvisorReadyProposal | null;
  readonly proposalIsStale: boolean;
  /** A result line: an error, a clarification, or what happens next. */
  readonly message: string | null;
  readonly messageIsError: boolean;
  readonly recovery: AdvisorRecovery;
  apply(): AdvisorAppliedNext | null;
  dismiss(): void;
  retry(): void;
  /** Re-validates the last draft against the ride as it is now; no model call. */
  refresh(): void;
  readonly stopSearches: AdvisorStopSearchFlow | null;
  readonly documentStore: RideDocumentStore;
  readonly planningStore?: PlanningSessionStore;
  readonly placesSource?: PlacesSource;
  dismissStopSearches(): void;
  addSelectedStops(selected: readonly AdvisorStopCandidate[]): void;
}

export interface AdvisorStopSearchFlow {
  readonly id: string;
  readonly surface: AdvisorSurface;
  readonly baseRevision: number;
  readonly requests: readonly AdvisorStopSearchRequest[];
  readonly timeBudgetMinutes: number | null;
}

const AdvisorContext = createContext<RideAdvisor | null>(null);

/** The planner's advisor, or `null` when this deployment has none. */
export function useRideAdvisor(): RideAdvisor | null {
  return useContext(AdvisorContext);
}

export interface RideAdvisorProviderProps {
  readonly enabled: boolean;
  readonly store: RideDocumentStore;
  readonly client: AdvisorProposalClient;
  readonly planningStore?: PlanningSessionStore;
  /** HTTP adapter for the existing `/api/places/along` boundary. */
  readonly placesSource?: PlacesSource;
  /** Called once a proposal is applied: the planner plans, or names what is missing. */
  readonly onApplied?: () => AdvisorAppliedNext;
  readonly children: ReactNode;
}

export function RideAdvisorProvider(props: RideAdvisorProviderProps) {
  const { store } = props;
  const subscribe = useCallback((onChange: () => void) => store.subscribe(() => onChange()), [store]);
  const getRideId = useCallback(() => store.getState().document.rideId, [store]);
  const rideId = useSyncExternalStore(subscribe, getRideId, getRideId);
  return <RideAdvisorSession key={rideId} {...props} />;
}

/** Conversation and pending work belong to one ride, including across equal revisions. */
function RideAdvisorSession({ enabled, store, client, planningStore, placesSource, onApplied, children }: RideAdvisorProviderProps) {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(() => onChange()), [store]);
  const getRevision = useCallback(() => store.getState().document.revision, [store]);
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const [prompt, setPrompt] = useState("");
  const [surface, setSurface] = useState<AdvisorSurface>("composer");
  const [conversation, setConversation] = useState<readonly AdvisorExchange[]>([]);
  const conversationRef = useRef<{ rideId: string; exchanges: readonly AdvisorExchange[] }>({ rideId: store.getState().document.rideId, exchanges: [] });
  const [pending, setPending] = useState(false);
  const [proposal, setProposal] = useState<AdvisorReadyProposal | null>(null);
  const [stopSearches, setStopSearches] = useState<AdvisorStopSearchFlow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [recovery, setRecovery] = useState<AdvisorRecovery>("none");
  const [lastDraft, setLastDraft] = useState<AdvisorDraft | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const onAppliedRef = useRef(onApplied);
  useEffect(() => {
    onAppliedRef.current = onApplied;
  }, [onApplied]);
  useEffect(() => () => requestController.current?.abort(), []);

  const fail = useCallback((text: string, next: AdvisorRecovery) => {
    setMessage(text);
    setMessageIsError(true);
    setRecovery(next);
  }, []);

  const ask = useCallback(
    (value: string, from: AdvisorSurface = "composer") => {
      const text = value.trim();
      if (text.length < 2 || text.length > RIDE_DESCRIPTION_MAX_LENGTH) return;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const generation = ++requestGeneration.current;
      emitTelemetry("advisor_proposal_requested", { capabilityStatus: "available" });
      setPrompt(text);
      setSurface(from);
      setPending(true);
      setProposal(null);
      setStopSearches(null);
      setLastDraft(null);
      setMessage(null);
      setMessageIsError(false);
      setRecovery("none");
      const requestedDocument = store.getState().document;
      const history = conversationRef.current.rideId === requestedDocument.rideId ? conversationRef.current.exchanges : [];
      const planning = planningStore?.getState();
      const bundle = planning?.snapshot.committedBundle ?? planning?.snapshot.lastGoodBundle ?? null;
      const selected = bundle?.candidates.find((candidate) => candidate.id === bundle.selectedRouteId);
      const geometry = selected === undefined ? undefined : planning?.geometry[selected.geometryRef];
      const climb = selected !== undefined && geometry?.kind === "line" ? cachedElevationClimb(selected.id, geometry.coordinates.length) : null;
      const plannedRide = summarizeAdvisorRide(requestedDocument, bundle, climb);
      void (async () => {
        try {
          const [{ advisorRequestForDocument }, { buildAdvisorProposal }] = await Promise.all([
            import("@/application/advisor/advisor-proposal"),
            import("@/application/advisor/advisor-proposal-commands"),
          ]);
          if (controller.signal.aborted || generation !== requestGeneration.current) return;
          const result: AdvisorDraftResult = await client.request(
            advisorRequestForDocument(requestedDocument, text, { history, ...(plannedRide === null ? {} : { plannedRide }) }),
            controller.signal,
          );
          if (generation !== requestGeneration.current) return;
          if (!result.ok) {
            emitTelemetry("advisor_proposal_ready", { capabilityStatus: "unavailable" });
            fail(result.message, result.recovery);
            return;
          }
          setLastDraft(result.draft);
          const built = buildAdvisorProposal(store.getState().document, result.draft);
          if (built.status !== "error") {
            const isProposal = built.status === "ready" || built.status === "search";
            const summary = isProposal
              ? [
                  ...built.changes.map(changeChip),
                  ...built.stopSearches.map((search) => `${ADVISOR_STOP_CATEGORY_LABELS[search.category]} ${ADVISOR_ROUTE_POSITION_LABELS[search.routePosition].toLowerCase()}`),
                ].join(" · ")
              : "";
            const reply = isProposal ? `Suggested: ${summary}.` : built.message;
            const exchanges = appendAdvisorExchange(history, { riderRequest: text, reply, outcome: isProposal ? "proposal" : built.status });
            conversationRef.current = { rideId: requestedDocument.rideId, exchanges };
            setConversation(exchanges);
          }
          if (built.status === "ready" || built.status === "search") {
            emitTelemetry("advisor_proposal_ready", { capabilityStatus: "available" });
            setProposal(built);
          } else if (built.status === "error") {
            fail(built.message, built.recovery);
          } else {
            // A clarifying question: not an error, the rider just says more.
            setMessage(built.message);
            setMessageIsError(false);
          }
        } catch {
          if (!controller.signal.aborted && generation === requestGeneration.current) {
            const state = advisorRiderState("unavailable");
            fail(state.message, state.recovery);
          }
        } finally {
          if (generation === requestGeneration.current) setPending(false);
        }
      })();
    },
    [client, store, planningStore, fail],
  );

  const proposalIsStale = proposal !== null && proposal.baseRevision !== revision;

  const apply = useCallback(() => {
    if (proposal === null) return null;
    if (proposal.baseRevision !== store.getState().document.revision) {
      const state = advisorRiderState("stale-revision");
      fail(state.message, state.recovery);
      setProposal(null);
      return null;
    }
    const result = "command" in proposal ? store.getState().dispatch(proposal.command) : { outcome: "applied" as const };
    setProposal(null);
    setLastDraft(null);
    if (result.outcome === "applied") {
      if (proposal.stopSearches.length > 0) {
        setStopSearches({
          id: crypto.randomUUID(),
          surface,
          baseRevision: store.getState().document.revision,
          requests: proposal.stopSearches,
          timeBudgetMinutes: proposal.timeBudgetMinutes,
        });
      }
      emitTelemetry("advisor_proposal_applied", { source: "advisor" });
      setRecovery("none");
      setPrompt("");
      const next = onAppliedRef.current?.() ?? { kind: "planning" as const };
      // Planning speaks for itself on the map; only a missing point needs words.
      setMessage(next.kind === "planning" ? null : `Now set your ${next.point === "finish" ? "destination" : "start"} to plan this ride.`);
      setMessageIsError(false);
      return next;
    }
    const state = advisorRiderState(result.outcome === "stale" ? "stale-revision" : "invalid-request");
    fail(state.message, state.recovery);
    return null;
  }, [proposal, store, surface, fail]);

  const dismissStopSearches = useCallback(() => setStopSearches(null), []);

  const addSelectedStops = useCallback((selected: readonly AdvisorStopCandidate[]) => {
    const flow = stopSearches;
    if (flow === null) return;
    const document = store.getState().document;
    if (document.revision !== flow.baseRevision) {
      setStopSearches(null);
      fail("The ride changed while places were loading. Ask again to refresh the search.", "none");
      return;
    }
    const command = buildAdvisorStopSelectionCommand(document, selected, flow.requests.length);
    if (command === null) {
      fail("Choose at least one place to add.", "none");
      return;
    }
    const result = store.getState().dispatch(command);
    if (result.outcome !== "applied") {
      setStopSearches(null);
      fail("The ride changed before these stops could be added. Ask again to refresh the search.", "none");
      return;
    }
    setStopSearches(null);
    const next = onAppliedRef.current?.() ?? { kind: "planning" as const };
    setMessage(next.kind === "planning" ? "Stops added. Updating the route…" : `Now set your ${next.point === "finish" ? "destination" : "start"} to plan this ride.`);
    setMessageIsError(false);
  }, [stopSearches, store, fail]);

  const dismiss = useCallback(() => {
    if (proposal !== null) emitTelemetry("advisor_proposal_discarded");
    requestController.current?.abort();
    requestGeneration.current += 1;
    setPending(false);
    setProposal(null);
    setStopSearches(null);
    setLastDraft(null);
    setMessage(null);
    setRecovery("none");
    setPrompt("");
    setConversation([]);
    conversationRef.current = { rideId: store.getState().document.rideId, exchanges: [] };
  }, [proposal, store]);

  const retry = useCallback(() => ask(prompt, surface), [ask, prompt, surface]);

  const refresh = useCallback(() => {
    if (lastDraft === null) return;
    const generation = ++requestGeneration.current;
    void (async () => {
      const { refreshAdvisorProposal } = await import("@/application/advisor/advisor-proposal-commands");
      if (generation !== requestGeneration.current) return;
      const built = refreshAdvisorProposal(store.getState().document, lastDraft);
      if (built.status === "ready" || built.status === "search") {
        setProposal(built);
        setMessage(null);
        setMessageIsError(false);
        setRecovery("none");
        return;
      }
      if (built.status === "error") {
        fail(built.message, built.recovery);
        return;
      }
      setMessage(built.message);
      setMessageIsError(false);
      setRecovery("none");
    })();
  }, [lastDraft, store, fail]);

  const value = useMemo<RideAdvisor>(
    () => ({ ask, surface, prompt, conversation, pending, proposal, proposalIsStale, message, messageIsError, recovery, apply, dismiss, retry, refresh, stopSearches, documentStore: store, planningStore, placesSource, dismissStopSearches, addSelectedStops }),
    [ask, surface, prompt, conversation, pending, proposal, proposalIsStale, message, messageIsError, recovery, apply, dismiss, retry, refresh, stopSearches, store, planningStore, placesSource, dismissStopSearches, addSelectedStops],
  );
  return <AdvisorContext.Provider value={enabled ? value : null}>{children}</AdvisorContext.Provider>;
}

const ROAD_WORDS: Readonly<Record<string, string>> = {
  efficient: "Quickest roads",
  balanced: "Balanced roads",
  curvy: "Curvy roads",
  backroads: "Backroads",
};
const SURFACE_WORDS: Readonly<Record<string, string>> = {
  pavement: "Paved only",
  "mostly-pavement": "Mostly paved",
  mixed: "Mixed surface",
  "dirt-preferred": "Dirt preferred",
};
const TERRAIN_WORDS: Readonly<Record<string, string>> = {
  "known-easy-only": "Easy terrain",
  moderate: "Moderate terrain",
  "any-supported": "Any terrain",
};
const NOVELTY_WORDS: Readonly<Record<string, string>> = {
  "prefer-new-to-me": "New roads",
  balanced: "Balanced roads",
  "prefer-familiar": "Roads I know",
};
const TRAFFIC_WORDS: Readonly<Record<string, string>> = {
  "protect-ride": "Avoid busy roads",
  "minimize-delay": "Fastest through traffic",
};

/**
 * One value of one changed field in rider words: "From Jim Thorpe, PA", "New
 * roads", "Back by 6:00 pm on Sep 26". Every field is named explicitly so a
 * stored setting value never reaches the card as a machine token.
 */
function fieldWords(field: AdvisorProposalChange["field"], value: string): string {
  switch (field) {
    case "shape":
      return value === "A to B" ? "To a destination" : value;
    case "start":
      return value === "No start set" ? "No start" : `From ${value}`;
    case "finish":
      return value === "No finish set" ? "No destination" : `To ${value}`;
    case "stop":
      return value === "No stops" ? "No stops" : `Via ${value}`;
    case "time":
      return value;
    case "departure":
      return value === "Leave now" ? "Leave now" : `Leave ${value}`;
    case "roadCharacter":
      return ROAD_WORDS[value] ?? value;
    case "novelty":
      return NOVELTY_WORDS[value] ?? value;
    case "surface":
      return SURFACE_WORDS[value] ?? value;
    case "terrain":
      return TERRAIN_WORDS[value] ?? value;
    case "highways":
      return value === "Avoid" ? "No highways" : "Highways OK";
    case "tolls":
      return value === "Avoid" ? "No tolls" : "Tolls OK";
    case "traffic":
      return TRAFFIC_WORDS[value] ?? value;
  }
}

/** One short chip per change, in rider words ("From Jim Thorpe, PA", "No highways"). */
export function changeChip(change: AdvisorProposalChange): string {
  return fieldWords(change.field, change.after);
}

/** What the setting was before, in the same rider words, for a visible comparison. */
/**
 * The settings a proposal actually overwrites, in rider words. Filling an empty
 * slot ("No start", "No time target") or the ride shape is self-evident from
 * the chips, so only real previous choices are named.
 */
export function replacedSettings(changes: readonly AdvisorProposalChange[]): readonly string[] {
  return changes
    .filter((change) => change.field !== "shape")
    .map(changeWas)
    .filter((before, index, all) => !/^(no |none\b|not set\b)/i.test(before) && all.indexOf(before) === index);
}

export function changeWas(change: AdvisorProposalChange): string {
  return fieldWords(change.field, change.before);
}

function recoveryLabel(recovery: AdvisorRecovery): string | null {
  if (recovery === "retry") return "Try again";
  if (recovery === "refresh") return "Refresh";
  return null;
}

/**
 * The advisor's mark, with the text-presentation selector: bare U+2733 draws
 * as a green emoji tile on iOS.
 */
export const ADVISOR_GLYPH = "\u2733\uFE0E";

/** After this long a turn stops looking like a moment and says what it is doing. */
export const ADVISOR_SLOW_HINT_MS = 3_000;

/** The glyph the advisor answers under, everywhere it appears. */
export function AdvisorMark() {
  return (
    <span className="og-advisor__mark" aria-hidden="true">
      {ADVISOR_GLYPH}
    </span>
  );
}

/**
 * Says what the wait is for once a turn stops looking like a moment. Mounted
 * only while the advisor is thinking, so its timer is the wait's own clock.
 */
function AdvisorSlowHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), ADVISOR_SLOW_HINT_MS);
    return () => clearTimeout(timer);
  }, []);
  return slow ? (
    <span className="og-advisor__working-detail">Still reading your ride and checking places…</span>
  ) : null;
}

/**
 * The advisor's answer, inline in the sheet: working, a proposal to plan, or
 * one line of what went wrong. With `askBox`, it also offers a one-line box for
 * the times the composer has no search field to type into (a loop's start is
 * already set, say).
 */
export function AdvisorInline({
  askBox = false,
  surface = "composer",
  hideForm = false,
  onPlan,
}: {
  readonly askBox?: boolean;
  readonly surface?: AdvisorSurface;
  readonly hideForm?: boolean;
  readonly onPlan?: () => void;
}) {
  const advisor = useRideAdvisor();
  const mode = useActivityMode();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftBase, setDraftBase] = useState("");
  // The advisor plans rides on the road graph; a hiker plans on the hike card.
  if (advisor === null || mode === "hike") return null;
  const { pending, proposal, proposalIsStale, message, messageIsError, recovery } = advisor;
  const composerText = draftBase === advisor.prompt ? draft : advisor.prompt;
  // Another surface owns the live conversation: this one stays quiet.
  const idle = (!pending && proposal === null && message === null) || advisor.surface !== surface;
  const hasStopFlow = advisor.stopSearches?.surface === surface;
  if (idle && !askBox && !hasStopFlow) return null;

  function submit(): void {
    if (advisor === null || advisor.pending) return;
    const text = composerText;
    if (text.trim().length < 2) return;
    advisor.ask(text, surface);
  }

  return (
    <section className="og-advisor" data-testid="advisor-inline" aria-label="Ride advisor" aria-live="polite">
      {idle && askBox && !open ? (
        <button type="button" className="og-advisor__ask" data-testid="advisor-open" onClick={() => setOpen(true)}>
          <AdvisorMark />
          Describe a ride instead
        </button>
      ) : null}
      {advisor.surface === surface && (advisor.conversation.length > 0 || advisor.prompt !== "") ? (
        <ol className="og-advisor__conversation" aria-label="Ride conversation">
          {advisor.conversation.map((exchange, index) => (
            <li key={`${index}-${exchange.riderRequest}`}>
              <p className="og-advisor__rider"><span className="og-visually-hidden">You: </span>{exchange.riderRequest}</p>
              {index < advisor.conversation.length - 1 || exchange.riderRequest !== advisor.prompt || (message === null && !pending && proposal === null) ? <p className="og-advisor__reply"><AdvisorMark /> {exchange.reply}</p> : null}
            </li>
          ))}
          {advisor.prompt !== "" && advisor.conversation.at(-1)?.riderRequest !== advisor.prompt ? <li><p className="og-advisor__rider"><span className="og-visually-hidden">You: </span>{advisor.prompt}</p></li> : null}
        </ol>
      ) : null}

      {pending && !idle ? (
        <div className="og-advisor__pending">
          <p className="og-advisor__working" role="status" data-testid="advisor-working">
            <AdvisorMark />
            Reading “{advisor.prompt}”…
            <AdvisorSlowHint />
          </p>
          <button type="button" className="og-advisor__cancel" data-testid="advisor-cancel" onClick={advisor.dismiss}>
            Cancel
          </button>
        </div>
      ) : null}

      {proposal !== null && !idle ? (
        <div className="og-advisor__proposal" data-testid="advisor-proposal">
          <p className="og-advisor__summary">
            <AdvisorMark />
            <span>Proposed ride</span>
          </p>
          {proposal.status === "ready" ? <AdvisorInterpretation proposal={proposal} /> : null}
          {proposal.stopSearches.length === 0 ? null : (
            <ul className="og-advisor__stop-intents" aria-label="Places to find after routing">
              {proposal.stopSearches.map((search, index) => (
                <li key={`${index}-${search.category}`}>
                  <strong>{ADVISOR_STOP_CATEGORY_LABELS[search.category]}</strong>
                  <span>{ADVISOR_ROUTE_POSITION_LABELS[search.routePosition]}</span>
                  {search.vicinity === null ? null : <span>near {search.vicinity}</span>}
                </li>
              ))}
            </ul>
          )}
          {replacedSettings(proposal.changes).length === 0 ? null : (
            <p className="og-advisor__was" aria-hidden="true">Replaces {replacedSettings(proposal.changes).join(", ")}</p>
          )}
          {proposal.notes.map((note, index) => (
            <p className="og-advisor__note" key={`${index}-${note}`}>
              {note}
            </p>
          ))}
          {proposalIsStale ? (
            <p className="og-advisor__error" role="alert">
              {advisorRiderState("stale-revision").message}
            </p>
          ) : null}
          <div className="og-advisor__actions">
            {proposalIsStale ? (
              <button type="button" className="og-primary" data-testid="advisor-refresh" onClick={advisor.refresh}>
                Refresh
              </button>
            ) : (
              <button type="button" className="og-primary" data-testid="advisor-apply" onClick={() => { if (advisor.apply()?.kind === "planning") onPlan?.(); }}>
                Plan it
              </button>
            )}
            <button type="button" className="og-secondary" data-testid="advisor-dismiss" onClick={advisor.dismiss}>
              Not this
            </button>
          </div>
        </div>
      ) : null}

      {message !== null && !idle ? (
        <div className={messageIsError ? "og-advisor__error" : "og-advisor__notice"} role={messageIsError ? "alert" : "status"}>
          <p>{messageIsError ? null : <AdvisorMark />} {message}</p>
          {recoveryLabel(recovery) === null ? null : (
            <button
              type="button"
              className="og-advisor__retry"
              onClick={recovery === "refresh" ? advisor.refresh : advisor.retry}
            >
              {recoveryLabel(recovery)}
            </button>
          )}
          <button type="button" className="og-advisor__close" aria-label="Dismiss" onClick={advisor.dismiss}>
            ×
          </button>
        </div>
      ) : null}
      {!hideForm && (askBox && open || !idle) ? (
        <form
          className="og-advisor__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <AdvisorMark />
          <input
            type="text"
            className="og-place-search__input og-advisor__input"
            data-testid="advisor-prompt"
            aria-label="Describe your ride"
            placeholder="2 h of twisty backroads, no highways"
            enterKeyHint="go"
            maxLength={RIDE_DESCRIPTION_MAX_LENGTH}
            autoFocus
            value={composerText}
            onChange={(event) => { setOpen(true); setDraftBase(advisor.prompt); setDraft(event.target.value); }}
            onBlur={() => {
              if (idle && draft.trim() === "") setOpen(false);
            }}
          />
          <button type="submit" className="og-secondary" disabled={pending || composerText.trim().length < 2}>Send</button>
        </form>
      ) : null}
      {hasStopFlow ? <AdvisorStopPicker advisor={advisor} /> : null}
    </section>
  );
}

function AdvisorInterpretation({ proposal }: { readonly proposal: Extract<AdvisorReadyProposal, { status: "ready" }> }) {
  const intent = proposal.interpretation;
  const routeShape = intent.shape === "loop" ? "Loop" : intent.shape === "destination" ? "To a destination" : "Open ride";
  const start = intent.start === null ? "No start set" : `From ${intent.start}`;
  const destination = intent.shape === "loop"
    ? `Returns to ${intent.start ?? "start"}`
    : intent.shape === "destination"
      ? intent.finish === null ? "No destination set" : `To ${intent.finish}`
      : "No fixed destination";
  const style = [
    ROAD_WORDS[intent.roadCharacter],
    SURFACE_WORDS[intent.surface],
    TERRAIN_WORDS[intent.terrain],
    NOVELTY_WORDS[intent.novelty],
    intent.avoidHighways ? "No highways" : null,
    intent.tollPolicy === "avoid" ? "No tolls" : null,
    TRAFFIC_WORDS[intent.traffic],
  ].filter((value): value is string => typeof value === "string");
  const stops = intent.stops.length === 0
    ? ["No stops"]
    : intent.stops.map((stop) => `${stop.label ?? "Unnamed stop"}${stop.arrivalIntent == null ? "" : ` · ${ARRIVAL_INTENT_LABELS[stop.arrivalIntent]}`}`);
  const unknowns = [
    ...intent.unknowns,
    ...(intent.start === null ? ["A start point is still needed to route this ride."] : []),
    ...(intent.shape === "destination" && intent.finish === null ? ["A destination is still needed to route this ride."] : []),
    "The route and deadline feasibility are checked after planning.",
  ];

  return (
    <div className="og-advisor__interpretation" data-testid="advisor-interpretation">
      <h3>Interpretation</h3>
      <dl>
        <div><dt>Route</dt><dd>{routeShape} · {start} · {destination}</dd></div>
        <div><dt>Style</dt><dd>{style.join(" · ")}</dd></div>
        <div><dt>Stops</dt><dd>{stops.join(", ")}</dd></div>
        <div><dt>Departure</dt><dd>{intent.departure}</dd></div>
        <div><dt>{intent.time.kind === "budget" ? "Time target" : "Deadline"}</dt><dd>{intent.timeLabel}</dd></div>
      </dl>
      <div className="og-advisor__unknowns">
        <h4>Unknowns</h4>
        <ul>{unknowns.map((unknown, index) => <li key={`${index}-${unknown}`}>{unknown}</li>)}</ul>
      </div>
    </div>
  );
}

const MAP_ASK_EXAMPLES = [
  "Two hours of twisty backroads, no highways",
  "Loop from Jim Thorpe, back by 6",
  "Ride to Jim Thorpe and arrive by 4",
] as const;

/**
 * Shared modal focus for the Ask sheet: trap Tab, Escape closes, focus goes
 * back to the Ask button on close. Mounted inside the dialog so the ref is set
 * when the hook runs; the text box takes focus first.
 */
function AskDialogFocus({ dialogRef, inputRef, onClose }: {
  readonly dialogRef: { readonly current: HTMLElement | null };
  readonly inputRef: { readonly current: HTMLInputElement | null };
  readonly onClose: () => void;
}) {
  useDialogFocus(dialogRef, onClose);
  useEffect(() => { inputRef.current?.focus(); }, [inputRef]);
  return null;
}

/** Dedicated map entry: the place search and its readQuery heuristic stay independent. */
export function MapAdvisorAsk() {
  const advisor = useRideAdvisor();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  // Tapping a button does not focus it in Safari, so the shared hook may have
  // no invoker to return to; send focus back to Ask explicitly.
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function close(): void {
    if (advisor?.surface === "map" && (advisor.pending || advisor.proposal !== null || advisor.message !== null)) {
      advisor.dismiss();
    }
    setOpen(false);
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const prompt = text.trim();
    if (prompt.length < 2 || advisor === null || advisor.pending) return;
    advisor.ask(prompt, "map");
  }

  return (
    <>
      <div className="og-map-ask">
      <button
        ref={triggerRef}
        type="button"
        className="og-map-ask__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ask to plan a ride"
        data-testid="map-ask-open"
        onClick={() => setOpen(true)}
      >
        <AdvisorMark /> Ask
      </button>
      </div>
      {!open || typeof document === "undefined" ? null : createPortal(
        <div
          className="og-map-ask__scrim"
          data-testid="map-ask-scrim"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <section
            ref={dialogRef}
            className="og-map-ask__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="og-map-ask-title"
            aria-describedby="og-map-ask-description"
            data-testid="map-ask-sheet"
          >
            <AskDialogFocus dialogRef={dialogRef} inputRef={inputRef} onClose={close} />
            <header className="og-map-ask__header">
              <div>
                <p className="og-map-ask__eyebrow"><AdvisorMark /> Plan a ride</p>
                <h2 id="og-map-ask-title">Describe a ride</h2>
              </div>
              <button type="button" className="og-map-ask__close" aria-label="Close Ask" onClick={close}>×</button>
            </header>
            <p id="og-map-ask-description" className="og-map-ask__description">
              Tell us where to go, the kind of roads you want, and when you need to be back.
            </p>
            <div className="og-map-ask__examples" role="group" aria-label="Example ride descriptions">
              {MAP_ASK_EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => { setText(example); inputRef.current?.focus(); }}>
                  {example}
                </button>
              ))}
            </div>
            <form className="og-map-ask__form" onSubmit={submit}>
              <label htmlFor="og-map-ask-prompt">Your ride</label>
              <div className="og-map-ask__input-row">
                <input
                  ref={inputRef}
                  id="og-map-ask-prompt"
                  type="text"
                  data-testid="map-ask-prompt"
                  aria-label="Describe a ride"
                  placeholder="e.g. A two-hour loop on backroads"
                  maxLength={RIDE_DESCRIPTION_MAX_LENGTH}
                  autoComplete="off"
                  enterKeyHint="go"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <button type="submit" className="og-primary" disabled={advisor === null || advisor.pending || text.trim().length < 2}>
                  {advisor?.pending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
            {advisor === null ? (
              <p className="og-map-ask__unavailable" role="status">
                Ask is unavailable right now. You can still search for a place or set your start and destination in Plan.
              </p>
            ) : <AdvisorInline surface="map" hideForm onPlan={() => setOpen(false)} />}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

/** One-tap asks about a planned ride, in the rider's words. */
const RIDE_ASKS: readonly { readonly label: string; readonly prompt: string }[] = [
  { label: "Why this route?", prompt: "Why this route?" },
  { label: "Shorter", prompt: "Make this ride about 30 minutes shorter" },
  { label: "More dirt", prompt: "More gravel and dirt roads on this ride" },
  { label: "Curvier", prompt: "Make this ride curvier" },
  { label: "No highways", prompt: "Avoid highways on this ride" },
];

interface StopLookupState {
  readonly flowId: string;
  readonly attempt: number;
  readonly routeKey: string;
  readonly proposals: readonly AdvisorStopSearchProposal[];
}

interface StopSelectionState {
  readonly flowId: string;
  readonly attempt: number;
  readonly byIndex: Readonly<Record<number, string>>;
}

function AdvisorStopPicker({ advisor }: { readonly advisor: RideAdvisor }) {
  const flow = advisor.stopSearches;
  const planningStore = advisor.planningStore;
  const source = advisor.placesSource;
  const subscribePlanning = useCallback((onChange: () => void) => planningStore?.subscribe(() => onChange()) ?? (() => undefined), [planningStore]);
  const getPlanning = useCallback(() => planningStore?.getState() ?? null, [planningStore]);
  const planning = useSyncExternalStore(subscribePlanning, getPlanning, getPlanning);
  const subscribeDocument = useCallback((onChange: () => void) => advisor.documentStore.subscribe(() => onChange()), [advisor.documentStore]);
  const getDocument = useCallback(() => advisor.documentStore.getState().document, [advisor.documentStore]);
  const document = useSyncExternalStore(subscribeDocument, getDocument, getDocument);
  const [lookup, setLookup] = useState<StopLookupState | null>(null);
  const [selection, setSelection] = useState<StopSelectionState | null>(null);
  const [attempt, setAttempt] = useState(0);

  const snapshot = planning?.snapshot;
  const bundle = snapshot?.committedBundle ?? snapshot?.lastGoodBundle ?? null;
  const selectedRoute = bundle?.candidates.find((candidate) => candidate.id === bundle.selectedRouteId);
  const geometry = selectedRoute === undefined ? undefined : planning?.geometry[selectedRoute.geometryRef];
  const routeReady = flow !== null && snapshot?.phase === "ready" && bundle !== null &&
    bundle.rideRevision === document.revision && document.revision === flow.baseRevision && geometry?.kind === "line";
  const routeKey = selectedRoute === undefined || bundle === null
    ? null
    : `${selectedRoute.id}|${selectedRoute.geometryRef}|${bundle.planningGeneration}`;

  useEffect(() => {
    if (flow === null || document.revision !== flow.baseRevision) return;
    if (source === undefined || planning === null || snapshot === undefined || !routeReady || selectedRoute === undefined || geometry?.kind !== "line") {
      return;
    }

    const controller = new AbortController();
    const line = geometry.coordinates;
    const miles = routeLengthMiles(line);
    const routeDurationMinutes = selectedRoute.durationSeconds / 60;
    void Promise.all(flow.requests.map(async (request): Promise<AdvisorStopSearchProposal> => {
      const result = await source.alongRoute(
        { line, bufferMiles: 5 },
        { kinds: [], window: "today", categories: [request.category], vicinity: request.vicinity },
        controller.signal,
      );
      if (result.availability === "unavailable") {
        return { request, candidates: [], sourceLabel: "Places", unavailableReason: result.reason };
      }
      return {
        request,
        sourceLabel: result.attribution,
        candidates: rankAdvisorStopCandidates({
          request,
          places: result.places,
          attribution: result.attribution,
          routeMiles: miles,
          routeDurationMinutes,
          timeBudgetMinutes: flow.timeBudgetMinutes,
        }),
      };
    })).then((proposals) => {
      if (!controller.signal.aborted) {
        if (routeKey !== null) setLookup({ flowId: flow.id, attempt, routeKey, proposals });
        setSelection(null);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLookup({
          flowId: flow.id,
          attempt,
          routeKey: routeKey ?? "",
          proposals: flow.requests.map((request) => ({
            request,
            candidates: [],
            sourceLabel: "Places",
            unavailableReason: "Places are unavailable right now.",
          })),
        });
        setSelection(null);
      }
    });
    return () => controller.abort();
  }, [attempt, document, flow, geometry, planning, routeKey, routeReady, selectedRoute, snapshot, source]);

  if (flow === null) return null;
  const stale = document.revision !== flow.baseRevision;
  const currentLookup = routeReady && routeKey !== null && lookup?.flowId === flow.id &&
    lookup.attempt === attempt && lookup.routeKey === routeKey ? lookup : null;
  const proposals = currentLookup?.proposals ?? [];
  const selected = selection?.flowId === flow.id && selection.attempt === attempt ? selection.byIndex : {};
  const selectedCandidates = proposals.flatMap((proposal, index) =>
    proposal.candidates.filter((candidate) => candidate.place.id === selected[index]),
  );
  const canAdd = currentLookup !== null && proposals.length === flow.requests.length && selectedCandidates.length > 0;

  return (
    <section className="og-advisor-stops" aria-label="Choose route stops" data-testid="advisor-stop-picker">
      <h4>Choose places along the route</h4>
      {stale ? <p role="status">The ride changed. Ask again to refresh these place searches.</p> : null}
      {!stale && currentLookup === null ? (
        <p role="status">
          {snapshot !== undefined && isPlanningInFlight(snapshot.phase)
            ? "Planning the route before searching places…"
            : routeReady
              ? "Searching places from the selected source along the planned route…"
              : "Set a start and destination, then plan a route before searching for these stops."}
        </p>
      ) : null}
      {currentLookup !== null ? (
        <>
          <p className="og-advisor-stops__note">Order uses only supplied ratings and review counts, estimated detour and your time budget. Missing ratings show as Not rated. Route time recalculates after you add stops.</p>
          {proposals.map((proposal, index) => (
            <section className="og-advisor-stops__group" key={String(index) + proposal.request.category}>
              <h5>
                Stop {index + 1}: {ADVISOR_STOP_CATEGORY_LABELS[proposal.request.category]} · {ADVISOR_ROUTE_POSITION_LABELS[proposal.request.routePosition]}
                {proposal.request.vicinity === null ? "" : " · " + proposal.request.vicinity}
              </h5>
              <p className="og-advisor-stops__source">Source: {proposal.sourceLabel}</p>
              {proposal.unavailableReason !== undefined ? <p role="status">Places are unavailable: {proposal.unavailableReason}</p> : null}
              {proposal.unavailableReason === undefined && proposal.candidates.length === 0 ? <p>No matching places were returned. Try another area or search manually.</p> : null}
              {proposal.candidates.length === 0 ? null : (
                <ul className="og-advisor-stops__candidates">
                  {proposal.candidates.map((candidate) => {
                    const place = candidate.place;
                    const rating = candidate.qualityEvidence?.rating;
                    const reviews = candidate.qualityEvidence?.reviewCount;
                    const quality = rating === undefined
                      ? "Not rated" + (reviews === undefined ? "" : " · " + reviews + " reviews")
                      : rating.toFixed(1) + " / 5" + (reviews === undefined ? "" : " · " + reviews + " reviews");
                    const detour = place.offRouteMiles === null
                      ? "Detour unavailable"
                      : place.offRouteMiles < 0.1 ? "On route" : place.offRouteMiles.toFixed(1) + " mi off route";
                    const time = candidate.detourMinutesEstimate === null
                      ? ""
                      : " · est. +" + Math.round(candidate.detourMinutesEstimate) + " min";
                    const isSelected = selected[index] === place.id;
                    return (
                      <li key={place.id}>
                        <button
                          type="button"
                          className={isSelected ? "og-advisor-stops__candidate is-selected" : "og-advisor-stops__candidate"}
                          aria-pressed={isSelected}
                          aria-label={"Choose " + place.name + ", " + quality + ", " + detour}
                          onClick={() => setSelection({
                            flowId: flow.id,
                            attempt,
                            byIndex: { ...selected, [index]: isSelected ? "" : place.id },
                          })}
                        >
                          <strong>{place.name}</strong>
                          <span>{place.category}{place.city === "" ? "" : " · " + place.city}</span>
                          <span>{quality}</span>
                          <span>{detour}{time}</span>
                          <span className="og-advisor-stops__candidate-source">Source: {candidate.sourceLabel}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
          <div className="og-advisor-stops__actions">
            <button type="button" className="og-primary" disabled={!canAdd} onClick={() => advisor.addSelectedStops(selectedCandidates)}>
              Add selected stops and replan
            </button>
            <button type="button" className="og-secondary" onClick={advisor.dismissStopSearches}>Cancel</button>
          </div>
        </>
      ) : null}
      {currentLookup?.proposals.some((proposal) => proposal.unavailableReason !== undefined) ? (
        <button type="button" className="og-advisor__retry" onClick={() => setAttempt((value) => value + 1)}>Try places again</button>
      ) : null}
    </section>
  );
}

/**
 * "Ask about this ride", under a planned ride: the advisor sees the selected
 * route's summary, so a question or a tweak is one tap away instead of buried
 * in the composer the planned sheet no longer shows.
 */
export function AdvisorRideAsk() {
  const advisor = useRideAdvisor();
  const [draft, setDraft] = useState("");
  if (advisor === null) return null;
  const busy = advisor.pending;
  const live = advisor.surface === "ride" && (busy || advisor.proposal !== null || advisor.message !== null);
  function send(text: string): void {
    if (advisor === null || busy || text.trim().length < 2) return;
    advisor.ask(text, "ride");
    setDraft("");
  }
  return (
    <section className="og-advisor-ask" aria-label="Ask about this ride" data-testid="advisor-ride-ask">
      <h3 className="og-advisor-ask__title"><AdvisorMark /> Ask about this ride</h3>
      <ul className="og-advisor-ask__chips" aria-label="Quick asks">
        {RIDE_ASKS.map((item) => (
          <li key={item.label}>
            <button type="button" disabled={busy} onClick={() => send(item.prompt)}>{item.label}</button>
          </li>
        ))}
      </ul>
      {live ? <AdvisorInline surface="ride" /> : (
        <form className="og-advisor-ask__form" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
          {/* One row: the field holds its own send button, so a 320 px sheet
              never wraps a field and a button onto two lines. */}
          <div className="og-advisor-ask__field">
            <input
              type="text"
              className="og-place-search__input og-advisor__input"
              data-testid="advisor-ride-prompt"
              aria-label="Ask about this ride"
              placeholder="Ask or change anything: “lunch stop in Jim Thorpe”"
              enterKeyHint="send"
              maxLength={RIDE_DESCRIPTION_MAX_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className="og-advisor-ask__send"
              aria-label="Send"
              disabled={busy || draft.trim().length < 2}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </form>
      )}
      {!live && advisor.stopSearches?.surface === "ride" ? <AdvisorStopPicker advisor={advisor} /> : null}
    </section>
  );
}
