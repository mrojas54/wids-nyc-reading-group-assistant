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

### `VERIFIED` 2026-09-02 — profile B is produced at draft creation, by the Gmail MCP `create_draft` path

**This closes the "why".** The stripping happens when the connector writes the
draft, before any human opens it and before anything is sent. Calendar time
and the compose window were never the variable.

Method: `create_draft` with `htmlBody` + `body` for `availability-reminder`
(paper_pending state), then `get_draft` with `messageFormat: "RAW"` — that
option exists on `get_draft` even though `get_message` lacks it — then
base64url-decode and quoted-printable-decode the `raw` field. Draft
`r-4555741430189389421`, message `1a0653edc864a7af`, to `annaagoha@gmail.com`.
The operator independently confirmed the mark absent in the Gmail web UI for the
same unsent draft (screenshot, 2026-09-02).

Stored HTML part versus what was submitted:

| Submitted | Stored |
|---|---|
| `<!doctype>`, `<html>`, `<head>`, `<title>`, `<meta>` | gone — body content only |
| `<style>` block, `<!--[if mso]>` conditionals, VML button | gone |
| every `<img>` (the mark) | gone — the `<td width="48">` cell is stored **empty** |
| every inline `<svg>` (card icons) | gone — cells stored empty |
| `class="…"`, `role="presentation"` | gone |
| `href="https://wids-nyc-…"` | rewritten `https://www.google.com/url?q=…&source=gmail&ust=…&sa=E`, in the HTML **and** the plain-text part |
| hidden preheader `<div>` | **kept**, minus `opacity` and `mso-hide` |
| `bgcolor`, inline `style`, table layout, `&mdash;` text | kept |

The MIME headers read `Received: from … by gmailapi.google.com with HTTPREST`.

That is profile B minus the preheader. The preheader is present in the stored
draft and absent in delivered profile-B mail, so one more pass (the composer's
Send, or delivery) removes it — but the mark, the styles and the classes are
already gone before that pass runs.

### `VERIFIED` 2026-09-02 — `<img>` is dropped by tag, whatever the `src`, `cid:` with a real inline part included

Draft `r-3749716002901602761`, message `1a0654f51096d7ee`, to self, subject
"MARK TEST via create_draft — cid / data / https (do not send)". Three
`<img>` in three labelled cells: `src="cid:mark.png"` with the PNG passed as
`attachments[0].inline = true`; a `data:image/png;base64` URI; the live `https`
URL. Stored HTML: all three cells empty, zero `<img>`. The PNG is stored as a
real part — `Content-Disposition: inline; filename=mark.png`,
`Content-ID: <ii_1a0654f4da2e9f73880>` — with nothing referencing it, exactly
the orphaned-attachment shape seen in delivered mail on 2026-07-27.

Confirmed visually by the operator in the Gmail compose window (screenshot,
2026-09-02): the three labels render with nothing beside them, and `mark.png
(3K)` sits in the attachment tray as a plain file.

Consequence: **no image the Gmail MCP writes into a draft reaches anyone.**
Not the mark, not the card icons, not a QR code. Do not spend another cycle on
`src` schemes, asset hosting, or template markup — none of them is the lever.

### `VERIFIED` 2026-09-02 — the date confound is broken; May's send path is the only unknown

Every profile-B message in the table is consistent with having been drafted by
this connector. The two profile-A messages (2026-05-25, 2026-05-27) rendered the
mark, so whatever wrote them was not this path in its current form. That send
path is unrecorded. The working explanation is that the drafting tool changed
between 2026-05-27 and 2026-06-19, not Gmail. Only May's mechanism remains
`UNVERIFIED`, and it no longer needs resolving to fix the problem.

### What this means for getting the mark back

Three options, in order of preference:

1. **Build drafts as raw MIME through the Gmail REST API** (`drafts.create`
   with `raw`), from a local script under the operator's own OAuth. The API
   stores raw MIME verbatim, so the stored draft would carry the full template.
   The operator still presses Send — this is drafting, not sending, so it stays
   inside the standing rule. **The one remaining experiment** is whether the
   compose window re-sanitises a raw-MIME draft on Send. That is the old
   "decisive experiment" with the right vehicle: it needs a draft the connector
   did not write.
2. **Paste the PNG into the compose window before Send.** Standard Gmail
   behaviour keeps pasted inline images (`UNVERIFIED` here — check on one send).
   Manual, per draft; a stopgap.
3. **Ship the text wordmark and drop the empty 48px cell** in connector-drafted
   mail, so the header sits flush instead of advertising a missing image. The
   `WiDS NYC` / magenta rule / `AI READING GROUP` lockup survives intact.

The 2026-09-02 reminder batch went out as option 3 without the cell removed.

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
| Raw RFC822 via Gmail MCP | **Drafts: available** — `get_draft` accepts `messageFormat: "RAW"` and returns the base64url MIME (verified 2026-09-02, see above). Messages: still unavailable; `get_message` offers `MINIMAL` / `FULL_CONTENT` / `METADATA_ONLY` / `PLAIN_TEXT` only. |
| Raw RFC822 via Composio | `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` with `format:"raw"` denied at the permission prompt; separately the gmail toolkit is **not linked** (`composio connections list` returns only `eventbrite`, `discord`, `firecrawl`, `supabase`, `github`). |
| Sending anything programmatically | **Not permitted, independent of tooling.** The operator has ruled that nothing here sends email as them; everything member-facing is drafted for a human to send. Gmail MCP also has no send tool, and Composio catalogues `GMAIL_SEND_EMAIL` / `GMAIL_SEND_DRAFT` on an unlinked account — but treat those as incidental. Linking the account would not make sending allowed. See [`transactional-emails.md`](transactional-emails.md). |
| `get_thread` on the staged draft's thread | `The caller does not have permission`. |

Delivered messages are still read through the MCP's parsed body (that reader
was controlled for — see the Zoom entry). Drafts can now be read raw, which is
what settled the mechanism on 2026-09-02.
