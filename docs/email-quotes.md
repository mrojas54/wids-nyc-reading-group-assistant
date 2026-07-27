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

## Machine-readable pool (availability + reminder emails)

The availability-reminder, availability-thanks, rsvp-confirmation,
pre-meeting reminder, and welcome-availability emails draw their quote from a
structured, verified pool under `data/quotes/<author-slug>/` (one folder per
person: `author.json` plus dated `YYYYMMDD_quotes.json` snapshots, with a
`quotes.json` symlink for humans). `scripts/build_quotes.py` validates sourcing
and emits the committed bundle `web/lib/quotes.generated.json`;
`scripts/quotes.py` (emails) and `web/lib/quotes.ts` (dashboard) select from
it. Selection considers only quotes marked `verified: true`; the build
(`scripts/build_quotes.py`) additionally requires every verified quote to carry
a `sourceUrl` and a `source` note, failing CI otherwise. Welcome-availability
pulls `quote.text` / `quote.by` only when its `quote` block is on
(`scripts/welcome_availability.py`).

For the full transactional-email template map, preview command, and
idempotency-key conventions, see
[`docs/runbooks/transactional-emails.md`](runbooks/transactional-emails.md).

The rest of this document is the **magic-link** email's manual rotation, which
is Supabase-static and intentionally separate from the pool above.

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
time to be beginners."* *(verify source — widely circulated but
thin primary-source trail)*

**Radia Perlman** — *"The fact that I'm a 'famous' person is sort of
sad. The world should have so many female engineers that it wouldn't
be at all noteworthy."*

**Barbara Liskov** — *"Designing something just powerful enough is an
art."* and *"Let go of the need to please."* — both from the Quanta
Magazine profile, 20 Nov 2019.

**Barbara Liskov** — *"You don't get to be a successful scientist
without overcoming a lot of obstacles."* *(verify source — searched the
ACM Turing interview transcript, the Quanta profile, the MIT Technology
Review profile, and Wikiquote without finding it; held at
`verified: false` in `data/quotes/barbara-liskov/`)*

**Frances Allen** — *"Focus on your work, not your career — that will
happen later."* — ACM-W spotlight, interview by Bettina Bair.

**Frances Allen** — *"My advice to the young women of today is to
look beyond their immediate environment and to find the courage to do
what they think is important."* *(verify source — her documented ACM-W
advice reads differently; held at `verified: false`)*

**Joan Clarke** — *"It was easy to make decisions for myself, harder
to make them for others."* *(verify source — Clarke was bound by the
Official Secrets Act for decades and left almost no written public
record; this quote has no traceable primary source)*

**Hedy Lamarr** — *"The brains of people are more interesting than
the looks, I think."*

**Mary Allen Wilkes** — *"I had a lot of adventures that young men
would never have had, because they would have been on the straight and
narrow."* and *"Programmers were all women and they were fungible."* —
both from her Computer History Museum oral history, 28 July 2021.

**Mary Allen Wilkes** — *"I have to say that I think the world has
gotten more interesting for women."* *(verify source — not in part 1 of
the CHM oral history transcript; part 2 unchecked, and it may come from
her 2019 Wellesley colloquium or a podcast, neither transcribed. Held at
`verified: false`)*

## Sourcing rule

Prefer quotes the operator has independently verified — apocryphal
"famous person said X" lines are common online. When unsure, leave
the current quote in place.

Entries marked *(verify source — …)* have thin or non-existent
primary-source trails and should be sourced (or replaced) before
rotation into the live template.

## Reversing an apocryphal rotation

If a quote turns out to be apocryphal after it has been rotated into
the live Supabase template: edit the template back to the previous
quote (or to the seed Grace Hopper quote) immediately, and remove
the offending entry from this file with a brief note in the commit
message.
