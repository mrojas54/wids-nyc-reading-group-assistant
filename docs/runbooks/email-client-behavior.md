# Email client behaviour — dated findings

What mail clients actually do to our templates. This file exists because these
claims were previously scattered through HTML head comments where they had no
date, no message ID, and no method — and at least two of them were wrong for
months before anyone checked.

**The rule for every entry below: a date, the message ID it was verified
against, and how it was verified.** An entry that cannot carry all three is
`UNVERIFIED` and must be labelled so. Do not promote an entry to `VERIFIED`
because it sounds right or because it has been in the tree a long time.

Status values:

| Status | Meaning |
|---|---|
| `VERIFIED` | Read back from a delivered message, with the ID recorded. |
| `REFUTED` | Was asserted somewhere, then tested and found false. |
| `UNVERIFIED` | Inherited from a template comment with no evidence attached. Treat as a lead. Do not design around it without re-checking. |

Message IDs are Gmail message IDs in `mirojas1524@gmail.com`, readable with the
Gmail MCP `get_message`.

---

## The mark-rendering regression

The open investigation. See `HANDOFF.md` for the live state; this section is the
evidence table only.

### Observation table

Every row read back from the delivered message, not from a preview. The May 25
and May 27 rows were additionally confirmed visually in the Gmail web UI from
operator screenshots.

| Date | Template | Recipient | Message ID | Mark | Profile |
|---|---|---|---|---|---|
| 2026-05-25 | availability-reminder | asthashie@gmail.com | `19e613bc6c209aa2` | **renders** | A |
| 2026-05-27 | rsvp-confirmation | niharikakrishnan@gmail.com | `19e69fe626a5da4d` | **renders** | A |
| 2026-06-19 | pre-meeting-reminder | asthashie@gmail.com | `19ee0c32df57e57a` | absent | B |
| 2026-07-14 | new-paper-announcement | self | `19f6102d80ec9876` | absent | B |
| 2026-07-26 | welcome-availability | self | `19fa177127522805` | absent | B |
| 2026-07-27 | welcome-availability | chary.priyanka@gmail.com | `19fa18c4cb061071` | absent | B |
| 2026-07-27 | MARK TEST (3 img variants) | self | `19fa1a54135fcf31` | absent | B |

### `VERIFIED` 2026-07-27 — the loss is whole-document, not image-specific

Method: compared full delivered bodies of `19e613bc6c209aa2` and
`19e69fe626a5da4d` (mark present) against `19ee0c32df57e57a` (mark absent).

Mark-absent messages differ from mark-present ones in **four** ways at once, not
one:

| Marker | Profile A (mark renders) | Profile B (mark absent) |
|---|---|---|
| `<img>` mark | present | absent |
| `href` form | plain (`https://wids-nyc-…`) | rewritten through `google.com/url?q=…&source=gmail&ust=…&sa=E` |
| `class` attributes | present, Gmail-namespaced `m_<id>…` | none at all |
| hidden preheader `<div>` | present | absent |

This matters because "the mark disappears" framed the problem far too narrowly.
Whatever produces profile B degrades the entire document — it drops the `<style>`
block (hence no classes to namespace), the preheader, and every `<img>`. Any fix
aimed only at the image is aimed at one symptom of four.

### `VERIFIED` 2026-07-27 — the regression window is 2026-05-27 → 2026-06-19

Method: fetched the 2026-06-19 `pre-meeting-reminder` batch (six sends,
`19ee0c*`) and read the delivered body of `19ee0c32df57e57a`.

That send is profile B. It went to a real member — `asthashie@gmail.com`, the
same recipient as the working 2026-05-25 send. The window between last-known-good
and first-known-bad is therefore 24 days, not the two months previously recorded.

### `VERIFIED` 2026-07-27 — recipient is not the variable

The 2026-07-27 send to a real member (`19fa18c4cb061071`) lost the mark exactly
like the sends to self. "It only breaks when you mail yourself" is ruled out.

### `VERIFIED` 2026-07-27 — template design is not the variable

2026-05-25 is the old white-card `availability-reminder` design; 2026-05-27 is
`rsvp-confirmation`, in the current paper-note family. Both render. Four
different templates fail.

