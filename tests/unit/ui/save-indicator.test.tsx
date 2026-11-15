import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RIDE_EXPORT_AVAILABLE, SaveIndicator } from "@/ui/planner/SaveIndicator";

afterEach(cleanup);

describe("save indicator", () => {
  it("does not promise an export action before the export capability exists", () => {
    expect(RIDE_EXPORT_AVAILABLE).toBe(false);
  });

  it.each([
    ["saved", "Saved"],
    ["failed", "Could not save"],
    ["quota", "Storage is full — try again after freeing space in browser settings"],
    ["conflict", "Conflict — choose an option"],
  ] as const)("renders truthful copy for %s", (state, copy) => {
    render(<SaveIndicator state={state} />);
    expect(screen.getByTestId("save-indicator")).toHaveTextContent(copy);
  });

  it("stays out of the way until there is a ride to save (OG-23)", () => {
    // A cold planner has nothing to save, so "Not saved" is a stray label with
    // no subject — the rider sees the sheet's own first step instead.
    const { container } = render(<SaveIndicator state="unsaved" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("save-indicator")).not.toBeInTheDocument();

    // A ride that was saved before and has changed since keeps the honest note.
    render(<SaveIndicator state="unsaved" savedBefore />);
    expect(screen.getByTestId("save-indicator")).toHaveTextContent("Not saved");
  });
});
