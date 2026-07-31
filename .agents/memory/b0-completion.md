---
name: B0 production-state and alert-reliability completion
description: Key decisions and outcomes from Phase B0 implementation (Jul 2026).
---

## Summary

B0 fixed six alert/state defects. Completed 2026-07-31, ~18:00 IST. All 4326 non-DB tests pass. Evidence at `artifacts/audit-evidence/PHASE_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY.md`.

## Key patterns established

**buildAlertText() is the pure test-entry-point for alert formatting.**
- Exported from `alerting.ts`; takes `(event, message, metadata?, priority?)` → string
- SUCCESS_EVENTS set drives ✅ vs ⚠️/🔴 header routing
- Each named operational event (EOD, instruments, clock drift) has its own header+action text
- Generic F&O/Kite events still get the `"🚨 F&O DATA ALERT"` header with priority prefix

**Clock drift is multi-probe with RTT filtering and hysteresis.**
- 3 probes per cycle; reject RTT > 3000ms; require ≥2 valid probes
- Median drift (not mean) — outlier-resistant
- Recovery fires once when drift drops below DRIFT_RECOVERY_MS=400ms (below DRIFT_WARN_MS=500ms)
- Process-level `lastAlertedDriftStatus` variable tracks state; resets on restart

**EOD OK message is always honest about skipped checks.**
- `buildEodOkMessage()` exported pure helper — never says "all checks OK" when any are SKIPPED
- OK alert always INFO priority (not WARN)

**Instruments recovery is a discrete exported function.**
- `markInstrumentsRefreshRecovered(date)` — no-op if not failed today
- Clears `failedDateCache` + deletes DB key via `deleteAppState()` (use delete, not null upsert)
- Emits INFO alert once; idempotent

**Options page market-closed gate:**
`(!isError && data?.marketStatus != null && !data.marketStatus.marketOpen)` — isError blocks stale-cache false "Market is closed".

## Test counts (post-B0)

- test:unit = 181 (P0.1B guard, unchanged — compile-time tripwire)
- test:full = 4326 tests, 208 files (+76 tests / +3 new files vs P0.1B baseline of 4250/205)
- `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` — UNCHANGED

**Why:** Record for the next B-phase so B1 can locate the alert formatter and know the test baseline.
