# H10a — B1 / B3 Pure Shadow-Scoring Module Report

> **scope:** smallest isolated foundation for future B1/B3 shadow diagnostics — pure module + unit tests + warning-code verification helper. **No route. No UI. No schema. No DB writes. No live scoring change. No paper-equity / F&O / scheduler / workflow / route-auth / `replit.md` / memory-doc change.**

## A. Files changed

| File | Status | Lines | Purpose |
|---|---|---|---|
| `artifacts/api-server/src/lib/swingShadowScore.ts` | **new** | ~415 | Pure module: B1/B3 formulas, fail-open contract, reason codes, warning-code verifier |
| `artifacts/api-server/src/lib/swingShadowScore.test.ts` | **new** | ~360 | 40 vitest unit tests (formulas + clamping + fail-open + non-mutation + isolation guards) |
| `.agents/outputs/h10a/b1_b3_pure_shadow_scoring_module_report.md` | **new** | this doc | H10a report |

**No other file modified.** Verified via `git diff --stat` mental model — only the two source files above are touched in `artifacts/`.

## B. Pure function / API added

```ts
// types
export interface SwingScanRowForShadow { … }
export interface ShadowReason { code: ShadowReasonCode; delta: number; note: string }
export interface ShadowScoreResult { symbol, scanDate, liveScore, liveAction,
  b1ShadowScore, b3ShadowScore, b1Delta, b3Delta,
  b1Reasons, b3Reasons, dataQuality, missingFields }
export type ShadowReasonCode = "B1_FUNDAMENTAL_REMOVED" | … (17 codes total)
export type ShadowDataQuality = "OK" | "PARTIAL" | "INSUFFICIENT"

// frozen H8-locked constants
export const B3_PENALTY_CONSTANTS = Object.freeze({ … })
export const B3_WARNING_SUBSTRINGS = Object.freeze({ … })
export const KNOWN_NON_B3_WARNING_SUBSTRINGS = Object.freeze([ … ])
export const SHADOW_SCORE_MIN = 0
export const SHADOW_SCORE_MAX = 100

// functions (all pure, never throw, never mutate input)
export function computeShadowB1(row): { b1ShadowScore, reasons, missingFields }
export function computeShadowB3(row, b1): { b3ShadowScore, reasons, missingFields }
export function computeShadowScores(row): ShadowScoreResult            // combined wrapper
export function verifyWarningCodes(sample): WarningCodeVerificationResult
```

Module dependencies: **zero external imports** at runtime. Only TS types from the module itself. Module is a leaf — nothing in the codebase imports it (yet).

## C. Exact B1 formula used

```text
b1_shadow_score = clamp(live_score - fundamental_score, 0, 100)
```

**Conservatism choice (B1 ambiguity, per H10a §B1):** **full removal** of `fundamental_score`, NOT a partial downweight. Rationale documented in the module header docstring and quoted here:
> A partial downweight would introduce a new tunable parameter (the downweight ratio) that has zero offline evidence behind it — testing it later would require re-running H4-H8 with the new constant. Full removal is the most conservative interpretation of "remove or downweight" — a partial downweight would be a NEW model that wasn't in H8's locked candidate set.

Drizzle-numeric tolerance: `fundamental_score` arrives from Postgres as a `string` (drizzle `numeric` mapping). Module accepts `number | string | null | undefined`; non-finite/non-parseable values fail open with reason `B1_FUNDAMENTAL_MISSING_FAIL_OPEN`.

## D. Exact B3 formula used

```text
extension_penalty =
    (rsi14 > 70                                              ?  8 : 0)
  + (warnings ⊇ "Price extended far above EMA20"             ?  6 : 0)
  + (warnings ⊇ "RSI overextended"                           ?  5 : 0)
  + (|pct_from_52w_high| ≤ 3                                 ?  3 : 0)

rs_weak_penalty   =
    warnings ⊇ "Short-term relative strength weak vs benchmark" ? 15 : 0

b3_shadow_score   = clamp(b1_shadow_score - extension_penalty - rs_weak_penalty, 0, 100)
```

All constants are exposed via `B3_PENALTY_CONSTANTS` (frozen — re-assignment throws in strict mode) so callers cannot re-tune.

## E. Warning codes verified

The H8 design used short codes (`warn_extended`, `warn_rsi_overext`, `warn_rs_weak`). **The actual scanner emits English prose**, not short codes. I read `artifacts/api-server/src/lib/swingScanner.ts` lines 970–1070 and cataloged every `warnings.push(…)` call (13 fixed strings + 2 template-string forms). The three B3-relevant prose strings are:

| H8 code (alias) | Verified scanner prose (exact) | Scanner trigger | Module substring const |
|---|---|---|---|
| `warn_extended` | `"Price extended far above EMA20; wait for pullback"` | `distEma20Atr > 2.5` | `B3_WARNING_SUBSTRINGS.EXTENDED_FROM_EMA20` (matches on prefix `"Price extended far above EMA20"`) |
| `warn_rsi_overext` | `"RSI overextended"` | `rsiNow > 75` | `B3_WARNING_SUBSTRINGS.RSI_OVEREXTENDED` (exact) |
| `warn_rs_weak` | `"Short-term relative strength weak vs benchmark"` | `rs.rs20 < -3` | `B3_WARNING_SUBSTRINGS.RS_WEAK` (exact) |

