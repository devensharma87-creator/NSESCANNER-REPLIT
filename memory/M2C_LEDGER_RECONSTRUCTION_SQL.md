# M2c — Ledger Reconstruction Queries

**As of:** 2026-07-20 (weekend before M1)  
**Rule:** Read-only. No UPDATE/INSERT without owner approval. No balance reset. No guessed capital events.

---

## FNO Ledger Identity

```sql
-- FNO reconstruction: seed + Σclosed P&L - Σdeployed capital = expected balance
SELECT 
  pa.seed_capital,
  pa.balance,
  pa.balance - pa.seed_capital                          AS balance_minus_seed,
  COALESCE(t.total_pnl, 0)                              AS lifetime_gross_pnl,
  COALESCE(t.cnt, 0)                                    AS closed_trade_count,
  COALESCE(cap.add_capital, 0)                          AS recorded_add_capital,
  COALESCE(cap.withdraw_capital, 0)                     AS recorded_withdraw_capital,
  pa.seed_capital
    + COALESCE(cap.add_capital, 0)
    - COALESCE(cap.withdraw_capital, 0)
    + COALESCE(t.total_pnl, 0)                          AS expected_balance,
  pa.balance - (
    pa.seed_capital
    + COALESCE(cap.add_capital, 0)
    - COALESCE(cap.withdraw_capital, 0)
    + COALESCE(t.total_pnl, 0)
  )                                                      AS unexplained_drift
FROM paper_account pa
LEFT JOIN (
  SELECT SUM(realized_pnl) AS total_pnl, COUNT(*) AS cnt
  FROM paper_trade_fo WHERE status = 'CLOSED'
) t ON true
LEFT JOIN (
  SELECT 
    SUM(CASE WHEN kind = 'ADD_CAPITAL'      THEN amount ELSE 0 END) AS add_capital,
    SUM(CASE WHEN kind = 'WITHDRAW_CAPITAL' THEN amount ELSE 0 END) AS withdraw_capital
  FROM paper_capital_event WHERE segment = 'FNO'
) cap ON true
WHERE pa.segment = 'FNO';
```

**Current result (2026-07-20):**

| Field | Value |
|---|---|
| seed_capital | ₹200,000.00 |
| balance | ₹1,006,281.00 |
| lifetime_gross_pnl | ₹6,508.30 (7 trades) |
| recorded_add_capital | ₹0 |
| expected_balance | ₹206,508.30 |
| **unexplained_drift** | **₹799,772.70** |

---

## FNO Closed Trade Timeline

```sql
SELECT 
  signal_date, index_symbol, direction, status,
  realized_pnl, lots, lot_size, entry_premium, exit_premium,
  to_char(opened_at  AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS opened_ist,
  to_char(exited_at  AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS exited_ist,
  exit_reason, writer_version, charges_status
FROM paper_trade_fo
WHERE status = 'CLOSED'
ORDER BY opened_at;
```

**Current result — all 7 trades (May 4–6 2026):**

| signal_date | index_symbol | direction | realized_pnl | exit_reason | opened_ist | exited_ist |
|---|---|---|---|---|---|---|
| 2026-05-04 | BANKEX | BEARISH | 0.00 | EXPIRED | 2026-05-04 15:29 | 2026-05-04 15:30 |
| 2026-05-04 | SENSEX | BEARISH | 0.00 | EXPIRED | 2026-05-04 15:29 | 2026-05-04 15:30 |
| 2026-05-05 | FINNIFTY | BEARISH | −1,960.40 | STOPPED | 2026-05-05 11:41 | 2026-05-05 11:41 |
| 2026-05-05 | SENSEX | BEARISH | −1,125.20 | STOPPED | 2026-05-05 11:41 | 2026-05-05 13:16 |
| 2026-05-05 | BANKEX | BEARISH | +3,312.90 | EXPIRED | 2026-05-05 11:41 | 2026-05-05 15:30 |
| 2026-05-06 | SENSEX | BULLISH | +3,419.30 | TARGET1_HIT | 2026-05-06 11:46 | 2026-05-06 15:30 |
| 2026-05-06 | SENSEX | BEARISH | +2,861.70 | EXPIRED | 2026-05-06 12:23 | 2026-05-06 15:30 |
| **TOTAL** | | | **+6,508.30** | | | |

Note: `writer_version` is NULL on all rows (trades pre-date Phase A/B writer versioning).

---

## FNO First Divergence Hunt

```sql
-- Check: was the balance ever ₹200k after account creation?
-- (paper_account has no balance history — only current state)
SELECT segment, seed_capital, balance,
       to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS created_ist,
       to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS updated_ist
FROM paper_account WHERE segment = 'FNO';
-- created: 2026-04-28 20:55 IST
-- updated: 2026-07-18 20:45 IST  ← last write; does NOT prove when drift started

-- Check: are there any balance-mutation clues in paper_trade_fo?
SELECT 
  to_char(opened_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
  COUNT(*) AS opens, SUM(realized_pnl) AS day_pnl
FROM paper_trade_fo
GROUP BY day ORDER BY day;

-- Check: any direct balance update audit in pg logs? (not queryable via app)
-- Must export: pg_wal or audit extension if enabled

-- Candidate causes (in order of likelihood):
-- 1. Legacy daily balance reset wrote ₹1,006,281 directly (no capital event)
-- 2. Migration artifact: balance was seeded at wrong value during Replit migration
-- 3. Manual SET balance = X by a developer tool without a capital event
-- 4. Old "top-up" code path (pre-C0) that credited without recording an event
```

