#!/bin/bash
# Runs tests/paper_passage_search_test.sql against a throwaway Postgres with
# pgvector: Supabase stubs, then every migration in numeric order, then the test.
# Connection comes from the standard PG* environment variables. The database is
# dropped and recreated, so point this only at a disposable server.
set -euo pipefail
cd "$(dirname "$0")/.."

db=paperpal_retrieval_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/paper_passage_search_fixture.sql
for migration in migrations/[0-9][0-9][0-9]_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$migration"
done
psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/paper_passage_search_test.sql
