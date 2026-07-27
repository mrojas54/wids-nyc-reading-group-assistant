---
description: Add a new member to the roster and draft their welcome-and-availability email
argument-hint: <name> | <email> | [phone] | [whatsapp] | [vouched-by]
---

# /wids-add-member <name> | <email> | [phone] | [whatsapp] | [vouched-by]

Two phases: insert the member → draft the welcome email, operator confirms the send.

Use this when someone asks to join between cycles. It is the single-member
counterpart to `/wids-bootstrap` Step 5 (bulk CSV import) plus the reminder
half of `scheduled_tasks/availability-chase.md`.

Fields are pipe-separated so names with commas survive. Phone and whatsapp are
optional. If the operator invokes the command bare, prompt for the fields
instead of halting.

## Step 1 — Parse and normalize

Split `$ARGUMENTS` on `|` and trim each field.

**Name** — required. Halt if empty: "Need at least a name and an email."

**Email** — required, and **must be lowercased** before it touches the DB.
This is not cosmetic: `web/app/auth/callback/route.ts` links a new sign-in to
its member row with `.eq("email", user.email.toLowerCase())`, so a row stored
as `Foo@Bar.com` lets the member receive a magic link, sign in, and then land
on a dashboard with no member record — `auth_user_id` never links and their
availability writes fail RLS. Reject anything without a single `@` and a dot in
the domain: "That doesn't look like an email: `<value>`."

**Phone / whatsapp** — optional, stored E.164 (`^\+[1-9][0-9]{1,14}$`, enforced
by `members_phone_e164_check` / `members_whatsapp_e164_check` from
`migrations/006_members_phone.sql`). Normalize before insert:

| Input shape | Rule |
|---|---|
| Already `+…` | Validate against the regex as-is. |
| 10 digits (`(925) 577-9712`) | Strip non-digits → prefix `+1`. |
| 11 digits starting `1` | Strip non-digits → prefix `+`. |
| Anything else | Do **not** guess a country code. Halt: "Can't normalize `<value>` to E.164 — pass it as `+<countrycode><number>`." |

If the whatsapp field was omitted but a phone was given, ask once: "Is
`<phone>` also their WhatsApp? (y/n)". `y` → copy the phone into whatsapp;
`n` → leave NULL. Don't assume — roughly half the roster has them equal and
half has whatsapp NULL.

**vouched-by** — optional, the name or email of the existing member who
introduced them. Resolve it to a member id; do not store a name string:

```sql
SELECT id, name FROM members
WHERE active AND (lower(email) = lower('<value>') OR name ILIKE '%' || '<value>' || '%');
```

Zero rows → tell the operator the voucher isn't on the roster and ask whether
to continue with no voucher. Two or more rows → show them and ask which. One
row → that id becomes `vouched_by`.

If the field was omitted entirely, ask once: "Who vouched them in? (name, or
`none`)". `none` leaves it NULL, which is a real answer — self-serve and
operator-added members have no voucher, and NULL is what switches the vouch
block off in Step 5a rather than inventing a name.

## Step 2 — Check for an existing row

```sql
SELECT id, name, email, active, role FROM members WHERE email = '<email>';
```

If a row comes back, do **not** insert a duplicate — `members.email` is UNIQUE
and the insert would silently no-op. Report what's there and ask which the
operator wants:

- Row is `active = false` → offer: "`<name>` is already on the roster but
  inactive. Reactivate them? (y/n)". On `y`:
  `UPDATE members SET active = true WHERE id = <id>;` then continue to Step 4.
- Row is `active = true` → say "`<name>` is already an active member (id
  `<id>`)." Skip to Step 4 so the operator can still send the reminder, or
  stop if they'd rather not.

## Step 3 — Insert

```sql
INSERT INTO members (name, email, phone, whatsapp, vouched_by, active, role)
VALUES ('<name>', '<email>', <phone|NULL>, <whatsapp|NULL>, <voucher_id|NULL>, true, 'member')
ON CONFLICT (email) DO NOTHING
RETURNING id, name, email, phone, whatsapp, vouched_by, active, role, joined_at;
```

