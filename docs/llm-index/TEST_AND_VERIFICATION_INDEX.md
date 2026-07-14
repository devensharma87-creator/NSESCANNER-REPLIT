# Test & Verification Index

All test suites, how to run them, what they guard, and known gotchas.

---

## Running Tests

```bash
# api-server (MUST use --pool=threads — default forks pool exceeds 120s and loses output)
pnpm --filter @workspace/api-server exec vitest run --pool=threads

# scanner (fast, uses vmThreads + forceExit from vitest config)
pnpm --filter @workspace/scanner run test

# Run a single test file (api-server)
cd artifacts/api-server && pnpm exec vitest run --pool=threads fnoTradingDays

# Full typecheck (always run before marking work done)
pnpm run typecheck
```

**Pool requirement:** `api-server` vitest config uses `--pool=threads` in `package.json` script (config-file pool setting crashes in vitest 4.1.5 with `type:module`).

---

## Test Suite Overview

### api-server Tests (`artifacts/api-server/src/lib/`)

| File | Coverage | Tests | Risk |
|---|---|---|---|
| `alerting.test.ts` | `alertOwner()` dedup, Telegram stub, no-secret-in-logs, cycle safety | ~10 | HIGH |
| `bootScheduler.test.ts` | Boot scheduler stagger | ~5 | LOW |
| `candleWarehouseIngestor.test.ts` | Candle upsert, provenance write guard | ~8 | HIGH |
| `chartDatafeed.test.ts` | Candle datafeed assembly, freshness | ~12 | HIGH |
| `chartDatafeed.segment.test.ts` | Segment-aware datafeed | ~5 | HIGH |
| `chartInstruments.test.ts` | Instrument list dedup, NSE-wins rule | ~8 | HIGH |
| `chart.provenance.test.ts` | Candle source provenance labeling | ~6 | HIGH |
| `compositeBias.test.ts` | Composite bias engine | ~8 | HIGH |
| `deepscan.honesty.test.ts` | Deep scan data honesty — no synthetic fallback | ~6 | CRITICAL |
| `equitySizingHelper.test.ts` | Equity sizing 11-gate sequence | ~10 | HIGH |
| `etfNav.test.ts` | ETF NAV calculation | ~5 | LOW |
| `executionTruth.structural.test.ts` | Execution truth structural contract | ~8 | HIGH |
| `fnoCostModel.test.ts` | STT/brokerage cost model (shadow reporting only) | ~12 | MEDIUM |
| `fnoDiagnosticsFacade.test.ts` | F&O diagnostics facade | ~8 | HIGH |
| `fnoFailureDiagnosis.test.ts` | Failure diagnosis logic | ~8 | HIGH |
| `fnoObservability.test.ts` | Observability metrics | ~5 | MEDIUM |
| `fnoPaperRiskGuards.test.ts` | **27 tests** — F&O risk guard pack (shadow mode) | 27 | HIGH |
| `fnoPremiumExitOverlay.test.ts` | Premium exit overlay | ~8 | HIGH |
| `fnoReasoningAnalytics.test.ts` | Signal reasoning analytics | ~6 | MEDIUM |
| `fnoSignalReasoningFingerprint.test.ts` | Signal fingerprint dedup | ~5 | HIGH |
| `fnoSignalReasoningLogger.test.ts` | Signal reasoning persistence | ~6 | HIGH |
| `fnoSizingHelper.test.ts` | F&O lot sizing helper | ~10 | HIGH |
| `fnoSpotLifecycle.test.ts` | F&O spot price lifecycle | ~8 | HIGH |
| `fnoTradingDays.test.ts` | **14 tests** — Mon-Fri trading day counter | 14 | MEDIUM |
| `gex.test.ts` | GEX calculation | ~5 | MEDIUM |
| `gexDrift.contract.test.ts` | GEX drift contract | ~5 | MEDIUM |
| `globalIndices.test.ts` | Global indices | ~5 | LOW |
| `indexFuturesVolume.test.ts` | Index futures volume | ~5 | LOW |
| `indicatorsShared.test.ts` | Shared indicators | ~8 | MEDIUM |
| `indicesBoard.analytics.test.ts` | Indices board analytics | ~6 | MEDIUM |
| `journalAnalytics.test.ts` | Paper trade journal analytics | ~8 | MEDIUM |
| `kiteCrypto.test.ts` | Kite token encryption/decryption | ~5 | CRITICAL |
| `kiteScanner.etf.test.ts` | ETF scanning | ~5 | MEDIUM |
| `oiBuildup.test.ts` | OI buildup detection | ~8 | HIGH |
| `optionChain.spotTrust.test.ts` | Option chain spot price trust | ~6 | HIGH |
| `optionChainSnapshotIngestor.test.ts` | Snapshot ingestor | ~8 | HIGH |
| `optionSignalGates.antiFlip.test.ts` | Anti-flip gate | ~8 | HIGH |
| `optionSignalGates.*.test.ts` | F&O gate suite (multiple files) | ~30+ | HIGH |
| `optionSnapshotAnalytics.test.ts` | OI analytics | ~8 | MEDIUM |
| `optionSignals.popupWording.test.ts` | Signal popup wording | ~6 | MEDIUM |
| `optionSignals.vwapLabel.test.ts` | VWAP label | ~5 | MEDIUM |
| `optionSignalVetoes.test.ts` | Signal veto logic | ~8 | HIGH |
| `paperAccount.riskPct.test.ts` | Risk % computation | ~10 | HIGH |
| `paperAnalyticsFO.test.ts` | F&O paper analytics | ~8 | MEDIUM |
| `paperBaselineGuardrails.test.ts` | Baseline guardrails | ~10 | HIGH |
| `paperCapitalEvents.test.ts` | Capital events | ~8 | HIGH |
| `paperHeatSql.test.ts` | **Live-DB heat SQL regression** (auto-skips if no DATABASE_URL) | ~5 | HIGH |
| `paperReportsFoTimeExit.test.ts` | Time-exit reports | ~5 | MEDIUM |
| `paperTradeFoClosedTimeExit.test.ts` | Closed trade time-exit | ~6 | MEDIUM |
| `paperTradingCombo.test.ts` | Combo paper trade lifecycle | ~10 | HIGH |
| `paperTradingFoMtmSweep.test.ts` | MTM sweep | ~8 | HIGH |
| `paperTradingFoOrphanExit.test.ts` | Orphan exit | ~6 | HIGH |
| `paperTradingFO.premiumPath.test.ts` | F&O premium path | ~10 | CRITICAL |
| `preMarket.test.ts` | Pre-market data | ~5 | LOW |
| `replay-2026-06-09.test.ts` | Replay regression | ~5 | HIGH |
| `scannerFastPath.test.ts` | Scanner fast path | ~5 | HIGH |
| `scannerProvenance.test.ts` | **Scanner provenance stamping** | ~8 | CRITICAL |
| `scoring.entrySafety.test.ts` | Entry safety gate | ~10 | HIGH |
| `sectorCoverage.test.ts` | Sector coverage | ~6 | MEDIUM |
| `sectorMap.test.ts` | Sector mapping | ~8 | MEDIUM |
| `sprint3Phase*.structural.test.ts` | Structural contract tests (multiple phases) | ~20+ | HIGH |
| `swingAlerts.test.ts` | **58 tests** — Swing alert wording + production compliance | 58 | CRITICAL |
| `swingCashCostModel.test.ts` | Swing cost model | ~10 | HIGH |
| `swingCashDataTrust.test.ts` | Swing data trust gate | ~10 | CRITICAL |
| `swingCashEntryGate.test.ts` | Entry gate | ~10 | HIGH |
| `swingCashEventRisk.test.ts` | Event risk gate | ~8 | HIGH |
| `swingCashExposure.test.ts` | Exposure gate | ~8 | HIGH |
| `swingCashLiquidity.test.ts` | Liquidity gate | ~10 | HIGH |
| `swingCashRiskGuards.test.ts` | Risk guard pack | ~10 | HIGH |
| `swingCashSizing.test.ts` | Position sizing | ~10 | HIGH |
| `swingOrderStaging.test.ts` | Staging lifecycle | ~12 | CRITICAL |
| `swingScannerData.benchmark.test.ts` | Scanner data benchmark | ~5 | MEDIUM |
| `swingScannerStore.intradayRefresh.test.ts` | Intraday refresh | ~5 | MEDIUM |
| `swingShadowDiagnostic.test.ts` | Shadow diagnostic | ~6 | MEDIUM |
| `swingShadowScore.test.ts` | Shadow score | ~6 | MEDIUM |
| `tradeSetups.test.ts` | Trade setup detection | ~8 | HIGH |
| `watchlistBasket.test.ts` | Watchlist basket | ~8 | HIGH |
| `watchlistConsumerImports.test.ts` | Watchlist import guard | ~5 | HIGH |
| `watchlist.test.ts` | Watchlist | ~8 | MEDIUM |
| `winRateClassification.test.ts` | Win-rate classification | ~6 | MEDIUM |
| `marketData/*.test.ts` | Market data layer trust gates (multiple files) | ~50+ | CRITICAL |

