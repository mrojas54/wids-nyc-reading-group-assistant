---
description: End-to-end simulation of one full cycle in a separate Supabase project for smoke testing
---

# /wids-simulate-cycle

Walks through the entire workflow with mocked external calls, against a separate Supabase project, to verify everything wires up end-to-end. Doesn't send real emails or create real Calendar events.

## Prerequisites

- A second Supabase project (different from production), with the schema applied. Set its URL/key in env vars `SIM_SUPABASE_URL` and `SIM_SUPABASE_SERVICE_ROLE_KEY`.
- A "dry-run" mode for Gmail/Calendar MCPs OR a separate test Gmail account whose sends are noisy but inconsequential.

## Step 1 — Confirm separate project

Print: "This will write 8 fake members + 1 cycle to <SIM_SUPABASE_URL>. Reply 'go' to proceed (or 'use prod' to bail out)."

Halt unless 'go'.

## Step 2 — Seed members (8 fakes + 1 operator)

```sql
INSERT INTO members (name, email, role, active) VALUES
  ('Sim Operator',  'sim-op@example.test',  'operator', true),
  ('Sim Member 1',  'sim1@example.test',    'member',   true),
  ('Sim Member 2',  'sim2@example.test',    'member',   true),
  ('Sim Member 3',  'sim3@example.test',    'member',   true),
  ('Sim Member 4',  'sim4@example.test',    'member',   true),
  ('Sim Member 5',  'sim5@example.test',    'member',   true),
  ('Sim Member 6',  'sim6@example.test',    'member',   true),
  ('Sim Member 7',  'sim7@example.test',    'member',   true),
  ('Sim Member 8',  'sim8@example.test',    'member',   true);
```

## Step 3 — Seed topics

```sql
INSERT INTO topics (name) VALUES
  ('LLMs / Foundation Models'),
  ('RAG / Retrieval'),
  ('Diffusion / Generative Models'),
  ('Causal Inference');
```

## Step 4 — Walk the cycle (with mocks)

For each step below, print "Simulating: <command>" and run the SQL/MCP calls but with mocks for external sends:

1. **`/wids-meeting-start admin`** — creates admin + reading_group rows.
2. **Seed availability directly** (in production, members submit via the portal at `${PORTAL_URL}/availability`, which writes directly to the `availability` table). Insert 8 rows: 6 members covering Tue 7pm; 2 conflicting:
   ```sql
   INSERT INTO availability (meeting_id, member_id, range_start, range_end) VALUES
     (<admin_id>, 1, '2026-05-12 19:00 ET', '2026-05-12 21:00 ET'),
     (<admin_id>, 2, '2026-05-12 19:00 ET', '2026-05-12 21:00 ET'),
     -- ... etc, 6 covering, 2 with different ranges
     ;
   ```
3. **`/wids-schedule-admin`** — verify it picks Tue 7pm (covering window) and confirm with simulated 'go'.
4. **Seed volunteers**:
   ```sql
   INSERT INTO volunteers (meeting_id, member_id) VALUES
     (<rg_id>, 3), (<rg_id>, 5), (<rg_id>, 7);
   ```
5. **`/wids-pick-leader`** — verify longest-gap picks member 3 (never led in this fake history; ties broken by random).
6. **`/wids-find-paper search "RAG evaluation"`** — verify candidates are inserted into `papers` and `paper_suggestions`. Pick the first one.
7. **`/wids-meeting-start reading_group`** — verify the rg row's portal-link email is sent (mocked).
8. **Seed availability for the reading_group**.
9. **`/wids-schedule-reading-group`** — simulate 'go' + venue.
10. **`/wids-make-guide`** — verify both PDFs land in the cycle Drive folder. (If running against real Drive: use a dedicated `WiDS NYC AI Reading Group SIMULATION/` folder.)
11. **`/wids-send-packets`** — verify Gmail draft is created (not sent automatically; manual confirm).

## Step 5 — Verify final state

```sql
SELECT m.id, m.type, m.status, m.scheduled_at, m.location, m.leader_id, m.paper_id
FROM meetings m ORDER BY m.created_at;

SELECT count(*) FROM command_log WHERE ran_at > now() - interval '1 hour';
```

Expected:
- 2 meetings (1 admin scheduled, 1 reading_group scheduled)
- ~10+ command_log entries

## Step 6 — Cleanup option

Print: "Simulation complete. Reply 'cleanup' to wipe simulation rows, or 'keep' to leave for inspection."

On 'cleanup':
```sql
TRUNCATE command_log, paper_suggestions, paper_topics, papers, meeting_attendance, availability, volunteers, meetings, topics, members RESTART IDENTITY CASCADE;
```

## Step 7 — Final log

(Against the SIM project:)
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-simulate-cycle', 'success', 'Full cycle simulation completed');
```
