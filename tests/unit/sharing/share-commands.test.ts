import { describe, expect, it } from "vitest";

import { newShareId, newShareToken, asShareToken } from "@/domain/sharing/ids";
import { newCommandId } from "@/domain/ride/ids";
import { serializeShareSnapshot } from "@/domain/sharing/snapshot";
import type { ShareSource } from "@/domain/sharing/types";
import type { ShareRepositoryPort } from "@/application/sharing/ports/share-repository";
import { MemoryShareRepository } from "@/application/sharing/memory-share-repository";
import {
  createShareService,
  dispatchShareCommand,
  resolveShareLink,
  shareLink,
  type ShareCommand,
} from "@/application/sharing/share-commands";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The share command set (10-SHARING-AND-OFFLINE §10): opening the opaque link,
 * applying a privacy trim, and revoking. The three contracts these tests pin:
 *
 * - the privacy preview is byte-exact to what the link exposes,
 * - the link token is unguessable and unlistable,
 * - revocation makes the link unusable (and re-issuing makes sharing work again).
 */

const ROUTE: readonly Coordinate[] = Array.from({ length: 31 }, (_, index) => ({
  lon: -75.43,
  lat: 40.13 + index * 0.001,
}));

function source(overrides: Partial<ShareSource> = {}): ShareSource {
  return {
    sourceRevision: 3,
    title: "Pine Loop",
    route: { segments: [ROUTE] },
    summary: { distanceMeters: 2_100, durationSeconds: 1_800 },
    surface: { preference: "mixed", unknownSurfacePolicy: "allow-with-warning" },
    provenance: "import",
    authorPseudonym: null,
    ...overrides,
  };
}

const SOURCE = source();
const PRIVACY = { hideStart: true, hideFinish: true, trimMetersFromEnds: 0, blurCoordinates: true };

function command<T extends ShareCommand["type"]>(
  type: T,
  payload: Extract<ShareCommand, { type: T }>["payload"],
): Extract<ShareCommand, { type: T }> {
  return {
    type,
    commandId: newCommandId(),
    source: "rider",
    label: `Share: ${type}`,
    payload,
  } as Extract<ShareCommand, { type: T }>;
}

function deps(repository: ShareRepositoryPort = new MemoryShareRepository()) {
  return { repository, linkBase: "https://opengravel.test", now: () => "2026-02-14T10:00:00.000Z" };
}

async function previewedSnapshot() {
  const result = await dispatchShareCommand(
    command("share.apply-trim", { source: SOURCE, privacy: PRIVACY }),
    deps(),
  );
  if (!result.ok || result.kind !== "preview") throw new Error("preview did not succeed");
  return result;
}

describe("share.apply-trim — the privacy preview", () => {
  it("returns the exact output the link will expose (preview fidelity)", async () => {
    const preview = await previewedSnapshot();
    const repository = new MemoryShareRepository();

    const published = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );

    expect(published.ok && published.kind === "published" ? published.output : null).toBe(
      preview.output,
    );
  });

  it("rejects a trim that leaves no route instead of publishing an empty ride", async () => {
    const tiny = source({ route: { segments: [ROUTE.slice(0, 4)] } });
    const result = await dispatchShareCommand(
      command("share.apply-trim", {
        source: tiny,
        privacy: { hideStart: true, hideFinish: true, trimMetersFromEnds: 0, blurCoordinates: false },
      }),
      deps(),
    );
    expect(result).toMatchObject({ ok: false, code: "no-route-left" });
  });
});

describe("share.publish — the opaque link", () => {
  it("issues an unguessable, unlistable token and an active record", async () => {
    const preview = await previewedSnapshot();
    const repository = new MemoryShareRepository();

    const result = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );

    if (!result.ok || result.kind !== "published") throw new Error("publish did not succeed");
    expect(result.record.state).toBe("active");
    expect(result.record.revokedAt).toBeNull();
    // 256 bits of randomness in a URL-safe alphabet: no sequence to enumerate.
    expect(result.record.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.link).toBe(`https://opengravel.test/share/${result.record.token}`);
    // The opaque share id is internal; the link carries only the token.
    expect(result.link).not.toContain(result.record.shareId);
    // The payload carries neither the token nor the share id (nothing to list by).
    expect(result.output).not.toContain(result.record.token);
    expect(result.output).not.toContain(result.record.shareId);
  });

  it("mints a different token for every publish, even of the same snapshot", async () => {
    const preview = await previewedSnapshot();
    const repository = new MemoryShareRepository();
    const first = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );
    const second = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );
    const tokenOf = (result: Awaited<ReturnType<typeof dispatchShareCommand>>) =>
      result.ok && result.kind === "published" ? result.record.token : null;
    expect(tokenOf(first)).not.toBeNull();
    expect(tokenOf(first)).not.toBe(tokenOf(second));
  });

  it("serves exactly the previewed bytes to the link holder", async () => {
    const preview = await previewedSnapshot();
    const repository = new MemoryShareRepository();
    const published = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );
    if (!published.ok || published.kind !== "published") throw new Error("publish failed");

    const resolution = await resolveShareLink(published.record.token, repository);

    expect(resolution.state).toBe("active");
    expect(resolution.state === "active" ? resolution.output : null).toBe(preview.output);
  });

  it("keeps the snapshot immutable (revision and metadata preserved)", async () => {
    const preview = await previewedSnapshot();
    const repository = new MemoryShareRepository();
    const published = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );
    if (!published.ok || published.kind !== "published") throw new Error("publish failed");
    expect(published.record.snapshot).toEqual(preview.snapshot);
    expect(Object.isFrozen(published.record.snapshot)).toBe(true);
    expect(published.record.snapshot.sourceRevision).toBe(3);
  });
});

