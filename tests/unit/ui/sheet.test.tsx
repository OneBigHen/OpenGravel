import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/ui/sheet/Sheet";

afterEach(cleanup);
const props = { label: "Place", detent: "half" as const, onToggle: vi.fn(), onStep: vi.fn() };
describe("Sheet", () => {
  it("exposes all three controlled detents and a 48px handle", () => {
    const view = render(<Sheet {...props}>Details</Sheet>);
    for (const detent of ["peek", "half", "full"] as const) {
      view.rerender(<Sheet {...props} detent={detent}>Details</Sheet>);
      expect(screen.getByRole("dialog")).toHaveAttribute("data-detent", detent);
      expect(screen.getByTestId("sheet-handle")).toHaveAttribute("aria-expanded", String(detent !== "peek"));
    }
    fireEvent.click(screen.getByTestId("sheet-handle"));
    expect(props.onToggle).toHaveBeenCalled();
  });
  it("steps with arrows and Escape, ignores Escape outside the sheet", () => {
    const onStep = vi.fn();
    render(<Sheet {...props} onStep={onStep}><button>Action</button></Sheet>);
    const handle = screen.getByTestId("sheet-handle");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Action" }), { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onStep.mock.calls).toEqual([["up"], ["down"], ["down"]]);
  });
  it("focuses on entry, restores invoker and dismisses with Escape when supplied", () => {
    const invoker = document.createElement("button"); document.body.append(invoker); invoker.focus();
    const onDismiss = vi.fn();
    const view = render(<Sheet {...props} focusKey="place" onDismiss={onDismiss}><h2 tabIndex={-1} data-sheet-focus>Details</h2></Sheet>);
    expect(screen.getByRole("heading")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("heading"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
    view.unmount(); expect(invoker).toHaveFocus(); invoker.remove();
  });
  it("returns focus to the handle before collapsing hidden content", () => {
    const view = render(<Sheet {...props}><button>Action</button></Sheet>);
    screen.getByRole("button", { name: "Action" }).focus();
    view.rerender(<Sheet {...props} detent="peek"><button>Action</button></Sheet>);
    expect(screen.getByTestId("sheet-handle")).toHaveFocus();
  });
  it("swipes one detent, swallows the release click, and cancels cleanly", () => {
    const onStep = vi.fn(), onToggle = vi.fn();
    render(<Sheet {...props} onStep={onStep} onToggle={onToggle}>Details</Sheet>);
    const handle = screen.getByTestId("sheet-handle");
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 300, pointerType: "touch" });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 220 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 220 });
    fireEvent.click(handle);
    expect(onStep).toHaveBeenCalledWith("up"); expect(onToggle).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 300, pointerType: "touch" });
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 400 });
    expect(onStep).toHaveBeenCalledOnce();
  });
});
