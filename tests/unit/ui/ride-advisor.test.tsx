import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdvisorProposalClient } from "@/application/advisor";
import type { AdvisorDraft } from "@/application/advisor/advisor-proposal";
import type { PlaceMatch, PlaceSearchPort } from "@/application/geocoding/place-search";
import { createRideDocument } from "@/domain/ride/create";
import type { RideDocument } from "@/domain/ride/types";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { AdvisorInline, AdvisorRideAsk, RideAdvisorProvider, useRideAdvisor, type AdvisorAppliedNext } from "@/ui/planner/RideAdvisor";
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

function setup(
  options: {
    readonly enabled?: boolean;
    readonly onApplied?: () => AdvisorAppliedNext;
    readonly places?: readonly PlaceMatch[];
    readonly client?: AdvisorProposalClient;
  } = {},
) {
  const store = createRideDocumentStore({ document: createRideDocument() });
  const client: AdvisorProposalClient = options.client ?? {
    request: vi.fn(async () => ({ ok: true as const, draft: jimThorpeLoop(store.getState().document) })),
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
