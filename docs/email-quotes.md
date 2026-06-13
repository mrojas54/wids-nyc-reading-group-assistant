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

The availability-reminder, availability-thanks, rsvp-confirmation, and
pre-meeting reminder emails draw their quote from a structured, verified pool
under `data/quotes/<author-slug>/` (one folder per person: `author.json` plus
dated `YYYYMMDD_quotes.json` snapshots, with a `quotes.json` symlink for
humans). `scripts/build_quotes.py` validates sourcing and emits the committed
bundle `web/lib/quotes.generated.json`; `scripts/quotes.py` (emails) and
`web/lib/quotes.ts` (dashboard) select from it. Only quotes marked
`verified: true` with a `sourceUrl` are eligible — the build fails CI otherwise.

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

**Barbara Liskov** — *"You don't get to be a successful scientist
without overcoming a lot of obstacles."*

**Frances Allen** — *"My advice to the young women of today is to
look beyond their immediate environment and to find the courage to do
what they think is important."*

**Joan Clarke** — *"It was easy to make decisions for myself, harder
to make them for others."* *(verify source — Clarke was bound by the
Official Secrets Act for decades and left almost no written public
record; this quote has no traceable primary source)*

**Hedy Lamarr** — *"The brains of people are more interesting than
the looks, I think."*

**Mary Allen Wilkes** — *"I have to say that I think the world has
gotten more interesting for women."*

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