describe("share.revoke — the link must die", () => {
  async function publishedShare(repository: ShareRepositoryPort) {
    const preview = await previewedSnapshot();
    const published = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );
    if (!published.ok || published.kind !== "published") throw new Error("publish failed");
    return published;
  }

  it("marks the record revoked with the time it happened", async () => {
    const repository = new MemoryShareRepository();
    const published = await publishedShare(repository);

    const result = await dispatchShareCommand(
      command("share.revoke", { shareId: published.record.shareId }),
      deps(repository),
    );

    if (!result.ok || result.kind !== "revoked") throw new Error("revoke failed");
    expect(result.record.state).toBe("revoked");
    expect(result.record.revokedAt).toBe("2026-02-14T10:00:00.000Z");
  });

  it("makes the link unusable: a revoked token resolves to no snapshot at all", async () => {
    const repository = new MemoryShareRepository();
    const published = await publishedShare(repository);
    await dispatchShareCommand(
      command("share.revoke", { shareId: published.record.shareId }),
      deps(repository),
    );

    const resolution = await resolveShareLink(published.record.token, repository);

    expect(resolution.state).toBe("revoked");
    // Unusable means unusable: the envelope carries no snapshot and no output.
    expect("snapshot" in resolution).toBe(false);
    expect("output" in resolution).toBe(false);
  });

  it("reports an unknown share id instead of inventing a revocation", async () => {
    const repository = new MemoryShareRepository();
    const result = await dispatchShareCommand(
      command("share.revoke", { shareId: newShareId() }),
      deps(repository),
    );
    expect(result).toMatchObject({ ok: false, code: "share-not-found" });
  });

  it("revoking twice is idempotent, not an error", async () => {
    const repository = new MemoryShareRepository();
    const published = await publishedShare(repository);
    await dispatchShareCommand(
      command("share.revoke", { shareId: published.record.shareId }),
      deps(repository),
    );
    const again = await dispatchShareCommand(
      command("share.revoke", { shareId: published.record.shareId }),
      deps(repository),
    );
    expect(again).toMatchObject({ ok: true, kind: "revoked" });
  });

  it("is re-shareable when the snapshot is re-issued: a new token, working again", async () => {
    const repository = new MemoryShareRepository();
    const published = await publishedShare(repository);
    await dispatchShareCommand(
      command("share.revoke", { shareId: published.record.shareId }),
      deps(repository),
    );

    const reissued = await dispatchShareCommand(
      command("share.publish", { snapshot: published.record.snapshot }),
      deps(repository),
    );

    if (!reissued.ok || reissued.kind !== "published") throw new Error("re-publish failed");
    expect(reissued.record.token).not.toBe(published.record.token);
    const resolution = await resolveShareLink(reissued.record.token, repository);
    expect(resolution.state).toBe("active");
    // The old link stays dead even after the re-share.
    expect((await resolveShareLink(published.record.token, repository)).state).toBe("revoked");
  });
});

describe("resolution of unknown tokens", () => {
  it("answers not-found for a well-formed but unknown token", async () => {
    const repository = new MemoryShareRepository();
    expect((await resolveShareLink(newShareToken(), repository)).state).toBe("not-found");
  });

  it("narrows tokens structurally: 256-bit hex or nothing", () => {
    expect(asShareToken("short")).toBeNull();
    expect(asShareToken("z".repeat(64))).toBeNull();
    expect(asShareToken(newShareToken())).not.toBeNull();
  });
});

describe("shareLink", () => {
  it("normalizes a trailing slash on the base", () => {
    expect(shareLink("https://opengravel.test/", newShareToken())).toMatch(
      /^https:\/\/opengravel\.test\/share\/[0-9a-f]{64}$/,
    );
  });
});

describe("createShareService", () => {
  it("binds dispatch and resolve to one repository", async () => {
    const service = createShareService(deps());
    const preview = await service.dispatch(
      command("share.apply-trim", { source: SOURCE, privacy: PRIVACY }),
    );
    if (!preview.ok || preview.kind !== "preview") throw new Error("preview failed");
    const published = await service.dispatch(
      command("share.publish", { snapshot: preview.snapshot }),
    );
    if (!published.ok || published.kind !== "published") throw new Error("publish failed");
    const resolution = await service.resolve(published.record.token);
    expect(resolution.state).toBe("active");
  });
});

describe("preview fidelity is structural", () => {
  it("the published record's snapshot serializes to the previewed bytes", async () => {
    const repository = new MemoryShareRepository();
    const preview = await previewedSnapshot();
    const published = await dispatchShareCommand(
      command("share.publish", { snapshot: preview.snapshot }),
      deps(repository),
    );
    if (!published.ok || published.kind !== "published") throw new Error("publish failed");
    expect(serializeShareSnapshot(published.record.snapshot)).toBe(preview.output);
  });

  it("re-trimming the same source and settings reproduces the same bytes", async () => {
    const first = await previewedSnapshot();
    const second = await previewedSnapshot();
    expect(second.output).toBe(first.output);
  });
});
