import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RideOfferCard } from "@/ui/ride/RideOfferCard";

afterEach(cleanup);

describe("ride offer swipe", () => {
  it.each([120, -120])("does not choose an offer when a %s px drag is cancelled", (dx) => {
    const onTake = vi.fn();
    const onSkip = vi.fn();
    render(<RideOfferCard summary={{ title: "Curvy loop", kicker: "From here", minutes: 45, distanceMeters: 30000, chips: [], spoken: "Curvy loop" }}
      shownAt={new Date().toISOString()} lifetimeMs={30000} onTake={onTake} onSkip={onSkip} />);
    const card = screen.getByTestId("ride-offer");
    card.setPointerCapture = vi.fn();
    // jsdom has no PointerEvent constructor; supply the pointer fields explicitly.
    const send = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 1, clientX: x });
      fireEvent(card, event);
    };
    send("pointerdown", 200);
    send("pointermove", 200 + dx);
    send("pointercancel", 200 + dx);
    expect(onTake).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    expect(card.style.getPropertyValue("--og-offer-dx")).toBe("0px");
  });
});
