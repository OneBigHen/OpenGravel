/**
 * Scales a line-opacity paint value by a factor without breaking zoom
 * expressions. A `["zoom"]` input may only feed a top-level `step` or
 * `interpolate`, so wrapping one in `["*", …]` is a style error (Mapbox
 * Outdoors' road layers use both). Those are scaled at each output instead.
 */
export function scaleOpacity(value: unknown, factor: number): unknown {
  if (value === undefined || value === null) return factor;
  if (typeof value === "number") return value * factor;
  if (!Array.isArray(value)) return value;
  const [op] = value;
  if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab") {
    // [op, type, input, stop, output, stop, output, …]
    return value.map((part, index) => (index >= 4 && index % 2 === 0 ? scaleOpacity(part, factor) : part));
  }
  if (op === "step") {
    // ["step", input, output0, stop, output, stop, output, …]
    return value.map((part, index) => (index === 2 || (index > 2 && index % 2 === 0) ? scaleOpacity(part, factor) : part));
  }
  return ["*", value, factor];
}
