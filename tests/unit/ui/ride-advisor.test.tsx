import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdvisorProposalClient } from "@/application/advisor";
import type { AdvisorDraft } from "@/application/advisor/advisor-proposal";
import { asPlaceId, type NearbyPlace, type PlacesSource } from "@/application/places";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { PlaceMatch, PlaceSearchPort } from "@/application/geocoding/place-search";
import { createRideDocument } from "@/domain/ride/create";
import { newCommandId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { AdvisorInline, AdvisorRideAsk, MapAdvisorAsk, RideAdvisorProvider, useRideAdvisor, type AdvisorAppliedNext } from "@/ui/planner/RideAdvisor";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";

afterEach(() => cleanup());

function jimThorpeLoop(document: RideDocument): AdvisorDraft {
  return {
    rideId: document.rideId, baseRevision: document.revision, localDate: "2026-09-26", timeZone: "America/New_York",
    outcome: "proposal", clarification: null,
    fields: {
      shape: "loop", startPlace: "Jim Thorpe", finishPlace: null, stopPlace: null, stopArrivalIntent: null,
      rideTimeKind: "budget", rideTimeMinutes: 120, rideTimeDate: null, rideTimeLocalTime: null,
      roadCharacter: "backroads", noveltyPreference: null, surfacePreference: null, terrainLevel: null, avoidHighways: true, tollPolicy: null, trafficPreference: null,
      departureKind: "unchanged", departureLocalDate: null, departureLocalTime: null,
    },
    resolvedPlaces: {
      start: { id: "photon:1", label: "Jim Thorpe, PA", name: "Jim Thorpe", context: "Carbon County, PA", coordinate: { lat: 40.8759, lon: -75.7324 }, provider: "photon" },
      finish: null, stop: null,
    },
    notes: [],
  };
}

const OLD_MILL_GAP: PlaceMatch = {
  id: "photon:addr-1",
  label: "1234 Old Mill Gap Road, Stroudsburg, PA 18360",
  name: "1234 Old Mill Gap Road",
  context: "Stroudsburg, Monroe County, PA",
  coordinate: { lat: 40.9868, lon: -75.1947 },
  provider: "photon",
};
const COFFEE: PlaceMatch = {
  id: "photon:poi-1",
  label: "Notebook Coffee, Jim Thorpe, PA",
  name: "Notebook Coffee",
  context: "Jim Thorpe, Carbon County, PA",
  coordinate: { lat: 40.8631, lon: -75.7377 },
  provider: "photon",
};

/** A date a few days ahead, so a proposed return-by time is still in the future. */
function futureDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** The month and day names of a rider-local date, as the card reads them. */
function dayWords(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

function places(list: readonly PlaceMatch[] = []): PlaceSearchPort & { search: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async () => ({ status: "ok" as const, places: list })),
    reverse: vi.fn(async () => null),
  };
}

/** The finish box the composer renders, wired to the provider's advisor. */
function WhereTo({ port }: { readonly port: PlaceSearchPort }) {
  const advisor = useRideAdvisor();
  return (
    <PlaceSearchField
      slot="finish"
      search={port}
      onPick={() => undefined}
      {...(advisor === null ? {} : { describe: advisor.ask })}
    />
  );
}

function AskStopSearch() {
  const advisor = useRideAdvisor();
  return <button type="button" onClick={() => advisor?.ask("coffee halfway")}>Ask for coffee</button>;
}

function setup(
  options: {
    readonly enabled?: boolean;
    readonly onApplied?: () => AdvisorAppliedNext;
    readonly places?: readonly PlaceMatch[];
    readonly client?: AdvisorProposalClient;
    readonly draft?: (document: RideDocument) => AdvisorDraft;
  } = {},
) {
  const store = createRideDocumentStore({ document: createRideDocument() });
  const client: AdvisorProposalClient = options.client ?? {
    request: vi.fn(async () => ({ ok: true as const, draft: (options.draft ?? jimThorpeLoop)(store.getState().document) })),
  };
  const port = places(options.places);
  render(
    <RideAdvisorProvider enabled={options.enabled ?? true} store={store} client={client} {...(options.onApplied === undefined ? {} : { onApplied: options.onApplied })}>
      <WhereTo port={port} />
      <AdvisorInline />
    </RideAdvisorProvider>,
  );
  return { store, client, port };
}