---

## EQUITY Ledger Identity

```sql
-- EQUITY reconstruction: clean — zero unexplained drift
SELECT 
  pa.seed_capital,
  pa.balance,
  COALESCE(closed.total_pnl, 0)        AS lifetime_gross_pnl,
  COALESCE(closed.cnt, 0)              AS closed_count,
  COALESCE(open_pos.open_count, 0)     AS open_count,
  COALESCE(open_pos.open_deployed, 0)  AS open_deployed_capital,
  pa.seed_capital
    + COALESCE(closed.total_pnl, 0)
    - COALESCE(open_pos.open_deployed, 0)  AS expected_balance,
  pa.balance - (
    pa.seed_capital
    + COALESCE(closed.total_pnl, 0)
    - COALESCE(open_pos.open_deployed, 0)
  )                                        AS unexplained_drift
FROM paper_account pa
LEFT JOIN (
  SELECT SUM(realized_pnl) AS total_pnl, COUNT(*) AS cnt
  FROM paper_trade_eq WHERE exit_price IS NOT NULL
) closed ON true
LEFT JOIN (
  SELECT COUNT(*) AS open_count, SUM(capital_deployed) AS open_deployed
  FROM paper_trade_eq WHERE exit_price IS NULL
) open_pos ON true
WHERE pa.segment = 'EQUITY';
```

**Current result (2026-07-20):**

| Field | Value |
|---|---|
| seed_capital | ₹1,000,000.00 |
| balance | ₹1,017,024.86 |
| lifetime_gross_pnl | ₹67,024.86 (12 closed trades) |
| open_deployed_capital | ₹50,000.00 (10 open positions) |
| expected_balance | ₹1,017,024.86 |
| **unexplained_drift** | **₹0.00 — CLEAN** ✅ |

---

## Capital Events Journal (should be append-only)

```sql
-- Current state: ZERO rows — this is the gap
SELECT segment, kind, amount, balance_after,
       to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS created_ist,
       note, created_by
FROM paper_capital_event
ORDER BY created_at;
-- Returns 0 rows. Every balance mutation should be here.
-- Owner incident procedure must identify when/why balance moved without events.
```

---

## M2c Incident Procedure (reference — do NOT execute without owner approval)

```sql
-- Step 1: Export all FNO trades + capital events in chronological order
-- (Run this first, export to CSV, give to owner)
SELECT 
  'trade' AS row_type,
  signal_date::text AS date_ref,
  index_symbol AS subject,
  direction::text AS detail,
  realized_pnl AS amount,
  to_char(opened_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS event_ist
FROM paper_trade_fo WHERE status = 'CLOSED'
UNION ALL
SELECT 
  'capital_event',
  created_at::date::text,
  segment,
  kind,
  amount,
  to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')
FROM paper_capital_event WHERE segment = 'FNO'
ORDER BY event_ist;

-- Step 2: After owner approves and cause is identified, insert ONE adjustment event:
-- (TEMPLATE ONLY — values TBD after reconstruction)
-- INSERT INTO paper_capital_event (id, segment, kind, amount, balance_after, note, created_by)
-- VALUES (
--   gen_random_uuid()::text,
--   'FNO',
--   'ADJUSTMENT',         -- or a new kind if schema allows
--   <owner-approved-amount>,
--   <resulting-balance>,
--   'M2c incident reconstruction — cause: <identified cause> — approved by owner <date>',
--   'incident-procedure-m2c'
-- );
-- NEVER run this without owner sign-off on the amount and cause.
```

---

## Monitoring Query (run after each trading session during 30-session window)

```sql
-- Run once per trading session (post-close) to verify drift remains zero
WITH fno_expected AS (
  SELECT
    pa.balance,
    pa.seed_capital + COALESCE(t.pnl, 0) AS expected,
    pa.balance - (pa.seed_capital + COALESCE(t.pnl, 0)) AS drift
  FROM paper_account pa
  LEFT JOIN (SELECT SUM(realized_pnl) AS pnl FROM paper_trade_fo WHERE status='CLOSED') t ON true
  WHERE pa.segment = 'FNO'
)
SELECT 'FNO' AS segment, balance, expected, drift,
       CASE WHEN ABS(drift) < 0.01 THEN 'RECONCILED' ELSE 'DRIFT_PRESENT' END AS state
FROM fno_expected
UNION ALL
SELECT 'EQUITY', pa.balance,
       pa.seed_capital + COALESCE(c.pnl,0) - COALESCE(o.dep,0),
       pa.balance - (pa.seed_capital + COALESCE(c.pnl,0) - COALESCE(o.dep,0)),
       CASE WHEN ABS(pa.balance - (pa.seed_capital + COALESCE(c.pnl,0) - COALESCE(o.dep,0))) < 0.01
            THEN 'RECONCILED' ELSE 'DRIFT_PRESENT' END
FROM paper_account pa
LEFT JOIN (SELECT SUM(realized_pnl) AS pnl FROM paper_trade_eq WHERE exit_price IS NOT NULL) c ON true
LEFT JOIN (SELECT SUM(capital_deployed) AS dep FROM paper_trade_eq WHERE exit_price IS NULL) o ON true
WHERE pa.segment = 'EQUITY';
```
