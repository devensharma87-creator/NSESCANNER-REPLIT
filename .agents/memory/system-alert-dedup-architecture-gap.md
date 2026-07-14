---
name: System alert dedup — DB-backed, cross-restart safe
description: Data-health/Kite/session Telegram alerts dedup via claimSystemAlert (system_alert_dedup table) + transitionSystemAlertState (system_alert_state table) — NOT in-memory-only. The architecture gap was fixed; this file documents the resolved design.
---

The old in-memory-only `lastAlerted` Map in `alerting.ts` has been layered with DB-backed
dedup via `systemAlertDedup.ts` (`claimSystemAlert` / `transitionSystemAlertState`). The
in-memory Map is now only a same-process fast-path; the DB claim is the cross-restart /
cross-replica source of truth.

**Architecture (resolved):**
- `alertOwnerRaw` / `alertOwner` (alerting.ts): in-memory fast-path → `claimSystemAlert`
  (system_alert_dedup table, windowed INSERT ON CONFLICT). Fail-open on DB error.
- `FNO_DATA_RECOVERED` (fnoDataRecoveryTransition.ts): CAS via `transitionSystemAlertState`
  (system_alert_state table, per-family state machine). Each genuine degrade→recover cycle
  mints a unique incidentId so a second flap on the same day still alerts once.
- DD latch + BASELINE lock (infraAlerts.ts): `hasAlreadyDelivered` / `logNotificationDelivery`
  from `tradeLifecycle/notificationLog` (notification_delivery_log table).
- Boot-time self-test: `systemAlertDedupSelfTest.ts` proves the tables exist and
  claim/CAS primitives work on every autoscale cold start.

**Cross-restart test coverage:**
`systemAlertDedup.test.ts` → "cross-restart scenario" describe block (5 tests) explicitly
simulates autoscale cold starts by resetting the `tablesReady` latch and verifying the DB
claim prevents duplicate Telegram sends.

**Why:** autoscale replicas have no shared in-memory state. Any "send at most once" alert
must use a DB-backed unique constraint as the primary dedup gate; in-memory is fast-path only.