---

### scanner Tests (`artifacts/scanner/src/`)

| File | Coverage | Tests |
|---|---|---|
| `lib/fnoEmptyState.test.ts` | `deriveFnoEmptyReason`, `buildFnoIndexRows`, `deriveSessionBannerState`, `FNO_TABLE_INDICES` | ~20 |
| `lib/infraHealth.test.ts` | `deriveAgeSeverity`, `deriveCoverageSeverity`, `deriveSnapshotSeverity`, `deriveCandleSeverity`, `formatAge`, `rollUp` | 16 |
| `lib/optionChainFilters.test.ts` | `applyStrikeFilter`, OI spike constants | ~8 |
| `lib/backtestBlockers.test.ts` | Backtest blocker logic | ~8 |
| `lib/backtestRunSummary.test.ts` | Backtest run summary | ~8 |
| `lib/candleSourceBadge.test.ts` | Candle source badge | ~5 |
| `lib/fnoEmptyState.test.ts` | F&O empty state + banner | ~20 |
| `lib/foCockpitView.test.ts` | F&O cockpit view | ~6 |
| `lib/reportsView.test.ts` | Paper reports view | ~8 |
| `lib/setupExplanation.test.ts` | Setup explanation | ~6 |
| `lib/stocksToWatchView.test.ts` | Stocks-to-watch view | ~8 |
| `lib/portfolio/csv.test.ts` | CSV parser + validation | ~40 |
| `lib/portfolio/calc.test.ts` | Per-holding metrics, XIRR, summary | ~80 |
| `lib/portfolio/score.test.ts` | Composite score, SEBI-neutral labels | ~50 |
| `lib/portfolio/risk.test.ts` | HHI, concentration flags | ~30 |
| `lib/portfolio/allocation.test.ts` | Sector/stock/market-cap views | ~20 |
| `lib/portfolio/holdingPeriod.test.ts` | Long-term threshold, dividends | ~15 |
| `lib/portfolio/returnLabel.test.ts` | XIRR vs annualised label | ~10 |
| `components/kite-offline-banner.test.ts` | Kite offline banner | ~5 |
| `components/global-status-banner.test.ts` | Global status banner | ~5 |
| `components/paper-combo-confirm-dialog.test.ts` | Combo dialog | ~5 |
| `lib/__tests__/*.test.ts` | Various utility tests | ~20 |

