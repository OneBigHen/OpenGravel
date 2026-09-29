import { newShareId, newShareToken, asShareToken, type ShareId, type ShareToken } from "@/domain/sharing/ids";
import type { CommandId } from "@/domain/ride/ids";
import type { CommandSource } from "@/domain/ride/types";
import {
  ShareSnapshotError,
  buildShareSnapshot,
  serializeShareSnapshot,
} from "@/domain/sharing/snapshot";
import type {
  ShareSnapshot,
  ShareSource,
} from "@/domain/sharing/types";
import type { PrivacyTrimSettings } from "@/domain/sharing/privacy";
import type {
  ShareRecord,
  ShareRepositoryPort,
} from "./ports/share-repository";

/**
 * The share command set (10-SHARING-AND-OFFLINE §10–§12): three typed
 * commands, no field bags.
 *
 * - `share.apply-trim` applies a privacy trim (11) and returns the privacy
 *   preview: the exact bytes a link would expose, without issuing anything.
 * - `share.publish` opens the opaque link over the previewed snapshot. The
 *   previewed snapshot is published verbatim, which is what makes the preview
 *   byte-exact to the link a structural property rather than a claim.
 * - `share.revoke` makes the link unusable. Resolution after revocation
 *   returns a `revoked` envelope that carries no snapshot at all.
 *
 * Re-sharing is re-issuing: `share.publish` again mints a fresh token and a
 * fresh record; the revoked link stays dead.
 */

export interface ShareCommandBase<T extends string> {
  readonly type: T;
  readonly commandId: CommandId;
  readonly source: CommandSource;
  /** Human label for the one history entry the command produces. */
  readonly label: string;
}

export interface ShareApplyTrimCommand extends ShareCommandBase<"share.apply-trim"> {
  readonly payload: {
    readonly source: ShareSource;
    readonly privacy: PrivacyTrimSettings;
  };
}

export interface SharePublishCommand extends ShareCommandBase<"share.publish"> {
  readonly payload: {
    readonly snapshot: ShareSnapshot;
  };
}

export interface ShareRevokeCommand extends ShareCommandBase<"share.revoke"> {
  readonly payload: {
    readonly shareId: ShareId;
  };
}

export type ShareCommand =
  | ShareApplyTrimCommand
  | SharePublishCommand
  | ShareRevokeCommand;

export type ShareCommandResult =
  | {
      readonly ok: true;
      readonly kind: "preview";
      readonly snapshot: ShareSnapshot;
      readonly output: string;
    }
  | {
      readonly ok: true;
      readonly kind: "published";
      readonly record: ShareRecord;
      readonly link: string;
      readonly output: string;
    }
  | { readonly ok: true; readonly kind: "revoked"; readonly record: ShareRecord }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** What a holder of a link gets. Revocation serves no snapshot at all. */
export type ShareResolution =
  | { readonly state: "active"; readonly record: ShareRecord; readonly output: string }
  | { readonly state: "revoked"; readonly shareId: ShareId }
  | { readonly state: "not-found" };

export interface ShareDispatchDeps {
  readonly repository: ShareRepositoryPort;
  /** Origin the link is minted under (read once at the composition root). */
  readonly linkBase: string;
  readonly newToken?: () => ShareToken;
  readonly newShareId?: () => ShareId;
  readonly now?: () => string;
}

/** The canonical link shape: origin + one opaque token, nothing enumerable. */
export function shareLink(linkBase: string, token: ShareToken): string {
  return `${linkBase.replace(/\/+$/, "")}/share/${token}`;
}

export async function dispatchShareCommand(
  command: ShareCommand,
  deps: ShareDispatchDeps,
): Promise<ShareCommandResult> {
  switch (command.type) {
    case "share.apply-trim": {
      try {
        const snapshot = buildShareSnapshot(command.payload.source, command.payload.privacy);
        return { ok: true, kind: "preview", snapshot, output: serializeShareSnapshot(snapshot) };
      } catch (error: unknown) {
        if (error instanceof ShareSnapshotError) {
          return { ok: false, code: error.code, message: error.message };
        }
        throw error;
      }
    }
    case "share.publish": {
      const snapshot = command.payload.snapshot;
      const token = (deps.newToken ?? newShareToken)();
      const record: ShareRecord = Object.freeze({
        shareId: (deps.newShareId ?? newShareId)(),
        token,
        state: "active",
        createdAt: (deps.now ?? (() => new Date().toISOString()))(),
        revokedAt: null,
        snapshot,
      });
      await deps.repository.save(record);
      return {
        ok: true,
        kind: "published",
        record,
        link: shareLink(deps.linkBase, token),
        output: serializeShareSnapshot(snapshot),
      };
    }
    case "share.revoke": {
      const revoked = await deps.repository.revoke(
        command.payload.shareId,
        (deps.now ?? (() => new Date().toISOString()))(),
      );
      if (revoked === null) {
        return { ok: false, code: "share-not-found", message: "There is no such share to revoke." };
      }
      return { ok: true, kind: "revoked", record: revoked };
    }
  }
}

/**
 * Resolves what a link holder may see. The token is the only key: there is no
 * id lookup from outside, and a revoked or unknown token answers without a
 * snapshot (10 §10 — revocation makes the link unusable).
 */
export async function resolveShareLink(
  token: ShareToken,
  repository: ShareRepositoryPort,
): Promise<ShareResolution> {
  const narrow = asShareToken(token);
  if (narrow === null) return { state: "not-found" };
  const record = await repository.findByToken(narrow);
  if (record === null) return { state: "not-found" };
  if (record.state === "revoked") return { state: "revoked", shareId: record.shareId };
  return { state: "active", record, output: serializeShareSnapshot(record.snapshot) };
}

/** The UI-facing service: one bound repository, typed commands in and out. */
export interface ShareServicePort {
  dispatch(command: ShareCommand): Promise<ShareCommandResult>;
  resolve(token: ShareToken): Promise<ShareResolution>;
}

export function createShareService(deps: ShareDispatchDeps): ShareServicePort {
  return {
    dispatch: (command) => dispatchShareCommand(command, deps),
    resolve: (token) => resolveShareLink(token, deps.repository),
  };
}