function setupMapAsk(options: {
  readonly enabled?: boolean;
  readonly places?: readonly PlaceMatch[];
  readonly client?: AdvisorProposalClient;
} = {}) {
  const store = createRideDocumentStore({ document: createRideDocument() });
  const client: AdvisorProposalClient = options.client ?? {
    request: vi.fn(async () => ({ ok: true as const, draft: jimThorpeLoop(store.getState().document) })),
  };
  const port = places(options.places);
  render(
    <RideAdvisorProvider enabled={options.enabled ?? true} store={store} client={client}>
      <PlaceSearchField slot="finish" testIdPrefix="top-place" placeholder="Search here" search={port} onPick={() => undefined} />
      <MapAdvisorAsk />
    </RideAdvisorProvider>,
  );
  return { store, client, port };
}

describe("Map Ask entry and place search", () => {
  it("opens a focused Describe a ride sheet and sends directly without readQuery", async () => {
    const { client } = setupMapAsk();
    fireEvent.click(screen.getByTestId("map-ask-open"));
    const input = screen.getByTestId("map-ask-prompt");
    expect(input).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Describe a ride" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Example ride descriptions" })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "good beer" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(client.request).toHaveBeenCalledOnce());
    expect(vi.mocked(client.request).mock.calls[0]?.[0].prompt).toBe("good beer");
    expect(await screen.findByTestId("advisor-interpretation")).toHaveTextContent("Unknowns");
    expect(screen.getByTestId("advisor-interpretation")).toHaveTextContent("The route and deadline feasibility are checked after planning.");
  });

  it("keeps the map search place-only for businesses and ordinary addresses", async () => {
    const { client, port } = setupMapAsk({ places: [OLD_MILL_GAP] });
    const input = screen.getByTestId("top-place-search");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "good beer" } });
    await waitFor(() => expect(port.search).toHaveBeenCalledWith("good beer", expect.any(Object)));
    expect(screen.queryByTestId("place-option-describe")).toBeNull();
    expect(client.request).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "1234 Old Mill Gap Road, Stroudsburg, PA 18360" } });
    await waitFor(() => expect(port.search).toHaveBeenCalledWith("1234 Old Mill Gap Road, Stroudsburg, PA 18360", expect.any(Object)));
    expect(client.request).not.toHaveBeenCalled();
  });

  it("allows short text in Ask and restores focus when Escape closes the sheet", async () => {
    const { client } = setupMapAsk();
    const trigger = screen.getByTestId("map-ask-open");
    fireEvent.click(trigger);
    const input = screen.getByTestId("map-ask-prompt");
    fireEvent.change(input, { target: { value: "Go" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(client.request).toHaveBeenCalledOnce());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("map-ask-sheet")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("cancels an in-flight Map Ask and keeps its text when reopened", async () => {
    let signal: AbortSignal | undefined;
    setupMapAsk({
      client: {
        request: (_request, requestSignal) => {
          signal = requestSignal;
          return new Promise(() => undefined);
        },
      },
    });
    const trigger = screen.getByTestId("map-ask-open");
    fireEvent.click(trigger);
    const input = screen.getByTestId("map-ask-prompt");
    fireEvent.change(input, { target: { value: "A short twisty loop" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByTestId("advisor-working")).toBeInTheDocument());

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByTestId("map-ask-prompt")).toHaveValue("A short twisty loop");
  });

  it("states that Ask is unavailable while leaving manual planning available", () => {
    setupMapAsk({ enabled: false });
    fireEvent.click(screen.getByTestId("map-ask-open"));
    expect(screen.getByRole("status")).toHaveTextContent("Ask is unavailable right now");
    expect(screen.getByRole("status")).toHaveTextContent("set your start and destination in Plan");
    expect(screen.getByTestId("map-ask-prompt")).toBeEnabled();
  });
});


function categorySearchDraft(document: RideDocument): AdvisorDraft {
  const base = jimThorpeLoop(document);
  return {
    ...base,
    fields: {
      ...base.fields,
      shape: null,
      startPlace: null,
      rideTimeKind: "unchanged",
      rideTimeMinutes: null,
      roadCharacter: null,
      surfacePreference: null,
      avoidHighways: null,
      stopSearches: [{ category: "coffee", vicinity: null, routePosition: "halfway" }],
    },
    resolvedPlaces: { start: null, finish: null, stop: null },
  };
}

describe("one box for where to and describe a ride", () => {
  it("is a plain place search when the deployment has no advisor", () => {
    setup({ enabled: false });
    const box = screen.getByTestId("finish-search");
    expect(box).toHaveAttribute("placeholder", "Where to?");
    fireEvent.change(box, { target: { value: "2 hour twisty loop" } });
    expect(screen.queryByTestId("place-option-describe")).toBeNull();
    expect(screen.queryByTestId("advisor-inline")).toBeNull();
  });

  it("offers Plan this ride for a description, and never geocodes it", async () => {
    const { port, client } = setup();
    const box = screen.getByTestId("finish-search");
    expect(box).toHaveAttribute("placeholder", "Where to, or a ride idea");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "2 hours of backroads from Jim Thorpe" } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Plan this ride");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.request).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(port.search).not.toHaveBeenCalled();
  });

  it("accepts a ride description far longer than a place query", () => {
    setup();
    expect(screen.getByTestId("finish-search")).toHaveAttribute("maxLength", "600");
  });

  it("still searches places for a long street address", async () => {
    const { port } = setup({ places: [OLD_MILL_GAP] });
    const box = screen.getByTestId("finish-search");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "1234 Old Mill Gap Road, Stroudsburg, PA 18360" } });
    await waitFor(() => expect(port.search).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByTestId("place-option")).toHaveLength(1));
    expect(screen.getByText("1234 Old Mill Gap Road")).toBeInTheDocument();
  });

  it("keeps the place results for a business search, with the ride row after them", async () => {
    const { port } = setup({ places: [COFFEE] });
    const box = screen.getByTestId("finish-search");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "coffee shop, Jim Thorpe PA" } });
    await waitFor(() => expect(port.search).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((option) => option.getAttribute("data-testid"))).toEqual([
        "place-option",
        "place-option-describe",
      ]),
    );
  });

  it("shows the proposal in rider words and plans it on one tap", async () => {
    const onApplied = vi.fn((): AdvisorAppliedNext => ({ kind: "planning" }));
    const { store } = setup({ onApplied });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2h of backroads from Jim Thorpe, no highways" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const proposal = await screen.findByTestId("advisor-proposal");
    expect(proposal).toHaveTextContent("Loop");
    expect(proposal).toHaveTextContent("From Jim Thorpe, PA");
    expect(proposal).toHaveTextContent("2 hours");
    expect(proposal).toHaveTextContent("Backroads");
    expect(proposal).toHaveTextContent("No highways");
    fireEvent.click(screen.getByRole("button", { name: "Plan it" }));

    expect(onApplied).toHaveBeenCalledOnce();
    expect(store.getState().document.intent.shape).toBe("loop");
    await waitFor(() => expect(screen.queryByTestId("advisor-inline")).toBeNull());
  });

  it("refreshes a stale proposal against the ride as it is now, without asking the model again", async () => {
    const { store, client } = setup();
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2h of backroads from Jim Thorpe" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByTestId("advisor-proposal");

    // The rider taps a ride-style control before pressing Plan it.
    const before = store.getState().document;
    store.getState().dispatch({
      type: "roadCharacter.set",
      commandId: newCommandId(),
      rideId: before.rideId,
      baseRevision: before.revision,
      source: "rider",
      label: "Set road character",
      roadCharacter: "efficient",
    });

    expect(await screen.findByTestId("advisor-refresh")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    fireEvent.click(await screen.findByRole("button", { name: "Plan it" }));
    expect(client.request).toHaveBeenCalledOnce();
    expect(store.getState().document.intent.shape).toBe("loop");
    expect(store.getState().document.intent.roadCharacter).toBe("backroads");
  });

  it("names the point still missing after applying", async () => {
    setup({ onApplied: () => ({ kind: "needs-point", point: "finish" }) });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2h of backroads from Jim Thorpe" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Plan it" }));
    expect(await screen.findByText("Now set your destination to plan this ride.")).toBeInTheDocument();
  });
});

