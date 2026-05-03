---
description: Research assistant for the leader to search arXiv or compare candidate papers
argument-hint: search "<query>" | compare <url1> <url2> ... | pick <suggestion_id>
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

### 4e — Audit log
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'Picked paper "<title>" for reading_group <rg_id>');
```

## Failure handling

- arXiv search returns nothing → "No results for query. Try a different phrasing."
- WebFetch on a URL fails (paywall, 404) → skip that one in compare mode; abort search if all fail.
- PDF download fails → set `paper_id` but leave `pdf_drive_url` NULL; warn leader to upload manually.
