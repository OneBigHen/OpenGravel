/** Rider option names are comparisons over planner measurements, never routing requests. */
import type { RouteCardVm } from "./planner-view-model";

export interface RiderRouteOption {
  readonly card: RouteCardVm;
  readonly label: string;
  readonly reason: string;
}

function measured(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

/** Missing evidence is not a zero; every candidate must supply the quantity. */
function winner(
  cards: readonly RouteCardVm[],
  quantity: (card: RouteCardVm) => number | null | undefined,
  direction: "high" | "low",
): RouteCardVm | null {
  if (cards.length < 2) return null;
  const values = cards.map((card) => ({ card, value: quantity(card) }));
  if (values.some(({ value }) => !measured(value))) return null;
  const sorted = values as { card: RouteCardVm; value: number }[];
  sorted.sort((a, b) => direction === "high" ? b.value - a.value : a.value - b.value);
  const first = sorted[0];
  const second = sorted[1];
  if (first === undefined || second === undefined || first.value === second.value) return null;
  if (direction === "high" && first.value <= 0) return null;
  return first.card;
}

function pavedOnly(card: RouteCardVm): boolean {
  const strip = card.surfaceStrip;
  return strip !== undefined && strip.paved === 1 && strip.gravel === 0 && strip.dirt === 0 && strip.unknown === 0
    && card.unknownSurfaceMi === 0 && card.measurements?.unpavedMi === 0;
}

function miles(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fallbackReason(card: RouteCardVm): string {
  const curves = card.measurements?.curvyMi;
  if (measured(curves) && curves > 0) return `${miles(curves)} mi of curves`;
  const unpaved = card.measurements?.unpavedMi;
  if (measured(unpaved) && unpaved > 0) return `${miles(unpaved)} mi unpaved`;
  return card.unknownSurfaceMi == null || card.unknownSurfaceMi > 0 ? "Surface not fully measured" : "Another way to ride";
}

/**
 * Retains the selected recommendation and measured character winners, then fills
 * the remaining slots in the planner's order. An earned word never spills onto
 * the runner-up when one candidate wins more than one comparison.
 */
export function riderRouteOptions(cards: readonly RouteCardVm[]): readonly RiderRouteOption[] {
  const fastest = cards.find((card) => card.roleKey === "fastest")
    ?? winner(cards, (card) => card.addedMinutes, "low");
  const twistiest = winner(cards, (card) => card.measurements?.curvyMi, "high");
  const gravel = winner(cards, (card) => card.measurements?.unpavedMi, "high");
  const retained = new Set<RouteCardVm>();
  const retain = (card: RouteCardVm | null | undefined): void => {
    if (card !== null && card !== undefined && retained.size < 3) retained.add(card);
  };
  retain(cards.find((card) => card.isSelected));
  retain(fastest);
  retain(twistiest);
  retain(gravel);
  for (const card of cards) retain(card);

  return cards.filter((card) => retained.has(card)).map((card) => {
    if (card === fastest) return { card, label: "Fastest", reason: "Shortest ride time" };
    if (card === twistiest) return { card, label: "Twistiest", reason: `${miles(card.measurements!.curvyMi!)} mi of curves` };
    if (card === gravel) return { card, label: "Most gravel", reason: `${miles(card.measurements!.unpavedMi!)} mi unpaved` };
    if (pavedOnly(card)) return { card, label: "Paved only", reason: "All surface measured paved" };
    const label = card.roleKey === "more-twisties" || card.roleKey === "more-dirt" ? "Ride option" : card.roleLabel;
    return { card, label, reason: fallbackReason(card) };
  });
}
