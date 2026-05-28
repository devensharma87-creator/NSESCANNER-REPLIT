# H10b — Production warning-code verification + owner-only swing-shadow diagnostic

**Verdict: ENDPOINT ADDED**
(Warning-code verification across 10 production scan dates was unambiguous; the two newly observed non-B3 prose strings were added to the known-non-B3 catalog, and the diagnostic endpoint is in place behind `SWING_SHADOW_DIAG_ENABLED`.)

---

## Part 1 — Production warning-code verification

Verified across **10 scan dates** (2026-05-13 → 2026-05-28, ≈ 4,765 `swing_scan_result` rows) directly against the live database.

- All three B3 substrings (`RSI overextended`, `Stretched above SMA50`, `Extended from 52w high`) were observed on **every** scan date.
- `allSubstringsObserved = true` for every date probed.
- Two previously-unlisted prose strings surfaced:
  - `Large opening gap`
  - `Upper-wick rejection`
- Both are scanner-emitted but **not** B3-relevant (they describe intraday session events, not stretch from SMA50 / 52w-high / RSI overheat). Adding them to `KNOWN_NON_B3_WARNING_SUBSTRINGS` is correct because it preserves the catalog's intent: surface *truly* novel prose drift while suppressing strings whose semantics are already understood.
- `KNOWN_NON_B3_WARNING_SUBSTRINGS` grew **10 → 12**; the existing length-lock test was bumped accordingly with explicit `contains` assertions for the two new strings.

No B3 substring matcher logic changed; only the catalog widened.

## Part 2 — Owner-only diagnostic endpoint

`GET /api/stocks-to-watch/diagnostics/swing-shadow-score` — owner-only, feature-flag-gated, read-only.

### Spec compliance

| Requirement | Status |
|---|---|
| Owner-only via strict-owner gate pattern | ✅ matches sibling diagnostics verbatim (auth A/B/C/D covered in `diagnosticRouteAuth.test.ts`) |
| Feature flag `SWING_SHADOW_DIAG_ENABLED` (default ON) | ✅ disable on `"0" / "false" / "no" / "off"` (trimmed, case-insensitive) |
| Disabled response shape | ✅ `200` + `{ featureFlagEnabled:false, flagEnvVar }`, no DB calls |
| Reads LATEST `swing_scan_result` cohort only | ✅ `MAX(scan_date)` probe + `WHERE scan_date = $1::date` cohort SELECT — both parameterized |
| No live scoring / action / entry / stop / target / RR / paper-equity / F&O / schema / scheduler / UI changes | ✅ |
| No DB writes, no Kite, no Yahoo, no scheduler, no outcomes fetch | ✅ module-level isolation test enforces import allow-list |
| `computeShadowScores` invocation per row | ✅ |
| 5-minute in-process memo keyed by (`scanDate`, `rowCount`) | ✅ single-entry TTL cache, bounded growth |
| Bounded lists (`LIST_CAP = 25`) | ✅ enforced for every ranked / bucket list |
| Deterministic sort (metric desc + symbol asc tiebreak) | ✅ `sortDescBy` / `sortAscBy` helpers |
| Per-row payload: symbol, sector, industry, liveScore, liveAction, b1/b3 shadow scores + deltas + reasons, dataQuality, missingFields | ✅ |
| Top-level: scanDate, totalRows, featureFlag, warning verification, B1/B3 summaries, top lists, promoted/demoted lists, AVOID-promoted, high-score-demoted, delta histogram, data-quality histogram | ✅ |
| Unknown warnings **surfaced** (never silently mapped to B3) | ✅ `unrecognizedStrings` carried through verification block |
| Drizzle numeric tolerance (numeric columns serialized as strings) | ✅ `SwingScanRowForShadow` already widened in H10a |
| SQL injection vector | ✅ only DB-derived `scanDate` flows into the SQL template |

### Tests

- `swingShadowDiagnostic.test.ts` — 32 tests (bounded lists, deterministic ordering, `computeShadowScores` usage, unknown-warning surfacing, non-mutation of inputs, no-forbidden-imports isolation, score-delta distribution, data-quality histogram, cross-cut buckets, memoization, feature flag, payload shape).
- `diagnosticRouteAuth.test.ts` — extended ENDPOINTS matrix (auth A/B/C/D for the new path) **plus** 4 owner-path runtime tests:
  1. Flag disabled → `200` with `featureFlagEnabled:false` and **zero** DB calls.
  2. Flag enabled, empty DB → `200` with `scanDate:null`, `totalRows:0`, exactly **1** DB call (latest-scan probe only).
  3. Flag enabled, populated DB → `200` with payload populated, exactly **2** DB calls (latest probe + cohort SELECT), per-row payload shape verified.
  4. Memo correctness — second identical request within TTL returns `cached:true` and skips the cohort SELECT.
- `swingShadowScore.test.ts` — length-lock bumped 10 → 12 with `contains` assertions for `Large opening gap` and `Upper-wick rejection`.

### Verification

- Typecheck: **clean**.
- Full api-server suite: **652 / 652 pass** (was 611 before H10b; +41 net new tests across the three files).

### Code review (architect)

> **PASS (low risk)**. Live-behaviour isolation intact; route behaviour matches spec; read-only / side-effect constraints hold; memoization bounded; SQL injection posture safe; warning-drift posture correct.

Two optional follow-ups from the review:
- **Address now:** add route-level tests for flag-disabled and latest-scan-only. ✅ added (4 tests above).
- **Skipped (low-value):** flipping the flag default to OFF (current default-ON is already low-risk given strict owner + read-only); paginating `distinctStrings` / `unrecognizedStrings` (bounded by the scanner's finite emission set).

### Strict scope

No changes to: signal generation, entry, exit, stops, targets, RR, sizing, gates, confluence, paper-trader exec, paper-equity, scheduler, Kite, Yahoo, swing scanner store, option chain, F&O lanes, snapshot/candle ingestion, scheduler, schema, or any UI.

Rollback: remove the single route registration in `routes/stocksToWatch.ts` and the two new module files; the warning-catalog widening is independently safe and can be left in place (it strictly reduces false drift alerts).
