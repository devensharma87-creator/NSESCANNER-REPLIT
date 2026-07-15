# MarketScanner — Backtest / Replay Regression Harness Spec (P2)

_Owner-decisions locked (see §12). Ready for R1 implementation._
_Author: iteration 9 · revised iteration 10 (2026-07-15). Status: **APPROVED FOR R1**._

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

## 2. Non-goals (STRICT — enforced by CI + code)

- ❌ **Not** a research backtester. This is a **regression tool**, not a
  strategy sandbox. It cannot fabricate option data, mint synthetic
  ticks, or otherwise produce numbers that could be mistaken for
  live-broker output. All fixtures MUST originate from real Kite/NSE
  captures — enforced by `providerImportGuard.ts` + manifest
  `sourceHash` verification.
- ❌ **Not** live-trading. Zero broker calls. The `LiveOrderGuard` +
  `SystemMode` locks stay engaged in replay mode.
- ❌ **Not** a coverage extension of the existing `backtestRouter`
  under `/backtest/fno/*`. That endpoint continues to serve owner
  Backtest Lab UI; the regression harness is CLI-only and lives in
  the test tree.
- ❌ **Cannot "reconstruct" a session** from stored chain snapshots or
  bar data. If it wasn't recorded live, the session doesn't exist for
  the harness. Reconstruction is fabrication wearing a costume — the
  spec's provenance rule bans it.
- ❌ **PDF summaries** are out of scope. The deliverable on failure is
  a structured diff and a red CI job; R4 already adds Telegram
  notification. A markdown dump from `result.diffs` is 30 minutes if
  ever needed — not a PDF pipeline.

## 3. Fixture format

### 3.1 Directory layout (bucket + repo hybrid — see §12.1)

Fixture bytes live in Replit Object Storage / S3. The repo carries only
the manifest + `sourceHash` verifier + one baseline fixture check-in:

```
/app/artifacts/api-server/src/__tests__/replay_fixtures/
  ├─ README.md                            ← how to record + attribution
  ├─ baseline_2026_YY_MM_normal_monday/   ← EXACTLY ONE fixture in repo
  │  ├─ manifest.json
  │  └─ *.jsonl                           ← trimmed to 90 min if needed
  ├─ manifests/                           ← manifests only for bucket fixtures
  │  ├─ <fixture-id>.manifest.json        ← includes bucket URI + sourceHash
  │  └─ …
  └─ bucketFetcher.ts                     ← hash-checked, cached-local
```

The **baseline fixture** ships committed so `replay:baseline` runs on
every PR without any bucket dependency. Everything else is fetched by
`bucketFetcher(<fixture-id>)`, which downloads, verifies
`sha256(bytes) === manifest.sourceHash`, and caches in
`~/.cache/scanner-replay/`.

### 3.2 `manifest.json`

```jsonc
{
  "id": "<fixture-id>",
  "recordedAt": "<UTC ISO>",                 // real capture time
  "sessionKind": "NORMAL_MONDAY|EXPIRY_THU|EXPIRY_FRI|VIX_SPIKE|KITE_OUTAGE|BOOT_STORM",
  "istDate": "YYYY-MM-DD",
  "kiteInstruments": ["NIFTY 50", …],
  "tickCount": <int>,
  "chainSnapshotCount": <int>,
  "boardSnapshotCount": <int>,
  "chainWidth": "FULL",                      // §12.5 — bucket = cheap; snapshot full chain
  "notes": "…",
  "provider": "kite",                        // ONLY "kite" — no other value is legal
  "sourceHash": "sha256:…",                  // sha256 over concatenated jsonl bytes
  "bucketUri": "s3://…/…",                   // null for the committed baseline
  "engineVersion": "paper-writer-vX.Y.Z-…",  // pins Drizzle migrations
  "runtimeSeed": <int>                       // deterministic RNG
}
```

### 3.3 Record format (unchanged from v1)

- **`ticks.jsonl`**: one Kite `TickData` object per line, ordered by
  `receivedAtNs`.
- **`option_chain_snapshots.jsonl`**: one snapshot per 60s wall-clock,
  **full chain** — see §12.5.
- **`system_events.jsonl`**: `SystemMode` transitions,
  `regimeDetector.currentRegime` changes, `kiteSessionMonitor` edges.

