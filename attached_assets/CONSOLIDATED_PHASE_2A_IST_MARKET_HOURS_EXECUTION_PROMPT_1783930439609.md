# CONSOLIDATED CODER PROMPT — PHASE 2A CLOSEOUT + IST MARKET-HOURS BUG

## Context

The previous “deploy current commit only” prompt was NOT sent before the latest coder response.

Latest coder evidence says production is now published on:

- commitShort: `7be8c17d`
- commitSha: `7be8c17d371c3625e281e04b05be261bb5b25b24`
- buildTime: `2026-07-13T07:35:51.838Z`
- bootTime: `2026-07-13T07:37:37.043Z`
- environment: production
- verify:release: `11 PASS / 0 WARN / 0 FAIL`

Production paperConversion preview now works with owner auth:

- stagedOrderId: `1e42fcf6-7b12-4946-9f89-cba21758604a`
- symbol: `HDFCBANK`
- approvalStatus: `APPROVED`
- source: `SWING_STAGED_APPROVAL`
- paperConversion.opened / wouldOpen: `false`
- blockedReason: `CONCURRENT_CAP`
- availableCapital: `₹58.59`
- requiredCapital: `₹4,950`
- brokerExecution: `false`
- brokerExecutionEnabled: `false`
- brokerStatus: `DISABLED`
- no real order placed

Accepted sub-statuses:

- `PHASE_2A_SWING_TELEGRAM_FNO_P0_DEV_VERIFIED`
- `PHASE_2A_PROD_BUILD_DEPLOYED_RELEASE_REGRESSION_VERIFIED`
- `PHASE_2A_PROD_AUTH_FUNCTIONAL_CORE_VERIFIED`
- `PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING`
- `PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED`

Do not waste time re-proving the above unless a regression is detected.

---

# Important new issue from owner screenshots

The F&O Live Setups page shows:

- `Kite LIVE`
- a signal popup triggered at around `10:13 IST`
- but the Live Setups panel says:
  `Market is closed`
- page says:
  `0 live setups across 0 indices`
- popup says:
  `Execution not confirmed — no paper trade record found for this signal. This may indicate a server restart or timing gap.`

The website must use **Asia/Kolkata / IST** for all market-open checks, report scheduling, and user-facing timestamps.

NSE Equity Derivatives normal market open/close is currently `09:15` to `15:30` IST. If exchange timing changes are configured in the app, use the official calendar/config source and label it.

---

# P0 Task A — Fix IST market-hours/live setup bug

## Problem

During apparent market hours, the UI shows “Market is closed.”

This is wrong unless the actual date is a holiday/weekend/special market-closed day.

## Required audit

Trace the full path:

1. F&O Live Setups frontend component.
2. API endpoint that returns live setup status.
3. market-hours utility.
4. trading-day / holiday calendar utility.
5. server timezone.
6. browser timezone assumptions.
7. any cache layer that stores `marketOpen=false`.
8. deployment/build timestamp.

## Required API payload

The live setup API must return explicit fields:

```ts
{
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
  },
  setupState: {
    indicesEvaluated: number;
    liveSetupsCount: number;
    tradeableCount: number;
    suppressedCount: number;
    noSetupReason?: string;
  }
}
```

## Required frontend behavior

Do not show “Market is closed” when `marketStatus.marketOpen=true`.

Use these states:

1. `marketOpen=true` + `liveSetupsCount=0`:
   - show: `Market open — no live tradeable setup currently.`
2. `marketOpen=true` + signal generated but no paper record:
   - show: `Signal triggered — paper execution not confirmed.`
3. `marketOpen=false`:
   - show exact reason:
     - `Market closed — after 15:30 IST`
     - `Market closed — before 09:15 IST`
     - `Market closed — weekend`
     - `Market closed — NSE holiday`
4. Never use browser local timezone for exchange status unless converted to `Asia/Kolkata`.

## Required tests

Add tests for:

1. Monday trading day `10:12 IST` → `marketOpen=true`.
2. Monday trading day `09:14 IST` → `marketOpen=false`, reason `BEFORE_OPEN`.
3. Monday trading day `15:31 IST` → `marketOpen=false`, reason `AFTER_CLOSE`.
4. Weekend → `marketOpen=false`, reason `WEEKEND`.
5. NSE holiday → `marketOpen=false`, reason `HOLIDAY`.
6. Market open + zero setups → UI must NOT show “Market is closed.”
7. Market open + zero setups → UI says “Market open — no live tradeable setup currently.”
8. All timestamps shown to owner are IST.

---

# P0 Task B — Investigate “Execution not confirmed — no paper trade record found”

## Evidence

Owner screenshot popup:

`INFO ALERT — ENTRY LEVEL REACHED`

- Instrument: `BANK NIFTY 57900 CALL`
- Triggered at: `10:13:16 IST`
- Paper Trade: `NOT CONFIRMED`
- Message:
  `Execution not confirmed — no paper trade record found for this signal. This may indicate a server restart or timing gap.`

## Required audit

Trace:

