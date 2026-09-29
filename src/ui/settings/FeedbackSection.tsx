"use client";

/**
 * Settings → Feedback: what broke or confused a rider, straight to the owner
 * (/api/feedback). No account; a way to reply is optional.
 */

import { useState, type FormEvent } from "react";

type SendState = "idle" | "sending" | "sent" | "failed";

export function FeedbackSection() {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (message.trim().length < 3 || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, contact, page: document.referrer === "" ? null : new URL(document.referrer).pathname }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Feedback could not be sent. Try again in a moment.");
        setState("failed");
        return;
      }
      setState("sent");
      setMessage("");
      setContact("");
    } catch {
      setError("You look offline. Your note is still here; send it when you're back online.");
      setState("failed");
    }
  };

  return (
    <section className="og-settings__section" aria-labelledby="settings-feedback-title">
      <div className="og-settings__section-heading">
        <div>
          <p className="og-settings__eyebrow">HELP US</p>
          <h2 id="settings-feedback-title">Send feedback</h2>
        </div>
      </div>
      <form className="og-feedback" onSubmit={(event) => void send(event)}>
        <label className="og-feedback__field">
          <span>What happened, or what would make it better?</span>
          <textarea
            data-testid="feedback-message"
            value={message}
            maxLength={2000}
            rows={4}
            onChange={(event) => {
              setMessage(event.target.value);
              if (state !== "sending") setState("idle");
            }}
          />
        </label>
        <label className="og-feedback__field">
          <span>Email or phone, if you’d like a reply (optional)</span>
          <input type="text" data-testid="feedback-contact" value={contact} maxLength={200} autoComplete="email" onChange={(event) => setContact(event.target.value)} />
        </label>
        <button type="submit" className="og-primary" data-testid="feedback-send" disabled={message.trim().length < 3 || state === "sending"}>
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        {state === "sent" ? <p className="og-feedback__status" role="status" data-testid="feedback-sent">Thanks, it’s on its way.</p> : null}
        {error === null ? null : <p className="og-planner__error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
