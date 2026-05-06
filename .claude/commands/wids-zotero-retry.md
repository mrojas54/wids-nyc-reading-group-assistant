# /wids-zotero-retry <meeting-id>

Re-run the Zotero push for a meeting whose previous push failed
(visible in `command_log` as a `failure` row with name
`/wids-make-companion:zotero-push`).

This is the documented recovery path printed by `scripts/zotero_push.py`
on failure.

## Inputs

- `<meeting-id>`: the `meetings.id` of the meeting whose paper needs
  to be re-pushed.

## Behavior

Idempotent. If the paper is already in Zotero (either
`papers.zotero_item_key` is set, or the `wids_paper_id:<id>` correlator
finds it on the Zotero side), the script does nothing and exits 0.

## Steps

1. Look up the paper id:

   ```sql
   SELECT paper_id FROM meetings WHERE id = :meeting_id;
   ```

   If `paper_id IS NULL`, abort with: "meeting <id> has no paper assigned."

2. Run the push:

   ```bash
   uv run scripts/zotero_push.py \
       --paper-id=:paper_id \
       --meeting-id=:meeting_id
   ```

3. On exit 0, write `command_log`:

   ```sql
   INSERT INTO command_log (source, name, status, summary)
   VALUES ('slash_command', '/wids-zotero-retry', 'success',
           'Retry succeeded for meeting <meeting_id>, paper <paper_id>.');
   ```

4. On non-zero exit, the script has already written its own
   `command_log` failure row. Surface stderr to the operator and stop —
   do not write a second log row.

## Output

```
Zotero retry: paper <paper-id> -> item <item-key>
```

Or, on failure, the same warning the original push emits (with the
`/wids-zotero-retry` hint).
