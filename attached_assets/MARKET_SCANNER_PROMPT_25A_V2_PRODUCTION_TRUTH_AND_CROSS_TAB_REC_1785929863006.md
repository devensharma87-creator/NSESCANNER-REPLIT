# MARKET SCANNER PROMPT 25A V2 — PRODUCTION TRUTH AND CROSS-TAB RECONCILIATION

## 1. Objective

Work only on **Stock Scanner Pro** (`artifacts/scanner`, `artifacts/api-server`, `lib/api-zod`, and `lib/api-client-react`).

This prompt supersedes the earlier Prompt 25A. It converts the useful, evidence-backed findings from the 39-screen production audit into one bounded closure task. The audit is evidence to verify, not authority to copy blindly.

The goal is to make production values, labels, performance metrics, charts, and cross-tab data truthful and internally consistent. This is not a strategy-development pack, provider-activation pack, database-cleanup task, or UI redesign.

Do not create another roadmap or planning task. Execute this prompt directly.

## 2. Frozen scope and prohibitions

- `artifacts/global/**` is the separate **Global Multi Asset Scanner** project. It is frozen and excluded from edits, tests, builds, screenshots, and acceptance counts.
- Do not activate Upstox or IndianAPI. Pack 7 remains next after this task.
- Do not change signal formulas, thresholds, weights, confidence scores, vetoes, entries, stops, targets, sizing, or admission logic.
- Do not start professional F&O strategy research, `FNO_PAPER_V2`, or `SWING_PAPER_V2`.
- Do not delete, rewrite, or reset any F&O, swing, paper-trading, P&L, or audit history.
- Do not perform operational DB writes or cleanup.
- Do not enable live broker execution.
- Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` unchanged.
- No commit, push, pull, fetch, publish, or deployment.
- Never expose credentials or secret values in source, logs, screenshots, tests, or evidence.

## 3. Git governance without loops

Record HEAD, branch, upstream, and working-tree state before edits.

If HEAD moves during the task, continue without asking only when the entire intervening range contains documentation/attachment auto-commits under `attached_assets/`, `artifacts/audit-evidence/`, or `.agents/memory/`, with no production, test, schema, migration, dependency, build, or deployment file. Record the chronology in evidence.

Stop on any other unexpected HEAD change and report the exact commit and file inventory. Do not revert automatically.

## 4. Audit rules

For every finding:

1. Reproduce it from production code, the captured response/fixture, or a registered route/component.
2. Identify the exact source field, source identity, timestamp, unit, scope, and transformation.
3. Classify it as `CONFIRMED_DEFECT`, `VALID_DIFFERENT_SCOPE`, `STALE_OR_PARTIAL_DATA`, `PRESENTATION_ONLY`, or `NOT_REPRODUCED`.
4. Fix only confirmed defects.
5. Add executable tests using real production functions, registered route handlers, or rendered components. Source-text checks alone are insufficient for behavioral acceptance.

If two values are valid but use different dates, universes, windows, sources, or models, preserve both and label their scopes. Do not force them to equal.

## 5. Gate A — Performance and ledger truth (P0)

### A1. F&O lifetime-performance reconciliation

Verify the reported values and definitions behind:

- F&O account `NET VS SEED` approximately `+₹8,06,361.70`;
- cockpit ledger drift approximately `+₹8,00,644.80`;
- attributed F&O realised P&L approximately `+₹5,716–₹5,717`;
- combined F&O plus equity realised P&L approximately `+₹15,030`.

Trace each value to its ledger fields and aggregation code. Do not assume the audit's root-cause explanation is correct until proved.

Required behavior:

- unreconciled capital movement or drift must never be presented as strategy profit, gain, return, expectancy, or performance;
- `NET VS SEED`, if retained, must be labelled as an account-balance reconciliation metric and must separately disclose unreconciled drift;
- the primary performance headline must use reconciled, trade-attributed realised P&L;
- all performance surfaces must use one documented definition or visibly state their different scopes;
- historical drift remains preserved as evidence and is not deleted.

### A2. Intraday win-rate denominator

Reproduce the report state with zero T1 hits, zero T2 hits, zero stops, and expired-open outcomes. Win rate must be:

`decided wins / (decided wins + decided losses)`

If the denominator is zero, render `—` / `Not enough decided trades`, never `100%`, `0%`, `Infinity`, or a fabricated zero. Expired-open/mark-to-market P&L must be shown in a separate labelled bucket and must not silently enter the decided win-rate denominator.

### A3. Low-sample honesty

Mathematically valid values such as `100% win rate` or `Profit Factor ∞` from one trade must not be changed, but must carry a visible `n=1 — not conclusive` or equivalent low-sample warning. Apply the existing `<20` policy consistently.

### A4. False-zero report fields

Audit Best Trade, Worst Trade, MFE, MAE, totals, and report summary values. Missing/unpopulated values render `—`/unavailable, not ₹0 or 0%. Preserve genuine numeric zero.

## 6. Gate B — Canonical market identity, time, and units (P0/P1)

### B1. NIFTY identity

Trace the Post-Market Wrap values:

- NIFTY close/spot approximately `24,624.65`;
- previous close approximately `24,614.90`;
- erroneous top-strip value approximately `24,685.05`;
- GIFT NIFTY approximately `24,649.50`.

The NIFTY-labelled field must come only from the canonical NIFTY instrument. GIFT NIFTY may be shown only as a separately labelled proxy/cue. Preserve previous close, but label it explicitly. Add an identity test proving a GIFT instrument value cannot populate a NIFTY spot/close field.

### B2. India VIX versus US VIX

Trace the homepage `VIX 16.50` against India VIX approximately `12.06` and US VIX approximately `16.57`. Fix the field mapping so an India-VIX-labelled surface cannot display the US VIX. Test by canonical instrument key, not by coincidental numeric value.

### B3. FII/DII source, date, unit, and scope

Use the canonical daily institutional-flow record as the source of truth for the same-date homepage chip and detailed table. Every surface must show:

- explicit observation date;
- `₹ Cr` unit;
- daily versus 5-day/monthly scope;
- unavailable gross buy/sell as `— (net-only source)`, never ₹0.00;
- stale values as stale, never current.

Do not force daily, five-day, monthly, or participant-OI values to match each other.

For the March 2026 net-only row, verify the source unit and aggregation before changing the large net value. If it cannot be validated, label it unavailable/quarantined rather than silently rescaling it.

### B4. Timestamp correctness

Verify UTC/IST conversion across affected pages. A provider timestamp must be converted exactly once. Preserve the accepted future-timestamp fail-closed behavior and the five-second skew tolerance.

## 7. Gate C — Derivatives consistency without changing strategy logic

### C1. Sentiment scopes

Audit NEUTRAL versus MILDLY BEARISH labels across Option Chain, OI Lab, Option Strategies, and participant-wise OI.

Do not force genuinely different models to one value. Either:

- route identical model inputs through one canonical classifier; or
- label each result by model and scope, for example `Option-chain PCR: Neutral` and `Participant futures positioning: Bearish`.

No page may display an unlabeled generic `Market sentiment` when it is only one model's output.

### C2. PCR scope

Verify full-chain PCR approximately `0.72` and visible-window/ATM±10 PCR approximately `0.59`. If both are correct, label them `Full-chain PCR (OI)` and `Visible strikes PCR (OI)` and disclose the strike window. Do not change correct arithmetic.

### C3. Bull Call Spread payoff

Reproduce the displayed 24,600C/24,700C spread, quantity/lot size, net cost, and max profit. Enforce:

`maxProfit = (shortStrike - longStrike) × quantity - netDebit`

The leg labels, quantity, net debit, max profit, and breakeven must reconcile from the same immutable plan snapshot. Fix either the label or the math based on the production plan—not by hardcoding the screenshot values.

Preserve known-correct derivatives behavior: current NIFTY lot size 65, BANKNIFTY 30, Greeks signs, intrinsic values, option breakevens, PCR arithmetic, GEX arithmetic, and cost calculations unless a new executable test proves a defect.

## 8. Gate D — Swing staged-order integrity

For the HDFCBANK staged candidate around ₹1,920, perform read-only forensic tracing:

- canonical instrument/token and symbol identity;
- stage timestamp and `asOf`;
- source/provider;
- corporate-action/split adjustment;
- current canonical quote identity;
- expiry/status and audit provenance.

Do not delete or rewrite the row. If confirmed invalid or stale, harden admission/rendering so mismatched or corporate-action-unadjusted staged prices are quarantined/expired with a machine-readable reason and cannot be approved. Operational cleanup remains a separate owner-authorized task.

## 9. Gate E — UI truth and production-state clarity

### E1. Chart states

Distinguish:

- data loading/hydration;
- valid empty series;
- no buffered snapshots;
- source unavailable;
- rendering failure;
- rendered chart.

Charts with data must re-render after async arrival. OI Lab with zero snapshots must say `No snapshots buffered`, while institutional-flow hydration must show a loading state rather than a blank chart.

### E2. Counts and universes

Audit and explicitly label:

- total provider instruments;
- configured scanner universe;
- available subset;
- scanned rows;
- unavailable rows;
- breadth denominator.

Numbers such as 8,891, 155, 152, 76, 29/30 may coexist only with clear scope. Arithmetic must reconcile within each scope.

### E3. Market status

Closed-market pages must not present cached data as live. Preserve last-known values with `CLOSED`, `STALE`, source, and `asOf` labels. Do not blank useful last-good data merely because the market is closed.

### E4. Classification and copy

Verify before fixing:

- MARICO positive earnings item placed under regulator/probe classification;
- bullish/strong-bullish score threshold ordering;
- RSI/trend labels, noting trend may legitimately use inputs beyond RSI;
- R:R values, labelling fixed 2R targets as fixed targets;
- similar ticker names such as GODREJPROP/GODREJCP, showing full names where selection risk exists.

Only change behavior after tracing the exact classifier. Otherwise improve scope/copy without altering classification logic.

## 10. Gate F — Preserve valid data and reject speculative recommendations

The audit's trading observations—time-of-day outcomes, setup expectancy, exit distribution, tier performance, and institutional positioning—are research observations only. Do not convert them into entry blocks, thresholds, strategy changes, or execution rules in this task.

Do not change the accurate Portfolio Analyser, Charting, Backtest Lab replay logic, educational content, existing provenance badges, modelled/info-only labels, fail-closed empty states, or honest missing-data behavior unless a reproduced regression requires it.

## 11. Gate G — Load-bearing tests

Add executable tests covering at least:

1. unreconciled drift cannot populate a performance headline;
2. zero decided outcomes render no win rate;
3. expired-open outcomes are separate from decided wins/losses;
4. low-sample metrics carry a warning;
5. missing report extremes render unavailable, genuine zero remains zero;
6. GIFT NIFTY cannot populate NIFTY spot;
7. US VIX cannot populate India VIX;
8. FII/DII daily/date/unit/scope parity;
9. net-only gross fields render unavailable;
10. UTC→IST conversion occurs once;
11. full-chain and visible-window PCR labels and arithmetic;
12. spread payoff invariant across leg widths and quantities;
13. sentiment labels expose model/scope;
14. staged-order instrument/price provenance quarantine;
15. chart loading versus no-data states;
16. universe and breadth count reconciliation;
17. closed-market last-good data is labelled stale/closed;
18. MARICO/classifier behavior based on real classifier inputs.

Use real production functions, route handlers, Zod boundaries, and rendered components where possible. Do not weaken assertions, add retries to hide failures, add arbitrary sleeps, or create source-only proofs for runtime claims.

## 12. Gate H — Full verification battery

Run and record:

- Stock Scanner Pro scanner tests: floor `1,112` passing;
- API-server non-DB suite: floor `5,603` passing;
- TypeScript checks for scanner, api-server, api-zod, and api-client-react;
- scanner production build;
- API-server production build;
- `git diff --check`;
- `.skip`, `.only`, retry, and arbitrary-sleep audit for changed/new tests;
- zero-DB and zero-live-provider-call proof for the new tests;
- credential/sentinel scan of built client assets.

Do not run or count `@workspace/global`.

Capture authenticated Stock Scanner Pro screenshots at 390×844, 768×1024, and 1440×900 for every changed production surface. Use production-shaped fixtures only for deterministic visual states; never present fixture screenshots as live-provider proof.

## 13. Evidence and final response

Write:

`artifacts/audit-evidence/PROMPT_25A_V2_PRODUCTION_TRUTH_AND_CROSS_TAB_RECONCILIATION.md`

The evidence must contain:

- preflight and Git chronology;
- finding-by-finding classification;
- exact source/field/asOf/unit/scope traces;
- files changed and why;
- before/after behavior;
- test and build results;
- screenshot inventory;
- unresolved blockers and owner-only actions;
- confirmation that Global remained untouched;
- confirmation that strategy logic, history, DB data, provider activation, and broker execution remained unchanged.

Final nonblank line:

`END_PROMPT_25A_V2_PRODUCTION_TRUTH_AND_CROSS_TAB_RECONCILIATION`

Return `ACCEPT_PROMPT_25A_V2_PRODUCTION_TRUTH_AND_CROSS_TAB_RECONCILIATION` only if all confirmed P0 defects and every applicable gate pass.

If any P0 cannot be safely verified or fixed, return:

`BLOCKED_PROMPT_25A_V2 — <exact blocker>`

Do not claim production deployment or live-provider parity. After this acceptance, proceed to Pack 7 provider activation/shadow parity; do not start any other pack first.