### 3.4 Fixture provenance guard (mandatory)

`bucketFetcher.ts` MUST refuse any manifest with:
- `provider !== "kite"`, OR
- missing / non-matching `sourceHash`, OR
- `bucketUri === null` outside the single committed baseline slot.

Replay boot recomputes the hash locally after download and hard-fails on
mismatch. No override flag.

## 4. Replay driver

### 4.1 Public surface

```ts
// src/__tests__/replayHarness/replayDriver.ts
import { replayFixture } from "./replayDriver";

const result = await replayFixture({
  fixtureId: "baseline_2026_YY_MM_normal_monday",
  goldenMode: "ASSERT",              // ASSERT | RECORD — see §12.3
  clock: "SIMULATED",                // hard-locked in tests
  tickBudgetMs: 60_000,              // safety kill-switch
});
result.pass;                         // boolean
result.diffs;                        // structured diffs vs golden files
result.metrics;                      // tick throughput, engine latency p95
```

### 4.2 Determinism guarantees

1. **Deterministic clock** — `Date.now`, `performance.now` and
   `setTimeout` are wrapped. Time only advances when the driver
   consumes a tick.
2. **Deterministic RNG** — every module using randomness reads from a
   seeded PRNG keyed on `manifest.runtimeSeed`. Global `Math.random`
   is trap-thrown in replay mode.
3. **Isolated Postgres** — replay uses a per-test transactional
   database (Drizzle `withTransaction` + rollback).
4. **Frozen migrations** — replay boot pins Drizzle to
   `manifest.engineVersion`.
5. **CI hard-fail on RECORD** — if `process.env.CI === "true"` and
   `goldenMode !== "ASSERT"`, driver aborts before any code runs.
   No override. See §12.3.

### 4.3 Boot sequence

```
1. Load manifest. Verify sourceHash. Refuse if provider != "kite".
2. Spin up in-memory Redis (or use an ephemeral namespace).
3. drizzle migrate → schema at manifest.engineVersion.
4. Seed `paper_account` rows to golden pre-state. (Note: pre-state
   composition — e.g. mixed CURRENT + LEGACY_NOT_STORED rows for
   fixture #7 — is a DB seed, NOT fabricated market data. This is
   the legitimate way to guard ledger-mix behaviour.)
5. Register system_events queue.
6. Replace Kite client with `RecordedKiteClient(fixture)`.
7. Replace Telegram client with `RecordingTelegramClient()`.
8. Replace Yahoo/NSE providers with `RefuseFallbackProvider` UNLESS
   the fixture explicitly captured a fallback edge.
9. Start engine. Drive ticks in order.
10. On session end: compare all DB tables + Telegram outbox to golden.
```

### 4.4 R2 iteration bright line (owner mandate — §12.6)

During R2 golden reconciliation:
- Iteration may only change the **harness** (clock wrapping, mock
  wiring, driver plumbing).
- Iteration MAY NOT change the **engine** to make a diff pass. Ever.
- Iteration MAY NOT hand-edit golden files to swallow a diff. Ever.
- If the engine produces something the harness didn't expect, that is
  a **finding** — reported to the owner as a possible regression —
  not a golden to adjust.
- Any suspected engine bug pauses R2 and gets a normal-severity
  bug intake (bug register + PR).

Rationale: golden regeneration and engine edits are the two doors
through which a real regression (or a fabrication) can be laundered
into "expected output." Both stay behind bright lines.

### 4.5 Assertion strategy

- **Structural**: every row in `paper_trades_fo` must have exact
  {`symbol`, `side`, `entry_premium`, `exit_premium`, `charges_total`,
  `charges_status`, `writer_version`} match.
- **Numerical**: `realized_pnl`, `net_pnl` within 0.01. Anything wider
  is a bug.
- **Ordering**: Telegram messages must land in the exact recorded
  order — priority/tier drift is a bug.

## 5. Coverage targets — REALISTIC dating

The v1 spec used aspirational dates for fixtures that predate the
recorder. This is impossible — the recorder is what this project builds.
The table below is honest about **what exists** vs **what is
recordable-today** vs **what waits for the session to naturally occur**.

Owner has confirmed **no pre-existing raw Kite websocket captures**
exist on disk. If any surface later, they need `provider: "kite"` and a
`sourceHash` before they can enter the harness.

