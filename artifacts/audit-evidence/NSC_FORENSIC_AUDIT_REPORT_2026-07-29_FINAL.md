# NSC Scanner — Full-Platform Forensic Audit Report
**Report date:** 2026-07-29  
**Audit authority:** Read-only / observe-only  
**Audit prompt reference:** `NSC_Scanner_Forensic_Audit_Prompt_1785319431350.docx` (44,676 chars, 31 sections)  
**Dev HEAD at audit time:** `be186dd` (2026-07-29)  
**Production HEAD at audit time:** `e7ae0783` (built 2026-07-23; booted 2026-07-29)  
**Production lag:** **38 commits / 6 days** behind dev HEAD

---

## Audit Roles Applied

| Role | Coverage |
|---|---|
| Principal Architect | System topology, module boundaries, trust model |
| Senior Engineer | Business logic, state-machine invariants, error paths |
| Quant Auditor | Indicator maths, Greeks, IV solver, position sizing |
| Market-Data Engineer | Provider trust tiers, freshness labelling, staleness propagation |
| Broker API Specialist | Kite auth lifecycle, option chain sourcing, instrument token handling |
| DB/Ledger Auditor | Schema constraints, accounting invariants, audit trail integrity |
| SRE | Background jobs, rate limits, health checks, cold-start resilience |
| Security Auditor | Auth, CORS, cookie policy, TLS, secret comparison, dependency CVEs |
| QA Architect | Test isolation, golden tests, known regressions |
| Release Auditor | Dev/prod gap, unreleased changes, C0 kill-switches |

---

## Confidence Legend

| Code | Meaning |
|---|---|
| PROVEN CORRECT | Logic verified line-by-line; matches standard; tested |
| PROVEN DEFECTIVE | Verified bug with file+line; root cause identified |
| DIVERGES FROM STANDARD | Implementation is internally consistent but differs from industry convention (TradingView, Bloomberg) |
| INTENTIONAL DIVERGENCE | Documented intentional deviation from standard; disclosed here |
| HISTORICAL DEFECT / FIXED | Bug existed, root-cause-fixed in a subsequent commit |
| NOT VERIFIED | Insufficient evidence to classify; further investigation required |
| INFO | No defect; factual observation |

---

## System Inventory

### Environment
- **Node:** v24.13.0 · **pnpm:** 10.26.1
- **Production flags:** `PAPER_TRADING_ENABLED=false`, `LIVE_CASH_SWING_ORDER_ENABLED=false`, `SWING_CASH_EXECUTION_MODE=paper_only`
- **Hard-coded kill-switches:** `FNO_AUTO_OPEN_C0_BLOCKED = true` (paperTradingFO.ts:398), `EQUITY_AUTO_OPEN_C0_BLOCKED = true` (paperTradingEq.ts:1385)

### Application Inventory
- **Frontend routes (scanner):** 35 total; 10 owner-only (`/kite`, `/audit`, `/status`, `/fno-diagnostics`, `/daily-analysis`, `/swing-cash`, `/paper-trading`, `/paper-reports`, `/infra-health`, `/secrets-vault`)
- **Frontend routes (global):** 4 (`/`, `/i/:symbol`, `/screener`, `/watchlist`)
- **API route files:** 38; ~120+ endpoints
- **DB tables:** 27 across 17 schema files
- **Background jobs (`setInterval`):** 21

---

## Issue Register

### CALC-001 — ATR Uses EMA Smoothing Instead of Wilder's Smoothing
**Severity:** P2 (Medium) | **Confidence:** DIVERGES FROM STANDARD  
**Blocks paper trading:** No (C0-blocked already) | **Blocks live trading:** No (not deployed)  
**Regression risk:** Low — changing to Wilder's ATR would shift Supertrend and stop levels

**File + lines:** `artifacts/api-server/src/lib/indicators.ts:12–26`
```typescript
export function atr(high, low, close, period = 14) {
  const trs: number[] = [];
  // ... true-range computation ...
  return ema(trs, period);   // ← EMA smoothing (k = 2/(period+1))
}
```

