import { clientIpFromForwardedFor } from "@/server/contributions/catalog-community";
import { SQLiteFeedbackStore, handleFeedbackPost } from "@/server/feedback/feedback-store";
import { escapeHtml, sendOwnerMail } from "@/server/mail/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_BYTES = 8_192;
const NO_STORE = { "cache-control": "private, no-store" };

let store: SQLiteFeedbackStore | undefined;
function sharedStore(): SQLiteFeedbackStore { return store ??= new SQLiteFeedbackStore(); }

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? "0") > LIMIT_BYTES) {
    return Response.json({ error: "Feedback is too long." }, { status: 413, headers: NO_STORE });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > LIMIT_BYTES) {
      return Response.json({ error: "Feedback is too long." }, { status: 413, headers: NO_STORE });
    }
    body = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ error: "Feedback must be valid JSON." }, { status: 400, headers: NO_STORE });
  }
  const result = handleFeedbackPost(
    body,
    sharedStore(),
    clientIpFromForwardedFor(request.headers.get("x-forwarded-for")),
    request.headers.get("user-agent"),
    (entry) => {
      // Saved first; the email is a courtesy and never holds the answer up.
      const lines = [`Page: ${entry.page ?? "(unknown)"}`, `Contact: ${entry.contact ?? "(none given)"}`, `Device: ${entry.userAgent ?? "(unknown)"}`];
      void sendOwnerMail({
        subject: `OpenGravel feedback: ${entry.message.slice(0, 60)}`,
        text: `${entry.message}\n\n${lines.join("\n")}`,
        html: `<p>${escapeHtml(entry.message).replace(/\n/g, "<br>")}</p><p style="color:#68716f">${lines.map(escapeHtml).join("<br>")}</p>`,
        event: "feedback",
      });
    },
  );
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}
