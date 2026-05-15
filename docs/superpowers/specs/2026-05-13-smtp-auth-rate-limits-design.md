# Custom SMTP for Magic-Link Auth — Design

**Date:** 2026-05-13
**Status:** Approved (pending implementation plan)
**Companion to:** [2026-05-03-wids-member-app-design.md](./2026-05-03-wids-member-app-design.md)

## 1. Overview

The member portal uses Supabase Auth magic links for sign-in (`web/app/page.tsx` → `supabase.auth.signInWithOtp(...)`). Supabase's built-in SMTP is rate-limited to ~2 emails/hour project-wide — fine for development, broken under any sign-in burst (e.g., when both availability forms go out the same week).

This spec replaces the built-in SMTP with **Resend** as a custom SMTP provider, using a Cloudflare-registered domain (`wids-nyc-reading-group.org`) and a branded magic-link email template aligned to the WiDS NYC Design System.

### Goals

1. **Eliminate the magic-link rate limit** as a member-facing failure mode.
2. **Brand the magic-link email** with WiDS NYC identity so members recognize the sender and the email reinforces the portal aesthetic.
3. **Keep the change reproducible** — every step documented in a runbook so any future operator (or future-Michelle) can re-establish or recover the setup.
4. **Zero code change in `web/`** — the auth flow already works; we swap infrastructure underneath it.

### Non-goals (v1)

- Programmatic delivery observability (Resend webhook → DB events table) — deferred
- Outlook Windows automated test coverage — manual smoke test only
- Per-environment SMTP separation (e.g., production vs `/wids-simulate-cycle` smoke-test project) — runbook documents manual repeat
- Moving magic-link generation entirely out of Supabase Auth into Next.js + Resend SDK — would unlock dynamic personalization but breaks Approach A2's "zero code change" guarantee
- Dynamic per-send quote rotation — Supabase static templates can't randomize; manual monthly rotation is the v1 pattern
- Replacement of the Gmail-draft operator email pattern (`leader-nudge`, `form-response-chase`, etc.) — those remain on the existing human-in-the-loop Gmail flow

## 2. System Shape

The change is an SMTP relay swap. Nothing else moves.

```
Before
──────

  member ── enter email ──► Next.js page.tsx
                                  │
                                  ▼ supabase.auth.signInWithOtp()
                            Supabase Auth
                                  │
                                  ▼
                      Supabase built-in SMTP    ◄── BOTTLENECK
                      (~2 emails/hour cap)             magic-link bursts fail
                                  │
                                  ▼
                          member's inbox


After
─────

  member ── enter email ──► Next.js page.tsx          UNCHANGED
                                  │
                                  ▼ supabase.auth.signInWithOtp()
                            Supabase Auth             UNCHANGED config except SMTP fields
                                  │
                                  ▼
                          Resend SMTP                 smtp.resend.com:465 TLS
                      (100/day, 3,000/month)          free tier covers all volume
                                  │
                                  ▼
                          member's inbox
```

### Key boundaries

- **No code change in `web/`.** The auth-side code (`web/app/page.tsx`, `web/app/actions.ts`, `web/app/auth/callback/route.ts`) is untouched. Supabase reads its own SMTP credentials internally; the Next.js app never sees them.
- **No new env vars in Vercel.** SMTP credentials live in Supabase project config, not in the Next.js bundle.
- **No new database schema.** No migration, no new tables.
- **Configuration lives in three external surfaces:** Cloudflare DNS zone, Resend project, Supabase Auth settings panel. The repo holds the *runbook* documenting how to recreate them — those surfaces themselves aren't version-controlled.

### Per-project caveat

Supabase SMTP config is **per-project**. The `/wids-simulate-cycle` smoke-test Supabase project needs its own Resend SMTP setup, or it falls back to the built-in (rate-limited) SMTP. The runbook documents this manual repeat; no automation provided.

## 3. Components and Artifacts

Five deliverables — three operator setup, two version-controlled.

| # | Artifact | Where it lives | Cost | Type |
|---|---|---|---|---|
| 1 | Registered domain `wids-nyc-reading-group.org` | Cloudflare Registrar | $7.50 yr 1 / $10.13/yr after | One-time setup (operator account) |
| 2 | DNS records on `wids-nyc-reading-group.org` | Cloudflare DNS | $0 | One-time setup (operator account) |
| 3 | Resend account + verified domain | resend.com | $0 (free tier) | One-time setup (operator account) |
| 4 | Supabase Auth config (SMTP credentials + email template) | Supabase Dashboard | $0 (existing project) | One-time setup (per Supabase project) |
| 5 | Repo artifacts: runbook, email template, mark assets, quote candidates | This repo (git) | $0 | Version-controlled |

