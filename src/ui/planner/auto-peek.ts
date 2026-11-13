import type { SheetDetent } from "@/ui/stores/planner-ui-store";

/**
 * Google Maps' route preview: when the rider drags or pinches the map while
 * the ride sheet is at half, the sheet drops to its peek so the map they are
 * looking at gets the room. Never from the full sheet (the rider opened it on
 * purpose), never while a text field has focus (the keyboard is up), never
 * while a pen tool owns the map, and only with a ride on the map.
 */
export function autoPeekDetent(input: {
  readonly detent: SheetDetent;
  readonly compact: boolean;
  readonly hasRide: boolean;
  readonly panning: boolean;
  readonly typing: boolean;
  readonly placeOpen: boolean;
}): SheetDetent | null {
  if (!input.compact || !input.hasRide || !input.panning || input.typing || input.placeOpen) return null;
  return input.detent === "half" || input.detent === "ride" ? "peek" : null;
}

/** True when the focused element takes typing (the on-screen keyboard is up). */
export function textFieldFocused(active: Element | null): boolean {
  if (active === null) return false;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
  if (active instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(active.type);
  return active instanceof HTMLElement && active.isContentEditable;
}