### `VERIFIED` 2026-07-27 — `<img>` is stripped by tag, not by `src` scheme

Method: MARK TEST `19fa1a54135fcf31` carried three variants in one message — `cid:`
inline attachment, remote `https`, and a `data:` URI. All three `<img>` elements
were absent from the delivered body; all three text labels survived.

**No `src` scheme rescues this.** Do not reach for `cid:` as a fix.

### `VERIFIED` 2026-07-27 — a `cid:` part survives, orphaned

Same message. The `cid:` PNG survived as a real MIME part (`image/png`,
`mark-reader-96.png`, live `attachmentId`) but nothing in the body references it,
so it lands as a bare paperclip attachment. That is worse than no mark: the
recipient gets a stray file to wonder about.

### `VERIFIED` 2026-07-27 — the reader is not the one stripping images

Control: a Zoom visitor-pass mail in the same mailbox, fetched the same way,
comes back with both `<img src="cid:qrcode">` and a remote `https` `<img>`
intact, plus its own doctype and `<style>`. The absence in our sends is not the
Gmail MCP's parsing.

### `VERIFIED` 2026-07-27 — the branding assets are live

`mark-reader-96.png` → `200 image/png 2283b`; `mark-reader-192.png` →
`200 image/png 5081b`. A 404 does not explain any of this.

### `UNVERIFIED` — why profile B happens

Still open, and **the date confound is not broken**. Every profile-A message
predates every profile-B message, so calendar time predicts the outcome exactly
as well as any mechanism story does. Narrowing the window to 24 days does not
separate them.

The leading hypothesis remains that pressing Send in the Gmail compose window
ships the composer's re-parsed DOM, while a programmatic send ships the stored
HTML. It is consistent with the four-marker footprint — `<style>`, classes,
preheader and `<img>` are all things an editable-DOM round-trip would lose. It is
**not proven**, and two things argue against treating it as settled:

- The 2026-05-25 message's plain-text part is a flattening derived from its HTML,
  not the hand-wrapped `.txt` twin — itself a claimed composer signature. That
  message may have gone through the composer and kept its mark anyway.
- The only documentary support was `scheduled_tasks/availability-chase.md`
  Step 5c, which is independently known to be wrong (see below).

### `UNVERIFIED` 2026-07-27 — the staged experiment draft may have no HTML part

Draft `r3011218909851369227` (`welcome-availability`, addressed to
`mirojas1524@gmail.com`) is staged in `HANDOFF.md` as the vehicle for the
decisive experiment. `list_drafts` with `DRAFT_VIEW_FULL` returned a
`plaintextBody` and **no `htmlBody`** for it.

Not conclusive: `list_drafts` may simply not serialise that field, and
`get_thread` on the draft's thread (`19fa1c376c719b34`) returns
`The caller does not have permission`, so it could not be cross-checked.

Two details are worth flagging regardless. The returned `plaintextBody` is the
hand-wrapped `.txt` twin, and its URLs are **already rewritten through
`google.com/url?q=…&source=gmail`** — in a plain-text part, in an unsent draft.
Whatever applies that rewrite therefore happens at or before draft creation, not
at send.

**Check before running the experiment:** confirm the draft actually carries an
HTML part. If it does not, sending it proves nothing about HTML handling and the
draft must be recreated with `create_draft`'s `htmlBody` parameter (which does
exist — the tool supports it).

---

## Refuted claims

Both of these sat in `welcome-availability.html`'s head comment and were
believed for months. They are recorded here so nobody reintroduces them.

### `REFUTED` 2026-05-27 — "Gmail and Outlook strip the dotted-grid gradient"

The claim was that an inline `background-image: radial-gradient(...)` is honoured
by Apple Mail/iOS but stripped by Gmail and Outlook, falling back to flat cream.

False for Gmail web. Message `19e69fe626a5da4d` (`rsvp-confirmation`) uses the
identical technique — `background-image:radial-gradient(circle,#ddd4be 1px,transparent 1px)`
— and the operator's screenshot shows the dot grid rendering in the Gmail web UI.
The delivered body retains the declaration verbatim.

