---
name: Scheduled report retry on FAILED rows
description: tryClaimScheduledReport retry pattern — FAILED rows retried within window; SENT rows permanently deduped
---

## Rule
`tryClaimScheduledReport` in `dailyReports.ts` has two phases:
1. INSERT ... ON CONFLICT DO NOTHING (claims fresh slots, skips CLAIMED/SENT)
2. If INSERT returns 0 rows → UPDATE WHERE status='FAILED' AND started_at within window (re-claims timed-out attempts)

SENT rows are permanently deduped — the UPDATE condition `status='FAILED'` never matches SENT.

**Why:** Production confirmed 2026-07-10 (and 2026-07-06): transient PREPOST Telegram network timeouts write `status='FAILED'`. Without the UPDATE second-path, subsequent INSERT attempts within the 20-minute window hit ON CONFLICT DO NOTHING → return false → DEDUP_SKIPPED → permanently missed. The fix allows exactly one retry-on-FAILED per window while preserving the SENT dedup invariant.

**How to apply:** Any new scheduled report type using this same claim pattern must include both INSERT + UPDATE-WHERE-FAILED phases. Tests: `dailyReportsDedupContract.test.ts` — 23 tests cover the two-phase sequence.
