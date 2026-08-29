"use client";

import { FormEvent, useState } from "react";

type WaitlistFormProps = {
  compact?: boolean;
  source: "reel" | "waitlist" | "home";
};

type SubmitState = "idle" | "submitting" | "success" | "error";

export function WaitlistForm({ compact = false, source }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setMessage("Joining…");

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          source,
          website: data.get("website"),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not join the waitlist.");
      setState("success");
      setMessage("You’re in. Watch your inbox for the first run.");
      setEmail("");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not join the waitlist.");
    }
  }

  return (
    <form className={`waitlist-form${compact ? " waitlist-form--compact" : ""}`} onSubmit={submit}>
      <label htmlFor={`waitlist-email-${source}`}>Email address</label>
      <div>
        <input
          id={`waitlist-email-${source}`}
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@email.com"
          autoComplete="email"
          inputMode="email"
          required
          disabled={state === "submitting" || state === "success"}
        />
        <button type="submit" disabled={state === "submitting" || state === "success"}>
          {state === "success" ? "Joined" : state === "submitting" ? "Joining" : "Join waitlist"}
        </button>
      </div>
      <input className="waitlist-form__trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <p className={`waitlist-form__status waitlist-form__status--${state}`} aria-live="polite">
        {message || "Early access only. No spam."}
      </p>
    </form>
  );
}
