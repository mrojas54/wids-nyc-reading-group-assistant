# HANDOFF — why does the WiDS mark reach members in May but not later?

**Status (2026-09-02): mechanism established.** The Gmail MCP `create_draft`
path strips every `<img>`, `<svg>`, `<style>`, class and MSO conditional and
rewrites every href **when it writes the draft** — before any human opens it.
Verified by reading two drafts back raw (`get_draft` has a `RAW` format;
`get_message` does not). Full entries, message IDs and method in the runbook.
The composer-vs-API framing below is superseded: the connector never stores the
mark in the first place, so nothing downstream can render it. `cid:` with a real
inline part is stripped too.

**What is still open:** only whether a draft built as raw MIME through the Gmail
REST API survives the compose window's Send. `scripts/gmail_raw_drafts.py`
builds such drafts (setup, usage and the experiment procedure in
[`docs/runbooks/gmail-raw-drafts.md`](docs/runbooks/gmail-raw-drafts.md)); one
send to yourself settles it. Everything under "The decisive experiment" below
is kept for the record but is no longer the plan.

**Immediate consequence for operators:** connector-drafted mail cannot carry the
mark. Either paste the PNG into the compose window before Send, or accept the
text wordmark. The runbook lists the options in order of preference.

**Scope note:** this is the image/rendering investigation plus the template
comment cleanup it triggered. Design standardization — migrating
`availability-reminder` onto the paper-note system, reconciling CTA colours and
mark sizes across the suite — is **deliberately out of scope**.

**Evidence now lives in [`docs/runbooks/email-client-behavior.md`](docs/runbooks/email-client-behavior.md)**,
dated, with the message ID and method behind every claim. This file is the live
state: what is open, what to do next, what not to redo.

---

## The question

Every member-facing template embeds the mark the same way: a plain remote
`<img>` pointing at `wids-nyc-reading-group-assistant.vercel.app/branding/`.
In messages delivered in May the mark renders. In later messages the `<img>`
element is **absent from the delivered HTML entirely** — not merely unloaded.
Nobody has established what changed.

---

## What changed this session

### 1. The regression window narrowed to 24 days

The 2026-06-19 `pre-meeting-reminder` batch was fetched and read. It **also lost
the mark** (`19ee0c32df57e57a`, to `asthashie@gmail.com` — the same member as the
working 2026-05-25 send). Last known good is 2026-05-27; first known bad is now
2026-06-19, not 2026-07-14.

### 2. The loss is whole-document, not image-specific

This is the substantive reframe. Mark-absent messages differ from mark-present
ones in **four** ways at once:

| Marker | mark renders | mark absent |
|---|---|---|
| `<img>` mark | present | absent |
| `href` form | plain | rewritten through `google.com/url?q=…&source=gmail` |
| `class` attributes | present, Gmail-namespaced `m_<id>…` | none at all |
| hidden preheader `<div>` | present | absent |

Whatever produces the bad profile drops the `<style>` block, the preheader and
every `<img>`. **"The mark disappears" was too narrow a framing** — a fix aimed
at the image alone addresses one symptom of four. That also explains why no
`src` scheme rescues it.

### 3. The date confound is still NOT broken

Worth stating plainly, because narrowing the window is easy to over-read: every
good message still predates every bad one. Calendar time predicts the outcome
exactly as well as any mechanism story. Nothing this session separated them.

### 4. A previous conclusion was wrong — the refuted claim WAS copied

The earlier pass searched the suite for the dot-grid claim's wording, found only
`welcome-availability`, and concluded it had not spread. **That was wrong.**
`pre-meeting-reminder.html` drops the same dotted grid for the same reason
("clients strip background-images") — the search matched strings, not the belief.
That template's design deviation rests on a premise `rsvp-confirmation` disproves.
It has been annotated; reinstating its grid is design work and stays out of scope.

Lesson: grepping a wrong claim's wording does not find the places that acted on it.

### 5. Head comments shipped in delivered mail — and were leaking values — **DONE**

Found while smoke-testing: `scripts/render_email_previews.py` did **not** strip
HTML comments (unlike `scripts/welcome_availability.py`, which already did). So
every head comment shipped inside the delivered email, and any `{{ token }}`
written in live syntax inside a comment got substituted. `rsvp-confirmation`'s
comment was rendering as *"Template tokens are Mustache-style (**Maya**)"* — a
real recipient's first name, shipped in a comment, in every send.

Interim mitigation: de-delimited 17 tokens across four templates
(`availability-reminder`, `magic-link`, `pre-meeting-reminder`,
`rsvp-confirmation`). Bodies untouched.

