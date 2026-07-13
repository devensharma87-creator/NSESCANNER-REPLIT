# URGENT PROFESSIONAL CODER PROMPT — STOP LOOPING: F&O INTRADAY FALSE “MARKET IS CLOSED” ROOT-CAUSE CLOSEOUT

## Situation

We are stuck on the same F&O Intraday / `/options` page bug. The owner still sees **“Market is closed”** even when it should not appear during IST market hours.

The latest investigation already found useful facts:

- DEV fix commit: `339a9743d1fa9e1a6f11abaa6229bbf39c8367b9`
- Production was still pending deploy at the time of evidence.
- `/api/options/signals` previously returned HTTP 500 due `contractInstrumentToken` Zod mismatch.
- Backend now has rich `marketStatus`.
- `execution` truth was previously stripped by OpenAPI/Zod and is now added.
- The deeper repeated bug is stale React Query/browser cached data:
  - old cached payload has `marketStatus` absent
  - old cached payload may have deprecated `marketState="closed"`
  - UI still trusted that stale deprecated field and showed the “Market is closed” card.

Now stop patching randomly. Do one controlled closeout.

---

# Current verdict

Use current status:

`PHASE_2A_FNO_MARKET_CLOSED_STALE_CACHE_FIX_DEV_PROGRESS`

Do not claim production verified until the real production page is proven.

---

# Non-negotiable rules

1. Do not start new lanes.
2. Do not change strategy logic.
3. Do not change F&O signal thresholds, scoring, gates, stops, targets, or trade eligibility.
4. Do not touch P&L/accounting/ledger.
5. Do not place real broker orders.
6. Do not send real Telegram messages.
7. Do not do “maybe fixed.” Provide root cause, exact diff, tests, deploy proof, browser proof.

---

# Final objective

The F&O Intraday page must never show **“Market is closed”** unless the current rich market-status payload explicitly says:

```ts
marketStatus.marketOpen === false
```

with a valid reason:

```ts
BEFORE_OPEN | AFTER_CLOSE | WEEKEND | HOLIDAY | SPECIAL_SESSION_CLOSED
```

If `marketStatus` is missing, stale, undefined, or API errored, do **not** show “Market is closed.”

---

# Part 1 — First prove what code is actually deployed

Before writing any code, capture:

```bash
curl -s https://marketscannerbydev.in/api/build-info
```

Return:

| Check | Evidence |
|---|---|
| production commitShort |
| production commitSha |
| buildTime |
| bootTime |
| environment |
| frontend bundle filename |
| is commit `339a9743` or later live? yes/no |

If production is not on the latest fix commit, stop code work and publish/deploy first.

Allowed verdict if not deployed:

`PHASE_2A_FNO_MARKET_CLOSED_FIX_BUILD_NOT_DEPLOYED`

---

# Part 2 — Find every renderer that can show “Market is closed”

Run exact searches:

```bash
grep -R "Market is closed" -n artifacts scanner lib src . || true
grep -R "Market closed" -n artifacts scanner lib src . || true
grep -R "marketState" -n artifacts/scanner/src artifacts/api-server/src lib || true
grep -R "marketStatus" -n artifacts/scanner/src artifacts/api-server/src lib || true
grep -R "No setups because the market is closed" -n . || true
```

Create a table:

| File | Line | Text rendered | Condition used | Uses deprecated marketState? | Fix needed? |
|---|---:|---|---|---|---|

Do not guess. Find every possible source of the message.

---

# Part 3 — Implement one canonical F&O UI state function

Create or centralize a pure function, for example:

```ts
deriveFnoIntradayUiState({
  data,
  error,
  isLoading,
  nowIst,
})
```

It must return one of:

```ts
"LOADING"
"API_ERROR"
"MARKET_STATUS_UNKNOWN"
"MARKET_OPEN_WITH_SETUPS"
"MARKET_OPEN_NO_TRADEABLE_SETUP"
"MARKET_CLOSED_BEFORE_OPEN"
"MARKET_CLOSED_AFTER_CLOSE"
"MARKET_CLOSED_WEEKEND"
"MARKET_CLOSED_HOLIDAY"
"MARKET_CLOSED_SPECIAL_SESSION"
```

Use this single function for:
1. F&O Intraday main `/options` page.
2. empty state.
3. session banner.
4. any signal alerter/diagnostic card that can show market-closed copy.
5. any Paper Trading F&O tab if it shares the same component/state.

---

# Part 4 — Correct logic

## Allowed market-closed condition

Only this is allowed:

```ts
data?.marketStatus?.marketOpen === false
```

## Forbidden for showing “Market is closed”

These must not trigger market-closed UI:

```ts
data?.marketState !== "open"
data?.marketState === "closed"
data?.marketState === "pre_open"
!data
data == null
error
api 500
marketStatus missing
stale cached payload
```

If `marketStatus` is missing, show:

```text
Live market status unavailable — refreshing Kite/NSE status...
```

or

```text
No live setup currently. Waiting for fresh market-status payload.
```

Never show **“Market is closed”** from stale `marketState`.

---

# Part 5 — Fix stale React Query / browser cache properly

The same bug keeps coming back because stale cached pre-fix payloads survive.

Do all applicable fixes:

1. Include API/build version or schema version in React Query key for `/api/options/signals`.
2. When fetched payload lacks `marketStatus`, treat it as stale/legacy and invalidate/refetch.
3. Do not render the market-closed card while legacy payload is present.
4. On app boot after new build, clear/invalidate old F&O signal query cache.
5. If persisted cache/localStorage is used, bump cache schema version and purge old F&O keys.
6. Add a dev-only console/debug line:
   - `commitShort`
   - `marketStatus.marketOpen`
   - `marketStatus.reason`
   - whether payload is legacy/missing marketStatus

