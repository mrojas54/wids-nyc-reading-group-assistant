---
description: Research assistant for the leader to search arXiv or compare candidate papers
argument-hint: search "<query>" | compare <url1> <url2> ... | pick <suggestion_id> | suggest [--top N] [--limit M]
---

# /wids-find-paper

Three sub-modes: `search`, `compare`, `pick`.

## Step 1 — Find the active reading_group

```sql
SELECT id, leader_id FROM meetings
WHERE type='reading_group' AND status='prep' AND leader_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row: halt: "No reading_group with a leader yet. Run `/wids-pick-leader` first."

## Step 2 — Sub-mode: search

Invocation: `/wids-find-paper search "RAG evaluation"`

### 2a — Read group topics for search bias
```sql
SELECT name FROM topics ORDER BY weight DESC;
```

### 2b — Search arXiv via WebFetch
Construct an arXiv search URL like:
`https://arxiv.org/search/?searchtype=all&query=<encoded_query>&start=0`

Optionally bias with topic names: e.g., `"<query> <topic1> OR <topic2>"`.

WebFetch the search result page. Parse out the top 5 papers (title, authors, abstract, arXiv ID, year).

### 2c — Insert candidates into papers + paper_suggestions

For each candidate:
```sql
-- Find or create paper by URL (no UNIQUE constraint on papers.url in V1, so check first)
SELECT id FROM papers WHERE url = '<arxiv_url>';
-- If no row:
INSERT INTO papers (title, url, abstract, authors, venue, year)
VALUES ('<title>', '<arxiv_url>', '<abstract>', ARRAY[<authors>], 'arXiv', <year>)
RETURNING id;
-- Capture paper_id either way

INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source, notes)
VALUES (<rg_id>, <paper_id>, NULL, 'agent', '<background_assessment>')
ON CONFLICT (meeting_id, paper_id) DO NOTHING
RETURNING id;
-- Capture suggestion_id for display
```

### 2d — Generate background-level assessment

For each candidate, write a 2-3 sentence assessment as the `notes` field. Example:
"Background needed: comfort with variational inference, basics of diffusion models, intro-level information theory. Would feel rough for members new to generative modeling. Accessibility: medium."

(Done by Claude analyzing the abstract — no separate skill required.)

### 2e — Present to leader

```
Found <N> candidates:

[#<sugg_id>] <title> (<year>, <venue>)
  Authors: <authors>
  Abstract: <truncated abstract>
  Background needed: <notes>

[#<sugg_id>] ...

Pick one with: `/wids-find-paper pick <suggestion_id>`
Or run again with a refined query.
```

## Step 3 — Sub-mode: compare

Invocation: `/wids-find-paper compare <url1> <url2> ...`

### 3a — Fetch each URL via WebFetch
Extract title, authors, abstract, year, venue.

### 3b — Insert into papers + paper_suggestions (source='leader')
Same as 2c but `source='leader'` and `suggested_by=<leader_id>`.

### 3c — Generate background assessments and side-by-side
Render comparison table:
```
                            Paper A          Paper B          Paper C
Title                       ...              ...              ...
Year/Venue                  ...              ...              ...
Background needed           ...              ...              ...
Discussion potential        ...              ...              ...
```

Then list each as suggestion: "Pick with: `/wids-find-paper pick <id>`"

## Step 4 — Sub-mode: pick

Invocation: `/wids-find-paper pick <suggestion_id>`

### 4a — Validate
```sql
SELECT s.id, s.paper_id, p.title, p.url
FROM paper_suggestions s
JOIN papers p ON p.id = s.paper_id
WHERE s.id = <suggestion_id> AND s.meeting_id = <rg_id>;
```

If no row: halt: "Invalid suggestion ID for this reading group."

### 4b — Update reading_group with chosen paper
```sql
UPDATE meetings SET paper_id = <paper_id> WHERE id = <rg_id>;
```

### 4c — Download paper PDF to Drive

If `papers.url` looks like an arXiv URL, derive the PDF URL (e.g., `https://arxiv.org/abs/2308.07037` → `https://arxiv.org/pdf/2308.07037.pdf`).

