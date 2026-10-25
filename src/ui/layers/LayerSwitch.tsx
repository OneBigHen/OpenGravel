/**
 * The layers sheet switch, drawn once so every row states on and off the same
 * way: a track with a knob that travels, green when on. The row button owns the
 * state (`role="switch"` + `aria-checked`) and the whole 56 px row is the hit
 * area, so this is the picture the row shows, not a second control.
 */
export function LayerSwitch({ on }: { readonly on: boolean }) {
  return <span className="og-switch" data-on={on ? "true" : "false"} aria-hidden="true" />;
}