**Total recurring cost:** ~$10/year (just the domain). Resend free tier (3,000 emails/month, 100/day) is far beyond this group's volume.

### Version-controlled artifacts

```
README.md
  └── (edit) Prerequisites section — add new step 7 with pointer to runbook

docs/runbooks/
  └── smtp-auth-setup.md             ← full operator runbook (a→h subsections)

docs/
  └── email-quotes.md                ← rotation candidates for the quote feature

assets/emails/template/
  ├── magic-link.html                ← branded HTML template (Supabase pastes from this)
  └── magic-link.txt                 ← plain-text fallback

web/public/branding/
  ├── mark-reader-96.png             ← 2× retina source
  ├── mark-reader-192.png            ← 4× retina, referenced by the email template
  └── mark-reader-512.png            ← reserve for in-app hero / favicon source
```

## 4. DNS Records

Resend's "Verify domain" wizard produces the exact values at setup time. The four records below describe shape; values are filled in from Resend's UI.

| # | Type | Host | Value (shape) | Purpose |
|---|---|---|---|---|
| 1 | TXT | `send.wids-nyc-reading-group.org` | `v=spf1 include:amazonses.com ~all` | SPF — authorizes Resend to send from this subdomain |
| 2 | MX | `send.wids-nyc-reading-group.org` | `feedback-smtp.us-east-1.amazonses.com` priority 10 | Bounce return-path so Resend tracks deliverability |
| 3 | TXT | `resend._domainkey.wids-nyc-reading-group.org` | `p=MIGfMA0G...` (long DKIM public key) | DKIM signing — primary deliverability signal |
| 4 | TXT | `_dmarc.wids-nyc-reading-group.org` | `v=DMARC1; p=none; rua=mailto:dmarc@wids-nyc-reading-group.org` | DMARC alignment policy + aggregate reports |

### Subdomain rationale

Resend defaults to verifying a subdomain (`send.<apex>`) rather than the apex itself. This isolates email-auth DNS from any future records on the apex (e.g., a future inbox at `hello@wids-nyc-reading-group.org` won't conflict with Resend's SPF). The from-address still appears as `noreply@wids-nyc-reading-group.org` — the subdomain is only the authentication context, not the visible sender.

### Cloudflare proxy must be DISABLED for all 4 records

Cloudflare's "orange-cloud" proxy mangles TXT and MX records. All 4 records must be set to DNS-only mode (grey cloud). This is the most common DNS misconfiguration failure mode and is documented in the runbook's troubleshooting section.

## 5. Operator Runbook

Full step-by-step lives at [`docs/runbooks/smtp-auth-setup.md`](../../runbooks/smtp-auth-setup.md). The README's "Prerequisites" section gets a short pointer that references the runbook.

### README addition (Prerequisites step 7)

```markdown
### 7. Custom SMTP for magic-link auth

Supabase's built-in SMTP is rate-limited to ~2 emails/hour, which throttles
members during sign-in bursts. Before going live with the member portal,
configure **Resend** as a custom SMTP provider using a Cloudflare-registered
domain.

See the step-by-step runbook: [`docs/runbooks/smtp-auth-setup.md`](docs/runbooks/smtp-auth-setup.md)

One-time cost: ~$10/year for the `.org` domain. Resend's free tier covers
this group's volume.
```

### Runbook structure (sections a–h)

a. **Register the domain** at Cloudflare Registrar (~5 min, $7.50 first year)
b. **Sign up for Resend and verify the domain** (~10 min including DNS propagation wait)
c. **Generate an SMTP API key** (1 min; store in password manager)
d. **Configure Supabase SMTP** — host, port, user, API key, sender email, sender name
e. **Deploy branded assets** — verify `web/public/branding/mark-reader-*.png` are on the live Vercel deployment; paste `assets/emails/template/magic-link.html` and `magic-link.txt` into Supabase Auth → Email Templates → Magic Link; swap the `<img src>` host to the deployment URL
f. **Smoke test** — magic-link sign-in from an incognito window; verify delivery, render, click-through
g. **Troubleshooting** — common failure modes and fixes
h. **Per-project note** — repeat steps c–e for any new Supabase project (e.g., the simulation environment)

## 6. Email Template

### Subject and preheader

- **Subject:** `Sign in and keep reading`
- **Preheader (hidden inbox-preview text):** `One-tap link. Works once, expires in 60 minutes.`

### Sender identity

- **From:** `WiDS NYC Reading Group <noreply@wids-nyc-reading-group.org>`
- **Reply-To:** unset; replies bounce silently. Members reach the operator via existing channels (WhatsApp, in-person).

