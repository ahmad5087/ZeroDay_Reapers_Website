#!/usr/bin/env bash
# Regenerate supabase/_apply_all.sql — the full schema bundle (base schema + every numbered migration,
# in order) used to bring the disposable CI test DB ("zdr-ci-test") to parity with production so the
# RLS/authorization suite (scripts/rls-test.mjs) tests the current schema. Run from the repo root:
#   bash scripts/build-apply-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=supabase/_apply_all.sql
{
  echo "-- _apply_all.sql — GENERATED full schema bundle: base schema + every numbered migration (002 → latest), in order."
  echo "-- Purpose: bring a DISPOSABLE Supabase project (the CI test DB, \"zdr-ci-test\") to full parity with production so"
  echo "-- the RLS/authorization suite (scripts/rls-test.mjs) tests the current schema. Run the WHOLE file once in the"
  echo "-- Supabase SQL Editor of the TEST project — NEVER production. Built for a clean/empty DB (deterministic apply);"
  echo "-- most migrations are additive/idempotent so an in-place re-run also works, but a fresh DB is the guaranteed match."
  echo "-- Regenerate with: scripts/build-apply-all.sh"
  echo
  echo "-- ============================================================================"
  echo "-- ===== supabase/schema.sql (base) ====="
  echo "-- ============================================================================"
  cat supabase/schema.sql
  echo
  # Only real numbered migrations (NNN_*.sql); excludes schema.sql and the _apply_* bundles.
  for f in $(ls supabase/[0-9][0-9][0-9]_*.sql | sort); do
    echo
    echo "-- ============================================================================"
    echo "-- ===== $f ====="
    echo "-- ============================================================================"
    cat "$f"
    echo
  done
} > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT") lines, $(ls supabase/[0-9][0-9][0-9]_*.sql | wc -l) migrations + base)."