**Total scanner: 721 tests across 34 files**

---

## Critical Tests — Never Let These Fail

| Test | What It Guards |
|---|---|
| `swingAlerts.test.ts` | **Alert wording compliance** — "Risk eval: kite", not "Data: kite"; "[SAMPLE]" label on test alerts; entry price note present |
| `swingCashDataTrust.test.ts` | Kite data freshness gate — stale data is rejected, not silently used |
| `swingOrderStaging.test.ts` | Staged order lifecycle — approve/expire/reject state transitions |
| `paperTradingFO.premiumPath.test.ts` | F&O premium validation path — fake/unpriced premiums are rejected |
| `fnoPaperRiskGuards.test.ts` | G1-G4 risk guards — near-expiry theta, low premium, cooldown, SENSEX block |
| `scannerProvenance.test.ts` | Signal source stamping — Yahoo signal cannot be promoted by a Kite LTP tick |
| `deepscan.honesty.test.ts` | No synthetic/fabricated deep scan data |
| `marketData/providerImportGuard.test.ts` | No direct provider imports outside the allowlist |
| `kiteCrypto.test.ts` | Kite session token encryption |
| `paperHeatSql.test.ts` | Heat cap SQL correctness (live-DB, auto-skips without DATABASE_URL) |
| `infraHealth.test.ts` | Infra health severity helpers (16 tests) |
| `portfolio/calc.test.ts` + `score.test.ts` | Portfolio XIRR, scoring, SEBI-neutral labels |

---

## What Tests Do NOT Cover (Honest Gaps)

- **Live Kite connectivity** — tests use mocked responses; actual Kite session requires a valid token
- **NSE public holidays** — `fnoTradingDays` intentionally has no holiday list; tests verify Mon-Fri only
- **Telegram delivery** — tests mock the HTTP call; real delivery requires `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
- **End-to-end paper trade cycle** — unit-tested per-function; full scheduler cycle not e2e tested
- **Browser/UI rendering** — no Playwright/Cypress; UI verified via manual screenshot

---

## Typecheck

```bash
# Full canonical check (always run this)
pnpm run typecheck

# Libs only (faster, after lib changes)
pnpm run typecheck:libs

# Single artifact
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/scanner run typecheck
```

**Disagreement between editor and CLI:** trust `pnpm run typecheck` (CLI) over editor/tsserver. Stale lib declarations cause false positives in editor — run `pnpm run typecheck:libs` to rebuild.

---

## Adding Tests for New Features

### api-server
- Co-locate with source: `lib/myFeature.test.ts` next to `lib/myFeature.ts`
- Import from vitest: `import { describe, it, expect, vi } from "vitest";`
- Mock DB: `vi.mock("@workspace/db", () => ({ db: mockDb }))`
- Mock env: `vi.stubEnv("MY_VAR", "value")` (restores automatically)

### scanner
- Co-locate: `lib/myPureLib.test.ts` next to `lib/myPureLib.ts`
- Import types from `@workspace/api-client-react` (use generated types)
- Pure functions only in `lib/` — no direct API calls from lib

### Test file header pattern (api-server)
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { myFunction } from "./myFeature";

describe("myFunction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns expected value", () => {
    expect(myFunction("input")).toBe("expected");
  });
});
```
