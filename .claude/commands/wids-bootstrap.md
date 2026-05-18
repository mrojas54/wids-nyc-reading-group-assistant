---
description: One-time setup — verifies prerequisites, seeds members + topics, kicks off cycle 1
---

# /wids-bootstrap

This command walks the operator through one-time setup of the WiDS NYC AI reading group assistant. Run it once. After that, all other `/wids-*` commands assume bootstrap completed.

## Step-by-step

### Step 1 — Verify Supabase connection

Use the Supabase MCP to run:
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('members','topics','papers','paper_topics','meetings',
                     'volunteers','availability','meeting_attendance',
                     'paper_suggestions','command_log');
```

The result must be `10`. If less, tell the operator to apply `migrations/001_initial_schema.sql` via the Supabase SQL Editor and re-run bootstrap.

### Step 2 — Verify schema is empty

Run:
```sql
SELECT count(*) FROM members;
```

If this returns > 0, halt with: "Bootstrap has already been run. Delete all rows manually if you want to re-bootstrap."

### Step 3 — Get Drive root folder

Ask the operator: "Paste the URL of your `WiDS NYC AI Reading Group` Drive folder."

Validate it looks like a Drive folder URL (`https://drive.google.com/drive/folders/...`). Store the folder ID for later. Drive folder URL is referenced by per-cycle records, not stored centrally in V1.

### Step 4 — Operator details

Ask: "What's your name and email? (You'll be the operator.)"

Insert the operator row:
```sql
INSERT INTO members (name, email, role, active)
VALUES ('<name>', '<email>', 'operator', true);
```

### Step 5 — Member import

Ask: "Paste members as CSV with columns `name,email,phone,whatsapp` (one per line, no header). Leave phone/whatsapp blank if not known. Send 'done' when finished."

Parse and INSERT each. Skip rows with empty name or email. Skip the operator's email (already inserted). UPSERT to avoid duplicates:
```sql
INSERT INTO members (name, email, phone, whatsapp, active, role)
VALUES (...) ON CONFLICT (email) DO NOTHING;
```

Confirm count: "Inserted N members. Plus you as operator. Total: M active members."

### Step 6 — Topic seeding

Display the curated ML genres list:

```
[ ] LLMs / Foundation Models
[ ] RAG / Retrieval
[ ] Agents / Tool Use
[ ] Diffusion / Generative Models
[ ] Reinforcement Learning
[ ] Multimodal Learning
[ ] Computer Vision
[ ] NLP (general)
[ ] Speech / Audio
[ ] Recommendation Systems
[ ] Time Series / Forecasting
[ ] Tabular / Classical ML
[ ] Causal Inference
[ ] Bayesian / Probabilistic Modeling
[ ] Theory / Learning Theory
[ ] Fairness / Ethics / Safety
[ ] Interpretability / Mech Interp
[ ] Evaluation / Benchmarks
[ ] Efficient ML / Quantization
[ ] Graph Neural Networks
[ ] Self-Supervised Learning
[ ] Healthcare / Medical AI
[ ] Robotics
[ ] Climate / Sustainability AI
```

Ask: "Reply with a comma-separated list of the topics you want to track. You can also add custom topics (e.g., 'Mechanistic Interpretability, Custom: Hawkes processes')."

INSERT each with weight=1:
```sql
INSERT INTO topics (name, weight) VALUES ('<topic>', 1)
ON CONFLICT (name) DO NOTHING;
```

### Step 7 — Output scheduled task registration instructions

Print:

```
Bootstrap complete!

Next: register the 6 active scheduled background tasks. The prompts are in
`scheduled_tasks/`. For each, register it via the scheduled-tasks MCP
with daily cron and Supabase credentials available as env vars
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

  - cycle-keep-alive
  - availability-chase
  - pre-meeting-reminder
  - meeting-auto-advance
  - post-meeting-thanks
  - calendar-rsvp-sync

Do not register `leader-nudge`; that prompt is deprecated and superseded
by the Paper Pal companion flow.

Once registered, run `/wids-meeting-start admin` to kick off cycle 1.
```

### Step 8 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-bootstrap', 'success',
        'Operator + N members + M topics seeded');
```

## Failure handling

Any SQL error → log to `command_log` with `status='failure'` and the error message; halt and surface error to operator. Do not partial-write.
