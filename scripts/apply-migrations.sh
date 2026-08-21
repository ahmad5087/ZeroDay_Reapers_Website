#!/usr/bin/env bash
# apply-migrations.sh — apply the full ZeroDay Reapers schema to a target Postgres/Supabase DB,
# in order: schema.sql first, then every NNN_*.sql by number. Stops on the first error.
#
# Usage (Git Bash on Windows / WSL / macOS / Linux):
#   DATABASE_URL='postgresql://postgres:PASSWORD@db.YOUR-STAGING-REF.supabase.co:5432/postgres' \
#     ./scripts/apply-migrations.sh
#
# Get the connection string from: Supabase -> your STAGING project -> Settings -> Database ->
# Connection string (URI). NEVER point this at production.
#
# Requires: psql (Postgres client). On Windows install via `winget install PostgreSQL.PostgreSQL`
# or use the Supabase CLI instead (see STAGING.md). Migrations are idempotent, so if one errors
# you can fix it and re-run the whole script.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to your STAGING connection string (never production).}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase" && pwd)"

echo "==> Applying base schema: schema.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DIR/schema.sql"

# Numbered migrations in order (002_.. through the newest). Zero-padded names sort correctly.
for f in "$DIR"/[0-9][0-9][0-9]_*.sql; do
  echo "==> Applying: $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> All migrations applied successfully."
