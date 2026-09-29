import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackSection } from "@/ui/settings/FeedbackSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("feedback", () => {
  it("sends the note and an optional reply address, then says thanks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FeedbackSection />);

    const send = screen.getByTestId("feedback-send");
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByTestId("feedback-message"), { target: { value: "The loop chip did nothing" } });
    fireEvent.change(screen.getByTestId("feedback-contact"), { target: { value: "rider@example.com" } });
    fireEvent.click(send);

    expect(await screen.findByTestId("feedback-sent")).toHaveTextContent("Thanks");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(String(init.body))).toMatchObject({ message: "The loop chip did nothing", contact: "rider@example.com" });
    expect(screen.getByTestId("feedback-message")).toHaveValue("");
  });

  it("keeps the note and says why when the server refuses it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Try again in a few minutes." }), { status: 429 })));
    render(<FeedbackSection />);
    fireEvent.change(screen.getByTestId("feedback-message"), { target: { value: "Something broke" } });
    fireEvent.click(screen.getByTestId("feedback-send"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in a few minutes.");
    await waitFor(() => expect(screen.getByTestId("feedback-message")).toHaveValue("Something broke"));
  });
});
