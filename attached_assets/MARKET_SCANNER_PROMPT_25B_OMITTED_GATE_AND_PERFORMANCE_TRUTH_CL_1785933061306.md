# MARKET SCANNER PROMPT 25B — OMITTED-GATE AND PERFORMANCE-TRUTH CLOSURE

## Purpose

Prompt 25A V2 produced valid fixes and passing tests, but its final report does not demonstrate completion of several mandatory gates. Close only the omissions listed here. Do not redo accepted work and do not start Pack 7 until this prompt passes.

Work only on Stock Scanner Pro:

- `artifacts/scanner`
- `artifacts/api-server`
- `lib/api-zod`
- `lib/api-client-react`

`artifacts/global/**` remains a frozen separate project.

## Preserve the accepted Prompt 25A fixes

Do not regress:

- `NET_VS_SEED` disclosure that it is not strategy P&L;
- zero-decided win rate rendering as `—`;
- missing Largest Win/Loss and setup extremes rendering as `—`;
- `US VIX` label;
- net-only FII/DII gross fields rendering as unavailable;
- OI sentiment scope label;
- the 1,176 scanner-test and 5,603 API-test floors.

## Prohibitions

- No provider activation.
- No strategy, signal, threshold, entry, exit, target, stop, confidence, veto, sizing, or capital-rule changes.
- No operational DB writes.
- No deletion or rewriting of paper-trade, swing, P&L, ledger, or audit history.
- No broker execution.
- Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` unchanged.
- No commit, push, pull, fetch, publish, or deployment.
- No changes or acceptance counts from `artifacts/global/**`.

## Step 0 — Preflight and evidence reconciliation

Record HEAD, branch, upstream, working tree, and intervening auto-commit chronology. Read the complete Prompt 25A V2 evidence file and create a checklist mapping every original Gate A–H requirement to:

- `PASS_WITH_EXECUTABLE_EVIDENCE`
- `VALID_DIFFERENT_SCOPE_WITH_PROOF`
- `NOT_REPRODUCED_WITH_PROOF`
- `STILL_OPEN`

Do not equate “not mentioned in the final summary” with pass.

## Gate 1 — Reconciled performance must be the primary headline

The Prompt 25A fix changed only explanatory text. That is insufficient unless the visible performance hierarchy is also truthful.

Trace and reconcile:

- account `NET VS SEED` around `+₹8,06,361.70`;
- ledger drift around `+₹8,00,644.80`;
- trade-attributed F&O realised P&L around `+₹5,716–₹5,717`;
- combined F&O/equity realised P&L around `+₹15,030`.

Required production behavior:

1. The dominant/primary trading-performance headline must use reconciled trade-attributed realised P&L.
2. `NET VS SEED` may remain only as a secondary account-reconciliation metric.
3. Unreconciled drift must be visibly labelled `not strategy performance` and must never feed ROI, expectancy, profit factor, setup performance, or strategy ranking.
4. If exact reconciliation is not possible from current records, show `UNRECONCILED` and the known components; do not invent a balancing entry.
5. Preserve all historical evidence.

Add executable tests that fail if an unreconciled balance delta becomes a strategy-performance headline or downstream performance input.

## Gate 2 — HDFCBANK staged-order forensic closure

Investigate the staged HDFCBANK candidate around ₹1,920 versus canonical prices shown elsewhere.

Trace, read-only:

- symbol, exchange, segment, instrument token, ISIN where available;
- stage timestamp and quote `asOf`;
- provider/source;
- corporate-action/split adjustment status;
- expiry/status;
- plan snapshot and audit provenance.

Return one verdict:

- `VALID_HISTORICAL_PRICE_WITH_PROOF`
- `WRONG_INSTRUMENT_IDENTITY`
- `UNADJUSTED_CORPORATE_ACTION`
- `STALE_OR_EXPIRED_STAGE`
- `INSUFFICIENT_PROVENANCE_QUARANTINE_REQUIRED`

Do not delete or mutate the record. If invalid, harden the production admission/approval path so equivalent stages are rejected or quarantined with a machine-readable reason. Add executable tests using production validation logic.

## Gate 3 — Chart loading, hydration, and empty-data states

Audit the actual production chart paths for OI Lab and Institutional Flows.

Prove and distinguish:

- initial loading/hydration;
- async data arrival and re-render;
- valid empty series;
- zero buffered OI snapshots;
- provider unavailable/error;
- rendered chart.

Required UI behavior:

- never show a blank chart container without an explicit state;
- data arriving after first paint must render without a manual reload;
- zero OI snapshots must say `No snapshots buffered` or equivalent;
- loading must not be labelled no-data;
- last-good stale data may remain visible with source and `asOf`.

Use rendered-component tests with controlled async resolution. Source-text inspection alone is not acceptance.

## Gate 4 — Universe, scan, and breadth count reconciliation

Trace each displayed count to its exact dataset and scope:

- provider instrument master;
- configured scanner universe;
- available subset;
- scanned subset;
- unavailable symbols;
- breadth denominator;
- Sensex 30 availability.

Values such as 8,891, 155, 152, 76, and 29/30 may coexist only when visibly labelled by scope. Within every card/table:

`available + unavailable = configured total`

and breadth counts must reconcile to the labelled breadth universe or explicitly disclose exclusions/no-data rows.

Add production-function/component tests for arithmetic and labels. Do not force unrelated universe sizes to one number.

## Gate 5 — Classification and copy verification

Use the real classifier/configuration to verify:

1. MARICO positive earnings content appearing under regulator/probe classification.
2. Bullish versus Strong Bullish score-threshold ordering.
3. RSI/trend labels, acknowledging that trend may use inputs beyond RSI.
4. Fixed 2R targets versus structure-capped R:R values.
5. Similar ticker identification for GODREJPROP versus GODREJCP.

Fix only reproduced defects. If different labels are valid because they come from different models, display the model/scope rather than changing the classifier. Show full company names where ticker similarity creates selection risk.

## Gate 6 — NIFTY/GIFT and other `VALID_DIFFERENT_SCOPE` proof

The Prompt 25A report classified NIFTY/GIFT, timestamp handling, PCR scope, and spread payoff as valid. Preserve that result only if evidence contains executable proof of:

- a GIFT instrument key never populating a NIFTY spot/close field;
- NIFTY previous close being explicitly labelled;
- UTC→IST conversion occurring exactly once;
- full-chain and visible-window PCR carrying distinct scope labels;
- the Bull Call Spread payoff invariant reconciling legs, width, quantity, debit, breakeven, and max profit from the same plan snapshot.

Add the missing executable test if any proof is only structural or narrative. Do not alter correct arithmetic.

## Gate 7 — Authenticated visual evidence

Capture Stock Scanner Pro only at 390×844, 768×1024, and 1440×900 for every surface changed by Prompts 25A/25B, including:

- F&O account/performance summary;
- intraday report win-rate state;
- P&L Overview missing-extremes state;
- FII/DII monthly net-only state;
- OI Lab sentiment and chart states;
- staged swing-order status if safely reproducible;
- affected market-cue/universe surfaces.

Screenshots must demonstrate READY, missing/unavailable, loading/empty, and stale/closed states where applicable. Production-shaped fixtures may be used for deterministic states but must be clearly identified as fixture evidence, not live-provider proof.

Reject screenshots with clipped tables, navigation overlap, horizontal overflow, ambiguous metric labels, or missing `asOf`/scope where required.

## Gate 8 — Closing battery

Run and record:

- scanner tests: floor `1,176` passing;
- API-server non-DB tests: floor `5,603` passing;
- TypeScript checks: scanner, api-server, api-zod, api-client-react;
- scanner production build;
- API-server production build;
- `git diff --check`;
- `.skip`, `.only`, retry, assertion-weakening, and arbitrary-sleep audit;
- zero DB connections and zero live-provider calls from new tests;
- client-bundle credential sentinel scan;
- confirmation that `artifacts/global/**` is untouched.

## Evidence and final verdict

Append a new closure section to:

`artifacts/audit-evidence/PROMPT_25A_V2_PRODUCTION_TRUTH_AND_CROSS_TAB_RECONCILIATION.md`

Include the full original-gate reconciliation matrix, exact files changed, runtime evidence, screenshot inventory, test/build results, and unresolved owner actions.

Final nonblank line:

`END_PROMPT_25B_OMITTED_GATE_AND_PERFORMANCE_TRUTH_CLOSURE`

Return only one of:

- `ACCEPT_PROMPT_25B_OMITTED_GATE_AND_PERFORMANCE_TRUTH_CLOSURE`
- `BLOCKED_PROMPT_25B — <exact unresolved gate and evidence>`

Do not begin Pack 7 during this task. Pack 7 provider activation/shadow parity becomes next only after this closure is accepted.