describe("advisor conversation", () => {
  it("keeps the rider text, accepts just the missing detail and sends prior turns", async () => {
    const store = createRideDocumentStore({ document: createRideDocument() });
    const client: AdvisorProposalClient = { request: vi.fn()
      .mockResolvedValueOnce({ ok: true, draft: { ...jimThorpeLoop(store.getState().document), outcome: "clarification", clarification: "ride-time" } })
      .mockResolvedValue({ ok: true, draft: jimThorpeLoop(store.getState().document) }) };
    render(<RideAdvisorProvider enabled store={store} client={client}><AdvisorInline askBox /></RideAdvisorProvider>);
    fireEvent.click(screen.getByTestId("advisor-open"));
    const input = screen.getByTestId("advisor-prompt");
    fireEvent.change(input, { target: { value: "A backroads loop from Jim Thorpe" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText(/I couldn't understand the ride time/);
    expect(screen.getByTestId("advisor-prompt")).toHaveValue("A backroads loop from Jim Thorpe");
    fireEvent.change(screen.getByTestId("advisor-prompt"), { target: { value: "2 hours" } });
    fireEvent.submit(screen.getByTestId("advisor-prompt").closest("form")!);
    await screen.findByTestId("advisor-proposal");
    expect(client.request).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: "2 hours", history: [expect.objectContaining({ riderRequest: "A backroads loop from Jim Thorpe", outcome: "clarification" })] }), expect.any(AbortSignal));
    expect(screen.getByLabelText("Ride conversation")).toHaveTextContent("A backroads loop from Jim Thorpe");
    expect(screen.getByTestId("advisor-prompt")).toHaveValue("2 hours");
    expect(screen.getByRole("button", { name: "Plan it" })).toBeInTheDocument();
  });
});

describe("advisor explanation and continued conversation", () => {
  it("renders an explanation without a Plan it command and accepts the next question", async () => {
    const store = createRideDocumentStore({ document: createRideDocument() });
    const client: AdvisorProposalClient = { request: vi.fn(async () => ({ ok: true as const, draft: { ...jimThorpeLoop(store.getState().document), outcome: "answer" as const, answer: "About 62 miles and 120 minutes. Surface unknown." } })) };
    render(<RideAdvisorProvider enabled store={store} client={client}><AdvisorInline askBox /></RideAdvisorProvider>);
    fireEvent.click(screen.getByTestId("advisor-open"));
    fireEvent.change(screen.getByTestId("advisor-prompt"), { target: { value: "Why this route?" } });
    fireEvent.submit(screen.getByTestId("advisor-prompt").closest("form")!);
    await screen.findByText("About 62 miles and 120 minutes. Surface unknown.");
    expect(screen.queryByTestId("advisor-apply")).toBeNull();
    expect(store.getState().document.revision).toBe(0);
    expect(screen.getByTestId("advisor-prompt")).toHaveValue("Why this route?");
    fireEvent.change(screen.getByTestId("advisor-prompt"), { target: { value: "More dirt" } });
    fireEvent.submit(screen.getByTestId("advisor-prompt").closest("form")!);
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2));
    expect(client.request).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: "More dirt", history: [expect.objectContaining({ outcome: "answer", riderRequest: "Why this route?" })] }), expect.any(AbortSignal));
  });
});