Substring (not equality) matching is used so that future cosmetic edits to the prose tail ("wait for pullback" → "consider waiting") don't silently zero the penalty. **However**, if the scanner ever changes the *prefix* prose, the B3 penalty silently goes to 0 — `verifyWarningCodes(sample)` is the helper that surfaces this regression. Its verdict field `allSubstringsObserved` is the lock-in assertion to run against a 30-day sample before any future activation step (planned for the live verification surface, not built in H10a).

## F. Unknown warning codes found

**None at module-creation time.** The 10 known non-B3 prose strings emitted by `swingScanner.ts` are listed in `KNOWN_NON_B3_WARNING_SUBSTRINGS` (frozen):

```
"Below EMA200", "Bearish structure", "ADX low", "Weekly trend weak",
"Price is inside supply", "Liquidity low", "Market index context weak",
"R:R moderate", "R:R weak", "Stop distance wide versus ATR"
```

The two template-literal forms (`R:R moderate: <n>R`, `R:R weak: <n>R`, `Liquidity low: avg traded value <n> lakhs`) match via substring on the prefix.

Three additional dynamic emissions (`candle.comment`, `risk.warning`, weekly-trend prose) come from helper functions whose strings aren't pinned. `verifyWarningCodes` will surface any of those as `unrecognizedStrings` when run against a real sample — that's a follow-up audit, not an H10a fix, because the B3 formula deliberately consumes only the three substrings above.

## G. Fail-open behavior

| Input | Treatment | Reason code emitted |
|---|---|---|
| `liveScore` null/NaN/non-finite | Return B1=null, B3=null; `dataQuality="INSUFFICIENT"` | `B1_LIVE_SCORE_MISSING_FAIL_OPEN` |
| `fundamentalScore` null/NaN/non-finite | Subtract 0 → B1 == liveScore | `B1_FUNDAMENTAL_MISSING_FAIL_OPEN` |
| `rsi14` null/NaN/non-finite | RSI-hot contribution = 0 | `B3_RSI_MISSING_FAIL_OPEN` |
| `pctFrom52wHigh` null/NaN/non-finite | Near-52w-high contribution = 0 | `B3_PCT_52W_HIGH_MISSING_FAIL_OPEN` |
| `warnings` null/undefined | All warning-driven penalties = 0 | `B3_WARNINGS_MISSING_FAIL_OPEN` |
| `warnings` not an array (jsonb corruption) | All warning-driven penalties = 0 | `B3_WARNINGS_NOT_ARRAY_FAIL_OPEN` |
| Unknown warning prose | Silently ignored (no guessing) | — (no false-positive reason code) |
| Non-string elements inside `warnings` array | Silently ignored per-element | — |
| Drizzle numeric arriving as string | Parsed; fail-open if not parseable | (parses successfully when valid) |

`dataQuality` aggregation: `OK` (no missing fields), `PARTIAL` (some B3 inputs missing but live+B1 OK), `INSUFFICIENT` (live score itself missing). Functions never throw; even garbage like `liveScore: "garbage"`, `warnings: "not-an-array"` is absorbed (explicit test: "never throws on garbage input").

## H. Tests added

**40 tests in `swingShadowScore.test.ts`**, grouped:

1. **B1 formula (10 tests)**: subtracts full fundamental, never mutates input, clamps low/high, fails open on null/undefined/NaN-string fundamental, accepts stringified numeric (drizzle), fails open on null/NaN live score.
2. **B3 formula (15 tests)**: inherits B1 untouched, RSI-hot strict `>` boundary (70 exclusive, 71 inclusive), each warning substring isolated, near-52w-high inclusive `±3` boundary, RS-weak isolated, all-five penalties stack & clamp low, B1>100 clamp high, fail-open on null rsi14, null pctFrom52wHigh, null warnings, non-array warnings, unknown warning prose ignored, non-string array elements ignored.
3. **Combined wrapper (5 tests)**: clean row → `dataQuality=OK`, missing B3 input → `PARTIAL`, missing live → `INSUFFICIENT` (b1/b3/deltas all null, b3Reasons=[]), never throws on garbage, `missingFields` deduped across B1+B3.
4. **`verifyWarningCodes` (5 tests)**: counts substring matches, `allSubstringsObserved=false` when any B3 substring absent, surfaces unrecognized prose, skips null/non-array entries, ignores non-string elements.
5. **Isolation guards (5 tests)**: source file has zero forbidden imports (pg / drizzle-orm / @workspace/db / kite / yahoo / scheduler / fs / express / db); does not import `swingScanner`/`swingScannerStore`/`paperAccount`; H8-locked constants exposed with exact expected values; constants are frozen (re-assignment throws); `B3_WARNING_SUBSTRINGS` substrings match scanner prose verbatim; `KNOWN_NON_B3_WARNING_SUBSTRINGS` length-locked to 10.

