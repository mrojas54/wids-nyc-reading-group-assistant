---
description: Generate static companion page (Mermaid walkthrough + Colab notebook) for a paper. Operator-triggered, runs after /wids-make-guide is approved.
---

# /wids-make-companion

**Inputs:** `<paper_id>` (required) or omit to default to the paper of the current `prep` meeting. Pass `--dry-run` to validate without committing.

## Step 0 — Resolve paper

If no `paper_id` argument:
```sql
SELECT paper_id FROM meetings
WHERE status='prep' AND paper_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```
Abort if null: "No active prep meeting with a paper. Run `/wids-find-paper pick <id>` first."

Load the paper:
```sql
SELECT id, title, authors, url, pdf_drive_url, abstract
FROM papers WHERE id = :paper_id;
```

If `pdf_drive_url IS NULL`, abort: "No PDF attached for paper :id. Run `/wids-find-paper pick <id>` first."

Download the PDF locally via the Drive MCP (`download_file_content` or equivalent) so subagents can read it.

## Stage 1 — Sections + vocabulary (single subagent)

Dispatch one subagent with the paper PDF and these instructions:

> Read the paper. Return JSON shaped:
> ```json
> {
>   "sections": [{"title": "...", "summary": "..."}],
>   "vocabulary": [{"term": "...", "definition": "..."}]
> }
> ```
> - `sections`: 3–7 entries. Discussion-friendly chunks: usually (1) problem, (2) prior work / motivation, (3-5) the technique broken down, (6) results, (7) limitations. Each `summary` is 2–3 sentences explaining what this part does.
> - `vocabulary`: 5–8 entries for terms a reader new to the paper would benefit from defining up front. Definitions are 1 sentence, plain language.
> - No prose outside JSON.

If `sections.length < 3`, abort with operator-facing message.

The vocabulary block is rendered by `web/app/papers/[id]/PaperCompanion.tsx` (added in phase 6) — it's optional in the schema but worth generating; the page looks bare without it.

## Stage 2 — Per-section content (parallel subagents)

For each section, dispatch a subagent in parallel with `{paper_pdf, section_title, section_summary}`:

> Return JSON: `{"mermaid": "...", "code": "..."}`.
> - `mermaid`: A valid Mermaid `flowchart` or `sequenceDiagram` showing this section's mechanism. Keep nodes short. Must parse via the `validate_and_render_mermaid_diagram` MCP tool.
> - `code`: A self-contained Python cell illustrating this section's concept. Toy inputs only. No GPU. Runs in Colab free tier in <10s. Imports at top of cell. Self-contained — no global state from other cells. Pedagogical, not realistic.

Validate each Mermaid block by calling the `validate_and_render_mermaid_diagram` MCP tool. If invalid, retry the subagent once with the parse error in the prompt. Still invalid → fall back to `flowchart LR\n  A[See paper section]`.

If a subagent fails twice, fall back to `code: "# TODO: add example for {title}"`.

## Stage 3 — Assemble + validate

Build `web/content/papers/<id>.json` matching the `PaperContent` type in `web/lib/paperContent.ts`:
```json
{
  "paper_id": <id>,
  "title": "<from papers.title>",
  "authors": [<from papers.authors>],
  "arxiv_url": "<from papers.url>",
  "notebook_path": "/notebooks/<id>.ipynb",
  "generated_at": "<now ISO>",
  "vocabulary": [<stage 1 vocabulary>],
  "sections": [<stage 2 outputs merged with stage 1 titles+summaries>]
}
```

Build `web/public/notebooks/<id>.ipynb` using `nbformat` (Python). Top-level cells:
1. Markdown: paper title, authors, arxiv link.
2. Code: `pip install` of the union of imports detected via regex `^(import |from )(\w+)` across all section code cells. Skip Python stdlib modules.
3. For each section i: Markdown cell (`## i. <title>` + summary), then code cell.

Validate notebook JSON with `nbformat.validate`. Fail if invalid.

## Operator review (HITL)

Print preview:
```
Paper: "<title>" (id: <id>)
Vocabulary: <n> terms
Section 1: Problem (diagram: 4 nodes, code: 12 lines)
  > "RNNs and CNNs were the dominant architectures..."
Section 2: Self-attention (diagram: 5 nodes, code: 18 lines)
  > "Each token attends to all others..."
...
```

Prompt: `[a] approve and publish | [r N] regenerate section N | [v] regenerate vocabulary | [c] cancel`. Loop on `r N` (re-runs Stage 2 for section N only) and `v` (re-runs the vocab subagent only).

## Publish

```bash
git add web/content/papers/<id>.json web/public/notebooks/<id>.ipynb
git commit -m "companion: paper <id> — <title>"
git push
```

Then update DB:
```sql
UPDATE papers SET companion_url = '/papers/' || :id WHERE id = :id;
```

If git push fails, leave files staged, tell operator to resolve manually, **do not** update DB.

## Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-make-companion', 'success',
        'Companion published for paper <id>: <title>');
```

On abort (missing PDF, stage failure, operator cancel):
```sql
INSERT INTO command_log (source, name, status, error)
VALUES ('slash_command', '/wids-make-companion', 'failure', '<error>');
```

## Output

```
Companion published.
- /papers/<id> live after Vercel rebuild (~30s)
- Notebook: web/public/notebooks/<id>.ipynb
- DB: papers.companion_url = '/papers/<id>'
```

## Re-runs

Idempotent. Running on a paper that already has a companion overwrites both files and `papers.companion_url`. Git history is the version history.

## Dry-run mode

`--dry-run`: run Stages 1-3 + validate, print preview, but skip the HITL loop and publish step. Used to sanity-check a new paper without making git noise.
