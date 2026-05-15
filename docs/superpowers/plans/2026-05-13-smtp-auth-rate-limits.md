# SMTP Auth Rate Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the repo-side artifacts that enable the operator to replace Supabase's built-in SMTP (rate-limited to ~2 emails/hour) with Resend + a Cloudflare-registered `wids-nyc-reading-group.org` domain, including a design-system-aligned magic-link email template, Reader mark PNG assets, and a step-by-step operator runbook.

**Architecture:** Pure configuration-and-content change. **Zero code edits to `web/`.** The plan produces 7 new files and 1 README edit. The operator runbook (`docs/runbooks/smtp-auth-setup.md`) is the deliverable that drives the external setup (domain registration, DNS, Resend, Supabase dashboard) *after* this PR merges.

**Tech Stack:** Email-safe HTML (inline CSS, table layout, VML for Outlook), Markdown for docs, PNG assets served by Vercel's static file handler.

**Spec:** [`docs/superpowers/specs/2026-05-13-smtp-auth-rate-limits-design.md`](../specs/2026-05-13-smtp-auth-rate-limits-design.md)

**TDD note:** This plan has no executable code, so "test" maps to **verification** (grep for unwanted strings, check file metadata, validate cross-references) rather than unit-test assertions. Each task's "verify" step is the equivalent of running a test.

---

## File Structure

```
/assets/emails/template/                NEW
  magic-link.html                       Cleaned branded HTML (Supabase pastes from this)
  magic-link.txt                        Plain-text fallback (mandatory for deliverability)
/docs/runbooks/                         NEW
  smtp-auth-setup.md                    Full operator runbook (sections a–h)
/docs/
  email-quotes.md                       NEW — quote rotation candidates
/web/public/branding/                   NEW
  mark-reader-96.png                    2× retina source
  mark-reader-192.png                   4× retina — referenced by email <img>
  mark-reader-512.png                   reserve for in-app hero / favicon source
/README.md                              EDIT — add new Prerequisites step 7
```

**Source materials (operator-provided, not in repo until copied):**

- `/Users/michellerojas/Downloads/assets/mark-reader-{96,192,512}.png` — Reader mark PNG assets
- `/Users/michellerojas/Downloads/Magic Link Email - email-safe.html` — operator's HTML template draft (needs cleanup pass)

---

## Task 1: Copy Reader mark PNG assets

**Files:**
- Create: `web/public/branding/mark-reader-96.png`
- Create: `web/public/branding/mark-reader-192.png`
- Create: `web/public/branding/mark-reader-512.png`

- [ ] **Step 1: Verify source files exist with expected dimensions**

Run:
```bash
ls -la /Users/michellerojas/Downloads/assets/mark-reader-{96,192,512}.png
for f in /Users/michellerojas/Downloads/assets/mark-reader-*.png; do
  sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | tail -2 | tr '\n' ' '
  echo "  → $f"
done
```

Expected: 3 files exist, sizes match: 96×96, 192×192, 512×512.

- [ ] **Step 2: Create destination directory**

Run:
```bash
mkdir -p web/public/branding
```

Expected: directory created, no errors. (May already exist if other branding assets land here later.)

- [ ] **Step 3: Copy the three PNGs**

Run:
```bash
cp /Users/michellerojas/Downloads/assets/mark-reader-96.png  web/public/branding/mark-reader-96.png
cp /Users/michellerojas/Downloads/assets/mark-reader-192.png web/public/branding/mark-reader-192.png
cp /Users/michellerojas/Downloads/assets/mark-reader-512.png web/public/branding/mark-reader-512.png
```

- [ ] **Step 4: Verify the copies match the originals (byte-for-byte)**

Run:
```bash
for sz in 96 192 512; do
  src="/Users/michellerojas/Downloads/assets/mark-reader-${sz}.png"
  dst="web/public/branding/mark-reader-${sz}.png"
  diff -q "$src" "$dst" && echo "OK: mark-reader-${sz}.png matches"
done
```