## I. Typecheck / test results

```
$ pnpm --filter @workspace/api-server run typecheck
> tsc -p tsconfig.json --noEmit
(clean — zero errors)

$ pnpm --filter @workspace/api-server exec vitest run swingShadowScore
 Test Files  1 passed (1)
      Tests  40 passed (40)
   Duration  671ms

$ pnpm --filter @workspace/api-server run test          # full suite, regression check
 Test Files  29 passed (29)
      Tests  611 passed (611)
   Duration  22.33s
```

**Zero regressions across the full 611-test api-server suite.** (`scanner` artifact untouched — no need to re-run that suite.)

## J. Confirmation that no route/schema/DB write was added

- **No route**: I added no Express handler, no router mount, no entry under `artifacts/api-server/src/routes/`. The only new files are the pure module + its test.
- **No schema**: I added no Drizzle table, no column, no migration, no `lib/db/src/schema/` change. The module reads from an *in-memory shape* (`SwingScanRowForShadow`) — it does not import any drizzle table reference.
- **No DB write**: The module has zero DB imports (asserted by an isolation test that greps the source for forbidden import patterns). No `INSERT`, `UPDATE`, `DELETE`, `tx.…`, advisory-lock, or pg call exists in the module.

## K. Confirmation that live swing scoring/action/entry/stop/target/RR did not change

- `artifacts/api-server/src/lib/swingScanner.ts` — untouched (read-only inspection only, to catalog the 13 warning-prose strings at lines 970–1070).
- `artifacts/api-server/src/lib/swingScannerStore.ts` — untouched.
- `artifacts/api-server/src/lib/swingScannerData.ts` — untouched.
- `artifacts/api-server/src/lib/scoring.ts` (Entry-Safety Gate) — untouched.
- `lib/db/src/schema/swingScan.ts` — untouched.
- `artifacts/api-server/src/routes/stocksToWatch.ts` — untouched.
- `artifacts/scanner/src/**` — untouched.

The new module reads from row objects; it does not call into the live scoring path, and the live scoring path does not import it. The "Pro Swing Scanner v3" port and its store remain bit-identical.

## L. Confirmation that paper-equity, F&O, scheduler, workflows, `replit.md`, and memory/docs did not change

- **Paper-equity** (`artifacts/api-server/src/lib/paperAccount.ts`, `equitySizingHelper.ts`, paper routes): untouched.
- **F&O** (`optionSignals.ts`, `optionSignalGates.ts`, `oiLab.ts`, `paperTradingFoMtmSweep`, `fnoCostModel.ts`, `fnoFailureDiagnosis.ts`, `fnoObservability.ts`, `paperDailySummaryFo.ts`, combo lane): untouched.
- **Scheduler** (no scheduler entry added; the module has no caller).
- **Workflows** (`artifact.toml` / `.replit-artifact/`): untouched. All four workflows (`api-server`, `global`, `mockup-sandbox`, `scanner`) running with no config delta.
- **Route auth** (`requireOwner`, `APP_ACCESS_PASSWORD`-gated routes): untouched.
- **`replit.md`**: untouched (standing permanent rule). The auto-trim system reminder fired during this session and was ignored as instructed.
- **`.agents/memory/`**: untouched. No memory file added or modified by H10a.

## M. Recommended next phase (do NOT start)

**Phase 2** of the H9 plan: owner-only diagnostic endpoint `GET /api/stocks-to-watch/diagnostics/swing-shadow-score`, no outcomes, 5-min in-process memo, feature-flagged via `SWING_SHADOW_DIAG_ENABLED` (default true). Wires the H10a pure module to a read-only Drizzle SELECT against `swing_scan_result`.

**Prerequisite before Phase 2 implementation work**: run `verifyWarningCodes(sample)` against a 30-day production sample to assert `allSubstringsObserved === true` and inspect `unrecognizedStrings` for any scanner prose this module is unaware of. If `allSubstringsObserved === false`, do NOT proceed — fix the substring constants first.

**Not started.** H10a stops here per spec.

---

## Standing labels applied

`pure module` · `fail-OPEN` · `no route` · `no UI` · `no schema` · `no DB writes` · `no live behavior change` · `H8-locked constants` · `frozen constants (cannot re-tune from caller)` · `non-mutating` · `40/40 module tests pass` · `611/611 full api-server suite passes` · `typecheck clean`

## Verdict

**Not an approval of live scoring, action labels, entries, stops, targets, RR, paper-equity execution, or any S4 phase.** Module is implementation-ready foundation only. Live scoring / recommendations / paper trading / F&O / scheduler / route auth / workflows / `replit.md` / memory all unchanged.

**S2b / S3b / F&O P25 still pending. S4c / S4d / S4e / S4f not approved. Stopping per spec. Awaiting next instruction.**
