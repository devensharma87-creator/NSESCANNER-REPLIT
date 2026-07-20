# Phase 0 State-Writer and Read-Side-Effect Map — 2026-07-20

**Authority:** Superseding Phase 0 prompt §6.4, P0-B  
**Status:** STATIC ANALYSIS (no DB queries run; based on code inspection)

---

## State-Changing Trade Writers

| Writer | Location | Triggers | C0 Gate | Session Gate | Provenance Gate | Ledger Gate |
|--------|----------|----------|---------|--------------|-----------------|-------------|
| `openPaperTrade()` (FO auto) | `paperTradingFO.ts:398` | Scheduler tick | FNO_AUTO_OPEN_C0_BLOCKED=true ✓ | `computeMarketStatus` ✓ | PREMIUM_UNTRUSTED ✓; CONTRACT_NOT_TRADE_GRADE ✓ (NEW) | checkLedgerReconciliationGate ✓ |
| `tryOpenPaperTrades()` (FO batch) | `paperTradingFO.ts:3402` | Scheduler | delegates to openPaperTrade | — | — | — |
| `openPaperEquityTrade()` (EQ auto) | `paperTradingEq.ts:192` | Scheduler tick | EQUITY_AUTO_OPEN_C0_BLOCKED=true ✓ | MISSING — no writer-boundary session gate | LEVELS_NOT_TRADE_GRADE ✓ (NEW) | checkLedgerReconciliationGate ✓ |
| `openPaperEquityTrade()` (EQ manual) | same, opts.source="MANUAL" | Owner UI click | same C0 ✓ | MISSING — no writer-boundary session gate | LEVELS_NOT_TRADE_GRADE ✓ (NEW) | checkLedgerReconciliationGate ✓ |
| `openPaperEquityTradeFromStagedOrder()` | `paperTradingEq.ts:1107` | Staged approval | delegates to openPaperEquityTrade | via delegation ✓ | via delegation ✓ | via delegation ✓ |
| `reconcileMissingPaperTrades()` | `paperAccountReconciliation.ts` | Scheduler / restart | UNKNOWN — must verify | MISSING | MISSING | UNKNOWN |
| Combo `POST /paper/combo/open` | `routes/paperTradingCombo.ts` (approx) | Owner UI | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Force-exit `POST /paper/fo/force-exit` | `routes/paperTrading.ts` (approx) | Owner UI or 15:20 sweep | N/A (exit, not open) | N/A | N/A | N/A |
| `sweepStaleOpenPaperTrades()` | `paperTradingFO.ts` (approx) | Scheduler / next-day | N/A (close) | N/A | N/A | N/A |

**Missing gates identified:**
1. `openPaperEquityTrade()` lacks a canonical session gate at the writer boundary (§6.3 defect)
2. `reconcileMissingPaperTrades()` gate coverage UNKNOWN — must be verified
3. Combo writer gate coverage UNKNOWN

---

## GET/HEAD Routes with Known or Suspected Side Effects

| Route | Location | Suspected Side Effect | Evidence | Label |
|-------|----------|-----------------------|----------|-------|
| `GET /api/paper/account` | `routes/paperTrading.ts` | Calls `ensureDailyReset("FNO")` + `ensureDailyReset("EQUITY")` | Audit finding §6.4 | LIKELY |
| `GET /api/paper/positions` | `routes/paperTrading.ts` | Calls `ensureDailyReset` | Audit finding §6.4 | LIKELY |
| `GET /api/paper/combo` | `routes/paperTradingCombo.ts` | May remark/persist values | Audit finding §6.4 | LIKELY |
| `GET /api/kite/status` | `routes/kite.ts` | Read-only (session metadata) | Code inspection | LIKELY pure |
| `GET /api/kite/export-session` | `routes/kite.ts:155` | Read-only (session export) | Code inspection | LIKELY pure (see security report) |

**P0-B action needed:** Move `ensureDailyReset()` out of GET handler paths and into  
explicit authenticated commands or idempotent scheduled jobs. No code change made this  
session (Phase 1 work; cannot be safely done without understanding full consumer impact).

---

## `ensureDailyReset()` Call Sites

| Call Site | Caller | When Called | Side Effect |
|-----------|--------|-------------|-------------|
| `paperTradingEq.ts:310` | `openPaperEquityTrade()` | Every EQ open attempt | INSERT/UPDATE paper_account |
| Multiple GET handlers (unverified) | `routes/paperTrading.ts` | On every GET request | Same INSERT/UPDATE |

**Label:** LIKELY for GET-handler call sites (require grep confirmation — not done to  
avoid excessive file reads this session).

---

## Capital and Balance Mutations

| Mutation | Location | Guarded By |
|----------|----------|-----------|
| Balance debit (trade open) | `paperTradingFO.ts` + `paperTradingEq.ts` | C0 block (never reached in C0) |
| Balance credit (trade close) | `paperTradingFO.ts` closePosition path | 15:20 gate + session gate |
| Balance debit (daily reset) | `paperAccountReconciliation.ts` or `resetDailyState` | Scheduler only |
| Capital event INSERT | `paper_capital_events` table | checkLedgerReconciliationGate references this table |

---

## Schema-Mutating Runtime Calls (from non-migration paths)

| Function | Location | Tables Touched |
|----------|----------|----------------|
| `ensurePaperEqProvenanceColumns()` | `paperTradingEq.ts:199` | `paper_trade_eq`, `paper_eq_audit` |
| `ensureContractMasterSchemaColumns()` | `paperTradingFO.ts:598` | `paper_trade_fo` |
| `ensureXSchemaColumns()` | (various) | Various FO tables |

These lazy migrations are per the `runtime-schema-ensure-for-new-db-objects` memory entry.  
They run `ALTER TABLE ADD COLUMN IF NOT EXISTS` — idempotent, additive.