describe("conversation ownership", () => {
  it("clears the transcript when switching to another ride at the same revision", async () => {
    const first = createRideDocumentStore({ document: createRideDocument() });
    const second = createRideDocumentStore({ document: createRideDocument() });
    const client: AdvisorProposalClient = { request: vi.fn(async () => ({ ok: true as const, draft: { ...jimThorpeLoop(first.getState().document), outcome: "clarification" as const, clarification: "ride-time" as const } })) };
    const view = render(<RideAdvisorProvider enabled store={first} client={client}><AdvisorInline askBox /></RideAdvisorProvider>);
    fireEvent.click(screen.getByTestId("advisor-open"));
    fireEvent.change(screen.getByTestId("advisor-prompt"), { target: { value: "A gravel loop from Jim Thorpe" } });
    fireEvent.submit(screen.getByTestId("advisor-prompt").closest("form")!);
    await screen.findByText(/I couldn't understand the ride time/);
    view.rerender(<RideAdvisorProvider enabled store={second} client={client}><AdvisorInline askBox /></RideAdvisorProvider>);
    expect(screen.queryByLabelText("Ride conversation")).toBeNull();
    expect(screen.queryByText(/I couldn't understand the ride time/)).toBeNull();
    expect(screen.getByTestId("advisor-open")).toBeInTheDocument();
  });
});

describe("ask about this ride", () => {
  function setupRide() {
    const store = createRideDocumentStore({ document: createRideDocument() });
    const client: AdvisorProposalClient = {
      request: vi.fn(async () => ({ ok: true as const, draft: jimThorpeLoop(store.getState().document) })),
    };
    render(
      <RideAdvisorProvider enabled store={store} client={client}>
        <section data-testid="composer-side"><AdvisorInline /></section>
        <AdvisorRideAsk />
      </RideAdvisorProvider>,
    );
    return { client };
  }

  it("sends a one-tap ask and shows the answer under the ride, not in the composer", async () => {
    const { client } = setupRide();
    fireEvent.click(screen.getByRole("button", { name: "Shorter" }));
    await waitFor(() => expect(screen.getByTestId("advisor-proposal")).toBeInTheDocument());
    expect(vi.mocked(client.request).mock.calls[0]?.[0].prompt).toBe("Make this ride about 30 minutes shorter");
    expect(screen.getAllByTestId("advisor-proposal")).toHaveLength(1);
    expect(screen.getByTestId("advisor-ride-ask")).toContainElement(screen.getByTestId("advisor-proposal"));
    // The card already shows the chips; the matching reply waits for history.
    expect(screen.queryByText(/^Suggested:/)).toBeNull();
  });

  it("asks a typed question about the planned ride", async () => {
    const { client } = setupRide();
    fireEvent.change(screen.getByTestId("advisor-ride-prompt"), { target: { value: "add a coffee stop in Jim Thorpe" } });
    fireEvent.submit(screen.getByTestId("advisor-ride-prompt").closest("form")!);
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.request).mock.calls[0]?.[0].prompt).toBe("add a coffee stop in Jim Thorpe");
  });

  it("keeps the field and its send button on one row", () => {
    setupRide();
    const input = screen.getByTestId("advisor-ride-prompt");
    const field = input.closest(".og-advisor-ask__field");
    expect(field).not.toBeNull();
    // The send button lives inside the field, so a 320 px sheet cannot wrap the
    // field and the button onto two lines.
    const send = screen.getByRole("button", { name: "Send" });
    expect(field).toContainElement(send);
    expect(send).toHaveAttribute("type", "submit");
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: "more dirt" } });
    expect(send).toBeEnabled();
  });

  it("lets the rider cancel an ask that came from the ride sheet", async () => {
    let requested: AbortSignal | undefined;
    const store = createRideDocumentStore({ document: createRideDocument() });
    const client: AdvisorProposalClient = {
      request: (_request, signal) => {
        requested = signal;
        return new Promise(() => undefined);
      },
    };
    render(<RideAdvisorProvider enabled store={store} client={client}><AdvisorRideAsk /></RideAdvisorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Curvier" }));
    const working = await screen.findByTestId("advisor-working");
    expect(screen.getByTestId("advisor-ride-ask")).toContainElement(working);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("advisor-working")).toBeNull());
    expect(requested?.aborted).toBe(true);
  });
});