### Brand identity within the email

The email's in-product brand is **Reading Group Planner** (the design system's "Codex" name is retained for future v3 product chrome but not used in this email). The lockup is:

```
              [Reader mark PNG, 48×48 display, 192×192 source]
                    Reading Group Planner
                          (magenta hairline rule)
                  WIDS · NYC AI READING GROUP
```

This mirrors the design system's Codex lockup pattern (`MarkA` + bold sans + uppercase eyebrow), adapted to the product-specific name.

### Color and type mapping (design-system aligned)

| Element | Hex | Source token |
|---|---|---|
| Outer wrapper | `#1a160f` | dark ink — frames the cream card on desktop |
| Card surface | `#fefcef` | warm cream (variant of paper-50 `#faf8f4`) |
| Card border | `#ddd4be` | warm hairline (paper-200 family) |
| Body text | `#1a160f` | paper-900 equivalent |
| Secondary text | `#7e6f55` / `#594d3b` | paper-500 / paper-700 |
| Magenta hairline accents | `#c8226d` | magenta-500 |
| CTA button | `#467560` bg, white text, 10px radius | sage-600, `--radius-md` |
| Mark indigo line work | `#16205e` | indigo-700 |
| Quote serif | Georgia / Times fallback | Newsreader equivalent (email-safe stack) |

### Voice constraints (per design system)

- Calm, direct, slightly warm. No exclamation points.
- "You" for the member, never "the user."
- Sentence case for buttons (`Sign in and keep reading`, not `Sign In And Keep Reading`).
- No emoji.
- Em-dashes (`—`), not double hyphens.

### Body content (excerpt — full HTML lives at `assets/emails/template/magic-link.html`)

```
Hey curious friend — your sign-in link is below.
It opens as {{ .Email }}, works once, and expires in 60 minutes.

   [ Sign in and keep reading → ]

Or paste this into your browser:
{{ .ConfirmationURL }}

Didn't ask for this? Sit tight — without the link, no one signs in as you.

   ─── magenta hairline ───

"<quote text>" — <quote attribution>

   WiDS NYC AI Reading Group
```

### Template-token mapping

The source HTML uses placeholder tokens that get swapped to Supabase syntax during cleanup:

| Source placeholder | Supabase variable |
|---|---|
| `{{EMAIL}}` | `{{ .Email }}` |
| `{{MAGIC_URL}}` | `{{ .ConfirmationURL }}` |
| `{{QUOTE_TEXT}}` | hardcoded; see Quote rotation below |
| `{{QUOTE_BY}}` | hardcoded; see Quote rotation below |

### Cleanup pass (before committing to repo)

The source HTML picked up Cloudflare proxy artifacts during transit. The implementation phase strips them:

