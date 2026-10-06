type Env = Readonly<Record<string, string | undefined>>;

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * Mails the owner through Resend. Best effort by design: the thing being
 * reported (a feedback note, a removed route) is already saved, so a mail
 * outage is logged and never fails the request. Needs `RESEND_API_KEY` and
 * `OGV_NOTIFY_EMAIL`; without them it quietly does nothing.
 */
export async function sendOwnerMail(
  mail: { readonly subject: string; readonly text: string; readonly html: string; readonly event: string },
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const key = env["RESEND_API_KEY"];
  const to = env["OGV_NOTIFY_EMAIL"];
  if (key === undefined || key === "" || to === undefined || to === "") return false;
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env["OGV_MAIL_FROM"] ?? "OpenGravel <onboarding@resend.dev>",
        to: [to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.error(JSON.stringify({ event: `${mail.event}-mail-failed`, status: response.status }));
    return response.ok;
  } catch (caught) {
    console.error(JSON.stringify({ event: `${mail.event}-mail-failed`, error: String(caught) }));
    return false;
  }
}