describe("the proposal card", () => {
  it("reads in rider words, with a local date and the before-value in text", async () => {
    const returnDay = futureDay(3);
    setup({
      draft: (document) => {
        const draft = jimThorpeLoop(document);
        return {
          ...draft,
          fields: {
            ...draft.fields,
            rideTimeKind: "returnBy",
            rideTimeMinutes: null,
            rideTimeDate: returnDay,
            rideTimeLocalTime: "18:00",
            noveltyPreference: "prefer-new-to-me",
            departureKind: "unchanged",
            departureLocalDate: null,
            departureLocalTime: null,
          },
        };
      },
    });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "new roads, back by 6" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const proposal = await screen.findByTestId("advisor-proposal");
    expect(proposal).toHaveTextContent("Proposed ride");
    expect(proposal).toHaveTextContent("New roads");
    expect(proposal).toHaveTextContent(`Back by 6:00 pm on ${dayWords(returnDay)}`);
    expect(proposal.textContent).not.toMatch(/prefer-new-to-me|\d{4}-\d{2}-\d{2}/);
    // The old value is readable on a touch screen, not hidden in a hover title,
    // and filling an empty slot ("No time target") is not called a replacement.
    expect(proposal).toHaveTextContent("Replaces Balanced roads");
    expect(proposal.querySelector(".og-advisor__was")?.textContent).not.toMatch(/No time target|No start/);
    expect(proposal.querySelector("li[title]")).toBeNull();
  });

  it("names the departure in rider words", async () => {
    const leaveDay = futureDay(4);
    setup({
      draft: (document) => {
        const draft = jimThorpeLoop(document);
        return {
          ...draft,
          fields: {
            ...draft.fields,
            departureKind: "future",
            departureLocalDate: leaveDay,
            departureLocalTime: "08:00",
          },
        };
      },
    });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "loop from Jim Thorpe, leave at 8" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const proposal = await screen.findByTestId("advisor-proposal");
    expect(proposal).toHaveTextContent("8:00 AM");
    expect(proposal.textContent).toMatch(/Leave /);
    expect(proposal.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("advisor category stop selection", () => {
  it("waits for a route, shows honest provider evidence, then adds the rider's selected stop and replans", async () => {
    const store = createRideDocumentStore({ document: createRideDocument() });
    const listeners = new Set<() => void>();
    let planningState = {
      snapshot: { phase: "idle", committedBundle: null, lastGoodBundle: null },
      geometry: {},
    } as unknown as ReturnType<PlanningSessionStore["getState"]>;
    const planningStore = {
      getState: () => planningState,
      getInitialState: () => planningState,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    } as unknown as PlanningSessionStore;
    const candidate: NearbyPlace = {
      id: asPlaceId("venue:coffee-1"),
      kind: "venue",
      name: "Route Coffee",
      coordinate: { lon: -74.5, lat: 40 },
      category: "Coffee Shop",
      label: "",
      status: "day",
      city: "Jim Thorpe",
      address: "",
      specials: [],
      schedule: null,
      rating: null,
      popular: false,
      dogFriendly: null,
      patio: null,
      url: "https://places.example/coffee",
      mapsUrl: null,
      sourceLabel: "Regional Places Index",
      offRouteMiles: 0.4,
      routeMile: 26,
    };
    const alongRoute = vi.fn(async () => ({
      availability: "available" as const,
      places: [candidate],
      fetchedAt: "2026-10-26T12:00:00.000Z",
      attribution: "Fake Places provider",
    }));
    const placesSource: PlacesSource = {
      id: "fake-places",
      inExtent: async () => ({ availability: "available", places: [], fetchedAt: "2026-10-26T12:00:00.000Z", attribution: "Fake Places provider" }),
      alongRoute,
    };
    const onApplied = vi.fn(() => ({ kind: "planning" as const }));
    const client: AdvisorProposalClient = {
      request: vi.fn(async () => ({ ok: true as const, draft: categorySearchDraft(store.getState().document) })),
    };
    render(
      <RideAdvisorProvider enabled store={store} client={client} planningStore={planningStore} placesSource={placesSource} onApplied={onApplied}>
        <AskStopSearch />
        <AdvisorInline askBox />
      </RideAdvisorProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask for coffee" }));
    await screen.findByTestId("advisor-proposal");
    expect(screen.getByTestId("advisor-proposal")).toHaveTextContent("Coffee");

    const routeId = "route:ready" as never;
    const geometryRef = "geometry:route" as never;
    const route = {
      id: routeId,
      geometryRef,
      durationSeconds: 90 * 60,
    } as never;
    const bundle = {
      rideId: store.getState().document.rideId,
      rideRevision: store.getState().document.revision,
      candidates: [route],
      selectedRouteId: routeId,
    } as never;
    planningState = {
      snapshot: { phase: "ready", committedBundle: bundle, lastGoodBundle: bundle },
      geometry: { [geometryRef]: { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74, lat: 40 }] } },
    } as unknown as ReturnType<PlanningSessionStore["getState"]>;
    act(() => listeners.forEach((listener) => listener()));

    fireEvent.click(screen.getByTestId("advisor-apply"));
    expect(await screen.findByText("Source: Fake Places provider")).toBeInTheDocument();
    expect(screen.getByText("Source: Regional Places Index")).toBeInTheDocument();
    expect(screen.getByTestId("advisor-stop-picker")).toHaveTextContent("Not rated");
    expect(alongRoute).toHaveBeenCalledWith(
      expect.objectContaining({ bufferMiles: 5 }),
      expect.objectContaining({ kinds: [], categories: ["coffee"], vicinity: null }),
      expect.any(AbortSignal),
    );
    expect(onApplied).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /Choose Route Coffee/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected stops and replan" }));
    expect(store.getState().document.intent.stops).toMatchObject([
      { label: "Route Coffee, Jim Thorpe", arrivalIntent: "food", coordinate: candidate.coordinate },
    ]);
    expect(onApplied).toHaveBeenCalledTimes(2);
  });
});

describe("waiting for the advisor", () => {
  it("offers Cancel while the advisor is thinking, and cancelling returns to idle", async () => {
    let requested: AbortSignal | undefined;
    setup({
      client: {
        request: (_request, signal) => {
          requested = signal;
          return new Promise(() => undefined);
        },
      },
    });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2 hours of backroads from Jim Thorpe" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const working = await screen.findByTestId("advisor-working");
    expect(working).toHaveTextContent("Reading");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveClass("og-advisor__cancel");
    fireEvent.click(cancel);

    await waitFor(() => expect(screen.queryByTestId("advisor-inline")).toBeNull());
    expect(requested?.aborted).toBe(true);
  });

  it("does not offer Retry once the shared daily allowance is spent", async () => {
    setup({
      client: {
        request: async () => ({
          ok: false as const,
          errorClass: "quota-exhausted" as const,
          message: "The advisor has used up today's limit. Everything else works without it.",
          recovery: "none" as const,
        }),
      },
    });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2 hours of backroads from Jim Thorpe" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await screen.findByText(/used up today's limit/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says what it is still doing after a few seconds", async () => {
    vi.useFakeTimers();
    try {
      setup({ client: { request: () => new Promise(() => undefined) } });
      const box = screen.getByTestId("finish-search");
      fireEvent.change(box, { target: { value: "2 hours of backroads from Jim Thorpe" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByTestId("advisor-working")).not.toHaveTextContent("checking places");
      await act(async () => { vi.advanceTimersByTime(3_100); });
      expect(screen.getByTestId("advisor-working")).toHaveTextContent("Still reading your ride and checking places");
    } finally {
      vi.useRealTimers();
    }
  });
});