**Structural fix landed** in `97c7482` (`fix(email): strip HTML comments before
substitution on every send path`):

- Shared helper `scripts.render_email_previews.strip_html_comments()` lifts
  Outlook conditionals to sentinels, strips the rest, restores conditionals.
- Call sites before substitution: `render_pair()`,
  `welcome_availability.compose()` (via a thin wrapper that maps
  `RenderError` → `CompositionError`), and
  `generate_prerequisites.render_new_paper_email()`.
- `.txt` twins are untouched; their doc headers use `[[BEGIN:_doc]]` blocks.
- Canonical contract: `docs/runbooks/transactional-emails.md` (Architecture).
- Coverage: `tests/render_email_previews_test.py` and
  `tests/welcome_availability_test.py`.

Do **not** reopen this as open work. New send paths must call the shared
stripper before substitution — that rule is now the remaining constraint.

---

## Established by observation (high confidence)

Full table with message IDs is in the runbook. Summary:

| Date | Template | Mark |
|---|---|---|
| 2026-05-25 | availability-reminder | **renders** |
| 2026-05-27 | rsvp-confirmation | **renders** |
| 2026-06-19 | pre-meeting-reminder | absent |
| 2026-07-14 | new-paper-announcement | absent |
| 2026-07-26 | welcome-availability | absent |
| 2026-07-27 | welcome-availability (real member) | absent |
| 2026-07-27 | MARK TEST (cid / https / data) | absent |

Settled: **recipient is not the variable**; **template design is not the
variable**; **`<img>` is stripped by tag, not by `src` scheme**; the assets are
live; the MCP reader is not the thing stripping images.

---

## Not established

- **Why.** See §3 above.
- **The send mechanism of any message in the table.** Unknown for all seven.

### Leading hypothesis (unproven — treat as a lead, not a finding)

That messages sent programmatically keep the mark and messages sent by pressing
Send in the Gmail compose window lose it, because the composer re-parses the HTML
into an editable DOM and drops what it cannot represent.

The four-marker footprint in §2 is *consistent* with an editable-DOM round-trip —
`<style>`, classes, preheader and `<img>` are all things it would lose. That is
corroboration, not proof. Evidence against taking it as settled:

- The 2026-05-25 message's plain-text part is a flattening derived from its HTML,
  not the hand-wrapped `.txt` twin — itself a claimed composer signature. That
  message may have gone through the composer and kept its mark anyway.
- The only documentary support was `scheduled_tasks/availability-chase.md`
  Step 5c, which was independently wrong and has now been corrected (see below).

---

## The decisive experiment — SUPERSEDED 2026-09-02

Kept for the record. The mechanism was found by reading drafts back raw instead;
see the status block at the top and the runbook. The experiment below would have
compared two sends of a connector-written draft, and both would have lost the
mark, because the draft never had it.

Requires one setup step the operator must run:

```bash
composio link gmail
```

Then send **the same draft twice on the same day** — once via `GMAIL_SEND_DRAFT`,
once by pressing Send in the Gmail compose window. Same template, same recipient,
same date. That holds everything constant except mechanism, which is precisely
what the May-vs-June sample cannot do.

### ⚠ Check the staged draft first

A draft is staged for this: **`r3011218909851369227`** — `welcome-availability`,
all six optional blocks on, addressed to `mirojas1524@gmail.com`.

`list_drafts` returned a `plaintextBody` and **no `htmlBody`** for it. That is not
conclusive — `list_drafts` may not serialise the field, and `get_thread` on its
thread (`19fa1c376c719b34`) returns `The caller does not have permission`, so it
could not be cross-checked. But **if the draft has no HTML part, sending it proves
nothing about HTML handling.** Confirm before spending the experiment on it;
recreate it with `create_draft`'s `htmlBody` parameter if needed.

Also odd, and worth understanding: that draft's *plain-text* part already carries
URLs rewritten through `google.com/url?q=…&source=gmail`, in an unsent draft.
Whatever applies that rewrite happens at or before draft creation, not at send.

| Outcome | Conclusion |
|---|---|
| API keeps mark, composer loses it | Mechanism confirmed. Route member mail through the API. |
| Both keep it | Calendar time was the variable; something changed at Gmail. Re-examine. |
| Both lose it | Neither mechanism nor date. Look at the templates and asset URLs again. |

---

## Blocked paths — do not burn time rediscovering these

Listed with current state in the runbook. In short: raw RFC822 **is** available
for drafts via the Gmail MCP (`get_draft` with `messageFormat: "RAW"`, found
2026-09-02) but not for messages; Composio denied and gmail toolkit unlinked; no
send tool anywhere available to the agent; `get_thread` on the staged draft's
thread is permission-denied.