`vouched_by` is a self-referencing FK added in
`migrations/023_members_vouched_by.sql`, nullable, with a CHECK that blocks
self-vouching. Recording it here is what makes the vouch fact durable — before
023 the name existed only in whatever email the operator happened to send.

`role` is always `member` here. Never set `operator` — the `one_operator`
partial unique index allows exactly one and it is already taken.

Log it:

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('slash_command', '/wids-add-member', 'success',
        'Added member <name> <<email>> id=<member_id>',
        jsonb_build_object('kind', 'member_added', 'member_id', <member_id>,
                           'email', '<email>'));
```

Nothing else needs provisioning. `auth_user_id` stays NULL and is linked
automatically on their first magic-link sign-in (`migrations/002_member_app.sql`
§1). Do not create `meeting_attendance` rows — those are written when the
meeting is actually scheduled.

## Step 4 — Find the open meeting

```sql
SELECT id FROM meetings
WHERE status = 'prep'
ORDER BY created_at DESC LIMIT 1;
```

If no row: stop here and report: "Added `<name>`. No meeting is in prep, so
there's nothing to ask availability for yet — they'll be included in the next
`/wids-meeting-start`." That is a success, not a failure.

If the member already has availability for that meeting, skip the email:

```sql
SELECT 1 FROM availability WHERE meeting_id = <meeting_id> AND member_id = <member_id>;
```

## Step 5 — Render the welcome email

Use `assets/emails/template/welcome-availability.{html,txt}` — the
welcome-and-vouch design ported from the Claude Design handoff "Vouched in
group email". It is written for exactly this moment (someone was vouched in
and needs to submit availability), which `availability-reminder` is not: that
one opens "It's been too long. We're getting the gang back together," written
for a lapsed regular.

**Render through the composer, never through `render()` directly.** The
template carries nine per-send block toggles, and
`scripts/render_email_previews.render` has no conditionals:

```sh
uv run python -c "
from scripts.welcome_availability import Blocks, Content, compose
bodies = compose(Content(tokens=TOKENS, blocks=Blocks()))
"
```

`compose()` returns `{'html': …, 'txt': …}` from one content object, so a
block toggled off drops from both bodies. It raises `CompositionError` rather
than returning a body with an unresolved token or a surviving marker, so there
is no separate "check unresolved" step — if it returns, both bodies are
mailable. Preview either header voice with
`uv run python -m scripts.welcome_availability`.

Tokens to resolve (full list in the template's header comment):

| Token | Source |
|---|---|
| `recipient.firstName` | `split_part(members.name, ' ', 1)` — but confirm, see below |
| `vouch.name` | `SELECT v.name FROM members m JOIN members v ON v.id = m.vouched_by WHERE m.id = <member_id>` — NULL means no voucher, see Step 5a |
| `vouch.blurb` | Block D's body line. **Depends on whether the voucher is the sender.** Third party: "Grab her number before the first meeting — she's your person for anything you want to ask." Voucher is the sender (i.e. `vouched_by` = the operator, which is common): "I'm your person for anything you want to ask before the first meeting." Shipping the third-party line when the host vouched reads as "grab her number" about the person signing the email. |
| `answerBy` | Operator-supplied date, default +7 days |
| `links.availability` | `<portalBase>/availability?meeting=<meeting_id>` |
| `links.companion` | `<portalBase>/papers/<paper_id>` — verify it resolves, see Step 5a |
| `signoff.names` | Operator-supplied, e.g. "Michelle & Claudia" |
| `operator.email` | Footer reply-to; unsubscribe is a human reply by design |
| `paper.title` / `paper.byline` / `paper.citation` / `paper.hook` | `papers` row + a one-line hook; block I only |
| `quote.text` / `quote.by` | `scripts/quotes.py`, same rotation as the chase |

### Step 5a — Toggle blocks off rather than inventing content

Three blocks depend on facts that may not hold for a given send. Turn the
block off instead of shipping a plausible guess:

- `Blocks(paper_card=False)` when `links.companion` does not resolve. Check the
  right place: `/papers/<id>` renders from `paper_companions.payload` first and
  only falls back to a static `web/content/papers/<id>.json` fixture, which is
  the **deprecated** `/wids-make-companion` path. A missing fixture proves
  nothing. Verify with:

  ```sql
  SELECT paper_id FROM paper_companions WHERE paper_id = <id> AND payload IS NOT NULL;
  ```

  Paper 40 (Meta-Harness) has a payload, so the companion link is live for the
  current cycle and this block stays on.
- `Blocks(vouch=False)` when `members.vouched_by IS NULL`. Note the vouch name
  appears in **three** places — the intro sentence, the vouch card, and the
  footer — but only the card is inside the toggled block. With no voucher you
  must also drop the intro's "`<name>` vouched you in!" clause and the footer
  line, or turn the whole email into a different send. Don't paper over it with
  "someone vouched you in".
- `Blocks(meet_strip=False)` if cadence or hosts have changed. "Every two
  months", "6–9 PM ET", and the host names are operator-authored copy, not
  product truth — there is no meeting-format doc upstream.

`Blocks(court_voice=True)` swaps in the ceremonial header. Off by default.

### Step 5b — Two things differ from the chase

1. **No greeting name to confirm.** Both bodies open `Hey Queen,` — the group's
   in-house address rather than a name slot. So `recipient.firstName` is unused
   here and the `split_part(name, ' ', 1)` mis-greeting problem does not arise:
   a member who goes by her middle name (`Sai Priyanka Iragavarapu` →
   `Hi Sai,`) is never mis-addressed by this template.

   That problem is still live for `availability-reminder` and
   `rsvp-confirmation`, which do greet by name. If you reinstate a personalised
   greeting here, reinstate the confirmation prompt with it — and consider a
   `members.preferred_name` column as the durable fix.
2. **`links.availability`** is `<portalBase>/availability?meeting=<meeting_id>`
   rather than the bare `/availability`. The page resolves an explicit
   `?meeting=` against prep meetings and 404s on a stale one, whereas the
   bare path silently falls back to "newest prep" — the legacy behavior noted
   in `web/app/availability/page.tsx`. A new member has no reason to be
   pointed at a meeting that may have rolled over by the time they click.

   The deep link does **not** survive sign-in — `web/middleware.ts` redirects
   an unauthed visit to `/`. That is what the note block (H) is for, and why
   it sits below the CTA. Do not turn it off.

Sanity-checked against meeting 37 / paper 40 with real values: both bodies
compose clean, the twin wraps to 68 columns, and the rendered card matches the
handoff's reference screenshot.

## Step 6 — Draft, then confirm the send

Create a **Gmail draft** via the Gmail MCP — multipart, both the rendered HTML
and plain-text bodies, single recipient. Subject: `Welcome to WiDS NYC AI
Reading Group — when can you make it?`

Do not send yet. Show the operator the resolved subject, recipient, and the
plain-text body, then ask: "Draft is in Gmail. Reply `send` to send it as-is,
or edit it in Gmail and send it yourself."

Only on an explicit `send` reply, send it and log:

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('slash_command', '/wids-add-member', 'success',
        'Sent availability reminder meeting=<meeting_id> member=<member_id> to=<email>',
        'availability-chase:meeting=<meeting_id>:member=<member_id>',
        jsonb_build_object('kind', 'member_reminder', 'meeting_id', <meeting_id>,
                           'member_id', <member_id>, 'email', '<email>'));
```

The `idempotency_key` deliberately uses the **`availability-chase:` namespace**,
not this command's own. `availability-chase.md` Step 5c dedupes on that exact
key without filtering on `name`, so claiming it here is what stops the nightly
chase from nudging a member who was just personally emailed. A unique violation
(SQLSTATE 23505) means the chase already reached them — treat it as "already
sent", don't resend.

If the operator edits and sends from Gmail instead, still write the log row —
ask them to confirm they sent it, then insert with the same key.

## Step 7 — Report

State the member id, what was stored (including whether whatsapp was set), the
meeting the reminder points at, and whether the email was sent or left as a
draft.