1. All `/cdn-cgi/l/email-protection` link wrappers (replace email-protected anchors with `{{ .Email }}` or plain text)
2. The footer mailto entirely — matches the silent `noreply@` decision
3. The Cloudflare email-decode JS shim at end of `<body>` (email clients don't run JS; line is dead weight)

### Mark asset

The Reading Group Planner mark is delivered as a PNG (not inline SVG) so it renders correctly in Outlook Windows.

- **Source files**: `web/public/branding/mark-reader-{96,192,512}.png` (committed to repo, served by Vercel)
- **Email reference**:
  ```html
  <img src="https://<deploy-url>/branding/mark-reader-192.png"
       width="48" height="48"
       alt="Reading Group Planner">
  ```
- **Hosting URL swap during deploy**:
  - Initial (before custom domain): `https://wids-nyc.vercel.app/branding/mark-reader-192.png`
  - After custom domain points at Vercel: `https://wids-nyc-reading-group.org/branding/mark-reader-192.png`

The 96px and 512px variants are committed alongside but not referenced by the email. They're available for future product chrome (favicon source, sign-in hero) without re-export.

### Quote rotation

The template renders one inspirational quote (Grace Hopper as the seed) above the footer. Supabase email templates are static — rotation is **manual**:

1. Operator maintains a list of candidate quotes in `docs/email-quotes.md`.
2. Once a month (or when bored), operator pastes a new quote into the Supabase template editor.
3. Grace Hopper's *"The most dangerous phrase in the language is, 'we've always done it this way.'"* is the seed quote.

This is intentionally low-tech. Dynamic rotation would require moving email-send out of Supabase Auth (Approach C, out of scope).

### Plain-text fallback (`assets/emails/template/magic-link.txt`)

```
WiDS NYC AI Reading Group

Hey curious friend,

Sign in to the WiDS NYC member portal:
{{ .ConfirmationURL }}

This link expires in 60 minutes and works only once.

Didn't ask for this? Sit tight — without the link, no one signs in as you.

"<quote text>"
— <quote attribution>

---
WiDS NYC AI Reading Group — a community for women and
non-binary data scientists in NYC.
```

Pasted into Supabase Auth → Email Templates → Magic Link → plain-text variant.

## 7. Verification

### Pre-launch checklist

Operator runs before flipping `Enable Custom SMTP` to ON in production:

```
☐ Resend dashboard shows 4/4 DNS records verified (green checkmarks)
☐ Cloudflare DNS shows all 4 records (SPF, MX, DKIM, DMARC) with proxy DISABLED
☐ Supabase test email (Auth → Email Templates → Send test email) reaches operator inbox
☐ Magic link in test email lands in INBOX, not Spam (test on Gmail + Outlook)
☐ Clicking the magic link signs operator into the portal
☐ Resend → Emails tab shows the test send marked "delivered"
☐ HTML renders correctly in: Gmail web, Gmail iOS, Apple Mail macOS, Outlook.com
☐ Plain-text fallback renders correctly (View → original → toggle plain-text)
☐ Reader mark renders (not blank-space) in all of the above
☐ Footer does NOT contain a mailto artifact
☐ No /cdn-cgi/ paths anywhere in the rendered source
```

### Failure modes

| Failure | Detection | Mitigation |
|---|---|---|
| DNS records missing or proxied | Resend "Verify DNS" stays red | Re-check Cloudflare; disable orange-cloud proxy on the 4 records |
| DKIM split across lines by Cloudflare | Email lands in Spam | Paste DKIM TXT value as a single continuous string |
| Resend daily quota exhausted (>100/day) | New magic links fail | Members WhatsApp operator; daily reset at midnight UTC; upgrade Resend if recurring |
| Resend API key compromised | Resend abuse notice or unexpected `delivered` spike | Revoke key → regenerate → paste into Supabase SMTP password field |
| Template HTML breaks after dashboard edit | Members receive garbled email | Re-paste from `assets/emails/template/magic-link.html` (repo file is source of truth) |
| Supabase project deleted | Sign-in fully broken | Restore from Supabase backup; rerun runbook steps c–e |
| `mark-reader-192.png` returns 404 | Mark missing from email | Verify Vercel deployment includes `web/public/branding/`; verify deploy URL matches template `<img src>` |

## 8. Rollback

If magic-link auth breaks at cutover:

1. **(60 sec)** Supabase Dashboard → Authentication → SMTP Settings → toggle `Enable Custom SMTP` **OFF**. Save.
2. Supabase reverts to built-in (rate-limited but functional) SMTP.
3. **Communicate** — WhatsApp/Slack to active members: *"sign-in is being reconfigured — message me directly if you need access in the next hour."*
4. **Investigate** via Resend → Emails / Logs.
5. **Re-enable** Custom SMTP once fixed; rerun the smoke-test checklist.

Rollback is non-destructive: no DB changes, no migration to reverse, no member data affected.

## 9. Known Limitations and Future Work

### Documented, not blocking for v1

- **No webhook-based delivery observability.** Bounces show in Resend dashboard but aren't surfaced to Supabase or the admin UI. A member reporting "didn't receive my link" requires manual Resend lookup.
- **No automated test for email delivery.** The runbook's smoke test is human-driven. CI doesn't send real email — keeping it that way avoids polluting Resend logs and quota.
- **Template HTML duplicated** between repo (`assets/emails/template/magic-link.html`) and Supabase dashboard. The repo file is source of truth; operator re-pastes on changes. Drift is possible.
- **Quote rotation is manual.** Operator picks a new quote from `docs/email-quotes.md` periodically. Forgetting is harmless — stale quote = same email longer.
- **Mark image hosting depends on Vercel deploy URL** until the custom domain points at Vercel. Domain swap is a one-line template edit.

### Future work (deferred)

- **Resend delivery webhook + `email_events` table** for failure observability (Approach B from brainstorming).
- **Litmus / Email on Acid integration** for automated cross-client rendering tests.
- **Per-environment SMTP separation** — runbook documents the manual re-setup; could be wrapped in a setup script if smoke-test environments multiply.
- **Move magic-link generation out of Supabase Auth** into Next.js + Resend SDK (Approach C). Would unlock dynamic quote rotation, per-member personalization, and webhook-based delivery tracking — but breaks Approach A2's zero-code-change guarantee.

## 10. Open Questions

None at design time. All decisions locked during brainstorming on 2026-05-12 → 2026-05-13.
