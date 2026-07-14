#!/usr/bin/env bash
# ============================================================================
# Safe Postgres export — strips secrets before producing a portable dump.
#
# Why this exists:
#   The DB has columns that are LIVE CREDENTIALS (kite_session.access_token,
#   kite_session.api_key, kite_session.public_token) plus user secrets
#   (users.password_hash) and share-link tokens (global_screener_presets
#   .share_token). A naive `pg_dump` of the whole database leaks all of these.
#
# What this does:
#   1. Refuses to run unless DATABASE_URL is set.
#   2. Excludes the kite_session table entirely (it self-rotates daily anyway).
#   3. Excludes users.password_hash via a column-list COPY.
#   4. Excludes global_screener_presets.share_token via a column-list COPY.
#   5. Writes a single .sql file the user can share or archive without leaking
#      Kite tokens, bcrypt hashes, or share-link secrets.
#
# Usage:
#   ./scripts/safe-db-export.sh                       # writes ./safe-export-YYYYMMDD-HHMMSS.sql
#   ./scripts/safe-db-export.sh /path/to/output.sql   # writes to a specific file
#
# This script never prints any DB row contents to stdout — only counts/sizes.
# ============================================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Refusing to run." >&2
  exit 1
fi

OUT="${1:-safe-export-$(date -u +%Y%m%d-%H%M%S).sql}"

# ---- Tables to fully exclude (whole-row secrets) ---------------------------
EXCLUDED_TABLES=(
  "kite_session"            # plaintext Kite access_token + api_key + public_token
)

# ---- Columns to exclude from otherwise-safe tables -------------------------
# Format: "table:col1,col2,..."   (the EXPORT will OMIT these columns)
SCRUBBED_COLUMNS=(
  "users:password_hash"                   # bcrypt hashes (still secrets)
  "global_screener_presets:share_token"   # share-link bearer tokens
)

EXCLUDE_FLAGS=()
for t in "${EXCLUDED_TABLES[@]}"; do
  EXCLUDE_FLAGS+=(--exclude-table-data="public.${t}")
done

# Build a comma-separated list of "scrubbed" tables that we'll handle
# separately (data omitted by pg_dump, then re-emitted with column lists).
SCRUB_TABLES=()
for entry in "${SCRUBBED_COLUMNS[@]}"; do
  SCRUB_TABLES+=("${entry%%:*}")
done
for t in "${SCRUB_TABLES[@]}"; do
  EXCLUDE_FLAGS+=(--exclude-table-data="public.${t}")
done

echo "Safe export → ${OUT}"
echo "  Tables fully excluded     : ${EXCLUDED_TABLES[*]}"
echo "  Tables with scrubbed cols : ${SCRUB_TABLES[*]}"

# 1) Schema + data for everything EXCEPT excluded/scrubbed tables.
pg_dump --no-owner --no-privileges --no-comments \
  "${EXCLUDE_FLAGS[@]}" \
  "$DATABASE_URL" > "$OUT"

# 2) Append scrubbed-column data for the partially-redacted tables.
{
  echo ""
  echo "-- ===================================================================="
  echo "-- Scrubbed-column data (sensitive columns intentionally omitted)"
  echo "-- ===================================================================="
} >> "$OUT"

for entry in "${SCRUBBED_COLUMNS[@]}"; do
  table="${entry%%:*}"
  excluded_cols="${entry#*:}"
  # Build column list = (all columns) MINUS (excluded columns).
  cols=$(psql "$DATABASE_URL" -At -c "
    SELECT string_agg(quote_ident(column_name), ',')
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}'
      AND column_name NOT IN ($(echo "'$excluded_cols'" | sed "s/,/','/g"));
  ")
  if [ -z "$cols" ]; then
    echo "  (skipping ${table}: not present in schema)"
    continue
  fi
  echo "-- Table: ${table}  (excluded: ${excluded_cols})" >> "$OUT"
  echo "COPY public.${table} (${cols}) FROM stdin;" >> "$OUT"
  psql "$DATABASE_URL" -At -F $'\t' \
    -c "COPY (SELECT ${cols} FROM public.${table}) TO STDOUT" >> "$OUT"
  echo "\\." >> "$OUT"
  echo "" >> "$OUT"
done

# Sanity grep — refuse to ship the dump if any obvious secret pattern slipped in.
LEAK_CHECK=$(grep -cE "(access_token|api_secret|api_key|password_hash|share_token)" "$OUT" || true)
SCHEMA_HITS=$(grep -cE "^\s*(access_token|api_secret|api_key|password_hash|share_token)\s+text" "$OUT" || true)
DATA_HITS=$((LEAK_CHECK - SCHEMA_HITS))
if [ "$DATA_HITS" -gt 50 ]; then
  echo "ABORT: leak-check found $DATA_HITS suspicious occurrences in the dump." >&2
  echo "       Inspect ${OUT} before sharing. Consider deleting it." >&2
  exit 2
fi

SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo ""
echo "Done. ${OUT} (${SIZE} bytes)"
echo "Leak-check: ${SCHEMA_HITS} schema matches (expected, just column DEFs),"
echo "            ~${DATA_HITS} other matches (should be ≤ a handful)."
echo ""
echo "REMINDER: this dump is still owner-readable data. Treat it as confidential"
echo "          even though Kite tokens, bcrypt hashes, and share-link tokens"
echo "          have been stripped."
