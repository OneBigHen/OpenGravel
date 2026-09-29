// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { consumeRideHandoff, HANDOFF_MAX_AGE_MS, markRideHandoff } from "@/infrastructure/storage/ride-handoff-marker";

describe("ride handoff marker", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is consumed once, within its window", () => {
    markRideHandoff(1_000);
    expect(consumeRideHandoff(1_500)).toBe(true);
    expect(consumeRideHandoff(1_600)).toBe(false);
  });

  it("does not resume a ride from a stale mark or none at all", () => {
    expect(consumeRideHandoff(5_000)).toBe(false);
    markRideHandoff(1_000);
    expect(consumeRideHandoff(1_000 + HANDOFF_MAX_AGE_MS + 1)).toBe(false);
  });
});
