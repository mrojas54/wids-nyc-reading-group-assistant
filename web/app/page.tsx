"use client";

import { useState, useTransition } from "react";
import { Banner, Brandmark, Button, Input } from "@/components/ui";
import { requestMagicLink } from "./actions";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const sent = msg?.ok === true;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await requestMagicLink(email);
      setMsg({ ok: r.ok, text: r.message });
    });
  };

  return (
    <div className="shell">
      <header className="shell-header">
        <Brandmark />
      </header>
      <main className="signin">
        <div className="signin-h">
          <h1 className="text-balance">Welcome back.</h1>
          <p>
            Sign in with your email — we&apos;ll send a one-time link, no password to
            remember.
          </p>
        </div>

        <form className="magic-card" onSubmit={submit}>
          <Input
            label="Email"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (msg && !msg.ok) setMsg(null);
            }}
            error={msg && !msg.ok ? msg.text : undefined}
            disabled={pending || sent}
            autoFocus
            autoComplete="email"
          />
          <Button
            type="submit"
            block
            iconRight="arrowRight"
            disabled={pending || sent}
          >
            {pending ? "Sending…" : sent ? "Link sent" : "Send me a link"}
          </Button>

          {sent && (
            <Banner tone="success" title="Check your inbox.">
              We sent a sign-in link to <b>{email}</b>. It expires in 15 minutes.
            </Banner>
          )}
        </form>

        <div className="footer-note">
          New to the group?
          <br />
          Email <a href="mailto:hello@widsnyc.org">hello@widsnyc.org</a> to be added to
          the roster.
        </div>
      </main>
    </div>
  );
}