---

## Key files

| Path | Why it matters |
|---|---|
| `docs/runbooks/email-client-behavior.md` | **New.** Dated client-behaviour findings, with message IDs. The canonical record now. |
| `assets/emails/template/welcome-availability.html` | Head comment cut 51%; refuted claims removed. |
| `assets/emails/template/pre-meeting-reminder.html` | Carries the semantic duplicate of the refuted dot-grid claim, now annotated. |
| `scheduled_tasks/availability-chase.md` | Step 5c corrected — both occurrences. |
| `.claude/commands/wids-add-member.md` | Line 239 documents the no-send capability limit correctly; used as the wording source. |
| `docs/runbooks/transactional-emails.md` | Per-template contract and which are draft-only. |
| `scripts/welcome_availability.py` | The composer. Never mail the template through `render()` directly. |
| `scripts/render_email_previews.py` | Owns `strip_html_comments()`; `render_pair()` strips HTML before substitution — see §5. |
| `scripts/generate_prerequisites.py` | Announcement send path; also strips via the shared helper. |

---

## Template comment cleanup — DONE

Both problems the previous handoff identified have been treated.

### Problem 1 — size. One file. **Done.**

| | before | after |
|---|---|---|
| `welcome-availability.html` head comment | 14,986 chars / 222 lines / **42%** of file | 7,359 chars / ~101 lines / **26%** of file |
| ratio to next-largest template | 7× | 3.5× |
| `welcome-availability.txt` `_doc` block | 2,211 chars | 1,566 chars |

A second pass then cut the other six as well. The original "leave them, they're
only 6–12% of their files" call was **wrong metric** — these files are mostly
inline-style boilerplate, so share-of-file makes any amount of prose look small.
Measured as prose a maintainer must keep true, they were carrying changelog and
duplicated contract:

| | before | after |
|---|---|---|
| the six (excl. welcome-availability) | 9,009 chars | 7,848 chars (−13%) |
| all seven head comments | 23,995 chars | 15,207 chars (−37%) |

What came out: `magic-link`'s "History:" block and `availability-reminder`'s
"v2 deltas vs v1" list (both pure git-in-a-comment), and the inline token lists
in `availability-thanks`, `rsvp-confirmation` and `new-paper-announcement`.

Those token lists now live once in `docs/runbooks/transactional-emails.md` under
**Token contracts**. An audit while collapsing them found `pre-meeting-reminder`
had five tokens (`meeting.when`, `meeting.dayName`, `meeting.location`,
`meeting.leader`, `paper.subtitle`) documented **nowhere at all** — that gap is
now closed too.

Verified after: `scripts.welcome_availability` and `scripts.render_email_previews`
both pass, 38 tests green, and every token used in any template body resolves to
a documented contract.

### Problem 2 — rot risk. **Done.**

Volatile client-behaviour claims moved to
`docs/runbooks/email-client-behavior.md` with dates, message IDs and methods.
Per template:

| template | action taken |
|---|---|
| welcome-availability | Refuted dot-grid claim and superseded `cid:` claim removed. ~75 lines of client-behaviour narrative replaced by a pointer. Stable rationale (design deviations, block markers, token contract) kept inline. |
| magic-link | The claim that `<img>` "renders the mark in every modern client" — now contradicted by delivered mail — replaced with an explicit correction and pointer. |
| pre-meeting-reminder | "Clients strip background-images" marked REFUTED inline with the disproving message ID; the inherited SVG claim marked unverified. |
| availability-reminder | Outlook claim re-attributed to the handoff rather than stated as fact; pointer added. |
| rsvp-confirmation, new-paper-announcement, availability-thanks | No client-behaviour claims. Comment-token leak fixed in rsvp-confirmation. |

The governing rule, now stated at the top of the runbook: **every claim carries a
date, the message ID it was verified against, and how it was verified.**

---

## Out of scope

Design standardization beyond the mark-rendering investigation. As of PR #135
the wordmark (48×48 mark + lockup) and CTA *skeleton* are shared fragments —
see `docs/runbooks/transactional-emails.md` § Shared fragments. What remains
out of scope for *this* investigation:

- `availability-reminder`'s magenta `#c8226d` CTA color (deliberate
  design-system exception; still per-template via `cta.bg` /
  `cta.borderColor`).
- Reinstating `pre-meeting-reminder`'s dotted grid now that its stated reason
  is refuted.
- Broader CTA-label / footer-link reconciliation (functional per-template
  differences, not drift).
