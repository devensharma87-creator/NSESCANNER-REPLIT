CODER PROMPT — LANE 1 FINAL HARD GAP CLOSURE / RUNTIME CONTRACT MASTER PROOF REQUIRED

Current owner-review verdict:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_PARTIAL_GAP_REMAINS

Your latest work is useful and several sub-fixes are accepted, but Lane 1 is NOT accepted as DEV_VERIFIED yet because your own report lists important items as not done / follow-on.

Accepted sub-fixes:
1. ContractMasterFact module created.
2. OptionLeg now carries contract fields.
3. paper_trade_fo now has contract provenance columns.
4. backtest_trades now has lot_size_source and lot_size_regime columns.
5. codegen completed.
6. canonicalDataParity tests pass.
7. F&O and backtest related suites pass.
8. Reports were updated.

Remaining blockers:
1. expirySource='instrument_master' runtime behavior is not proven by dedicated tests.
2. Dedicated contractMasterFact unit tests were not created.
3. SENSEX BFO path is not directly tested.
4. BANKNIFTY fake-weekly fallback is not directly tested.
5. cold-cache / unavailable contract master behavior is not directly tested.
6. Frontend does not surface new contract identity fields yet.
7. verify:release exact count was not provided in the final evidence table.
8. scanner full suite exact count was not provided in the final evidence table.
9. production publish is still pending.

====================================================
STRICT RULES
====================================================

Do not start Lane 2.
Do not start Paper Ledger.
Do not start Chart Reliability.
Do not touch ATR/Wilder.
Do not touch equity gap-through exits.
Do not change strategy thresholds.
Do not change detector weights.
Do not change confidence formula.
Do not change stop formula.
Do not change target formula.
Do not change account balance.
Do not rewrite historical trades.
Do not perform destructive migrations.
Do not break P0-00 locked plan immutability.
Do not enable broker execution.
Do not place real orders.
Do not send Telegram test messages.

Close only the remaining Lane 1 proof gaps.

====================================================
GAP 1 — DEDICATED contractMasterFact TESTS
====================================================

Create dedicated unit tests, preferably:

contractMasterFact.test.ts

Required tests:

1. NIFTY exact contract match:
   - exchange=NFO
   - expirySource=instrument_master
   - contractGrade=trade_grade
   - contractInstrumentToken present
   - tradingSymbol present
   - lotSizeSource=instrument_master
   - strikeStepSource=instrument_master or correctly inferred from master

2. SENSEX exact contract match:
   - exchange=BFO
   - expirySource=instrument_master
   - contractGrade=trade_grade
   - contractInstrumentToken present
   - tradingSymbol present

3. BANKNIFTY fake-weekly guard:
   - no fake weekly expiry is created when the instrument master has only monthly expiry.
   - selected expiry must exist in the master.
   - if fallback is used, fallbackReason must be explicit.

4. Cold cache / unavailable master:
   - contractGrade is not trade_grade.
   - expirySource is algorithmic_weekday_fallback / static_fallback / unavailable.
   - fallbackReason is populated.
   - static fallback does not pretend to be instrument_master.

5. Static mismatch drift alarm:
   - if static lot/strike step differs from master, emit warning / drift alarm.
   - fallback must be labelled.

6. Output completeness:
   Every returned ContractMasterFact must include:
   - underlying
   - exchange
   - segment
   - instrumentToken
   - tradingSymbol
   - expiry
   - expirySource
   - expiryType
   - strike
   - strikeStep
   - strikeStepSource
   - optionType
   - lotSize
   - lotSizeSource
   - source
   - asOf
   - fetchedAt
   - freshnessSeconds
   - isFallback
   - fallbackReason
   - contractGrade

====================================================
GAP 2 — SIGNAL EMISSION RUNTIME TESTS
====================================================

Add runtime tests, not just source-scan tests.

Required tests:

1. OptionSignal leg uses ContractMasterFact result when cache is warm.
2. expirySource becomes instrument_master for exact matched contract.
3. contractInstrumentToken is present for exact matched contract.
4. tradingSymbol and exchange are present for exact matched contract.
5. SENSEX leg uses BFO, not NFO.
6. BANKNIFTY leg does not invent fake weekly expiry.
7. cold-cache signal leg is clearly fallback/info_only and not trade_grade.

====================================================
GAP 3 — PAPER OPEN CONTRACT PROVENANCE TESTS
====================================================

Add tests proving the paper open path stores contract provenance.

Required tests:

1. New NIFTY paper trade stores:
   - lot_size=65
   - lot_size_source=instrument_master
   - contract_instrument_token populated
   - contract_grade=trade_grade
   - contract_fallback_reason null