Outlook was never tested. Untested is not the same as stripped.

**This claim was copied, in substance if not in wording.**
`pre-meeting-reminder.html` drops the same dotted grid for the same stated
reason — "clients strip background-images". An earlier pass searched the suite
for the literal phrasing, found only `welcome-availability`, and concluded the
claim had not spread. That conclusion was wrong: the search matched strings, not
the belief. `pre-meeting-reminder`'s design deviation therefore rests on a
refuted premise. The template has been annotated; reinstating its grid is design
work and is deliberately not bundled into this investigation.

Lesson worth keeping: grepping for a wrong claim's wording does not find the
places that acted on it.

### `REFUTED` 2026-07-27 — "a `cid:` inline attachment is the only thing that would reach the recipient"

Written as "(untested here)". Now tested and false — see the MARK TEST entries
above. All three schemes lose their `<img>` identically.

---

## Composition rules that follow from the above

These are the design constraints worth keeping. Each is only as good as the
finding it rests on.

### `UNVERIFIED` — every painted background needs a `bgcolor` attribute

Inherited claim, no message ID recorded: Gmail's compose sanitiser drops
`background-color` from inline styles while keeping HTML attributes, so a colour
that lives only in CSS is lost to the recipient. Reported casualties before the
attributes were added were the sage vouch avatar, both magenta rules, and every
panel tint; the CTA survived because it already had `bgcolor`.

Partial corroboration: the 2026-07-26 send `19fa177127522805` rendered every
background correctly, which is consistent with the attributes doing their job —
but that is an absence of failure, not a controlled test.

Rule as applied today: inline `background-color` for radius/gradient-aware
clients, `bgcolor` alongside it for the sanitiser, never one without the other. A
colour bar therefore cannot be a bare styled `<div>`; it has to be a one-cell
table so there is an attribute to hang the colour on.

### `UNVERIFIED` — no inline SVG anywhere

Inherited claim, no message ID recorded: Gmail removes `<svg>` outright rather
than degrading it, so the Lucide glyphs the design handoff specifies rendered as
nothing at all in a real Gmail draft. Outlook and Yahoo reported the same; only
Apple Mail reliable.

Rule as applied today: every icon is a hosted PNG or a Unicode character
(`&#10003;` for the vouch check, `&#8594;` for CTA and companion arrows). If a
future icon needs real artwork, host a PNG under `web/public/branding/` like the
mark. Given the `<img>` finding above, note that a hosted PNG is not currently
reaching profile-B recipients either.

---

## Runbook errata

### `VERIFIED` 2026-07-27 — `scheduled_tasks/availability-chase.md` Step 5c is unfollowable

It says "Send via Gmail MCP." The Gmail MCP exposes **no send tool of any kind** —
`create_draft` and `update_draft` only. The step cannot be followed as written,
and it contradicts `.claude/commands/wids-add-member.md:239`, which states the
capability limit correctly.

Consequence for this investigation: the runbook cannot be cited as evidence that
any message was sent programmatically.

---

## Blocked paths — do not burn time rediscovering these

| Path | State as of 2026-07-27 |
|---|---|
| Raw RFC822 via Gmail MCP | Unavailable. `get_message` offers `MINIMAL` / `FULL_CONTENT` / `METADATA_ONLY`. No `raw`. |
| Raw RFC822 via Composio | `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` with `format:"raw"` denied at the permission prompt; separately the gmail toolkit is **not linked** (`composio connections list` returns only `eventbrite`, `discord`, `firecrawl`, `supabase`, `github`). |
| Sending anything programmatically | **Not permitted, independent of tooling.** The operator has ruled that nothing here sends email as them; everything member-facing is drafted for a human to send. Gmail MCP also has no send tool, and Composio catalogues `GMAIL_SEND_EMAIL` / `GMAIL_SEND_DRAFT` on an unlinked account — but treat those as incidental. Linking the account would not make sending allowed. See [`transactional-emails.md`](transactional-emails.md). |
| `get_thread` on the staged draft's thread | `The caller does not have permission`. |

Because raw MIME is unreachable, everything above is read through the MCP's
parsed body. That reader was controlled for — see the Zoom entry.
