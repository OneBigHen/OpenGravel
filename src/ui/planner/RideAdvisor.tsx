"use client";

/**
 * The ride advisor, inside the planner rather than floating over the map
 * (UX rework 2, #7/#13).
 *
 * The rider types into the same box they search with ("Where to, or describe a
 * ride"). A description goes to the advisor; its proposal appears inline in the
 * sheet as a short summary with one **Plan it** button, and applying it plans
 * the route. The state lives in one provider so the search field (which asks)
 * and the inline card (which answers) share a single conversation.
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

import { appendAdvisorExchange, type AdvisorExchange } from "@/application/advisor/advisor-conversation";
import { summarizeAdvisorRide } from "@/application/advisor/advisor-ride-summary";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import { cachedElevationClimb } from "./useElevationProfile";
import { advisorRiderState } from "@/application/advisor/advisor-errors";
import { RIDE_DESCRIPTION_MAX_LENGTH } from "@/application/advisor/ride-description";
import type {
  AdvisorDraft,
  AdvisorDraftResult,
  AdvisorProposalClient,
  AdvisorRecovery,
  ReadyAdvisorProposal,
} from "@/application/advisor";
import type { AdvisorProposalChange } from "@/application/advisor/advisor-proposal-commands";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import "./advisor-conversation.css";
import { emitTelemetry } from "@/ui/telemetry/emit-telemetry";

/** What happens after an applied proposal, in the rider's words. */
export type AdvisorAppliedNext =
  | { readonly kind: "planning" }
  | { readonly kind: "needs-point"; readonly point: "start" | "finish" };

/** Where the rider asked from: the composer (no ride yet) or the planned ride's sheet. */
export type AdvisorSurface = "composer" | "ride";

export interface RideAdvisor {
  /** Send a ride description or answer the latest clarification. */
  ask(text: string, surface?: AdvisorSurface): void;
  /** The surface that shows the conversation, so it never draws twice. */
  readonly surface: AdvisorSurface;
  readonly prompt: string;
  readonly conversation: readonly AdvisorExchange[];
  readonly pending: boolean;
  readonly proposal: ReadyAdvisorProposal | null;
  readonly proposalIsStale: boolean;
  /** A result line: an error, a clarification, or what happens next. */
  readonly message: string | null;
  readonly messageIsError: boolean;
  readonly recovery: AdvisorRecovery;
  apply(): void;
  dismiss(): void;
  retry(): void;
  /** Re-validates the last draft against the ride as it is now; no model call. */
  refresh(): void;
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
function RideAdvisorSession({ enabled, store, client, planningStore, onApplied, children }: RideAdvisorProviderProps) {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(() => onChange()), [store]);
  const getRevision = useCallback(() => store.getState().document.revision, [store]);
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const [prompt, setPrompt] = useState("");
  const [surface, setSurface] = useState<AdvisorSurface>("composer");
  const [conversation, setConversation] = useState<readonly AdvisorExchange[]>([]);
  const conversationRef = useRef<{ rideId: string; exchanges: readonly AdvisorExchange[] }>({ rideId: store.getState().document.rideId, exchanges: [] });
  const [pending, setPending] = useState(false);
  const [proposal, setProposal] = useState<ReadyAdvisorProposal | null>(null);
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
            const reply = built.status === "ready" ? `Suggested: ${built.changes.map(changeChip).join(" · ")}.` : built.message;
            const exchanges = appendAdvisorExchange(history, { riderRequest: text, reply, outcome: built.status === "ready" ? "proposal" : built.status });
            conversationRef.current = { rideId: requestedDocument.rideId, exchanges };
            setConversation(exchanges);
          }
          if (built.status === "ready") {
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

  const proposalIsStale = proposal !== null && proposal.command.baseRevision !== revision;

  const apply = useCallback(() => {
    if (proposal === null) return;
    if (proposal.command.baseRevision !== store.getState().document.revision) {
      const state = advisorRiderState("stale-revision");
      fail(state.message, state.recovery);
      setProposal(null);
      return;
    }
    const result = store.getState().dispatch(proposal.command);
    setProposal(null);
    setLastDraft(null);
    if (result.outcome === "applied") {
      emitTelemetry("advisor_proposal_applied", { source: "advisor" });
      setRecovery("none");
      setPrompt("");
      const next = onAppliedRef.current?.() ?? { kind: "planning" as const };
      // Planning speaks for itself on the map; only a missing point needs words.
      setMessage(next.kind === "planning" ? null : `Now set your ${next.point === "finish" ? "destination" : "start"} to plan this ride.`);
      setMessageIsError(false);
      return;
    }
    const state = advisorRiderState(result.outcome === "stale" ? "stale-revision" : "invalid-request");
    fail(state.message, state.recovery);
  }, [proposal, store, fail]);

  const dismiss = useCallback(() => {
    if (proposal !== null) emitTelemetry("advisor_proposal_discarded");
    requestController.current?.abort();
    requestGeneration.current += 1;
    setPending(false);
    setProposal(null);
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
      if (built.status === "ready") {
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
    () => ({ ask, surface, prompt, conversation, pending, proposal, proposalIsStale, message, messageIsError, recovery, apply, dismiss, retry, refresh }),
    [ask, surface, prompt, conversation, pending, proposal, proposalIsStale, message, messageIsError, recovery, apply, dismiss, retry, refresh],
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
export function AdvisorInline({ askBox = false, surface = "composer" }: { readonly askBox?: boolean; readonly surface?: AdvisorSurface }) {
  const advisor = useRideAdvisor();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftBase, setDraftBase] = useState("");
  if (advisor === null) return null;
  const { pending, proposal, proposalIsStale, message, messageIsError, recovery } = advisor;
  const composerText = draftBase === advisor.prompt ? draft : advisor.prompt;
  // Another surface owns the live conversation: this one stays quiet.
  const idle = (!pending && proposal === null && message === null) || advisor.surface !== surface;
  if (idle && !askBox) return null;

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
          <p className="og-advisor__brief">{proposal.summary}</p>
          <ul className="og-advisor__changes" aria-label="What this sets">
            {proposal.changes.map((change) => (
              <li key={change.field}>
                <span>{changeChip(change)}</span>
                <span className="og-advisor__was">was {changeWas(change)}</span>
              </li>
            ))}
          </ul>
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
              <button type="button" className="og-primary" data-testid="advisor-apply" onClick={advisor.apply}>
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
      {(askBox && open || !idle) ? (
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
    </section>
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
          <button type="submit" className="og-secondary" disabled={busy || draft.trim().length < 2}>Ask</button>
        </form>
      )}
    </section>
  );
}