| # | Fixture | Guards | Recordable? | Priority |
|---|---------|--------|-------------|----------|
| 4 | `baseline_normal_monday` | Harness self-test — proves the driver, mock clients, golden comparator | **Next normal Mon** (any week) | R1 (immediate) |
| 1 | `nifty_friday_expiry` | BUG-80 expiry-day special mode, mean-reversion-only, 14:30 force close | **Next Fri** (weekly recurrence) | R3 |
| 7 | `mixed_charges_ledger` | Phase A↔B rollout boundary — CURRENT + LEGACY_NOT_STORED rows in one identity | **Constructible today** (see §5.1) | R3 |
| 6 | `monthly_expiry_thursday` | Monthly-vs-weekly expiry accounting | **Next month-end Thu** | R3 |
| 2 | `banknifty_vix_spike` | Regime hysteresis + cooldowns (BUG-72–79) | **Opportunistic** — record when a VIX spike happens live | R4+ |
| 3 | `kite_outage_yahoo_fallback` | Provider-guard, fallback chip degradation, LiveOrderGuard hard-lock | **Opportunistic** — record when a Kite outage happens live | R4+ |
| 5 | `boot_storm_rate_limit` | Phase 4 Telegram backoff, priority tiers | **Opportunistic** — record when boot storm occurs | R4+ |

### 5.1 Fixture #7 constructibility note

`mixed_charges_ledger` is legitimately buildable today because the
**market-data half is any fresh Kite capture** and the **ledger-mix half
is DB pre-state** — step 4 of the boot sequence. Seeding the
`paper_account` + `paper_trade_fo` tables with pre-Phase-B rows tagged
`charges_status = 'LEGACY_NOT_STORED'` alongside post-Phase-B
`'CURRENT'` rows exercises the identity keyed on `charges_status`. No
market data is fabricated. This distinction is preserved in code
comments so future contributors don't confuse pre-state seeding with
tick fabrication.

## 6. Rollout plan (owner-approved priority order)

### Phase R1 — Skeleton (~1 day)
- `replayDriver.ts` scaffold with mock Kite/Telegram clients, no real
  engine yet.
- Deterministic clock + PRNG wrappers, tested in isolation.
- `bucketFetcher.ts` with hash verification.
- **Record fixture #4** (baseline `normal_monday`) — commit trimmed
  90-min slice to repo.
- CI: `replay:baseline` job stubbed, does not fail the build yet.

### Phase R2 — First golden run (~2 days)
- Wire real engine to driver. `ASSERT` mode against fixture #4.
- Iterate under §4.4 bright line until byte-exact golden.
- **CI gate**: `replay:baseline` runs on every PR. Failure blocks
  merge until diff is explained.

### Phase R3 — Bug-guarding fixtures (~3 days)
- Record fixture #1 (weekly recurrence — can catch first Friday after
  R2 lands).
- Build fixture #7 (constructible now — see §5.1).
- Record fixture #6 at next month-end Thursday.
- Golden diff review manual before merge.
- CI: nightly full-suite replay.

### Phase R4 — Nightly regression + Telegram alerting (~1 day)
- CI job posts a Telegram summary to the ops channel on any failure
  (**no PDFs** — see §2).
- Failures block deploy until diff explained.

### Phase R5+ — Opportunistic fixtures
- Fixtures #2, #3, #5 recorded live via the manual owner-triggered
  endpoint (see §12.2) whenever the target session type actually
  happens.

## 7. Chain snapshot width (owner-decided — was v1 open question)

**Full chain per snapshot.** With bucket storage (§12.1) size is cheap;
using ATM ± 12 would render every historical fixture unusable if the
signal search radius ever widens, and that widening scenario has no
recovery path — the session is gone forever. Fall back to ATM ± 20 only
if capture size becomes a real operational problem.

## 8. Non-blocking prerequisites (all satisfied)

- Producer visibility on `writer_version` — done.
- Deterministic charge computation — done (Phase A).
- Ledger identity keyed on `charges_status` — done (Phase B).

None of the harness pieces require changes to the trading engine
itself. It's a pure test-time superset.

## 9. Estimated effort

