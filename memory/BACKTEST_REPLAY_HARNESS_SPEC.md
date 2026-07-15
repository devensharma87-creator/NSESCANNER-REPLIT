# MarketScanner — Backtest / Replay Regression Harness Spec (P2)

_Owner-approval spec — do not implement without explicit go-ahead._
_Author: iteration 9 (2026-07-15). Status: PROPOSED._

## 1. Motivation

Today's regression tests fall into two camps:

- **Unit / integration tests** (`vitest`): 3400+ tests. Pure math, DB
  identity, HTTP round-trips. Coverage is broad but shallow — each test
  arranges its own synthetic fixtures. Nothing exercises the **full
  end-to-end trading path** the platform runs in production:
  `tick → detector → gate → paper writer → reconciliation → report`.

- **Manual smoke checks**: production traffic monitored by ops. Slow,
  human-dependent, and only catches regressions after they land.

The gap is **deterministic replay of real recorded sessions** with
**golden-file assertions** against the trading engine's outputs. This is
what a backtest / replay regression harness fills.

## 2. Non-goals (strict)

- ❌ **Not** a research backtester. This is a **regression tool**, not a
  strategy sandbox. It cannot fabricate option data, mint synthetic
  ticks, or otherwise produce numbers that could be mistaken for
  live-broker output. All fixtures MUST originate from real Kite/NSE
  captures.
- ❌ **Not** live-trading. Zero broker calls. The `LiveOrderGuard` +
  `SystemMode` locks stay engaged in replay mode.
- ❌ **Not** a coverage extension of the existing `backtestRouter`
  under `/backtest/fno/*`. That endpoint continues to serve owner
  Backtest Lab UI; the regression harness is CLI-only and lives in
  the test tree.

## 3. Fixture format

### 3.1 Directory layout

```
/app/artifacts/api-server/src/__tests__/replay_fixtures/
  ├─ README.md                            ← how to record + attribution
  ├─ 2026-07-14-nifty-friday-expiry/
  │  ├─ manifest.json                     ← metadata
  │  ├─ ticks.jsonl                       ← Kite websocket capture (append-only)
  │  ├─ option_chain_snapshots.jsonl      ← 1/min chain snapshots
  │  ├─ index_boards.jsonl                ← 1/min board snapshots
  │  ├─ fii_dii.json                      ← EOD flows (may be null on intraday)
  │  ├─ system_events.jsonl               ← boot / mode transitions
  │  └─ golden/
  │     ├─ paper_trades_fo.jsonl          ← expected trades stamped in DB
  │     ├─ paper_trades_eq.jsonl
  │     ├─ signals.jsonl                  ← detector-emitted signals
  │     ├─ telegram_messages.jsonl        ← every alert the bot would send
  │     └─ reconciliation_snapshot.json   ← end-of-session identity
  └─ …
```

### 3.2 `manifest.json`

```jsonc
{
  "id": "2026-07-14-nifty-friday-expiry",
  "recordedAt": "2026-07-14T03:45:00Z",     // UTC boot time
  "sessionKind": "EXPIRY_FRIDAY",            // enum, drives regime detector
  "istDate": "2026-07-14",
  "kiteInstruments": ["NIFTY 50", "BANKNIFTY", "NIFTY IT"],
  "tickCount": 384211,
  "chainSnapshotCount": 360,
  "boardSnapshotCount": 360,
  "notes": "Captured with expiry-day-special-mode ON. Use to guard BUG-80.",
  "provider": "kite",                        // NEVER "synthetic"
  "sourceHash": "sha256:…",                  // guards against post-hoc edits
  "engineVersion": "paper-writer-v1.1.0-charges",
  "runtimeSeed": 42                          // for any random tie-breakers
}
```

### 3.3 Record format

- **`ticks.jsonl`**: one Kite `TickData` object per line, ordered by
  `receivedAtNs`. Includes LTP, LTQ, buy/sell depth (top 5), OI (for FO
  instruments), OI-change since prev tick.
- **`option_chain_snapshots.jsonl`**: one snapshot per 60s wall-clock,
  same shape as `/api/option-chain` response. Contains provenance
  (`source`, `fallbackUsed`, `isStale`) so replay can exercise the
  fallback path deterministically.
- **`system_events.jsonl`**: `SystemMode` transitions,
  `regimeDetector.currentRegime` changes, `kiteSessionMonitor`
  connect/disconnect edges. Replay driver injects these at their
  recorded wall-clock.

### 3.4 Fixture provenance guard

`providerImportGuard.ts` MUST refuse any fixture with `provider !== "kite"`
or a missing `sourceHash`. Replay boot verifies `sha256(ticks.jsonl +
option_chain_snapshots.jsonl + index_boards.jsonl) === manifest.sourceHash`.

## 4. Replay driver

### 4.1 Public surface

```ts
// src/__tests__/replayHarness/replayDriver.ts
import { replayFixture } from "./replayDriver";

const result = await replayFixture({
  fixtureId: "2026-07-14-nifty-friday-expiry",
  goldenMode: "ASSERT",              // ASSERT | RECORD (dev only)
  clock: "SIMULATED",                // never REAL — hard-locked in tests
  tickBudgetMs: 60_000,              // safety kill-switch
});
result.pass;                         // boolean
result.diffs;                        // structured diffs vs golden files
result.metrics;                      // tick throughput, engine latency p95
```

### 4.2 Determinism guarantees

1. **Deterministic clock** — `Date.now`, `performance.now` and
   `setTimeout` are wrapped. Time only advances when the driver
   consumes a tick. All broker/HTTP calls are asserted absent.
