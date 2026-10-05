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

import {
  advisorRequestForDocument,
  advisorRiderState,
  buildAdvisorProposal,
  type AdvisorDraftResult,
  type AdvisorProposalClient,
  type AdvisorRecovery,
  type ReadyAdvisorProposal,
} from "@/application/advisor";
import type { AdvisorProposalChange } from "@/application/advisor/advisor-proposal-commands";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import { emitTelemetry } from "@/ui/telemetry/emit-telemetry";

/** What happens after an applied proposal, in the rider's words. */
export type AdvisorAppliedNext =
  | { readonly kind: "planning" }
  | { readonly kind: "needs-point"; readonly point: "start" | "finish" };

export interface RideAdvisor {
  /** Send a ride description; replaces any earlier question. */
  ask(text: string): void;
  readonly prompt: string;
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
  /** Called once a proposal is applied: the planner plans, or names what is missing. */
  readonly onApplied?: () => AdvisorAppliedNext;
  readonly children: ReactNode;
}

export function RideAdvisorProvider({ enabled, store, client, onApplied, children }: RideAdvisorProviderProps) {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(() => onChange()), [store]);
  const getRevision = useCallback(() => store.getState().document.revision, [store]);
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [proposal, setProposal] = useState<ReadyAdvisorProposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [recovery, setRecovery] = useState<AdvisorRecovery>("none");
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
    (value: string) => {
      const text = value.trim();
      if (text.length < 2) return;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const generation = ++requestGeneration.current;
      emitTelemetry("advisor_proposal_requested", { capabilityStatus: "available" });
      setPrompt(text);
      setPending(true);
      setProposal(null);
      setMessage(null);
      setMessageIsError(false);
      setRecovery("none");
      void (async () => {
        try {
          const result: AdvisorDraftResult = await client.request(
            advisorRequestForDocument(store.getState().document, text),
            controller.signal,
          );
          if (generation !== requestGeneration.current) return;
          if (!result.ok) {
            emitTelemetry("advisor_proposal_ready", { capabilityStatus: "unavailable" });
            fail(result.message, result.recovery);
            return;
          }
          const built = buildAdvisorProposal(store.getState().document, result.draft);
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
    [client, store, fail],
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
    setMessage(null);
    setRecovery("none");
  }, [proposal]);

  const retry = useCallback(() => ask(prompt), [ask, prompt]);

  const value = useMemo<RideAdvisor>(
    () => ({ ask, prompt, pending, proposal, proposalIsStale, message, messageIsError, recovery, apply, dismiss, retry }),
    [ask, prompt, pending, proposal, proposalIsStale, message, messageIsError, recovery, apply, dismiss, retry],
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

/** One short chip per change, in rider words ("From Jim Thorpe, PA", "No highways"). */
export function changeChip(change: AdvisorProposalChange): string {
  switch (change.field) {
    case "shape":
      return change.after === "A to B" ? "To a destination" : change.after;
    case "start":
      return `From ${change.after}`;
    case "finish":
      return `To ${change.after}`;
    case "stop":
      return `Via ${change.after}`;
    case "roadCharacter":
      return ROAD_WORDS[change.after] ?? change.after;
    case "surface":
      return SURFACE_WORDS[change.after] ?? change.after;
    case "terrain":
      return TERRAIN_WORDS[change.after] ?? change.after;
    case "highways":
      return change.after === "Avoid" ? "No highways" : "Highways OK";
    case "tolls":
      return change.after === "Avoid" ? "No tolls" : "Tolls OK";
    default:
      return change.after;
  }
}

function recoveryLabel(recovery: AdvisorRecovery): string | null {
  if (recovery === "retry") return "Try again";
  if (recovery === "refresh") return "Ask again";
  return null;
}

/**
 * The advisor's mark, with the text-presentation selector: bare U+2733 draws
 * as a green emoji tile on iOS.
 */
export const ADVISOR_GLYPH = "\u2733\uFE0E";

/** The glyph the advisor answers under, everywhere it appears. */
export function AdvisorMark() {
  return (
    <span className="og-advisor__mark" aria-hidden="true">
      {ADVISOR_GLYPH}
    </span>
  );
}

/**
 * The advisor's answer, inline in the sheet: working, a proposal to plan, or
 * one line of what went wrong. With `askBox`, it also offers a one-line box for
 * the times the composer has no search field to type into (a loop's start is
 * already set, say).
 */
export function AdvisorInline({ askBox = false }: { readonly askBox?: boolean }) {
  const advisor = useRideAdvisor();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  if (advisor === null) return null;
  const { pending, proposal, proposalIsStale, message, messageIsError, recovery } = advisor;
  const idle = !pending && proposal === null && message === null;
  if (idle && !askBox) return null;

  function submit(): void {
    if (advisor === null || draft.trim().length < 2) return;
    advisor.ask(draft);
    setDraft("");
    setOpen(false);
  }

  return (
    <section className="og-advisor" data-testid="advisor-inline" aria-label="Ride advisor" aria-live="polite">
      {idle && askBox && !open ? (
        <button type="button" className="og-advisor__ask" data-testid="advisor-open" onClick={() => setOpen(true)}>
          <AdvisorMark />
          Describe a ride instead
        </button>
      ) : null}
      {askBox && open && !pending ? (
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
            className="og-place-search__input"
            data-testid="advisor-prompt"
            aria-label="Describe your ride"
            placeholder="2 h of twisty backroads, no highways"
            enterKeyHint="go"
            maxLength={600}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft.trim() === "") setOpen(false);
            }}
          />
        </form>
      ) : null}

      {pending ? (
        <p className="og-advisor__working" role="status" data-testid="advisor-working">
          <AdvisorMark />
          Reading “{advisor.prompt}”…
        </p>
      ) : null}

      {proposal !== null ? (
        <div className="og-advisor__proposal" data-testid="advisor-proposal">
          <p className="og-advisor__summary">
            <AdvisorMark />
            <span>Your ride</span>
          </p>
          <ul className="og-advisor__changes" aria-label="What this sets">
            {proposal.changes.map((change) => (
              <li key={change.field} title={`Was: ${change.before}`}>
                {changeChip(change)}
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
            <button type="button" className="og-primary" data-testid="advisor-apply" disabled={proposalIsStale} onClick={advisor.apply}>
              Plan it
            </button>
            <button type="button" className="og-secondary" data-testid="advisor-dismiss" onClick={advisor.dismiss}>
              Not this
            </button>
          </div>
        </div>
      ) : null}

      {message !== null ? (
        <div className={messageIsError ? "og-advisor__error" : "og-advisor__notice"} role={messageIsError ? "alert" : "status"}>
          <p>{message}</p>
          {recoveryLabel(recovery) === null ? null : (
            <button type="button" className="og-advisor__retry" onClick={advisor.retry}>
              {recoveryLabel(recovery)}
            </button>
          )}
          <button type="button" className="og-advisor__close" aria-label="Dismiss" onClick={advisor.dismiss}>
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}
