import { sendPlayerCommand } from "@/server/spotify/player-api";
import { apiErrorResponse, jsonResponse } from "@/server/spotify/http";
import { isSameOriginMutation } from "@/server/spotify/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMANDS = new Set(["play", "pause", "next", "previous"] as const);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) return jsonResponse({ ok: false, code: "origin", message: "This request must come from OpenGravel." }, 403);
  let command: unknown;
  try {
    command = (await request.json() as { command?: unknown }).command;
  } catch {
    return jsonResponse({ ok: false, code: "invalid_command", message: "Choose a Spotify playback command." }, 400);
  }
  if (typeof command !== "string" || !COMMANDS.has(command as never)) return jsonResponse({ ok: false, code: "invalid_command", message: "Choose a Spotify playback command." }, 400);
  const result = await sendPlayerCommand(request, command as "play" | "pause" | "next" | "previous");
  if (!result.ok || result.value === undefined) return apiErrorResponse(result.error!, result.setCookie);
  return jsonResponse(result.value, 200, result.setCookie === undefined ? [] : [result.setCookie]);
}
