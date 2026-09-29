import { describe, expect, it } from "vitest";
import { resolveHeadHomeTarget } from "@/application/free-ride/head-home-target";

describe("Head Home target selection", () => {
  const savedHome = { lon: -77.2, lat: 40.1 };
  const sessionStart = { lon: -76.9, lat: 40.4 };

  it("prefers saved Home when it is set", () => {
    expect(resolveHeadHomeTarget({ savedHome, sessionStart })).toEqual({
      kind: "saved-home",
      coordinate: savedHome,
      label: "saved Home",
    });
  });

  it("falls back to the persisted session start and has no guessed target before a fix", () => {
    expect(resolveHeadHomeTarget({ savedHome: null, sessionStart })).toMatchObject({
      kind: "session-start",
      coordinate: sessionStart,
    });
    expect(resolveHeadHomeTarget({ savedHome: null, sessionStart: null })).toBeNull();
  });
});