Use the Drive MCP to:
1. Create the cycle subfolder if not yet existing: `WiDS NYC AI Reading Group/cycles/<YYYY-MM>-meeting/` (use the reading_group's planned month — derive from the admin meeting's `scheduled_at` + 1 month, or use today's month + 1 if unknown).
2. Download the PDF (WebFetch the PDF URL) and upload to the cycle subfolder as `paper.pdf`.
3. Capture the Drive URL of the uploaded PDF.

### 4d — Update papers and meetings

```sql
UPDATE papers SET pdf_drive_url = <drive_url> WHERE id = <paper_id>;
UPDATE meetings SET drive_folder_url = <cycle_folder_url> WHERE id = <rg_id>;
```

### 4d.5 — Auto-tag with topics

Read the existing topic list:

```sql
SELECT id, name FROM topics ORDER BY weight DESC;
```

If zero rows: skip this step entirely (no Claude call, no INSERT). Print one line: `"Note: topics table is empty; skipping topic tagging."` This indicates wids-bootstrap was never run or topics were deleted; not a fail state.

Otherwise, read the paper's title and abstract (from the `papers` row) and run this prompt against Claude:

> Given this paper's title and abstract, pick 0–3 topics from the list below that the paper is *primarily* about (not just mentions). Return the topic NAMES exactly as they appear in the list, as a JSON array of strings. Use existing names only — do not invent new topics. If no topic clearly fits, return `[]`. Prefer fewer, more confident matches over many weak ones.
>
> Title: `<title>`
>
> Abstract: `<abstract>`
>
> Topics: `<topic_name_1>, <topic_name_2>, ...`

Parse Claude's response:

1. Try to parse as JSON. If parsing fails (malformed JSON, prose response, etc.), treat as `[]` and log a warning.
2. Validate each name against the topics list using **case-insensitive match**. Discard any name not in the list (hallucination guard).
3. Map validated names back to their canonical IDs.

Insert the validated rows:

```sql
INSERT INTO paper_topics (paper_id, topic_id)
SELECT $paper_id, t.id
FROM topics t
WHERE LOWER(t.name) = ANY($lowered_validated_names)
ON CONFLICT (paper_id, topic_id) DO NOTHING;
```

Where `$lowered_validated_names` is a TEXT[] of validated names converted to lowercase.

Capture the canonical names that were actually inserted (for the user-facing message and audit log).

If validated set is empty (Claude returned `[]`, all names were hallucinations, or response was malformed), log a one-line warning and continue. No tagging is acceptable — the rest of `pick` (Step 4e) proceeds normally.

### 4e — Audit log
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'Picked paper "<title>" for reading_group <rg_id>; '
        'tagged with topics: <names_joined>');
