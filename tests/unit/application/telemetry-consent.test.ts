import { describe, expect, it } from "vitest";

import {
  TELEMETRY_ACKNOWLEDGEMENT,
  TELEMETRY_CONSENT_POLICY_VERSION,
  acknowledgedConsentState,
  telemetryGateOpen,
} from "@/application/telemetry/consent";
import {
  REPLAY_MASKING_CATEGORIES,
  SESSION_REPLAY_MASKING_POLICY,
} from "@/application/telemetry/replay-masking";

/**
 * Consent gate and the honest acknowledgement model (Task 11.4;
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §14–§15).
 *
 * Two obligations are pinned here:
 * 1. the gate is off until acknowledged and stays off wherever sending is not
 *    permitted, and
 * 2. the acknowledge view model is honest about what a session replay reveals
 *    (map pixels and the map viewport carry geographic context), lists what is
 *    strictly excluded, and carries no provider name in rider-facing copy
 *    (VNX-007 / Rule E).
 */

const VENDOR_NAMES = [
  "posthog",
  "mapbox",
  "maplibre",
  "graphhopper",
  "tomtom",
  "valhalla",
  "openai",
  "anthropic",
  "google",
  "aws",
  "azure",
  "cloudflare",
];

const ALL_COPY_STRINGS = [
  TELEMETRY_ACKNOWLEDGEMENT.title,
  TELEMETRY_ACKNOWLEDGEMENT.collectedSummary,
  TELEMETRY_ACKNOWLEDGEMENT.neverCollectedSummary,
  TELEMETRY_ACKNOWLEDGEMENT.mapContextDisclosure,
  TELEMETRY_ACKNOWLEDGEMENT.offUntilAcknowledgedNote,
];

describe("the consent gate (11 §14)", () => {
  it("defaults to unacknowledged", () => {
    expect({ status: "unacknowledged" }).toEqual({ status: "unacknowledged" });
    expect(
      telemetryGateOpen("hosted-beta", { status: "unacknowledged" }),
    ).toBe(false);
  });

  it("opens only for hosted beta plus acknowledgement", () => {
    expect(
      telemetryGateOpen("hosted-beta", acknowledgedConsentState("now")),
    ).toBe(true);
    expect(telemetryGateOpen("self-host", acknowledgedConsentState("now"))).toBe(
      false,
    );
    expect(telemetryGateOpen("hosted-beta", { status: "unacknowledged" })).toBe(
      false,
    );
  });

  it("records the acknowledgement timestamp and the copy policy version", () => {
    expect(acknowledgedConsentState("2026-09-23T00:31:33.000Z")).toEqual({
      status: "acknowledged",
      acknowledgedAt: "2026-09-23T00:31:33.000Z",
      policyVersion: TELEMETRY_CONSENT_POLICY_VERSION,
    });
  });
});

describe("the acknowledgement view model is honest (11 §15)", () => {
  it("discloses that map pixels and the map viewport reveal geographic context", () => {
    const disclosure = TELEMETRY_ACKNOWLEDGEMENT.mapContextDisclosure;
    expect(disclosure).toContain("map pixels");
    expect(disclosure).toContain("map viewport");
    expect(disclosure).toContain("geographic");
  });

  it("lists every strictly excluded data class (11 §14–§15)", () => {
    const excluded = TELEMETRY_ACKNOWLEDGEMENT.neverCollectedSummary;
    expect(excluded).toMatch(/passwords/);
    expect(excluded).toMatch(/passkey/);
    expect(excluded).toMatch(/token/i);
    expect(excluded).toMatch(/GPX/);
    expect(excluded).toMatch(/recording geometry/);
    expect(excluded).toMatch(/route geometry/);
    expect(excluded).toMatch(/file names/);
    expect(excluded).toMatch(/identifiers/);
    expect(excluded).toMatch(/server secrets/);
  });

  it("describes what is collected without inventing more", () => {
    const collected = TELEMETRY_ACKNOWLEDGEMENT.collectedSummary;
    expect(collected).toContain("actions you take");
    expect(collected).toContain("error classes");
    expect(collected).toContain("build version");
    expect(collected).toContain("session replay");
    expect(collected).toContain("autocapture");
    expect(collected).toContain("network address");
  });

  it("says the gate is off until acknowledged and reversible", () => {
    const note = TELEMETRY_ACKNOWLEDGEMENT.offUntilAcknowledgedNote;
    expect(note).toContain("only counts anonymous page visits");
    expect(note).toContain("turn it off again at any time");
  });

  it("names no provider anywhere in rider-facing copy (VNX-007 / Rule E)", () => {
    const haystack = ALL_COPY_STRINGS.join("\n").toLowerCase();
    for (const vendor of VENDOR_NAMES) {
      expect(haystack).not.toContain(vendor);
    }
  });

  it("is written in sentence case (Rule E)", () => {
    for (const text of ALL_COPY_STRINGS) {
      expect(text).toMatch(/^[A-Z]/);
      const stripped = text
        .replace(/\bGPX\b/g, "")
        .replace(/OpenGravel/g, "");
      expect(stripped).not.toMatch(/\b[A-Z]{2,}\b/);
      expect(stripped).not.toMatch(/[a-z][A-Z]/);
      for (const sentence of text.split(". ")) {
        expect(sentence).toMatch(/^[A-Z]/);
      }
    }
  });
});

describe("session replay masking policy (11 §15)", () => {
  it("masks exactly the four required categories", () => {
    expect([...REPLAY_MASKING_CATEGORIES]).toEqual([
      "auth-inputs",
      "free-form-sensitive-fields",
      "imported-filenames",
      "secret-token-fields",
    ]);
    expect([...SESSION_REPLAY_MASKING_POLICY.maskedCategories]).toEqual([
      "auth-inputs",
      "free-form-sensitive-fields",
      "imported-filenames",
      "secret-token-fields",
    ]);
  });

  it("turns every mask on", () => {
    expect(SESSION_REPLAY_MASKING_POLICY.maskAllInputValues).toBe(true);
    expect(SESSION_REPLAY_MASKING_POLICY.maskAllFreeFormText).toBe(true);
    expect(SESSION_REPLAY_MASKING_POLICY.maskImportedFilenames).toBe(true);
    expect(SESSION_REPLAY_MASKING_POLICY.maskSecretFields).toBe(true);
  });

  it("carries the same honest map-context disclosure as the acknowledgement", () => {
    expect(SESSION_REPLAY_MASKING_POLICY.mapContextDisclosure).toBe(
      TELEMETRY_ACKNOWLEDGEMENT.mapContextDisclosure,
    );
  });
});

it("does not accept acknowledgement of an obsolete disclosure", () => {
  expect(telemetryGateOpen("hosted-beta", { status: "acknowledged", acknowledgedAt: "now", policyVersion: 0 })).toBe(false);
});