Return exactly what cache mechanism exists and what was changed.

---

# Part 6 — Required API behavior

`/api/options/signals` must return HTTP 200 and always include:

```ts
marketStatus: {
  isTradingDay: boolean;
  marketOpen: boolean;
  reason: "OPEN" | "BEFORE_OPEN" | "AFTER_CLOSE" | "WEEKEND" | "HOLIDAY" | "SPECIAL_SESSION_CLOSED" | "UNKNOWN";
  serverUtc: string;
  serverIst: string;
  exchangeTimezone: "Asia/Kolkata";
  openTimeIst: "09:15";
  closeTimeIst: "15:30";
  calendarSource: string;
  calendarAsOf: string;
}

setupState: {
  indicesEvaluated: number;
  liveSetupsCount: number;
  tradeableCount: number;
  suppressedCount: number;
  noSetupReason: string | null;
}
```

If a backend error occurs, the frontend must show an API/data error, not “Market is closed.”

---

# Part 7 — Execution confirmation must not regress

Also prove `/api/options/signal-history` includes `execution`.

Return one sample:

```json
{
  "executionStatus": "NOT_APPLICABLE",
  "executionBlockedReason": "BASELINE_NOT_TRADEABLE",
  "paperTradeOpened": false,
  "finalAlertClass": "INFO_ONLY"
}
```

INFO_ONLY must never show false `NOT_CONFIRMED`.

---

# Part 8 — Tests required

Add/verify these tests.

## Market-state tests

1. `marketStatus.marketOpen=true` + `liveSetupsCount=0`
   - UI says: `Market open — no live tradeable setup currently.`
   - does not show “Market is closed.”

2. `marketStatus.marketOpen=false`, reason `AFTER_CLOSE`
   - UI says after-close reason.

3. `marketStatus.marketOpen=false`, reason `WEEKEND`
   - UI says weekend reason.

4. `marketStatus` absent + stale `marketState="closed"`
   - must not show “Market is closed.”

5. `marketStatus` absent + stale `marketState="pre_open"`
   - must not show “Market is closed.”

6. API error / `data=undefined`
   - must not show “Market is closed.”

7. Monday `10:12 IST`
   - `marketOpen=true`.

8. Monday `09:14 IST`
   - `BEFORE_OPEN`.

9. Monday `15:31 IST`
   - `AFTER_CLOSE`.

10. NSE holiday
   - `HOLIDAY`.

## Execution tests

1. INFO_ONLY execution → not applicable / no paper expected.
2. TRADEABLE + paper row → confirmed.
3. TRADEABLE + blocked → exact blocked reason.
4. True missing paper record → investigation required, not generic misleading text.

---

# Part 9 — Required commands

Run and report exact counts:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/scanner run typecheck
pnpm --filter @workspace/scanner exec vitest run
pnpm --filter @workspace/api-server exec vitest run src/lib/marketEvents.test.ts src/lib/dailyReports.test.ts src/lib/contractMasterFact.test.ts
pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check
```

Do not say “all pass.” Give exact counts.

---

# Part 10 — Production verification after deploy

After publishing the final fix, prove production.

## Build proof

| Check | Evidence |
|---|---|
| `/api/build-info` commitShort |
| commitSha |
| buildTime |
| bootTime |
| environment |
| bundle filename |
| verify:release result |

## API proof

Authenticated or public call as applicable:

| Field | Production value |
|---|---|
| HTTP status |
| marketStatus.marketOpen |
| marketStatus.reason |
| serverIst |
| exchangeTimezone |
| setupState.liveSetupsCount |
| setupState.tradeableCount |
| sample contractInstrumentToken type |
| signalHistory execution present |

## Browser proof

Use a real browser session.

1. Hard refresh `/options`.
2. Clear site cache/localStorage/React Query persisted cache if needed.
3. Capture DOM text/screenshot.
4. Confirm:
   - during market open, no false “Market is closed.”
   - stale legacy payload does not show market-closed card.
   - API error does not show market-closed card.
   - execution popup no longer falsely says `NOT_CONFIRMED` for INFO_ONLY.

---

# Part 11 — Report updates

Update:

1. `FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md`
2. `FULL_PLATFORM_BUG_REGISTER.csv`
3. `USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md`
4. `POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md`
5. `docs/fno-signal-gap-audit/AUDIT-REPORT-2026-06-30.md`

---

# Final response format

Return exactly this structure:

## Verdict

One of:
- `PHASE_2A_FNO_MARKET_CLOSED_STALE_CACHE_FIX_DEV_VERIFIED`
- `PHASE_2A_FNO_MARKET_CLOSED_STALE_CACHE_FIX_PROD_VERIFIED`
- `PHASE_2A_FNO_MARKET_CLOSED_FIX_BUILD_NOT_DEPLOYED`
- `RELEASE_INTEGRITY_REGRESSION_FOUND`
- `ROLLBACK_REQUIRED`

## Root cause table

| Issue | Root cause | Fixed file | Proof |
|---|---|---|---|

## Code audit table

| Market-closed renderer | Old condition | New condition | Verdict |
|---|---|---|---|

## Cache handling proof

| Cache/stale source | Fix | Proof |
|---|---|---|

## API proof

| Field | Value |
|---|---|

## Browser proof

| Scenario | DOM/screenshot result | Verdict |
|---|---|---|

## Test counts

| Command | Count/result |
|---|---|

## Safety confirmation

Confirm:
- no broker execution
- no real orders
- no real Telegram send
- no strategy changes
- no signal scoring changes
- no risk-threshold changes
- no P&L/account rewrite
- no destructive DB migration

Do not provide long narrative. Only proof tables and final verdict.