```

Where `<names_joined>` is a comma-separated list of the canonical topic names that were inserted in 4d.5, or the literal string `no topics` if the validated set was empty.

### 4f — Render to leader

When topics were tagged in Step 4d.5 (validated set is non-empty), print:

```
Picked paper "<title>" for reading_group <rg_id>.
Tagged with topics: <names_joined>
PDF downloaded to: <drive_url>
```

When no topics were tagged (validated set is empty for any reason — empty topics table, all hallucinations, malformed Claude response), print:

```
Picked paper "<title>" for reading_group <rg_id>.
Tagged with no topics (none of the existing topics fit clearly).
PDF downloaded to: <drive_url>
```

## Step 5 — Sub-mode: suggest

Invocation: `/wids-find-paper suggest [--top N] [--limit M]`

Defaults: `--top 10`, `--limit 50`. Validation: `top` in `[1, 50]`, `limit` in `[10, 200]`, `top ≤ limit`. On invalid args, halt with usage hint and don't make HTTP calls.

### 5a — Load past read papers

```sql
SELECT p.id AS paper_id, p.title, p.url, m.scheduled_at
FROM meetings m JOIN papers p ON p.id = m.paper_id
WHERE m.type='reading_group' AND m.status='done' AND p.url IS NOT NULL;
```

If zero rows: halt with `"No past readings yet — suggest needs at least one completed reading_group. Use /wids-find-paper search \"<query>\" for the first cycle."`

### 5b — Resolve URLs to S2 paper IDs

For each row, derive an S2 paper ID:

1. arXiv URL → `ARXIV:<id>` (regex: `arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?(?:\.pdf)?`, strip version suffix).
2. DOI extractable → `DOI:<doi>` (regex: `\b(10\.\d{4,9}/[^\s/?#]+)`).
3. Otherwise → mark unresolvable; record paper_id, title, host for the user-facing note.

If zero papers resolve: halt with `"No past readings have arXiv or DOI URLs. /wids-find-paper suggest needs at least one resolvable past paper. Use search instead."`

### 5c — Load cached embeddings

```sql
SELECT paper_id, vector
FROM paper_embeddings
WHERE paper_id = ANY($resolved_paper_ids) AND model = 'specter_v2';
```

The vector type returns as a string like `'[0.012,-0.034,...]'`; parse into a Python float list per paper_id.

### 5d — Build helper input and invoke

Construct the JSON payload:

```json
{
  "past_papers": [
    {"paper_id": <int>, "s2_paper_id": "<ARXIV:... or DOI:...>", "title": "<title>"}
  ],
  "cached_embeddings": {"<paper_id_str>": [<floats>], ...},
  "top": <N>,
  "limit": <M>
}
```

Pipe into the helper:

```bash
uv run --with httpx --with numpy --with pydantic --with tenacity \
    scripts/find_paper_suggest.py
```

Expected: exit 0 with JSON on stdout (`Output` schema). Exit 1 indicates a hard failure; render the stderr message to the leader and write a `command_log` failure entry (5i).

### 5e — UPSERT new embeddings

For each entry in `embeddings_to_cache`:

```sql
INSERT INTO paper_embeddings (paper_id, model, vector)
VALUES ($paper_id, $model, $vector)
ON CONFLICT (paper_id, model)
DO UPDATE SET vector = EXCLUDED.vector, cached_at = now();
```

The `vector` value must be passed as a pgvector literal — string format `'[v1,v2,...]'`.

### 5f — Replace prior agent suggestions for this reading_group

```sql
DELETE FROM paper_suggestions
WHERE meeting_id = $rg_id AND source = 'agent';
```

### 5g — For each candidate, find-or-create paper + insert suggestion

For each candidate in the helper output:

1. Find or create the paper row by URL (mirror Step 2c pattern). The candidate's URL is `https://arxiv.org/abs/<arxiv_id>` if `arxiv_id` is set, else use the S2 paper URL `https://www.semanticscholar.org/paper/<s2_paper_id>`.

   **Escaping note:** SS-supplied abstracts and titles routinely contain apostrophes (`q-net`, `we've`, `arms' embedding`, `LLM's`) that break naïve single-quoted SQL. **Use PostgreSQL dollar-quoting** for `title`, `abstract`, and any other free-text fields — pick a tag unlikely to appear in academic text (e.g., `$wids_text$<value>$wids_text$`). The 2026-05-07 smoke test lost 6 of 10 abstracts to single-quoting; dollar-quoting prevents this entirely.

2. Generate the background-needed assessment by reading the abstract — same pattern as Step 2d.

3. Build the `notes` field. If `matched_past_paper_id` is non-null:

```
Most similar to: "<matched_past_paper_title>" (paper #<matched_past_paper_id>, read <YYYY-MM-DD>) — cosine <cosine:.2f>
Background: <assessment>
```

If `matched_past_paper_id` is null (no rationale available):

```
Background: <assessment>
```

4. Insert:

```sql
INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source, notes)
VALUES ($rg_id, $paper_id, NULL, 'agent', $notes)
ON CONFLICT (meeting_id, paper_id) DO NOTHING
RETURNING id;
```

Capture the returned suggestion id for display.

### 5h — Render output to leader

```
Found <N> candidates (similar to <K> of <M> past readings; SPECTER2 cosine; MMR λ=0.6):
```

If there were unresolvable past papers (Step 5b's third bucket), prefix with the partial-degradation note:

```
Note: <count> past readings excluded (no arXiv ID or extractable DOI):
  - "<title>" (<host>)
  - ...

Suggestions below are based on the remaining <K> of <M> past readings.
```

For each candidate (in helper-returned order):

```
[#<sugg_id>] <title> (arXiv:<arxiv_id>, <year>)
      Most similar to: "<matched_past_paper_title>" (read <date>) — cosine <cosine:.2f>
      Background: <assessment>
```

If `arxiv_id` is null (the candidate is not on arXiv — e.g., a Nature or ACM paper),
replace the `arXiv:<arxiv_id>` parenthetical with `S2:<s2_paper_id[:8]>` so the
header line still has an identifier. Example: `[#42] Title (S2:abc12345, 2026)`.

If matched_past_paper_id is null, omit the "Most similar to" line.

End with:

```
Pick one with: /wids-find-paper pick <id>
Or refine with: /wids-find-paper suggest --top 15 --limit 80
```

Surface any warnings from the helper output before the candidate list.

### 5i — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'suggest: <N> candidates inserted for reading_group <rg_id> '
        '(based on <K>/<M> past readings, SS Recommendations API, '
        'MMR λ=0.6, replaced <prior_count> prior agent rows)');
```

On failure (helper exit 1 or any DB write error):

```sql
INSERT INTO command_log (source, name, status, error)
VALUES ('slash_command', '/wids-find-paper', 'failure', '<message>');
```

## Failure handling

- arXiv search returns nothing → "No results for query. Try a different phrasing."
- WebFetch on a URL fails (paywall, 404) → skip that one in compare mode; abort search if all fail.
- PDF download fails → set `paper_id` but leave `pdf_drive_url` NULL; warn leader to upload manually.
