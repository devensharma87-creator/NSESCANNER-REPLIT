---
name: System alert dedup is in-memory-only, unlike trade alerts
description: Telegram data-health/session alerts (warmup-failed, session-missing, data-recovered, Kite final warning) dedup via a plain in-process Map and duplicate under autoscale; trade alerts and daily reports already use the correct DB-backed pattern.
---

`alerting.ts`'s `lastAlerted` Map (module-scope, in-memory) backs `alertOwner`/`alertOwnerRaw`,
used by all system/data-health Telegram alerts (F&O warmup-failed, FNO_KITE_SESSION_MISSING,
FNO_DATA_RECOVERED, Kite pre-open/final-warning). It has zero persistence, so it resets on
every autoscale cold start and cannot be shared across concurrent replicas — both are normal
occurrences on this project's `deploymentTarget = "autoscale"`. Combined with short dedup
windows (10 min for warmup) and keys missing a trading-day component (FNO_DATA_RECOVERED has
none at all), this produces real-world alert storms even though each individual send is
"correct" per its own (too-narrow) cooldown.

**Why this matters:** two *other* alert paths in the same codebase already solved this
correctly and should be the template for any fix:
- Trade alerts (F&O/Swing entry+exit) → `notification_delivery_log` DB table, keyed by
  domain+event_type+destination+id, checked via `hasAlreadyDelivered`/`logNotificationDelivery`.
- Daily pre/post-market reports → `daily_report_runs` table with `UNIQUE(report_type, ist_date)`
  and an atomic `INSERT ... ON CONFLICT DO NOTHING` claim (`tryClaimScheduledReport`).

**How to apply:** any new "send at most once" system/ops alert must claim through a DB-backed
unique constraint (or reuse one of the above tables/patterns) — never rely on the in-memory
`lastAlerted` Map as the *only* protection. In-memory dedup is fine only as a same-process
fast-path layered on top of a DB claim, exactly like `dailyReports.ts` does with
`lastPreMarketReportDate`. Full audit: `docs/telegram-alert-quality-audit-2026-07-03.md`.
