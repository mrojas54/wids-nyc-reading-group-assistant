#!/bin/bash
# .claude/hooks/destructive-sql-guard.sh
#
# PreToolUse hook — blocks destructive SQL targeting production tables
# until the operator has given explicit confirmation in chat.
#
# Implements the README policy ("Destructive SQL guard": destructive
# operations require explicit confirmation). Added 2026-05-17 after a DELETE FROM
# availability WHERE meeting_id = 6 ran on inferred (not explicit)
# authorization.
#
# Matcher in .claude/settings.json:
#   Bash|mcp__.*__execute_sql|mcp__.*__apply_migration
#
# The "mcp__.*__" wildcard is deliberate. Each Claude Code installation
# generates its own UUID per MCP server, so a hardcoded UUID like
# "mcp__f593e869-1d39-4295-a673-56bc3be4d701__execute_sql" would silently
# fail to match for any contributor whose Supabase MCP got a different UUID
# (i.e. anyone other than the person who first wrote the hook). The wildcard
# matches the Supabase MCP regardless of which UUID it was assigned on a
# given machine, and incidentally also catches any future Postgres / SQLite
# / etc. MCP that exposes execute_sql or apply_migration.
#
# Protected tables: members, meetings, papers, availability, command_log
# Blocks (case-insensitive):
#   - DELETE FROM <protected-table>
#   - TRUNCATE ... <protected-table>
#   - DROP TABLE/COLUMN <protected-table>
#
# Returns exit 2 with a message on stderr to block the tool call;
# Claude sees the message and must re-prompt for explicit confirmation
# before re-issuing the call.

set -euo pipefail

INPUT=$(cat)

# Tool input could be either a SQL query (Supabase MCP) or a shell command
# (Bash). Try both, fall back to empty.
QUERY=$(echo "$INPUT" | jq -r '.tool_input.query // .tool_input.command // ""' 2>/dev/null || echo "")

if [ -z "$QUERY" ]; then
  exit 0  # Nothing to inspect, allow
fi

# Strip SQL line comments (-- ...) and block comments (/* ... */) so they
# don't false-trigger the regex. (e.g. "-- DELETE FROM members would be bad")
QUERY_STRIPPED=$(echo "$QUERY" | sed -E 's|--[^\n]*||g; s|/\*[^*]*\*/||g')

PROTECTED='members|meetings|papers|availability|command_log'

# Three destructive patterns, all anchored on protected tables:
#   1. DELETE FROM [public.]<table>
#   2. TRUNCATE [TABLE] [ONLY] <table> (with optional public. prefix and any
#      filler before the table name)
#   3. DROP TABLE|COLUMN ... <table>
DESTRUCTIVE_RE="(\bdelete[[:space:]]+from[[:space:]]+(public\.)?(${PROTECTED})\b|\btruncate[[:space:]]+(table[[:space:]]+)?(only[[:space:]]+)?(public\.)?(${PROTECTED})\b|\bdrop[[:space:]]+(table|column)[[:space:]]+.*\b(${PROTECTED})\b)"

if echo "$QUERY_STRIPPED" | grep -iEq "$DESTRUCTIVE_RE"; then
  cat >&2 <<'EOF'
═════════════════════════════════════════════════════════════════════════
🛑 DESTRUCTIVE SQL BLOCKED by .claude/hooks/destructive-sql-guard.sh
═════════════════════════════════════════════════════════════════════════
The statement targets a production table (members, meetings, papers,
availability, or command_log).

Per README.md "Destructive SQL guard":

  1. Surface the EXACT statement to the user in chat
  2. Run a SELECT preview showing which rows would be affected
  3. Wait for an explicit affirmative (yes / confirm / proceed)
  4. THEN re-issue the call

Contextual clues like "I informed members", "let's reset for next
cycle", or "proceed with cleanup" are NOT sufficient — get a direct
yes on the actual destructive command itself.

If this is a false positive (e.g. a SELECT containing the word
"delete" in a string literal, or a migration that's genuinely been
pre-approved), the hook can be temporarily bypassed by routing the
call through a different MCP/tool, but prefer fixing the regex in
the hook to be more precise.
═════════════════════════════════════════════════════════════════════════
EOF
  exit 2
fi

exit 0