2. **Deterministic RNG** — every module using randomness reads from a
   seeded PRNG keyed on `manifest.runtimeSeed`. Global `Math.random`
   is trap-thrown in replay mode.
3. **Isolated Postgres** — replay uses a per-test transactional
   database (Drizzle `withTransaction` + rollback). Zero contamination
   of dev/prod tables.
4. **Frozen migrations** — replay boot pins Drizzle to
   `manifest.engineVersion`. Newer migrations run in a shadow schema.

### 4.3 Boot sequence

```
1. Load manifest.  verify sourceHash. refuse if provider != "kite".
2. Spin up in-memory Redis (or use an ephemeral namespace).
3. drizzle migrate → schema at manifest.engineVersion.
4. Seed `paper_account` rows to golden pre-state.
5. Register system_events queue.
6. Replace Kite client with `RecordedKiteClient(fixture)`.
7. Replace Telegram client with `RecordingTelegramClient()`.
8. Replace Yahoo/NSE providers with `RefuseFallbackProvider` UNLESS
   the fixture explicitly captured a fallback edge.
9. Start engine. Drive ticks in order.
10. On session end: compare all DB tables + Telegram outbox to golden.
```

### 4.4 Assertion strategy

- **Structural**: every row in `paper_trades_fo` must have exact
  {`symbol`, `side`, `entry_premium`, `exit_premium`, `charges_total`,
  `charges_status`, `writer_version`} match.
- **Numerical**: `realized_pnl`, `net_pnl` within 0.01. Anything wider
  is a bug.
- **Ordering**: Telegram messages must land in the exact recorded
  order — priority/tier drift is a bug.

## 5. Coverage targets (initial, incremental)

| # | Fixture | Guards | Priority |
|---|---------|--------|----------|
| 1 | `2026-07-14-nifty-friday-expiry` | BUG-80 expiry-day special mode, mean-reversion-only, 14:30 force close | P0 |
| 2 | `2026-06-24-banknifty-vix-spike` | Regime hysteresis + cooldowns (BUG-72-79) | P0 |
| 3 | `2026-05-19-kite-outage-yahoo-fallback` | Provider-guard, fallback chip degradation, LiveOrderGuard hard-lock | P0 |
| 4 | `2026-04-07-normal-monday` | Baseline sanity — should be a boring green run | P1 |
| 5 | `2026-03-15-boot-storm-rate-limit` | Phase 4 Telegram backoff, priority tiers | P1 |
| 6 | `2026-02-28-monthly-expiry-thursday` | Monthly-vs-weekly expiry accounting | P1 |
| 7 | `2026-01-…-mixed-charges-ledger` | Phase-A→Phase-B rollout boundary (mixed CURRENT + LEGACY_NOT_STORED rows) | P0 |

## 6. Rollout plan

### Phase R1 — Skeleton (1 day)
- `replayDriver.ts` scaffold with mock Kite/Telegram clients, no real
  engine yet.
- Deterministic clock + PRNG wrappers, tested in isolation.
- Fixture #4 recorded (small, baseline).

### Phase R2 — First golden run (2 days)
- Wire real engine to driver. Assert-mode against fixture #4.
- Iterate until byte-exact golden.
- CI gate: `replay:baseline` job runs fixture #4 on every PR.

### Phase R3 — Bug-guarding fixtures (3 days)
- Record fixtures #1 (expiry), #3 (Kite outage), #7 (rollout boundary).
- Golden diff review manual before merge.
- CI gate: full replay suite runs nightly.

### Phase R4 — Nightly regression + alerting (1 day)
- CI job posts a Telegram summary to the ops channel on any failure.
- Failures block deploy until diff explained.

## 7. Open questions (need owner input before implementation)

1. **Fixture storage**: check into git (~50–200 MB per session) or
   store in an artifact bucket (S3-compatible)? Recommendation:
   git-lfs for reproducibility.
2. **Live capture tooling**: who runs the "recorder"? A daily cron on
   the prod pod, or manually triggered on interesting session days?
   Recommendation: cron + owner-only manual endpoint that dumps the
   last N minutes to disk.
3. **Golden update flow**: `goldenMode="RECORD"` re-generates goldens.
   Should this require a codeowner approval on PR? Recommendation: yes,
   gate behind a `RECORD_GOLDEN=1` env in a dedicated `replay:record`
   npm script.
4. **How much of the option chain do we snapshot?** Full ATM ± N
   strikes, or the entire chain? Full is safer but larger.
   Recommendation: ATM ± 12 strikes (matches signal search radius).

## 8. Non-blocking prerequisites

- Producer visibility on `writer_version` — already stamped.
- Deterministic charge computation — already implemented (Phase A).
- Ledger identity keyed on `charges_status` — already implemented (Phase B).

None of the harness pieces require changes to the trading engine
itself. It's a pure test-time superset.

## 9. Estimated effort

- R1: 1 day
- R2: 2 days
- R3: 3 days
- R4: 1 day
- **Total ~7 dev-days** for first golden fixture + nightly CI. Adding
  each subsequent fixture is ~2–4 hours (record + iterate golden).

## 10. Acceptance criteria (owner sign-off)

Before starting R1, owner must confirm:
- [ ] Fixture storage location (git-lfs vs bucket).
- [ ] Recorder ownership (cron vs manual).
- [ ] Golden update flow (RECORD_GOLDEN gate).
- [ ] Priority ordering of the 7 candidate fixtures.
- [ ] Whether replay outputs should include a per-fixture PDF summary
      (nice-to-have; adds ~4h).
