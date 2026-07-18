# Monday Preflight Checklist — 2026-07-20 (M1 Session 1)

**Rule**: read-only observation during market hours (09:15–15:30 IST). No deploys before 15:30 IST. No gate/threshold changes without owner ruling. No adjacent fixes inline.

---

## PRE-OPEN (before 09:15 IST)

### 1. Kite login + session verify
- [ ] Log in at kite.zerodha.com; copy new `access_token`
- [ ] POST `/api/kite/session` with new token (owner-only endpoint)
- [ ] Confirm `GET /api/kite/health` returns `status: live` and `sessionValid: true`
- [ ] Confirm `expires_at` in `kite_session` table is today at 06:00 IST tomorrow

### 2. Broker execution confirmed DISABLED
- [ ] `FNO_AUTO_OPEN_C0_BLOCKED = true` (hardcoded in `paperTradingFO.ts:395`)
- [ ] `EQUITY_AUTO_OPEN_C0_BLOCKED = true` (hardcoded in `paperTradingEq.ts:1024`)
- [ ] `GET /api/paper/diagnostics/environment` → `autoTradingEnabled: false`
- [ ] ContainmentBanner visible in UI (C0.7 — intentional)

### 3. System mode
- [ ] `GET /api/system/mode` → `mode: LIVE` or `DEGRADED` (not `OFFLINE`)
- [ ] No `SYSTEM_MODE_OVERRIDE` env var set to a blocking value
- [ ] No uncleared F-27 suppressions (in-memory only; restart clears)

### 4. DB health + migrations
- [ ] `GET /api/system/health` → `db: ok`
- [ ] `pnpm --filter @workspace/db exec drizzle-kit push` → **zero pending migrations** (dry-run only, do NOT apply)
- [ ] Confirm `reconciliation_report` table exists (W3): `SELECT 1 FROM reconciliation_report LIMIT 1`
- [ ] Confirm `paper_capital_event` table exists: `SELECT COUNT(*) FROM paper_capital_event` (expect 0 rows — this is the ledger gap)

### 5. C0 flags
- [ ] `GET /api/paper/diagnostics/environment` → `reason` contains C0 language
- [ ] `PAPER_TRADING_ENABLED` env var absent or unset in workspace (fail-closed by default)
- [ ] `REASONING_WRITER_V2_ENABLED=1` confirmed in env (C0.6)

### 6. Snapshot parity (pre-open)
- [ ] `GET /api/kite/quotes?symbols=NIFTY+50,NIFTY+BANK,SENSEX` → all 3 resolve, `source: kite`
- [ ] `GET /api/option-snapshots/diagnostics` → age < 24h (pre-open, so yesterday's snapshot is expected)
- [ ] No `source: yahoo` rows in spot quotes (Kite live session required)

### 7. Telegram PREPOST test channel
- [ ] `GET /api/alerts/status` → `prepostTelegram: { configured: true }` (if PREPOST secrets set)
- [ ] `GET /api/daily-analysis/status` → last pre-market attempted timestamp
- [ ] Do NOT send a live pre-market report until 08:50 IST scheduled run confirms

---

## MARKET HOURS (09:15–15:30 IST) — OBSERVATION ONLY

### During session
- [ ] Monitor `fno_signal_reasoning` — confirm rows appear (proves scheduler running post-Kite-login)
  ```sql
  SELECT signal_date, COUNT(*), MIN(to_char(captured_at AT TIME ZONE 'Asia/Kolkata','HH24:MI')),
         MAX(to_char(captured_at AT TIME ZONE 'Asia/Kolkata','HH24:MI'))
  FROM fno_signal_reasoning WHERE signal_date = CURRENT_DATE GROUP BY signal_date;
  ```
- [ ] Confirm NO rows appear in `paper_trade_fo` with `status != 'CLOSED'` (no new opens)
- [ ] Confirm `option_signal_history` receives EMITTED rows within session times only (09:15–15:30 IST)
- [ ] Note any signals with `canonical_decision = 'DATA_BLOCKED'` — this is the C0.5 weekend-gate gap showing in live data

### 11:30–14:00 rate re-probe (M1 observation)
- [ ] Record NIFTY/BANKNIFTY/SENSEX spot at 11:30, 13:00, 14:00 IST (read-only)
- [ ] Check `fno_signal_reasoning` rejection breakdown by `canonical_reason`
- [ ] Do NOT tune any threshold based on this session

---

## POST-CLOSE (after 15:30 IST)

### Deploy window (after 15:30 IST, owner approval required)
- [ ] `pnpm run typecheck` → clean (zero errors)
- [ ] `pnpm --filter @workspace/scanner run test` → 799/799 pass
- [ ] Targeted safety tests → 111/111 pass:
  ```
  pnpm --filter @workspace/api-server exec vitest run --pool=threads \
    "src/lib/durableChargesIdentity.test.ts" \
    "src/lib/durableChargesPhaseB.test.ts" \
    "src/lib/fnoCostModelGuard.test.ts" \
    "src/lib/paperAccountReconciliation.test.ts" \
    "src/lib/columnWidthInvariants.test.ts" \
    "src/lib/optionSignals.expiryDay.test.ts"
  ```
- [ ] Owner reviews and approves any code changes before workflow restart
- [ ] **No restarts during 09:00–15:30 IST**
- [ ] `restart_workflow "artifacts/api-server: API Server"` only after owner approval post-close

### EOD reconciliation check
- [ ] `GET /api/system/reconciliation` → `reconciled: true` for EQUITY, `reconciled: false` for FNO (drift present)
- [ ] Confirm FNO drift still shows ₹799,772.70 (no unauthorized changes)
- [ ] Record: new `fno_signal_reasoning` row count for today, emitted count, first/last IST times

---

## KNOWN LIVE ISSUES (do not fix inline)

| Issue | Action |
|---|---|
| C0.5 gap: F&O signal sweep runs outside weekend gate | Log only; M1 calendar service fix |
| FNO paper ledger drift ₹799,772.70 | M2c incident procedure — owner must approve |
| Jul 15–17 signal gap | Classification: **PIPELINE_DID_NOT_REACH_DURABLE_REASONING_WRITER** — leading hypothesis: Replit workspace idle sleep (not confirmed). Other possibilities include: scheduler disabled, process startup failure, DB outage, exception silently swallowed before logging. **Action**: collect deployment uptime log, process-start timestamps, scheduler-heartbeat (if any), and exception log for Jul 14–18. Not a gate/threshold defect. |
| paper_capital_event empty (0 rows) | M2c — reconstruct before re-enabling opens |

---

**Broker execution remains DISABLED.**