1. signal row / signal ID
2. lifecycle trigger transition
3. paper trade creation function
4. paper_trade_fo insert
5. paper_trade_fo lookup used by popup
6. server restart / race timing
7. idempotency key / setup key
8. whether the popup is reading stale cache
9. whether signal is INFO_ONLY vs tradeable
10. whether paper trade is intentionally blocked by risk/capital/data gate

## Required output states

The UI/popup must distinguish:

1. `INFO_ONLY` signal:
   - `Info-only alert — no paper trade expected.`
2. `TRADEABLE_SIGNAL` but blocked by risk/capital/data:
   - `Paper trade blocked — [exact reason].`
3. `TRADEABLE_SIGNAL` trade created:
   - `Paper trade confirmed — trade ID [id].`
4. `TRADEABLE_SIGNAL` trade expected but missing:
   - `Execution mismatch — paper record missing. Investigation required.`
5. server restarted between signal and paper open:
   - `Execution not confirmed — server restart/timing gap detected.`

Do not display a generic scary message if the signal was never supposed to open a paper trade.

## Required tests

1. INFO_ONLY triggered alert → no paper trade expected message.
2. TRADEABLE signal + successful paper insert → confirmed trade ID.
3. TRADEABLE signal + blocked by risk/capital → exact blocked reason.
4. TRADEABLE signal + insert failure → execution mismatch with error code.
5. restart/timing gap → explicit restart/timing state.
6. popup must show signal ID/setup key/index/createdAt/triggeredAt in IST.

---

# P0 Task C — Confirm Phase 2A remaining statuses honestly

Do not mark full PROD_VERIFIED until the two time/capital dependent items are truly closed.

## Current honest status

```text
PHASE_2A_PROD_AUTH_FUNCTIONAL_CORE_VERIFIED
PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING
PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED
```

## Required proof still pending

1. Next scheduled pre-market run succeeds or retry behavior is captured.
2. A real `SWING_STAGED_APPROVAL` paper row opens after sufficient paper capital is available, OR an authenticated production dry-run proves the same exact code path and is explicitly accepted by owner.
3. Telegram dry-run includes the swing-open only when a swing-open exists.
4. Broker execution remains disabled.

---

# P0 Task D — Fix report schedule/date bug if present

The latest coder response said:

`2026-07-13 is Sunday — next run Mon 2026-07-14`

That date statement is wrong. `2026-07-13` is Monday and `2026-07-14` is Tuesday.

Audit all scheduling/date logic for:

1. weekday calculation source
2. timezone conversion
3. IST date boundary
4. pre-market scheduler `08:50 IST`
5. post-market scheduler
6. whether server UTC date is being confused with IST date

Add tests:

1. `2026-07-13 Asia/Kolkata` is Monday.
2. `2026-07-14 Asia/Kolkata` is Tuesday.
3. `08:50 IST` scheduled run maps to correct UTC time.
4. scheduler skips actual weekends only.
5. scheduler uses NSE holiday calendar, not hardcoded assumptions.

---

# Required production checks after fix

After deployment, provide:

| Check | Evidence | Verdict |
|---|---|---|
| `/api/build-info` commit after this fix |
| verify:release result |
| live setup API returns `serverIst` |
| live setup API returns marketStatus reason |
| 10:12 IST trading-day test passes |
| frontend no longer shows false “Market is closed” |
| popup execution state shows correct reason |
| broker execution disabled |
| no real order |
| no real Telegram send |

---

# Required test commands

Run and report exact counts:

```bash
pnpm --filter @workspace/scripts run verify:release
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:libs
pnpm --filter @workspace/api-server exec vitest run src/lib/*market*.test.ts src/lib/*calendar*.test.ts src/lib/*daily*.test.ts src/lib/*fno*.test.ts src/lib/*paper*.test.ts src/routes/**/*.test.ts
pnpm --filter @workspace/scanner run typecheck
pnpm --filter @workspace/scanner exec vitest run
pnpm --filter @workspace/scripts run index:llm
pnpm --filter @workspace/scripts run index:llm:check
```

Split timeouts and report exact counts.

---

# Final verdict options

Use exactly one:

- `PHASE_2A_IST_MARKET_HOURS_AND_EXECUTION_CONFIRMATION_PROD_VERIFIED`
- `PHASE_2A_IST_MARKET_HOURS_AND_EXECUTION_CONFIRMATION_DEV_VERIFIED`
- `PHASE_2A_PROD_LIVE_SWING_APPROVAL_SAMPLE_PENDING_CAPITAL_BLOCKED`
- `PRE_MARKET_RETRY_FIX_PROD_DEPLOYED_NEXT_RUN_PENDING`
- `RELEASE_INTEGRITY_REGRESSION_FOUND`
- `ROLLBACK_REQUIRED`

Do not use full Phase 2A PROD_VERIFIED until:
1. IST market-hours bug is fixed,
2. execution-not-confirmed popup is explained/fixed,
3. pre-market next run is captured or correctly marked next-run pending,
4. capital-blocked swing sample remains honestly labelled,
5. all safety checks pass.