- R1: 1 day
- R2: 2 days
- R3: 3 days (spread over ~4 weeks of natural session waits for
  fixtures #1 + #6)
- R4: 1 day
- R5+: 2–4 hours per opportunistic fixture

## 10. Acceptance criteria for R1 start

All items below are DECIDED (see §12) — no more owner sign-off needed:

- [x] Fixture storage: **bucket + one committed baseline** (§12.1).
- [x] Recorder ownership: **manual, owner-triggered, no cron** (§12.2).
- [x] Golden update flow: **RECORD_GOLDEN gate + CI hard-fail + PR
      diff summary review** (§12.3).
- [x] Priority ordering: **#4 → #1 → #7 → #6 → opportunistic**
      (§12.4).
- [x] Chain snapshot width: **full chain** (§12.5).
- [x] R2 iteration bright line: **no engine edits, no golden
      hand-edits** (§12.6).

R1 is safe to green-light.

## 11. What's explicitly OUT of this project

- Live trading OMS (Phase 7 — owner hold).
- AI/news sentiment (Phase 9 — owner hold).
- Backtesting research sandbox (Phase 8 — separate track).
- PDF summary generation (§2 non-goal).
- Cron-driven daily capture (§12.2 non-goal).
- Session reconstruction from bars/snapshots (§2 non-goal).

## 12. Owner decisions (locked, not open)

### 12.1 Fixture storage — bucket + one committed baseline

Bucket (Replit Object Storage / S3-compatible), NOT git-lfs. At
50–200 MB × 7+ fixtures = 1+ GB — git-lfs on Replit is painful and
bloats every clone.

**Reproducibility argument** for git is satisfied by `manifest.json` +
`sourceHash` living in the repo. The bucket only holds bytes; the hash
verifier refuses tampered blobs.

**Carve-out**: fixture #4 (baseline) runs on every PR, so it must
never depend on bucket availability. Commit a trimmed slice (~90-min
window) of that one fixture directly to the repo. Everything else is
fetched by `bucketFetcher(<fixture-id>)`, cached in
`~/.cache/scanner-replay/`.

### 12.2 Recorder — manual, owner-triggered, no cron

A daily cron writes 50–200 MB/day of sessions mostly never used, adds
a permanently-running component to the pod, and creates disk-creep
found at the worst time.

- Recorder is a **read-only tap** — recorder failure MUST never
  touch the trading path (fail-open).
- Ring buffer with hard **disk + memory cap** (e.g. 512 MB in RAM,
  spill to disk with rotation).
- Endpoint: `POST /api/replay/record` (owner-only, session-gated)
  dumps the last N minutes to disk + optional bucket upload.
- Cron can be revisited **later** if we notice we're missing
  interesting sessions. Start manual.

### 12.3 Golden update flow — gated three ways

- `RECORD_GOLDEN=1` env + dedicated `replay:record` npm script.
- **CI hard-fail** if `process.env.CI === "true"` and
  `goldenMode !== "ASSERT"`. No override.
- Any golden-regeneration PR must include the coder's **line-level
  diff summary** of what changed and why, reviewed by owner **before
  merge**.

Golden regeneration is the one door through which a regression (or
fabrication) can be laundered into "expected output" — it gets the same
bright-line treatment as schema changes.

### 12.4 Priority ordering — reordered by risk × capturability

Recommended sequence (replaces v1 §5 table order):

**#4 → #1 → #7 → #6 → #2/#3/#5 (opportunistic)**

Rationale:
- #4 first because it proves the harness itself (R1).
- #1 next: NIFTY expiry sessions **recur weekly** — can capture within
  days, guards BUG-80.
- #7 third: guards the newest money-math (`chargesActuallyDeducted`,
  Phase A→B boundary) and is legitimately constructible now (§5.1).
- #6 at next month-end Thursday.
- #2 (VIX spike), #3 (Kite outage), #5 (boot storm) can't be
  scheduled — standing instructions to hit the record endpoint when
  those conditions occur live.

### 12.5 Chain snapshot width — full chain

See §7. Bucket storage makes size cheap; the alternative has no
recovery path if the signal radius ever widens.

### 12.6 R2 iteration bright line

See §4.4. During "iterate until byte-exact golden":
- Only harness code changes. Never the engine.
- Never hand-edit golden files to make a diff pass.
- Unexpected engine output → **finding**, not a golden adjustment.

Given historical warehouse-backfill patterns, this is stated up front
rather than discovered mid-diff.