Expected: 3 lines of "OK: ...".

- [ ] **Step 5: Commit**

```bash
git add web/public/branding/mark-reader-96.png \
        web/public/branding/mark-reader-192.png \
        web/public/branding/mark-reader-512.png
git commit -m "$(cat <<'EOF'
feat(branding): add Reader mark PNG assets

Three sizes of the Reading Group Planner mark, exported from the
WiDS NYC Design System Codex MarkA. Email template references the
192px variant; 96 and 512 reserved for future product chrome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Author the cleaned magic-link HTML template

The source HTML at `~/Downloads/Magic Link Email - email-safe.html` picked up Cloudflare proxy artifacts during transit. This task copies it into the repo and performs 7 specific edits to make it production-ready.

**Files:**
- Create: `assets/emails/template/magic-link.html`

- [ ] **Step 1: Verify source file exists**

Run:
```bash
test -f "/Users/michellerojas/Downloads/Magic Link Email - email-safe.html" && \
  wc -l "/Users/michellerojas/Downloads/Magic Link Email - email-safe.html"
```

Expected: file exists, ~227 lines.

- [ ] **Step 2: Create destination directory and copy source**

Run:
```bash
mkdir -p assets/emails/template
cp "/Users/michellerojas/Downloads/Magic Link Email - email-safe.html" \
   assets/emails/template/magic-link.html
```

- [ ] **Step 3: Write the "failing verifications" — these checks should all FAIL right now**

Run:
```bash
echo "=== Should be 0 occurrences each (currently nonzero — these are the cleanup targets) ==="
echo -n "/cdn-cgi/ paths:        "; grep -c "/cdn-cgi/" assets/emails/template/magic-link.html
echo -n "__cf_email__ classes:   "; grep -c "__cf_email__" assets/emails/template/magic-link.html
echo -n "literal magic URLs:     "; grep -c "https://planner.widsnyc.org/auth" assets/emails/template/magic-link.html
echo -n "literal '15 minutes':   "; grep -c "15 minutes" assets/emails/template/magic-link.html
echo -n "obsolete {{EMAIL}}:     "; grep -c "{{EMAIL}}" assets/emails/template/magic-link.html
echo -n "obsolete {{MAGIC_URL}}: "; grep -c "{{MAGIC_URL}}" assets/emails/template/magic-link.html
echo ""
echo "=== Should be present after cleanup (currently 0) ==="
echo -n "Supabase {{ .Email }}:            "; grep -c '{{ \.Email }}' assets/emails/template/magic-link.html
echo -n "Supabase {{ .ConfirmationURL }}:  "; grep -c '{{ \.ConfirmationURL }}' assets/emails/template/magic-link.html
echo -n "mark-reader-192.png <img>:        "; grep -c "mark-reader-192.png" assets/emails/template/magic-link.html
```

Expected (before cleanup):
```
/cdn-cgi/ paths:        2     ← line 141 anchor + line 213 anchor
__cf_email__ classes:   2     ← same two lines (plus possibly inline tags)
literal magic URLs:     3     ← lines 154, 160, 176
literal '15 minutes':   2     ← preheader + body
obsolete {{EMAIL}}:     0     ← in comments only, not body
obsolete {{MAGIC_URL}}: 0     ← in comments only, not body
Supabase {{ .Email }}:            0
Supabase {{ .ConfirmationURL }}:  0
mark-reader-192.png <img>:        0
```

These all flip after Step 4.

- [ ] **Step 4: Perform the 7 edits**

Use `Edit` (or sed) for each. All edits are unambiguous string replacements.

**Edit 1: Preheader expiry (line ~69)** — `15 minutes` → `60 minutes`

```
old: One-tap link. Works once, expires in 15 minutes.
new: One-tap link. Works once, expires in 60 minutes.
```

**Edit 2: Replace inline SVG block (lines ~89–114) with `<img>` tag**

Replace the entire block from `<svg width="48" height="48" ...>` through `</svg>` with:
```html
<img src="https://YOUR-DEPLOY-URL/branding/mark-reader-192.png"
     width="48" height="48" alt="Reading Group Planner"
     style="display:block;border:0;outline:none;text-decoration:none;">
