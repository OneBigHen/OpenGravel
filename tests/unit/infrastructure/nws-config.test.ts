import { describe, expect, it } from "vitest";

import {
  DEFAULT_NWS_USER_AGENT,
  nwsUserAgentFromEnv,
} from "@/infrastructure/weather/config";

describe("NWS deployment identity", () => {
  it("uses one documented fallback identity when no deployment value is set", () => {
    expect(nwsUserAgentFromEnv({})).toBe(DEFAULT_NWS_USER_AGENT);
  });

  it("uses a trimmed deployment identity when configured", () => {
    expect(nwsUserAgentFromEnv({
      NWS_USER_AGENT: "  OpenGravel/1.0 (ops@example.com)  ",
    })).toBe("OpenGravel/1.0 (ops@example.com)");
  });
});
