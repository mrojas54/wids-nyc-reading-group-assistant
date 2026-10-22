#!/bin/bash
# Replays every migration with both grant baselines in a throwaway Postgres
# with pgvector, then checks passage search, API privileges, and role boundaries.
# Connection comes from the standard PG* environment variables. The database is
# dropped and recreated, so point this only at a disposable server.
set -euo pipefail
cd "$(dirname "$0")/.."

db=paperpal_retrieval_test
for legacy_grants in false true; do
  echo "Testing legacy_grants=$legacy_grants"
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
  psql -v ON_ERROR_STOP=1 -q -d "$db" -v legacy_grants="$legacy_grants" -f tests/paper_passage_search_fixture.sql
  for migration in migrations/[0-9][0-9][0-9]_*.sql; do
    psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$migration"
  done
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/paper_passage_search_test.sql
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/data_api_grants_test.sql
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/members_column_grants_test.sql
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/replace_my_availability_test.sql
  # The forward migration must also be safe on a second application.
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f migrations/038_explicit_data_api_grants.sql
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f tests/data_api_grants_test.sql
done