```

The `YOUR-DEPLOY-URL` placeholder is replaced by the operator during runbook step (e) with the actual Vercel deployment URL (or custom-domain URL once wired). It is intentionally a placeholder, not a real URL, so an operator pasting from this file without reading the runbook gets a visibly-broken image to investigate.

**Edit 3: Cloudflare-obfuscated email in body (line ~141)**

```
old: It opens as
     <b style="font-weight:600;"><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="5d303c243c732f1d3a303c3431733e3230">[email&#160;protected]</a></b>,
     works once, and expires in <b style="font-weight:600;">15 minutes</b>.

new: It opens as
     <b style="font-weight:600;">{{ .Email }}</b>,
     works once, and expires in <b style="font-weight:600;">60 minutes</b>.
```

**Edit 4: VML button magic URL (line ~154)**

```
old: <v:roundrect ... href="https://planner.widsnyc.org/auth/v?t=8f3c1a9b-2d4e-4f87-91ab-c0de7e6f4321" ...>
new: <v:roundrect ... href="{{ .ConfirmationURL }}" ...>
```

**Edit 5: HTML button magic URL (line ~160)**

```
old: <a href="https://planner.widsnyc.org/auth/v?t=8f3c1a9b-2d4e-4f87-91ab-c0de7e6f4321"
new: <a href="{{ .ConfirmationURL }}"
```

**Edit 6: Fallback URL display + anchor (line ~176)**

Two occurrences on the same line. Replace both:
```
old: <a href="https://planner.widsnyc.org/auth/v?t=8f3c1a9b-2d4e-4f87-91ab-c0de7e6f4321" style="..."
     >https://planner.widsnyc.org/auth/v?t=8f3c1a9b-2d4e-4f87-91ab-c0de7e6f4321</a>

new: <a href="{{ .ConfirmationURL }}" style="..."
     >{{ .ConfirmationURL }}</a>
```

**Edit 7: Footer mailto removal + Cloudflare JS shim removal**

Footer paragraph at line ~211–214:
```
old: <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.55;color:#7e6f55;text-align:center;">
       WiDS NYC AI Reading Group ·
       <a href="/cdn-cgi/l/email-protection#97fff2fbfbf8d7e0fef3e4f9eef4b9f8e5f0" style="color:#7e6f55;text-decoration:none;"><span class="__cf_email__" data-cfemail="c3aba6afafac83b4aaa7b0adbaa0edacb1a4">[email&#160;protected]</span></a>
     </p>

new: <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.55;color:#7e6f55;text-align:center;">
       WiDS NYC AI Reading Group
     </p>
```

JS shim at line ~225 — delete entirely:
```
old: <script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script></body>
new: </body>
```

- [ ] **Step 5: Re-run the verification grep — every line should now show the expected count**

Run the same block as Step 3.

Expected (after cleanup):
```
/cdn-cgi/ paths:        0
__cf_email__ classes:   0
literal magic URLs:     0
literal '15 minutes':   0
obsolete {{EMAIL}}:     0  (or, if present in comments, count is acceptable)
obsolete {{MAGIC_URL}}: 0  (same caveat)
Supabase {{ .Email }}:            1
Supabase {{ .ConfirmationURL }}:  3   ← VML button + HTML button + fallback display
mark-reader-192.png <img>:        1
```

If `{{EMAIL}}` or `{{MAGIC_URL}}` count > 0, they should only appear inside the `<!-- ... -->` template-author comment block near the top of the file (lines ~12–35). Verify with:
```bash
grep -nE "\{\{EMAIL\}\}|\{\{MAGIC_URL\}\}" assets/emails/template/magic-link.html
```
Expected: all hits inside `<!--` … `-->` comment block. Leave those — they document the original token convention for future readers.

- [ ] **Step 6: Spot-check rendering**

Open the file in a browser to visually confirm structure:
```bash
open assets/emails/template/magic-link.html
```

Expected visual:
- Dark brown frame around a cream card (600px wide on desktop)
- Top: broken-image icon where the mark would render (placeholder URL, intentional)
- Below that: "Reading Group Planner" headline + magenta hairline + "WIDS · NYC AI READING GROUP" eyebrow
- Body: "Hey curious friend — your sign-in link is below. It opens as `{{ .Email }}`..."
- Sage CTA: "Sign in and keep reading →"
- Magenta hairline + Grace Hopper quote
- Footer: "WiDS NYC AI Reading Group" (no mailto)

- [ ] **Step 7: Commit**

```bash
git add assets/emails/template/magic-link.html
git commit -m "$(cat <<'EOF'
feat(email): add cleaned magic-link HTML template

Source: operator's hand-crafted email-safe HTML. Cleanup pass:
- Strip Cloudflare /cdn-cgi/ proxy artifacts (anchors + JS shim)
- Swap {{EMAIL}}/{{MAGIC_URL}} → {{ .Email }}/{{ .ConfirmationURL }}
  (Supabase Go-template syntax)
- Replace inline SVG mark with <img> referencing mark-reader-192.png
  (resolves Outlook Windows blank-space)
- 15 min → 60 min expiry (Supabase default; spec decision)
- Remove footer mailto (matches silent noreply@ decision)

Template lives in repo as source of truth; operator pastes into
Supabase Auth → Email Templates → Magic Link.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Author the plain-text fallback

Required by Supabase Auth → Email Templates (plain-text variant) and required for deliverability — Gmail/Outlook downgrade HTML-only emails.

**Files:**
- Create: `assets/emails/template/magic-link.txt`

- [ ] **Step 1: Write the file**

Create `assets/emails/template/magic-link.txt` with this exact content:

```
WiDS NYC AI Reading Group

Hey curious friend,

Sign in to the WiDS NYC member portal:
{{ .ConfirmationURL }}

This link expires in 60 minutes and works only once.

Didn't ask for this? Sit tight — without the link, no one signs in
as you.

"The most dangerous phrase in the language is, 'we've always done
it this way.'"
— Grace Hopper

---
WiDS NYC AI Reading Group — a community for women and non-binary
data scientists in NYC.
```

- [ ] **Step 2: Verify token presence and absence of cleanup targets**

Run:
```bash
echo -n "{{ .ConfirmationURL }} count: "; grep -c '{{ \.ConfirmationURL }}' assets/emails/template/magic-link.txt
echo -n "Stray HTML tags:              "; grep -cE "<[a-z]+" assets/emails/template/magic-link.txt
echo -n "Stray {{EMAIL}}:              "; grep -c "{{EMAIL}}" assets/emails/template/magic-link.txt
echo -n "Stray '15 minutes':           "; grep -c "15 minutes" assets/emails/template/magic-link.txt
```

Expected:
```
{{ .ConfirmationURL }} count: 1
Stray HTML tags:              0
Stray {{EMAIL}}:              0
Stray '15 minutes':           0
```

- [ ] **Step 3: Commit**

```bash
git add assets/emails/template/magic-link.txt
git commit -m "$(cat <<'EOF'
feat(email): add plain-text fallback for magic-link

Mirrors the HTML template's voice and content. Required by
Supabase Email Templates (plain-text variant) and by Gmail/Outlook
deliverability heuristics for HTML-only emails.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create the quote candidates doc

Seeds the manual monthly quote rotation. Per spec §6, the operator picks a new quote from this doc periodically and pastes it into the Supabase template editor.

**Files:**
- Create: `docs/email-quotes.md`

- [ ] **Step 1: Write the file**

Create `docs/email-quotes.md` with this content:

```markdown
# Magic-link email — quote candidates

The magic-link email (`assets/emails/template/magic-link.html` and
`magic-link.txt`) shows one inspirational quote above the footer.
Supabase email templates are static — rotation is manual.

## How to rotate

1. Pick a quote from the list below (or add your own).
2. Open Supabase Dashboard → Authentication → Email Templates → Magic Link.
3. Replace both the HTML version's `<p class="quote-text">…</p>` block
   and the plain-text version's `"…"` / `— Name` lines.
4. Save in Supabase. Optionally also update the seed in
   `assets/emails/template/magic-link.{html,txt}` and commit so the
   repo file stays representative.

Suggested cadence: once a month, or whenever the current quote feels
stale to the operator.

## Quote candidates

Women + non-binary technologists, scientists, and writers whose words
land for a curious-friend audience.

### Currently in the seed template

**Grace Hopper** — *"The most dangerous phrase in the language is,
'we've always done it this way.'"*

### Rotation pool

**Ada Lovelace** — *"That brain of mine is something more than merely
mortal; as time will show."*

**Katherine Johnson** — *"Like what you do, and then you will do your
best."*

**Margaret Hamilton** — *"There was no choice but to be pioneers; no
time to be beginners."*

**Radia Perlman** — *"The fact that I'm a 'famous' person is sort of
sad. The world should have so many female engineers that it wouldn't
be at all noteworthy."*

**Barbara Liskov** — *"You don't get to be a successful scientist
without overcoming a lot of obstacles."*

**Frances Allen** — *"My advice to the young women of today is to
look beyond their immediate environment and to find the courage to do
what they think is important."*

**Joan Clarke** — *"It was easy to make decisions for myself, harder
to make them for others."*

**Hedy Lamarr** — *"The brains of people are more interesting than
the looks, I think."*

**Mary Allen Wilkes** — *"I have to say that I think the world has
gotten more interesting for women."*

## Sourcing rule

Prefer quotes the operator has independently verified — apocryphal
"famous person said X" lines are common online. When unsure, leave
the current quote in place.
```

- [ ] **Step 2: Verify the file lints clean as markdown and has the seed quote**

Run:
```bash
echo -n "Grace Hopper seed present: "; grep -c "Grace Hopper" docs/email-quotes.md
echo -n "Total named quotes:        "; grep -cE "^\*\*[A-Z]" docs/email-quotes.md
```

Expected:
```
Grace Hopper seed present: 1
Total named quotes:        10
```

- [ ] **Step 3: Commit**

```bash
git add docs/email-quotes.md
git commit -m "$(cat <<'EOF'
docs(email): seed quote rotation candidates

10 candidate quotes for the magic-link email's manual monthly
rotation. Grace Hopper is the seed quote in the committed template;
the rest live here for the operator to pull from.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Author the operator runbook

The canonical step-by-step the operator follows to wire Resend into Supabase. Cross-references all the artifacts created in Tasks 1–4.

**Files:**
- Create: `docs/runbooks/smtp-auth-setup.md`

- [ ] **Step 1: Create the runbook directory**

Run:
```bash
mkdir -p docs/runbooks
```

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/smtp-auth-setup.md` with this content:

````markdown
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
4. Leave **Reply-To** **unset** — replies bounce silently by design.
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

**Optional — commit the resolved URL back to the repo** so the repo
file always reflects the live deployment URL. Make a follow-up commit
swapping the placeholder for the real URL in
`assets/emails/template/magic-link.html`.

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

---

## g) Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Resend "Verify DNS" stays red after 30 min | Cloudflare proxy still on (orange-cloud) for at least one of the 4 records | Set all 4 to grey-cloud DNS-only |
| Email lands in Spam | DKIM TXT value split across lines by Cloudflare | Re-edit the DKIM record, paste as a single continuous string |
| Supabase test email says "SMTP error" | API key has leading/trailing whitespace from copy-paste | Regenerate API key, re-paste carefully, save |
| Members see broken-image icon where the mark should be | `<img src>` URL still has the `YOUR-DEPLOY-URL` placeholder, OR `mark-reader-192.png` is missing from the deployment | Update the URL per step (e); verify the asset is reachable at the URL |
| Magic-link click goes to 404 | `<vercel-url>/auth/callback` not added to Supabase → Auth → URL Configuration → Redirect URLs | Add the redirect URL per the existing portal setup |
| All members suddenly can't sign in | Resend daily quota (100/day free tier) exhausted | Wait for midnight-UTC reset OR upgrade Resend; meanwhile, fall back to built-in SMTP via the rollback procedure below |

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
````

- [ ] **Step 3: Verify the runbook is internally consistent**

Run:
```bash
echo -n "Section a present:  "; grep -c "^## a) " docs/runbooks/smtp-auth-setup.md
echo -n "Section h present:  "; grep -c "^## h) " docs/runbooks/smtp-auth-setup.md
echo -n "60-min consistency: "; grep -c "60 minutes" docs/runbooks/smtp-auth-setup.md
echo -n "Stale 15-min refs:  "; grep -c "15 minutes" docs/runbooks/smtp-auth-setup.md
echo -n "Spec backlink:      "; grep -c "2026-05-13-smtp-auth-rate-limits-design" docs/runbooks/smtp-auth-setup.md
echo -n "Template refs:      "; grep -c "assets/emails/template" docs/runbooks/smtp-auth-setup.md
echo -n "Mark asset refs:    "; grep -c "mark-reader-192" docs/runbooks/smtp-auth-setup.md
```

Expected:
```
Section a present:  1
Section h present:  1
60-min consistency: ≥3
Stale 15-min refs:  0
Spec backlink:      1
Template refs:      ≥2
Mark asset refs:    ≥3
```

- [ ] **Step 4: Verify cross-reference paths actually resolve**

Run:
```bash
test -f docs/superpowers/specs/2026-05-13-smtp-auth-rate-limits-design.md && echo "OK: spec exists"
test -f assets/emails/template/magic-link.html && echo "OK: HTML template exists"
test -f assets/emails/template/magic-link.txt && echo "OK: plain-text template exists"
```

Expected: 3 lines of "OK: ...".

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/smtp-auth-setup.md
git commit -m "$(cat <<'EOF'
docs(runbook): SMTP auth setup runbook for operators

Step-by-step (sections a–h) for replacing Supabase built-in SMTP
with Resend + Cloudflare. Covers domain registration, DNS, API
keys, Supabase config, template paste, smoke test, troubleshooting,
per-project repeat for the /wids-simulate-cycle environment, and
rollback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update README with Prerequisites step 7

The README currently has 6 numbered Prerequisites sub-sections (Supabase, Drive, MCPs, custom skill, scheduled tasks, Vercel). Adding step 7 for the SMTP setup, pointing to the new runbook.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Identify the insertion point**

Run:
```bash
grep -n "^### 6\.\|^## Running" README.md
```

Expected: shows line numbers for `### 6. Vercel project ...` and the next `## Running` heading. The new `### 7. Custom SMTP for magic-link auth` section goes between them.

- [ ] **Step 2: Edit README**

After the existing section 6 block (ends with the `See [web/README.md]...` line), and before the line `## Running`, insert this new section:

````markdown
### 7. Custom SMTP for magic-link auth

Supabase's built-in SMTP is rate-limited to ~2 emails/hour, which
throttles members during sign-in bursts. Before going live with the
member portal, configure **Resend** as a custom SMTP provider using
a Cloudflare-registered domain.

See the step-by-step runbook: [`docs/runbooks/smtp-auth-setup.md`](docs/runbooks/smtp-auth-setup.md)

One-time cost: ~$10/year for the `.org` domain. Resend's free tier
(3,000 emails/month, 100/day) covers this group's volume.

````

- [ ] **Step 3: Verify the README edit is well-formed**

Run:
```bash
echo -n "Section 7 added:        "; grep -c "^### 7\. Custom SMTP" README.md
echo -n "Runbook link present:   "; grep -c "docs/runbooks/smtp-auth-setup.md" README.md
echo -n "Sections still in order:"
grep -nE "^### [1-7]\." README.md
```

Expected:
```
Section 7 added:        1
Runbook link present:   1
Sections still in order:
<line>: ### 1. Supabase project
<line>: ### 2. Google Drive root folder
<line>: ### 3. Claude Code MCPs
<line>: ### 4. Custom skill
<line>: ### 5. Scheduled-tasks MCP
<line>: ### 6. Vercel project (only needed once the member portal is ready to deploy)
<line>: ### 7. Custom SMTP for magic-link auth
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): add Prerequisites step 7 — custom SMTP

Brief pointer in the Prerequisites block to the SMTP runbook,
so operators see the dependency before running /wids-bootstrap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Push branch and verify Vercel preview serves the mark asset

The Vercel preview deploy fires automatically on push. This task verifies the mark PNG is actually reachable at the deployment URL — the one thing that can go wrong post-merge.

**Files:** none modified; verification only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/gifted-feynman-2d2787
```

Expected: branch pushes successfully. Vercel's GitHub integration triggers a preview build.

- [ ] **Step 2: Wait for Vercel preview to be ready**

The preview URL appears as a check on the most recent commit. Find it:

```bash
gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | select(.context // .name | test("vercel"; "i")) | {name, state, targetUrl}' 2>/dev/null || \
  gh api repos/:owner/:repo/commits/HEAD/check-runs --jq '.check_runs[] | select(.name | test("vercel"; "i")) | {name, conclusion, details_url}'
```

If the PR doesn't exist yet (Task 8 will create it), check Vercel directly: `vercel ls` if the Vercel CLI is configured locally, or check the Vercel dashboard.

Wait until the Vercel preview build shows **Ready** (typically 1–3 min for this repo).

- [ ] **Step 3: Curl the mark asset**

```bash
# Replace VERCEL_URL with the actual preview URL from Step 2
VERCEL_URL="https://wids-nyc-<hash>-mrojas54.vercel.app"

curl -sI "$VERCEL_URL/branding/mark-reader-192.png" | head -5
```

Expected response:
```
HTTP/2 200
content-type: image/png
content-length: 20286
...
```

If the response is `HTTP/2 404`:
- The asset wasn't included in the deploy. Confirm `web/public/branding/mark-reader-192.png` exists locally and is committed (`git ls-files web/public/branding/`).
- Confirm Vercel's project Root Directory is set to `web` (per existing README step 6); the `public/` directory at that root is auto-served.

- [ ] **Step 4: (Optional) Render the email template in a browser**

Replace the `YOUR-DEPLOY-URL` placeholder with the live URL in a *local working copy* (don't commit this — the runbook tells the operator to do this swap themselves):

```bash
# In a throwaway location, not in the repo
cp assets/emails/template/magic-link.html /tmp/magic-link-preview.html
sed -i.bak "s|YOUR-DEPLOY-URL|$(echo $VERCEL_URL | sed 's|https://||')|g" /tmp/magic-link-preview.html
open /tmp/magic-link-preview.html
```

Expected: the email renders in your browser with the Reader mark visible at the top (not a broken-image icon).

This step is purely for sanity-checking before handing the PR to a reviewer; it doesn't change anything in the repo.

- [ ] **Step 5: No commit needed — this task is verification only**

If everything passed, proceed to Task 8.

---

## Task 8: Open the PR

**Files:** none modified; this task creates the GitHub PR.

- [ ] **Step 1: Verify all expected commits are on the branch**

```bash
git log main..HEAD --oneline
```

Expected: 6 commits (one per Task 1–6), each with focused scope.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: custom SMTP for magic-link auth (Resend + wids-nyc-reading-group.org)" --body "$(cat <<'EOF'
## Summary

- Adds the repo-side artifacts that let the operator swap Supabase built-in SMTP (rate-limited to ~2/hour) for **Resend** + a Cloudflare-registered `wids-nyc-reading-group.org` domain.
- Zero code change in `web/` — the swap is dashboard-only. This PR ships:
  - Branded magic-link email template + plain-text fallback (`assets/emails/template/`)
  - Reader mark PNG assets at 96/192/512 (`web/public/branding/`)
  - Operator runbook driving the external setup (`docs/runbooks/smtp-auth-setup.md`)
  - Quote rotation seed (`docs/email-quotes.md`)
  - README pointer in Prerequisites step 7
- Recurring cost: ~$10/year for the `.org` domain. Resend free tier covers volume.

**Spec:** [`docs/superpowers/specs/2026-05-13-smtp-auth-rate-limits-design.md`](docs/superpowers/specs/2026-05-13-smtp-auth-rate-limits-design.md)
**Runbook:** [`docs/runbooks/smtp-auth-setup.md`](docs/runbooks/smtp-auth-setup.md)

## Test plan

- [ ] CI passes (no code changes; just docs + assets — should be green)
- [ ] Vercel preview serves `/branding/mark-reader-192.png` (HTTP 200)
- [ ] Vercel preview serves `/branding/mark-reader-96.png` and `/branding/mark-reader-512.png` (HTTP 200) — included for future product chrome use
- [ ] `assets/emails/template/magic-link.html` renders in a browser with the placeholder URL visibly broken (intentional — operator swaps during runbook step e)
- [ ] No `/cdn-cgi/` paths anywhere in `assets/emails/template/magic-link.html`
- [ ] Runbook cross-references all resolve (spec, template, asset paths)

## Post-merge operator work

After this PR merges, the operator follows [`docs/runbooks/smtp-auth-setup.md`](docs/runbooks/smtp-auth-setup.md) to do the external setup (~45 minutes plus DNS propagation):

1. Register `wids-nyc-reading-group.org` at Cloudflare
2. Sign up for Resend + verify domain (4 DNS records)
3. Generate SMTP API key
4. Configure Supabase SMTP settings
5. Paste the committed template into Supabase Auth → Email Templates (swap `YOUR-DEPLOY-URL` for the real Vercel URL)
6. Smoke test from an incognito window

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm PR URL is printed**

Expected: `gh pr create` prints the PR URL like `https://github.com/mrojas54/wids-nyc-reading-group-assistant/pull/<n>`. Surface that URL to the user as the deliverable.

---

## Post-implementation: what happens next

This plan ships the **repo-side artifacts**. Two things follow the PR merge:

1. **Operator follows `docs/runbooks/smtp-auth-setup.md`** to do the external setup (domain, DNS, Resend, Supabase). This is ~45 min of dashboard work + 5–15 min DNS propagation wait. It is **not** part of the engineer's implementation plan — the runbook IS the operator's plan.

2. **Optional follow-up commit**: once the live deployment URL is known (Vercel preview or custom domain), the operator can submit a follow-up PR swapping `YOUR-DEPLOY-URL` for the real URL in `assets/emails/template/magic-link.html`. This is purely a cosmetic / source-of-truth alignment — the live Supabase template already has the resolved URL after runbook step (e).

## Spec coverage check

| Spec section | Covered by |
|---|---|
| §1 Overview, Goals, Non-goals | (no implementation; orientation only) |
| §2 System Shape | (no code change in `web/`; all tasks honor this) |
| §3 Components & artifacts | Tasks 1–6 produce all 5 deliverables |
| §4 DNS records | Documented in Task 5 runbook (operator action) |
| §5 Operator runbook | Task 5 |
| §6 Email template | Tasks 1, 2, 3, 4 |
| §7 Verification | Task 7 + runbook smoke test (Task 5 step f) |
| §8 Rollback | Documented in Task 5 runbook |
| §9 Known limitations | (no implementation; documented in spec) |
| §10 Open questions | (none) |

All sections covered.
