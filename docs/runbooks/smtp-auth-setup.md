# SMTP auth setup — Resend + Cloudflare + Supabase

**Companion to:** [SMTP design spec](../superpowers/specs/2026-05-13-smtp-auth-rate-limits-design.md)

Supabase's built-in SMTP is rate-limited to ~2 emails/hour project-wide,
which throttles members during sign-in bursts. This runbook walks the
operator through configuring **Resend** as a custom SMTP provider using
a Cloudflare-registered domain.

**One-time effort:** ~45 minutes (plus 5–15 min DNS propagation wait).
**Recurring cost:** ~$10/year for the `.org` domain. Resend free tier
covers this group's volume.

**Prerequisites:** Cloudflare account, access to the production
Supabase project, repo write access (so you can update the deployment
URL in the template after deploy).

---

## a) Register the domain

1. Go to [Cloudflare → Domain Registration](https://dash.cloudflare.com/?to=/:account/registrar).
2. Search for `wids-nyc-reading-group.org`. Click **Register**.
3. Complete checkout (~$7.50 first year, ~$10.13/year renewal).
4. The domain is now in your Cloudflare account with Cloudflare DNS
   automatically configured (no nameserver change needed).

---

## b) Sign up for Resend and verify the domain

1. Create a free account at [resend.com](https://resend.com).
2. Go to **Domains** → **Add Domain**.
3. Enter `wids-nyc-reading-group.org`. Accept the default `send.`
   subdomain (Resend will verify `send.wids-nyc-reading-group.org`).
4. Resend shows 4 DNS records to add: 1 SPF TXT, 1 MX, 1 DKIM TXT, 1
   DMARC TXT. Keep this tab open.
5. In a separate browser tab: Cloudflare Dashboard → `wids-nyc-reading-group.org`
   → **DNS** → **Records** → **Add record** for each of the 4 records
   shown in Resend. Copy the **Name** and **Content** fields verbatim.
6. **Critical:** for each of the 4 records, set the proxy status to
   **DNS only** (grey cloud, not orange). Cloudflare's orange-cloud
   proxy mangles TXT and MX records and is the most common DNS
   misconfiguration here.
7. Back in the Resend tab, click **Verify DNS Records**. Propagation
   usually takes 5–15 minutes. Wait until all 4 records show green
   checkmarks before proceeding.

If verification stays red after 30 minutes:
- Confirm proxy is grey-cloud (DNS only) on all 4 records.
- For the DKIM TXT record specifically: ensure the long value is
  pasted as a **single continuous string**; Cloudflare's textarea
  sometimes silently splits long values across lines, breaking the
  record.

---

## c) Generate the Resend SMTP API key

1. In Resend, go to **API Keys** → **Create API Key**.
2. Name it `supabase-smtp-prod` (or `supabase-smtp-<project-name>`
   if you have multiple Supabase projects).
3. Permission: **Sending access**.
4. Domain: restrict to `wids-nyc-reading-group.org`.
5. Click **Create**. **Copy the key immediately** — Resend shows it
   exactly once.
6. Save the key in your password manager labeled
   `Resend SMTP — WiDS NYC`.

---

## d) Configure Supabase SMTP

1. Go to your Supabase project → **Authentication** → **SMTP Settings**.
2. Toggle **Enable Custom SMTP** ON.
3. Fill in the fields:
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** the API key from step (c)
   - **Sender email:** `noreply@wids-nyc-reading-group.org`
   - **Sender name:** `WiDS NYC Reading Group`
4. Leave **Reply-To** **unset** — replies route to an unmonitored
   address and may bounce back to the sender depending on their email
   client. This is intentional; members reach the operator via
   WhatsApp/Slack.
5. Click **Save**.

---

## e) Deploy branded assets + paste the email template

1. **Verify the mark assets are on the live deployment.** Open the
   current Vercel preview or production URL plus
   `/branding/mark-reader-192.png`. Example:
   ```
   https://wids-nyc.vercel.app/branding/mark-reader-192.png
   ```
   You should see the Reader mark render (or download — depends on
   browser). If you get a 404, the assets weren't deployed; verify
   the Vercel build included `web/public/branding/`.
2. **Determine the canonical mark URL** for the email template:
   - If the custom domain is wired to Vercel: use
     `https://wids-nyc-reading-group.org/branding/mark-reader-192.png`
   - Otherwise: use the Vercel deployment URL (e.g.,
     `https://wids-nyc.vercel.app/branding/mark-reader-192.png`)
3. **Open the template file** at
   [`assets/emails/template/magic-link.html`](../../assets/emails/template/magic-link.html).
   Find the `<img>` tag and replace the placeholder
   `https://YOUR-DEPLOY-URL/branding/mark-reader-192.png`
   with the URL from step 2.
4. Copy the modified file's full contents.
5. Supabase Dashboard → **Authentication** → **Email Templates** →
   **Magic Link** → switch the editor to **HTML** mode → paste.
6. Switch to **plain-text** mode → paste the contents of
   [`assets/emails/template/magic-link.txt`](../../assets/emails/template/magic-link.txt)
   verbatim.
7. Update the **subject line** to:
   `Sign in and keep reading`
8. Click **Save**.

**HTML ↔ plain-text sync:** Both files (`magic-link.html` and
`magic-link.txt`) must be pasted together each time you update copy.
If you change the greeting, expiry, quote, or any user-visible string
in one, update the other to match. See
[`docs/email-quotes.md`](../email-quotes.md) for the quote rotation
workflow specifically.

**Strongly recommended — commit the resolved URL back to the repo.**
After the paste succeeds, make a follow-up commit swapping the
`YOUR-DEPLOY-URL` placeholder in `assets/emails/template/magic-link.html`
for the real URL you just used. Otherwise the repo file stays a stub
and the next operator following this runbook has to determine the
canonical URL from scratch rather than reading it from the source.

---

## f) Smoke test

1. Open the deployment in an **incognito** browser window.
2. On the sign-in page, enter your own email (must be on the member
   roster). Click **Send me a link**.
3. Within 60 seconds, check your inbox. Verify:
   - Arrives from `WiDS NYC Reading Group <noreply@wids-nyc-reading-group.org>`
   - Lands in **Inbox**, not Spam
   - Subject is `Sign in and keep reading`
   - Inbox preview text reads `One-tap link. Works once, expires in 60 minutes.`
   - The Reader mark renders (not a broken-image icon)
   - The CTA button is sage green with white text reading
     "Sign in and keep reading →"
   - Footer shows `WiDS NYC AI Reading Group` (no mailto link)
4. Click the CTA. You should land on `/dashboard` signed in.
5. In Resend Dashboard → **Emails**, the test send appears with status
   `delivered`.

Cross-client check (do at least these three):
- Gmail web
- Gmail iOS
- Apple Mail on macOS

If the mark image fails to render in any of these clients, treat it as
a blocker and re-check the asset URL (see "Members see broken-image
icon" in section g).

---

## g) Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Resend "Verify DNS" stays red after 30 min | Cloudflare proxy still on (orange-cloud) for at least one of the 4 records | Set all 4 to grey-cloud DNS-only |
| Email lands in Spam | DKIM TXT value split across lines by Cloudflare | Re-edit the DKIM record, paste as a single continuous string |
| Supabase test email says "SMTP error" | API key has leading/trailing whitespace from copy-paste | Regenerate API key, re-paste carefully, save |
| Members see broken-image icon where the mark should be | `<img src>` URL still has the `YOUR-DEPLOY-URL` placeholder, OR `mark-reader-192.png` is missing from the deployment | Update the URL per step (e); verify the asset is reachable at the URL |
| Magic-link click goes to 404 | `<vercel-url>/auth/callback` not added to Supabase → Auth → URL Configuration → Redirect URLs | Add the redirect URL per the existing portal setup |
| All members suddenly can't sign in | Resend daily quota exhausted (100/day on the free tier as of 2026-05 — check current limits at [resend.com/pricing](https://resend.com/pricing)) | Wait for midnight-UTC reset OR upgrade Resend; meanwhile, fall back to built-in SMTP via the rollback procedure below |

---

## h) Per-project repeat (for `/wids-simulate-cycle`)

Supabase SMTP config is **per-project**. If you spin up a separate
Supabase project for `/wids-simulate-cycle` smoke testing, repeat
steps (c) and (d) for that project:

1. In Resend → API Keys, create a second key named
   `supabase-smtp-simulation`.
2. In the simulation Supabase project, set the same SMTP fields but
   with this new API key as the password.
3. Reuse the same domain (`wids-nyc-reading-group.org`) — domain
   verification is per-Resend-account, not per-Supabase-project.

The DNS records and email template don't need re-creation; they're
shared across all Supabase projects that use this Resend account.

---

## Rollback (if magic-link auth breaks at cutover)

1. Supabase Dashboard → **Authentication** → **SMTP Settings** →
   toggle **Enable Custom SMTP** **OFF**. Save.
2. Supabase reverts to built-in (rate-limited but functional) SMTP.
3. Message the active members on WhatsApp/Slack: *"sign-in is being
   reconfigured — message me directly if you need access in the next
   hour."*
4. Investigate via Resend → **Emails** / **Logs**.
5. Re-enable Custom SMTP once fixed; rerun the smoke test in step (f).

Rollback is **non-destructive** — no DB changes, no member data
affected. The toggle reverts in under 60 seconds.