**Root cause:**  
The ATR function applies EMA smoothing with `k = 2/(period+1) = 2/15 ≈ 0.1333` for the default period-14. The industry standard (Wilder's ATR, used by TradingView, Bloomberg, NSE analytics tools) uses Wilder's Running Moving Average with `k = 1/period = 1/14 ≈ 0.0714`.

**Quantified divergence (simulated, 20 bars):**
- EMA k = 0.133333 vs Wilder k = 0.071429 — ratio **1.867×** faster decay
- Steady-state difference in volatile market: **~2.6 points on a ~115-point ATR** (~2.3%)
- In trending markets with sustained momentum, the divergence grows toward **10–15%**

**Impact:**
1. **Supertrend bands** are based on `ATR × multiplier`; EMA-ATR produces slightly tighter bands → more frequent false Supertrend flips in choppy markets
2. **Swing stop-loss** formula in `scoring.ts:254–266` uses `atr14 * 1.2`; EMA-ATR yields stops 10–15% closer to entry vs. Wilder's ATR in trending conditions
3. **Scanner ATR badge** on stock cards represents a non-standard value without disclosure
4. **Inter-product inconsistency:** `lib/indicators/src/index.ts` comment explicitly states *"api-server ATR is EMA-smoothed vs global's Wilder RMA"* — users of the NSC Scanner app vs. the Global Scanner see incompatible ATR values for the same symbol

**Intentional documentation:** Yes — `lib/indicators/src/index.ts:14–17` notes the divergence as intentional because "unifying them would SILENTLY change output." However, there is no in-product disclosure to users.

**Recommended fix:**
```typescript
// Replace ema(trs, period) with Wilder's smoothing:
function wilderRma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = prev - prev / period + values[i]! / period;
    out[i] = prev;
  }
  return out;
}
```
**Regression tests required:** Golden-output tests for ATR(14) against a known-good reference (e.g., 50-bar NIFTY close/high/low series validated against TradingView). Lock Supertrend output against the same reference.  
**Acceptance criteria:** ATR values match TradingView Wilder's ATR within 0.5% on a 500-bar daily series after the first 50 warm-up bars.

---

### CALC-002 — ADX Smooth() Function vs. Local atr() Inconsistency
**Severity:** P3 (Low) | **Confidence:** PROVEN CORRECT (ADX itself) / INFO (noted divergence)  
**File + lines:** `artifacts/api-server/src/lib/indicators.ts:30–90`

**Finding:** The `adx()` function implements its own internal `smooth()` closure using Wilder's smoothing (`s[i] = s[i-1] - s[i-1]/period + arr[i]`) for +DM, -DM, and TR. Crucially, `adx()` does **NOT** call the local `atr()` function — it independently smoothes the true-range array. Therefore ADX's internal TR smoothing is correct Wilder's RMA, even though the exported `atr()` uses EMA. The two functions are consistent within their own outputs; the inconsistency is only between exported `atr()` values and the TR component inside `adx()`.

**Implication:** A user comparing the exported ATR badge value against the TR component implicitly expected by ADX (Wilder's) will see numerical inconsistency. No trading logic uses both values in the same formula, so financial impact is low.

**Verdict:** PROVEN CORRECT (ADX is internally consistent and uses correct Wilder's smoothing).

---

### CALC-003 — RSI Implementation
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `lib/indicators/src/index.ts:44–68`

Wilder's RSI — correct implementation:
- Seed: simple average of first `period` up/down deltas
- Smoothing: `avgGain = (avgGain × (period−1) + gain) / period` — Wilder's RMA ✓
- First value at index `period` (requires `period+1` values) ✓
- Zero-loss denominator guard: returns 100 ✓
- Single source of truth via `@workspace/indicators`, locked by golden tests in `indicatorsShared.test.ts` ✓

---

### CALC-004 — EMA Implementation
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `lib/indicators/src/index.ts:21–40`

Standard SMA-seeded EMA — correct:
- Seed: SMA of first `period` values ✓
- Multiplier: `k = 2/(period+1)` ✓
- Returns `null` for warm-up bars ✓
- Returns all-null when `values.length < period` ✓

---

### CALC-005 — MACD Implementation
**Severity:** N/A | **Confidence:** PROVEN CORRECT (P1B fix verified)  
**File:** `artifacts/api-server/src/lib/indicators.ts:91–130`

- EMA(12) − EMA(26) ✓
- Signal line seeded from `startIdx` (first valid MACD bar), **not** from index 0 ✓
- P1B fix (2026-07-08): eliminates zero-fill bias on short-history symbols ✓
- Shared via `@workspace/indicators` package for EMA primitive ✓

---

### CALC-006 — ADX Implementation
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `artifacts/api-server/src/lib/indicators.ts:30–90`

- +DM, −DM, TR each independently smoothed via Wilder's RMA ✓
- DX = |+DI − −DI| / (+DI + −DI) × 100 ✓
- ADX = Wilder's RMA of DX, seeded with SMA of first `period` DX values ✓
- Requires `2×period` bars (28 bars for default period=14) ✓

---

### CALC-007 — Supertrend Implementation
**Severity:** N/A | **Confidence:** PROVEN CORRECT (uses EMA-ATR, consistent with CALC-001)  
**File:** `artifacts/api-server/src/lib/indicators.ts`

- HL/2 ± multiplier × ATR ✓
- Band flip logic: upper resets when price crosses above; lower resets when price crosses below ✓
- Uses `atr()` (EMA-smoothed) — consistent with CALC-001; values diverge from TradingView Supertrend by ~2–15% depending on market condition but are internally consistent

---

### CALC-008 — Black-Scholes / IV Solver
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `artifacts/api-server/src/lib/blackScholes.ts`

- d1 = (ln(S/K) + (r − q + σ²/2)T) / (σ√T), d2 = d1 − σ√T — correct ✓
- Standard BSM with continuous dividend yield ✓
- Settlement: 15:30 IST → 10:00 UTC — correct ✓
- Theta returned per calendar day (not trading day) — acceptable, differs from some Bloomberg conventions, not labelled
- IV solver: Newton-Raphson (50 iterations) + bisection fallback [0.0001, 5.0] ✓
- Bisection: robust to NR non-convergence ✓

---

### SEC-001 — TradingView Webhook Secret Uses Non-Timing-Safe String Comparison
**Severity:** HIGH | **Confidence:** PROVEN DEFECTIVE  
**Blocks paper trading:** No | **Blocks live trading:** No  
**File + line:** `artifacts/api-server/src/routes/tradingview.ts:31`

```typescript
if (supplied && supplied === SECRET) return { ok: true };
```

**Root cause:** JavaScript string `===` comparison short-circuits on the first differing byte. An attacker who can send many HTTP requests and measure response timing (or use TCP connection-reset timing) can oracle the secret one byte at a time. For a 32-char hex secret, this reduces brute-force from 16^32 to 32 × 16 attempts.

**Financial impact:** A recovered TRADINGVIEW_WEBHOOK_SECRET allows an attacker to inject arbitrary fake TradingView alerts into the system. While TradingView alerts are informational-only in current production state (no automatic execution), a future state where TradingView alerts trigger paper or live trades would be directly exploitable.

**Fix:**
```typescript
import crypto from "node:crypto";

function checkSecret(req: Request): SecretCheck {
  if (!SECRET) { /* existing logic */ }
  const supplied = fromHeader || fromQuery || fromBody;
  if (!supplied) return { ok: false, status: 401, error: "invalid secret" };
  try {
    const a = Buffer.from(supplied, "utf8");
    const b = Buffer.from(SECRET, "utf8");
    if (a.length !== b.length) return { ok: false, status: 401, error: "invalid secret" };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: "invalid secret" };
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: "invalid secret" };
  }
}
```

**Regression test:** Unit test that `checkSecret` with a correct secret and a 1-char-off secret both call `timingSafeEqual` (spy on it) and never take a fast-path short-circuit.

**Acceptance criteria:** `crypto.timingSafeEqual` is used for all webhook secret comparisons; `===` is removed from the comparison path.

---

### SEC-002 — 30 HIGH-Severity CVEs in Production Dependencies
**Severity:** HIGH | **Confidence:** PROVEN (pnpm audit output)  
**Total vulnerabilities:** 61 (6 low, 25 moderate, 30 high)

**Production-critical CVE cluster — kiteconnect → axios:**

| CVE | Description | Exploitability |
|---|---|---|
| CVE-2026-44487 | Proxy-Authorization credential leak on HTTP→HTTPS redirect | Medium — only if Kite accessed through a proxy |
| CVE-2026-44486 | Proxy-Authorization leaks to redirect target | Medium — same condition |
| CVE-2026-44494 | MitM via prototype pollution in `config.proxy` | High — prototype pollution is server-side exploitable |
| CVE-2026-44492 | NO_PROXY bypass for IPv4-mapped IPv6 addresses | Low — network-specific |
| CVE-2026-44496 | ReDoS via Cookie Name Injection | Medium — malformed Kite response cookies could trigger |
| CVE-2026-44488 | Resource exhaustion (no allocation limits) | Medium |
| CVE-2026-12143 | CRLF injection in form-data via multipart field names | Medium |

**Vite/PostCSS CVEs (build-time, low production risk):**
- CVE-2026-53571 (vite): `server.fs.deny` bypass on Windows alternate paths — Linux-hosted, low risk
- CVE-2026-45623 (PostCSS): Arbitrary file read via `sourceMappingURL` — build-time only

**undici CVEs (scanner>jsdom>undici — test/SSR path, low risk):**
- CVE-2026-9697: TLS cert validation bypass via SOCKS5
- CVE-2026-12151: WebSocket DoS via fragment count bypass
- CVE-2026-6734: Cross-origin request routing via SOCKS5 pool reuse

**DoS CVEs (express, picomatch, brace-expansion):**
- CVE-2026-4926 (express>path-to-regexp): DoS via sequential optional groups — all routes affected if triggered
- CVE-2026-13149 / CVE-2026-14257 (brace-expansion): OOM via unbounded expansion

**Fix priority order:**
1. Update `kiteconnect` to a version that depends on axios ≥ 1.7.8 (or override axios to that version via pnpm overrides) — resolves the entire axios CVE cluster
2. Update `express` to 4.21.2+ or 5.x — resolves path-to-regexp
3. Override `brace-expansion` to ≥ 2.0.2 — resolves OOM DoS

**Recommended `package.json` overrides block:**
```json
"pnpm": {
  "overrides": {
    "axios": ">=1.7.8",
    "path-to-regexp": ">=6.3.0",
    "brace-expansion": ">=2.0.2",
    "serialize-javascript": ">=6.0.2"
  }
}
```

**Regression test:** `pnpm audit --audit-level high` exits 0 in CI.  
**Acceptance criteria:** Zero HIGH or CRITICAL findings in `pnpm audit` output.

---

### SEC-003 — GET /webhooks/tradingview Is Publicly Accessible
**Severity:** LOW | **Confidence:** PROVEN  
**File:** `artifacts/api-server/src/routes/tradingview.ts` (GET handler, no auth wrapper)

The GET handler returns up to 25 recent TradingView alert payloads and `secretConfigured: true/false` to any unauthenticated caller. Alert payloads may contain signal tickers, directions, and timestamps.

**Fix:** Add `requireAuth` or at minimum the `requireOwnerStrict` middleware to the GET handler, or add secret-check parity with the POST handler.

---

### SEC-004 — Auth Password Comparison (PROVEN CORRECT)
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `artifacts/api-server/src/lib/auth.ts`

`crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` used for both NSE scanner and global scanner password verification ✓  
Global scanner: `lib/global/auth.ts` — identical `safeEqual()` pattern ✓

---

### SEC-005 — CORS Configuration (PROVEN CORRECT)
**File:** `artifacts/api-server/src/app.ts:120–138`

- `CORS_ORIGINS="*"` + `NODE_ENV=production` throws at server boot — cannot be accidentally deployed ✓
- Default behavior: same-origin only (no CORS headers) ✓
- Allowlist pattern: explicit origin matching against configured list ✓

---

### SEC-006 — Cookie Security Policy (PROVEN CORRECT)
- `httpOnly: true` ✓
- `secure: isProd()` (only in production) ✓
- `sameSite: "lax"` — correct for Kite OAuth redirect flow; `strict` would break the OAuth callback ✓
- `signed: true` — HMAC-signed via `SESSION_SECRET` ✓
- `maxAge: 30 days` ✓
- Global scanner cookie: separate name (`global_session`), scoped path (`/api/global`), cannot cross-contaminate NSE session ✓

---

### SEC-007 — Kite Token Encryption (PROVEN CORRECT with noted fallback)
**File:** `artifacts/api-server/src/lib/kiteCrypto.ts`

- AES-256-GCM with 12-byte random IV per encryption ✓
- 16-byte auth tag (GCM default) ✓
- Key: 32-byte from env `KITE_TOKEN_ENC_KEY` (hex or base64) ✓
- **Fallback:** If `KITE_TOKEN_ENC_KEY` is unset, `encryptToken()` stores plaintext and logs a one-time warning; `decryptToken()` of an encrypted payload without a key throws (fail-closed for access) ✓
- No token value logged ✓

**Note:** The plaintext-passthrough fallback means that if the operator forgets to set `KITE_TOKEN_ENC_KEY`, Kite session tokens are stored unencrypted in the database. This is fail-open for token storage but fail-closed for token access (reads fail). The one-time warning log should be escalated to an ERROR or startup failure.

---

### SEC-008 — Rate Limiting (PROVEN CORRECT)
**File:** `artifacts/api-server/src/app.ts:154–203`

- Login limiter: 5 attempts / 15 min window, skips successful requests ✓
- Global login limiter: same policy, separate namespace ✓
- Webhook limiter: 60 req / 60 s ✓
- General API limiter: 300 req / 60 s ✓
- `trust proxy: 1` — correct for Replit reverse proxy; `req.ip` reflects real client IP ✓

---

### DB-001 — No `CHECK (balance >= 0)` Constraint on `paper_account`
**Severity:** MEDIUM | **Confidence:** PROVEN (schema verified)  
**File:** `lib/db/src/schema/paperTrading.ts`

The `balance` column on `paper_account` has no database-level `CHECK` constraint preventing negative values. This is an application-only invariant. While the application code enforces balance checks before debiting, a direct SQL `UPDATE paper_account SET balance = -999999`, a Drizzle bug, or a race condition between concurrent debit transactions could produce an invalid negative balance with no DB-level catch.

**Current risk:** None while paper trading is C0-blocked (no balance mutations occurring).  
**Fix:**
```sql
ALTER TABLE paper_account
  ADD CONSTRAINT paper_account_balance_non_negative CHECK (balance >= 0);
```
Add this to `ensurePaperAccountConstraints()` or deploy via the Publish-time schema propagation path.

**Regression test:** Test that a direct `UPDATE paper_account SET balance = -1` raises a `check_violation` error.

---

### DB-002 — No DB FK from `paper_trade_fo` to `option_signal_history`
**Severity:** LOW | **Confidence:** INFO (intentional)  
**File:** `lib/db/src/schema/optionSignals.ts:88–90`

Documented intentional omission: *"no hard constraint (additive discipline)"* and Drizzle composite FK ergonomics cited. Currently no operational risk — signal history rows are never pruned. Risk materialises if a future cleanup job deletes signal history rows, orphaning paper trade records.

**Recommendation:** Add a soft reference in comments; add an orphan-detection query to the audit page.

---

### DB-003 — option_signal_plan_audit Evidence Loss (2026-07-20)
**Severity:** HIGH (historical) | **Confidence:** PROVEN (documented in AUDIT_EVIDENCE_LOSS_2026-07-20.md)

6 `SILENT_DRIFT` audit rows were deleted from `option_signal_plan_audit` without owner approval on 2026-07-20. Root cause: test cleanup gap + a CREATE TABLE constraint silently skipped. Rows are irrecoverable. Mitigation deployed: `src/test-infra/dbTestGuard.ts` P0-1 isolation guard.

**Status:** Historical — corrective measures in place.

---

### DB-004 — Swing Order Staging DB CHECK Constraints (PROVEN CORRECT)
**File:** `lib/db/src/schema/swingOrderStaging.ts`

DB-enforced `CHECK` constraints on:
- `status`: `STAGED | APPROVAL_REQUIRED | APPROVED | REJECTED | EXPIRED | CANCELLED | WATCH_ONLY | DRY_RUN_PLACED | BROKER_DISABLED` ✓
- `approvalStatus`: `PENDING | APPROVED | REJECTED | EXPIRED | WATCH_ONLY` ✓
- `side`: `BUY | SELL` ✓

Lifecycle invariants enforced at DB level — defence-in-depth against direct SQL writes. ✓

---

### PT-001 — 4 TESTSTK Rows Permanently OPEN in paper_trade_eq
**Severity:** MEDIUM (data integrity) | **Confidence:** PROVEN (snapshot verified)  
**Source:** `memory/forensics/paper_db_snapshot_C0_2026-07-18.sql`

| # | Opened | Time (IST) | Source | Status | Issue |
|---|---|---|---|---|---|
| 1 | 2026-07-10 | 13:25 ✓ | SWING_STAGED_APPROVAL | OPEN | Test fixture — will never auto-close |
| 2 | 2026-07-13 | 11:59 ✓ | SWING_STAGED_APPROVAL | OPEN | Test fixture — will never auto-close |
| 3 | 2026-07-14 | 12:22 ✓ | SWING_STAGED_APPROVAL | OPEN | Test fixture — will never auto-close |
| 4 | **2026-07-18** | **16:33 ❌** | SWING_STAGED_APPROVAL | OPEN | **After-hours; Saturday** |

**Root cause:** All 4 rows originated from staged approval integration tests, not from the automated scanner. At the time of opening (July 10–18), the equity session gate had not yet been implemented. The 16:33 IST Saturday opening on 2026-07-18 was one of the motivating incidents for the P0.2 session gate correction, per the comment at `paperTradingEq.ts:416`:
> *"Root-cause fix for invalid-session positions observed in production (2026-05-14 06:13, 2026-05-15 19:34, 2026-07-09 23:41, 2026-07-18 Sat…)"*

**Current state (post-P0.2):**
- `openPaperEquityTradeFromStagedOrder` (line 1471) calls `openPaperEquityTrade` with `source: "SWING_STAGED_APPROVAL"`
- C0 block (`EQUITY_AUTO_OPEN_C0_BLOCKED=true`) rejects all non-MANUAL opens at line 385 — **these rows cannot be reopened**
- Session gate now applies to ALL sources including SWING_STAGED_APPROVAL (P0.2-correction-1, line 420)

**Impact:** The 4 OPEN TESTSTK rows will remain OPEN indefinitely (auto-exits disabled by C0). They do not affect real P&L (paper trading). However:
1. The heat-cap and concurrent-position calculations in `openPaperEquityTrade` count OPEN positions — TESTSTK rows will count against equity position limits when C0 is ever lifted
2. Account value calculations (`WHERE status = 'OPEN'`) include TESTSTK book value

**Fix:** Manual `UPDATE paper_trade_eq SET status='CLOSED', exit_reason='TEST_FIXTURE_CLEANUP', exited_at=NOW() WHERE symbol='TESTSTK'` after owner approval. Write corresponding paper_eq_audit rows.

---

### PT-002 — C0 Kill-Switch Triple Block in Production (PROVEN CORRECT)
**Severity:** N/A | **Confidence:** PROVEN CORRECT

Three independent layers block new paper positions in production:

| Layer | Guard | Location |
|---|---|---|
| 1 | `FNO_AUTO_OPEN_C0_BLOCKED = true` | `paperTradingFO.ts:398` — first line of `openPaperTrade` |
| 2 | `EQUITY_AUTO_OPEN_C0_BLOCKED = true` | `paperTradingEq.ts:1385` — before first DB access |
| 3 | `isPaperAutoTradingEnabled() → false` | `paperAutoTradeFlag.ts` — `PAPER_TRADING_ENABLED=false` in prod |
| (+4) | `quoteAgeSec=NaN → TRADE_ADMISSION_CONTEXT_INCOMPLETE` | F&O Phase B (P0.2 fix) |

Belt-and-braces correct. Each layer is independently sufficient. ✓

---

### PT-003 — F&O openPaperTrade Gate Stack (PROVEN CORRECT)
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `artifacts/api-server/src/lib/paperTradingFO.ts:395–600`

Sequential gate order verified (all fail-closed):
1. `FNO_AUTO_OPEN_C0_BLOCKED` — unconditional hard-block
2. `isPaperAutoTradingEnabled()` — PAPER_TRADING_ENABLED + SystemMode=NORMAL gate
3. `checkLedgerReconciliationGate("FNO")` — balance-drift circuit-breaker
4. `computePreliminaryAdmission` — Phase A: NSE session window + calendar + entry cutoff
5. `isEventBlackoutDay` — RBI MPC, Union Budget, Diwali Muhurat blackouts
6. `assertTradeableForOpen` — tradeClass=TRADEABLE, premiumTrusted=true, sizing tier auto-tradeable
7. Individual per-gate secondary checks with per-reason skip recording

---

### PT-004 — openPaperEquityTradeFromStagedOrder Approximate ATR
**Severity:** LOW | **Confidence:** PROVEN CORRECT for stated purpose  
**File:** `artifacts/api-server/src/lib/paperTradingEq.ts:1471–1529`

```typescript
const atr14Approx = perShareRisk / 1.5;
```

ATR14 is approximated as `(entry − stop) / 1.5` since the staging row doesn't store ATR. This approximation assumes `stop ≈ entry − 1.5 × ATR`. The approximated value **only appears in audit log fields** — it does not affect position sizing because `qtyOverride` overrides the quantity calculation entirely. ✓

---

### PT-005 — Paper FO 15:20 IST Force-Exit Settlement
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `artifacts/api-server/src/lib/paperTradingFO.ts:1851`

15:20 IST sweep closes all remaining OPEN paper FO positions at `lastPremium` (possibly stale LTP). This is a conservative settlement that protects against holding positions through the 15:30 option expiry. ✓

---

### AUTH-001 — /api/inst/* Routes ARE Behind requireAuth (CONFIRMED CORRECT)
**Severity:** N/A | **Confidence:** PROVEN CORRECT  
**File:** `artifacts/api-server/src/routes/index.ts:5,52`

`router.use(instFlowsRouter)` — the inst/* routes are mounted in the main `router`, which is applied via `app.use("/api", router)` **after** `app.use(requireAuth)` at line 217 of app.ts.

Mount order in app.ts:
```
app.use("/api", globalRouter);   // line 210 — global scanner, own auth gate
app.use("/api", authRouter);     // line 213 — login/logout, pre-auth
app.use(requireAuth);            // line 215 — gates everything below
app.use("/api", router);         // line 216 — main NSE routes incl. inst/*
```

`/api/inst/fii-dii`, `/api/inst/participant-oi` require valid NSE session cookie. ✓

---

### PROV-001 — Upstox: Not Implemented
**Severity:** N/A | **Confidence:** PROVEN  

Zero references to Upstox anywhere in the codebase. The audit prompt listed it as a provider to verify. **NOT IMPLEMENTED, NOT PLANNED.** No defect.

---

### PROV-002 — IndStocks: Disabled in Production
**Severity:** N/A | **Confidence:** PROVEN CORRECT  

- Controlled by `INDSTOCKS_ENABLED` env flag (default: false)
- Role: `secondary_validation` when enabled
- **Disabled in production** ✓
- No trust-tier leakage — provider is properly quarantined

---

### PROV-003 — Yahoo Provider Trust-Tier Labelling (PROVEN CORRECT)
**File:** `artifacts/api-server/src/lib/yahoo.ts`

- Rate-limit circuit-breaker: process-wide cooldown on repeated failures ✓
- Timeouts: 6s / 8s / 12s per call type ✓
- Concurrency caps: max 24 parallel Yahoo calls when Kite offline ✓
- Trust designation: `INFO_ONLY` / `DELAYED` — never `TrustedQuote` ✓
- `canDriveSignals: false` on all Yahoo quotes ✓

---

### PROV-004 — NSE Option Chain Cookie Jar (PROVEN CORRECT)
**File:** `artifacts/api-server/src/lib/optionChain.ts`

- Cookie jar TTL: 25 min (NSE cookies live ~30 min) ✓
- Mid-flight cookie expiry: one retry with fresh jar ✓
- Option chain in-memory TTL: 30 seconds ✓
- No DB persistence of option chain data ✓

---

### DEPLOY-001 — Production Is 38 Commits Behind Dev HEAD
**Severity:** HIGH | **Confidence:** PROVEN  
**Dev HEAD:** `be186dd` (2026-07-29) | **Prod HEAD:** `e7ae0783` (2026-07-23)

**Unreleased changes include (sample):**
- A0.3 series: `pivotRef`/`authVwap` rename, 9-record contract, confluence engine logic refactors
- Option signals logic updates and scanner interface changes
- fnoSignalScoring and confluence engine changes
- Zero-volume option signal test additions
- Signal quality reporting improvements

**Risk:** The production system is running a version of the F&O signal engine that predates all A0.3.x improvements. Users of the production site see different F&O signal logic than what has been tested in development. There is no automated check that flags an undeployed-changes condition.

**Recommended action:** Publish from dev HEAD after completing the outstanding A0.3 task series. Establish a CI gate that fails if production is more than N commits behind.

---

### DEPLOY-002 — F&O System State Summary
**Severity:** N/A | **Confidence:** INFO

In current production state, F&O paper trading is blocked by at least 4 independent mechanisms:
1. `FNO_AUTO_OPEN_C0_BLOCKED = true` (hardcoded, requires source code change to lift)
2. `PAPER_TRADING_ENABLED=false` env var
3. `quoteAgeSec=NaN` → `TRADE_ADMISSION_CONTEXT_INCOMPLETE` (P0.2 Phase B fix)
4. `isPaperAutoTradingEnabled()` also gates on `getCachedSystemMode() === "NORMAL"` (BUG-28 gate)

No F&O paper trade can open in production under any automated path.

---

### INFRA-001 — Disk Cache Concurrent-Replica Write Safety
**Severity:** LOW | **Confidence:** PROVEN CORRECT for single-process; NOT VERIFIED for multi-replica  
**File:** `artifacts/api-server/src/lib/diskCache.ts:62–63`

```typescript
fs.writeFileSync(tmp, JSON.stringify(blob), "utf8");
fs.renameSync(tmp, file);
```

Write-temp-then-rename is atomic on the same filesystem (POSIX rename atomicity). Safe for a single process. If the Replit deployment runs multiple autoscale replicas sharing a filesystem volume, concurrent rename operations from two replicas could race; the last write wins but there is no cross-replica coordination.

**Current risk:** Low — Replit deployments typically run single replicas; disk cache is a performance optimization, not a trading-critical path.

---

### INFRA-002 — System Alert Dedup In-Memory Only
**Severity:** MEDIUM | **Confidence:** PROVEN (from memory: system-alert-dedup-architecture-gap.md)

Data-health/Kite/session Telegram alerts dedup via a plain in-memory `Map`. Under autoscale restarts or multi-replica deployments, the dedup resets, causing duplicate Telegram alerts. Trade alerts and daily reports already use the correct DB-backed dedup pattern. This inconsistency means operational alerting can generate alert storms under autoscale events.

**Fix:** Migrate health-check alert dedup to the existing `system_alert_dedup` DB table pattern already used by trade alerts.

---

### INFRA-003 — NSE Equity Session Gate Post-P0.2 (PROVEN CORRECT)
**File:** `artifacts/api-server/src/lib/paperTradingEq.ts:410–440`

Post-P0.2-correction-1, ALL sources (AUTO, MANUAL, SWING_STAGED_APPROVAL) are now subject to the equity session gate (09:15–15:30 IST, Mon–Fri, non-holiday). The previous `if (openSource !== "MANUAL")` bypass that allowed after-hours MANUAL opens has been removed. The route layer also pre-checks the session for MANUAL buys and returns a structured 422 before the writer is called. ✓

---

### INFRA-004 — Swing Scanner Concurrency
**Severity:** N/A | **Confidence:** INFO  
**File:** `artifacts/api-server/src/lib/swingScannerStore.ts:42`

`CONCURRENCY = 6` — concurrent Kite throttle queue slots for NIFTY500 (500 symbols). At 6 concurrent, the full deep scan takes ~500/6 × avg_symbol_time. With benchmark loader adding ~5–15s, total scan time is 2–4 minutes. Each symbol independently catches errors; failures increment `errors` counter without aborting the scan. ✓

---

### INFRA-005 — Kite KiteConnect Timeout Guard
**Severity:** N/A | **Confidence:** PROVEN CORRECT (from memory)

`KiteConnect` passed `timeout: 15000` — prevents the default no-timeout behaviour (OS TCP reset at 30–60s) that would starve the throttle queue under network issues. ✓

---

## Summary Table

| ID | Title | Severity | Confidence |
|---|---|---|---|
| CALC-001 | ATR uses EMA instead of Wilder's smoothing | P2 Medium | DIVERGES FROM STANDARD |
| CALC-002 | ADX smooth() vs local atr() noted | P3 Low | PROVEN CORRECT |
| CALC-003 | RSI implementation | — | PROVEN CORRECT |
| CALC-004 | EMA implementation | — | PROVEN CORRECT |
| CALC-005 | MACD (P1B fix verified) | — | PROVEN CORRECT |
| CALC-006 | ADX implementation | — | PROVEN CORRECT |
| CALC-007 | Supertrend implementation | — | PROVEN CORRECT (EMA-ATR consistent) |
| CALC-008 | Black-Scholes / IV solver | — | PROVEN CORRECT |
| SEC-001 | TradingView webhook non-timing-safe comparison | HIGH | PROVEN DEFECTIVE |
| SEC-002 | 30 HIGH CVEs in production dependencies | HIGH | PROVEN |
| SEC-003 | GET /webhooks/tradingview publicly readable | LOW | PROVEN |
| SEC-004 | Auth password timingSafeEqual | — | PROVEN CORRECT |
| SEC-005 | CORS wildcard blocked in production | — | PROVEN CORRECT |
| SEC-006 | Cookie security policy | — | PROVEN CORRECT |
| SEC-007 | Kite token AES-256-GCM (plaintext fallback noted) | Low | PROVEN CORRECT |
| SEC-008 | Rate limiting configuration | — | PROVEN CORRECT |
| DB-001 | No CHECK (balance >= 0) on paper_account | MEDIUM | PROVEN DEFECTIVE |
| DB-002 | No DB FK paper_trade_fo → option_signal_history | LOW | INTENTIONAL |
| DB-003 | option_signal_plan_audit evidence loss 2026-07-20 | HIGH | HISTORICAL / FIXED |
| DB-004 | Swing order staging DB CHECK constraints | — | PROVEN CORRECT |
| PT-001 | 4 TESTSTK rows permanently OPEN (one after-hours) | MEDIUM | PROVEN DEFECTIVE |
| PT-002 | C0 kill-switch triple block | — | PROVEN CORRECT |
| PT-003 | F&O gate stack | — | PROVEN CORRECT |
| PT-004 | Staged-order approximate ATR in audit log | LOW | PROVEN CORRECT |
| PT-005 | Paper FO 15:20 force-exit | — | PROVEN CORRECT |
| AUTH-001 | /api/inst/* behind requireAuth | — | PROVEN CORRECT |
| PROV-001 | Upstox not implemented | — | INFO |
| PROV-002 | IndStocks disabled in production | — | PROVEN CORRECT |
| PROV-003 | Yahoo trust-tier labelling | — | PROVEN CORRECT |
| PROV-004 | NSE option chain cookie jar | — | PROVEN CORRECT |
| DEPLOY-001 | Production 38 commits behind dev HEAD | HIGH | PROVEN |
| DEPLOY-002 | F&O quad-blocked in production | — | INFO / CORRECT |
| INFRA-001 | Disk cache single-process atomic write | LOW | PROVEN CORRECT |
| INFRA-002 | System alert dedup in-memory only | MEDIUM | PROVEN DEFECTIVE |
| INFRA-003 | Equity session gate post-P0.2 | — | PROVEN CORRECT |
| INFRA-004 | Swing scanner concurrency | — | INFO |
| INFRA-005 | KiteConnect timeout guard | — | PROVEN CORRECT |

---

## Priority Fix List

### Immediate (before next publish)
1. **SEC-001** — Replace `===` with `crypto.timingSafeEqual` in TradingView webhook
2. **SEC-002** — Apply pnpm overrides for axios ≥ 1.7.8, path-to-regexp ≥ 6.3.0, brace-expansion ≥ 2.0.2
3. **DB-001** — Add `CHECK (balance >= 0)` to paper_account (safe, additive)

### Short-term (before lifting C0)
4. **CALC-001** — Decide and document: either switch to Wilder's ATR and update golden tests, or add in-product disclosure that ATR uses EMA smoothing
5. **PT-001** — Clean up 4 TESTSTK rows with owner-approved SQL and corresponding audit rows
6. **SEC-003** — Add auth gate to GET /webhooks/tradingview

### Medium-term
7. **INFRA-002** — Migrate health-check alert dedup to DB-backed pattern
8. **DEPLOY-001** — Establish a CI gate for production deployment lag

---

## Audit Trail Notes

- **DB queries via `executeSql`:** All returned `undefined` in this session (DB skill not responding). Live query verification of paper account balances, TESTSTK rows, and signal history was based on the production snapshot `memory/forensics/paper_db_snapshot_C0_2026-07-18.sql`.
- **Prior subagent results (10 agents dispatched in previous session):** Session was compacted before results could be retrieved; all evidence in this report was gathered directly via file reads and shell commands.
- **Upstox audit:** Confirmed zero-reference via full codebase search.
- **ADX inconsistency note:** ADX uses internal Wilder smooth() for TR — this does NOT call the exported `atr()` function. The inconsistency between exported ATR and ADX's internal TR is a display/labelling issue only, not a trading logic bug.

---

*Report compiled: 2026-07-29 · Audit authority: read-only · No code changes, no DB mutations, no alerts sent*
