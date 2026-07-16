#!/bin/bash
# =====================================================================
# P0.4 Step 2 · Friday midday spot-check (2026-07-17 · ~12:00 IST)
# =====================================================================
# Purpose: catch a dead writer with half a session left to diagnose,
# rather than discovering it in the evening acceptance query with
# zero recourse.
#
# Read-only. No pod changes. No behaviour change. Safe to run any time.
#
# Owner-side rule (session 2026-07-16): preview pod is frozen from
# now until Friday's acceptance query runs. This script does not
# touch the pod — it only reads DB counts and prints the health
# counter surface for logFnoReasoning.
#
# Run:  bash /app/memory/forensics/p0_4_step2_friday_midday_spotcheck.sh
# =====================================================================

set -u

TODAY=$(TZ=Asia/Kolkata date +%Y-%m-%d)
echo "=== P0.4 Step 2 midday spot-check · $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M %Z') ==="
echo ""

# ---- Section 1: are writers firing at all today? ----
echo "--- fno_signal_reasoning row counts today ---"
psql -h localhost -U nse -d nsescanner -X -A -F ' | ' -c "
SELECT
  COUNT(*)                                  AS today_total,
  COUNT(*) FILTER (WHERE config_version IS NOT NULL) AS v2_stamped,
  MIN(captured_at)                          AS earliest,
  MAX(captured_at)                          AS latest,
  COUNT(DISTINCT decision)                  AS distinct_decisions,
  COUNT(DISTINCT reason_code)               AS distinct_reasons
FROM fno_signal_reasoning
WHERE captured_at::date = '${TODAY}'::date;
"

# ---- Section 2: minutes since last write (dead-writer canary) ----
echo ""
echo "--- Minutes since last fno_signal_reasoning write (dead-writer canary) ---"
psql -h localhost -U nse -d nsescanner -X -A -F ' | ' -c "
SELECT
  EXTRACT(EPOCH FROM (NOW() - MAX(captured_at)))/60.0 AS minutes_since_last_write
FROM fno_signal_reasoning
WHERE captured_at::date = '${TODAY}'::date;
"
echo "-- Expected under normal session load: < 5 minutes (30s tick × loose ceiling). --"
echo "-- If > 10 minutes: check apiserver logs, orchestrator hook, and Kite feed. --"

# ---- Section 3: sanity — no writer_version drift ----
echo ""
echo "--- writer versions seen today (should show only the current version) ---"
psql -h localhost -U nse -d nsescanner -X -A -F ' | ' -c "
SELECT writer_version, COUNT(*) AS n
FROM option_signal_history
WHERE last_evaluated_at::date = '${TODAY}'::date
GROUP BY writer_version
ORDER BY n DESC;
"

# ---- Section 4: option_signal_history freshness ----
echo ""
echo "--- option_signal_history sanity ---"
psql -h localhost -U nse -d nsescanner -X -A -F ' | ' -c "
SELECT
  COUNT(*)                    AS today_generated,
  COUNT(*) FILTER (WHERE execution_status IS NOT NULL) AS with_execution_status,
  COUNT(*) FILTER (WHERE signal_fingerprint IS NOT NULL) AS with_fingerprint
FROM option_signal_history
WHERE generated_at::date = '${TODAY}'::date;
"

# ---- Section 5: unhealthy canonical distribution ----
echo ""
echo "--- Today's canonical_decision distribution (should have variety) ---"
psql -h localhost -U nse -d nsescanner -X -A -F ' | ' -c "
SELECT canonical_decision, COUNT(*) AS n
FROM fno_signal_reasoning
WHERE captured_at::date = '${TODAY}'::date
  AND config_version IS NOT NULL
GROUP BY canonical_decision
ORDER BY n DESC;
"

echo ""
echo "=== spot-check complete ==="
echo ""
echo "Green if:"
echo "  - today_total > 0 AND minutes_since_last_write < 10"
echo "  - v2_stamped == today_total (flag is on, all writes canonical)"
echo "  - distinct_reasons >= 3 (multiple gate types firing)"
echo "  - canonical_decision distribution shows both REJECTED and EMITTED rows"
echo ""
echo "Red flags:"
echo "  - today_total == 0                    → orchestrator hook / Kite feed dead"
echo "  - v2_stamped == 0 AND today_total > 0 → flag OFF (env var missing/wrong)"
echo "  - minutes_since_last_write > 10       → writer stalled or apiserver crashed"
echo "  - only one canonical_decision seen    → sample not exercising all gates yet"