2. New SENSEX paper trade stores:
   - lot_size=20
   - exchange/contract token from BFO path if available
   - no static fallback pretending to be master

3. Static fallback case:
   - lot_size_source=static_fallback
   - contract_grade not trade_grade
   - fallback reason populated
   - no silent trade-grade claim

4. Existing historical rows:
   - not rewritten.

====================================================
GAP 4 — BACKTEST REGIME / SOURCE TESTS
====================================================

Add tests proving backtest output and persisted rows carry:

1. lotSizeSource
2. lotSizeRegime
3. contractSource or fallbackReason if available.

Required:
- existing historical backtest rows not rewritten.
- new backtest trades carry regime/source.

====================================================
GAP 5 — FRONTEND CONTRACT IDENTITY SURFACE
====================================================

Do not leave this completely hidden if the API now emits the fields.

At minimum surface read-only contract identity on F&O signal card/details:

1. tradingSymbol
2. exchange
3. contractInstrumentToken, if available
4. contractGrade
5. expirySource
6. lotSizeSource
7. strikeStepSource, if available
8. fallbackReason, if fallback

UI must show:

- TRADE-GRADE CONTRACT MASTER when matched.
- FALLBACK CONTRACT DATA when fallback.
- UNAVAILABLE CONTRACT MASTER when unavailable.

If frontend surfacing is not safe in this commit, final verdict must stay PARTIAL_GAP_REMAINS with explicit reason.

====================================================
GAP 6 — REPORTS / BUG REGISTER
====================================================

Until all gaps above are complete, keep:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_PARTIAL_GAP_REMAINS

Update:
1. P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_REPORT.md
2. MASTER_QUANT_REMEDIATION_ROADMAP_2026_07_09.md
3. MASTER_QUANT_BUG_REGISTER_2026_07_09.csv
4. WEBSITE_CANONICAL_DATA_INTEGRATION_REPORT.md
5. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
6. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md

Only mark:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED

if all runtime tests, paper/backtest tests, frontend surfacing, report updates, and required verification commands pass.

====================================================
REQUIRED TEST COMMANDS
====================================================

Run and report exact counts:

pnpm --filter @workspace/scripts run verify:release

pnpm --filter @workspace/api-server run typecheck

pnpm --filter @workspace/api-server run typecheck:libs

pnpm --filter @workspace/api-server exec vitest run src/lib/*contract*.test.ts src/lib/*optionChain*.test.ts src/lib/*optionSignal*.test.ts src/lib/*paper*.test.ts src/lib/*backtest*.test.ts src/routes/**/*.test.ts

pnpm --filter @workspace/scanner run typecheck

pnpm --filter @workspace/scanner exec vitest run

pnpm --filter @workspace/scripts run index:llm

pnpm --filter @workspace/scripts run index:llm:check

Split timed-out suites and report exact counts.

Do not say only “all green.”

====================================================
SAFETY CONFIRMATION
====================================================

Confirm:
1. No broker execution.
2. No real orders.
3. No Telegram messages.
4. No strategy threshold changes.
5. No detector weight changes.
6. No confidence formula changes.
7. No stop formula changes.
8. No target formula changes.
9. No account balance changes.
10. No realized P&L rewrite.
11. No historical trade rewrite.
12. No destructive migration.
13. No P0-00 locked plan mutation regression.
14. No Yahoo/delayed/proxy/report-grade source can drive trades.
15. No unavailable data rendered as zero/none/green/live.
16. Static fallback never presents as instrument-master verified.
17. Fallback contract data cannot silently open trade-grade paper trades.

====================================================
FINAL VERDICT
====================================================

Final verdict must be exactly one:

- P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED
- P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_PARTIAL_GAP_REMAINS
- P0_LANE1_FORENSIC_ONLY_OWNER_APPROVAL_REQUIRED
- RELEASE_INTEGRITY_REGRESSION_FOUND
- ROLLBACK_REQUIRED

Use DEV_VERIFIED only if:
1. dedicated contractMasterFact tests exist and pass,
2. runtime signal emission proves instrument_master when master is warm,
3. SENSEX BFO path is tested,
4. BANKNIFTY fake-weekly path is tested,
5. cold-cache fallback is tested,
6. paper open contract provenance is tested,
7. backtest lot-size regime/source is tested,
8. frontend surfaces contract identity or final verdict stays partial,
9. all reports are updated,
10. exact test counts are provided.

Do not claim PROD_VERIFIED until owner publishes and /api/build-info confirms the Lane 1 fix commit is live.
