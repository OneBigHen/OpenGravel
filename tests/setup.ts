import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no canvas implementation, so `HTMLCanvasElement.getContext()` logs a
 * "Not implemented" error to the virtual console on every call. The real map
 * renderer probes for a WebGL2 context during construction, which means the app
 * shell test would otherwise print that noise for a condition the product already
 * handles: `createMapLibreHost` catches the missing context and returns the
 * documented degraded host (05 §22), so the planner keeps working without a canvas.
 *
 * Returning `null` keeps that path exactly as a browser without WebGL2 produces
 * it, and keeps the test output readable.
 */
HTMLCanvasElement.prototype.getContext = ((): null => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
