CODER PROMPT — LANE 1 HARD GAP CLOSURE / DO NOT CLAIM DEV_VERIFIED YET

Current accepted verdict from owner review:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_PARTIAL_GAP_REMAINS

Your latest work is useful, but Lane 1 is not yet fully accepted because the report itself admits important Contract Master gaps remain.

Accepted sub-fixes:
1. F&O options page now displays spotChangePctVsPrevClose as primary, with vs-open fallback labelled.
2. MIDCAP proxy level blocking remains accepted.
3. FINNIFTY was classified as OUTDATED_AUDIT_FINDING with evidence.
4. strikeStepSource and instrument-master-first strike-step resolution are accepted.
5. lotSizeSource was added to option-chain response.
6. paperTradingFO lotSizeFor now tries live Kite cache first and logs LOT_SIZE_DRIFT.

Remaining hard gaps:
1. Expiry is still stamped as algorithmic_weekday, not instrument_master.
2. ContractMasterFact is not fully implemented.
3. expirySource: "instrument_master" is explicitly reported as “not yet wired.”
4. Backtest lot-size regime/source annotation is not clearly implemented.
5. Full Lane 1 production publish is still pending.

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

Close only the remaining Lane 1 contract-master gaps.

====================================================
GAP A — EXPIRY MUST BE CONTRACT-MASTER PROVEN
====================================================

Problem:
Current report says OptionLeg expirySource is stamped as:

algorithmic_weekday

This is not enough for Lane 1.

Required:
1. Resolve expiry from actual Kite/BSE/NSE contract master when the contract exists.
2. Persist / emit expirySource:
   - instrument_master
   - algorithmic_weekday_fallback
   - static_fallback
   - unavailable
3. If expiry is fallback/inferred, it must be labelled as fallback and not represented as trade-grade contract-master proof.
4. Signal payload must include:
   - expiry
   - expirySource
   - contractInstrumentToken
   - tradingSymbol
   - exchange
   - contractGrade
5. No global weekday assumption should be able to override an available contract-master expiry.
6. BANKNIFTY must not resolve fake weekly expiry if the instrument master has only monthly.
7. SENSEX must resolve from BSE contract instruments, not NSE global logic.
8. Existing historical rows must not be rewritten.

Required tests:
| Test | Expected |
|---|---|
| NIFTY expiry from contract master | expirySource=instrument_master |
| BANKNIFTY no fake weekly expiry | uses real listed expiry only |
| SENSEX expiry from BSE contract master | exchange=BSE, expirySource=instrument_master |
| contract master unavailable | fallback labelled, not trade-grade |
| signal payload | has expirySource + contractInstrumentToken |
| no global weekday override | pass |

====================================================
GAP B — COMPLETE CONTRACTMASTERFACT
====================================================

Implement or expose a real ContractMasterFact / equivalent response object.

Required fields:
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

Required:
1. ContractMasterFact must be used or surfaced wherever signal/paper/option-chain contract identity matters.
2. Static maps may exist only as labelled fallback.
3. Static fallback mismatch vs master must log a drift alarm.
4. ContractInstrumentToken must be persisted/emitted for new signal/paper-trade rows where available.
5. Existing historical rows must remain unchanged.

Required tests:
| Field | Expected |
|---|---|
| lotSizeSource | instrument_master when master warm |
| strikeStepSource | instrument_master when inferred from master |
| expirySource | instrument_master when contract matched |
| contractInstrumentToken | present on matched contract |
| fallbackReason | present when fallback used |
| contractGrade | not trade-grade when fallback/unavailable |
| drift alarm | emits if static differs from master |

====================================================
GAP C — PAPER OPEN PATH CONTRACT MASTER PROOF
====================================================

Do not only state “paper uses master lot size.”

Prove it.

Required:
1. Paper open path uses ContractMasterFact / live master lotSize at open time.
2. Paper open stores:
   - lot_size used
   - lotSizeSource, if schema/API supports it
   - contractInstrumentToken, if available
   - contractGrade / fallback reason, if available
3. If master unavailable, fail closed or demote to INFO_ONLY according to existing architecture.
4. No old trade P&L rewrite.

Required tests:
1. NIFTY open uses lot size 65 from master.
2. BANKNIFTY open uses lot size 30 from master.
3. SENSEX open uses lot size 20 from master.
4. Static fallback mismatch logs drift warning.
5. Master unavailable does not silently use stale static map as trade-grade.

====================================================
GAP D — BACKTEST LOT-SIZE REGIME / SOURCE ANNOTATION
====================================================

Required:
1. Backtest results must label lot-size regime/source.
2. Backtests spanning old and new lot-size regimes must not silently mix assumptions.
3. No historical paper ledger rewrite.
4. Add report/export field if available:
   - lotSizeRegime
   - lotSizeSource
   - contractSource
   - fallbackReason

Required tests:
1. Backtest row/result carries lot-size source/regime.
2. Static fallback is labelled.
3. Old historical regime is not overwritten.

====================================================
GAP E — REPORTS / BUG REGISTER
====================================================

Until all gaps above are complete, keep verdict:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_PARTIAL_GAP_REMAINS

Update:
1. P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_REPORT.md
2. MASTER_QUANT_REMEDIATION_ROADMAP_2026_07_09.md
3. MASTER_QUANT_BUG_REGISTER_2026_07_09.csv
4. WEBSITE_CANONICAL_DATA_INTEGRATION_REPORT.md
5. USER_FACING_CORE_TABS_DEEP_AUDIT_REPORT.md
6. POST_P0_SIGNAL_SYSTEM_REBASELINE_REPORT.md

If you complete all gaps, final verdict may become:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED

If any gap remains, final verdict must remain:

P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_PARTIAL_GAP_REMAINS

====================================================
TESTS REQUIRED
====================================================

Run and report exact counts:

pnpm --filter @workspace/scripts run verify:release

pnpm --filter @workspace/api-server run typecheck

pnpm --filter @workspace/api-server run typecheck:libs

pnpm --filter @workspace/api-server exec vitest run src/lib/*index*.test.ts src/lib/*quote*.test.ts src/lib/*contract*.test.ts src/lib/*optionChain*.test.ts src/lib/*optionSignal*.test.ts src/lib/*paper*.test.ts src/lib/*backtest*.test.ts src/routes/**/*.test.ts

pnpm --filter @workspace/scanner run typecheck

pnpm --filter @workspace/scanner exec vitest run

pnpm --filter @workspace/scripts run index:llm

pnpm --filter @workspace/scripts run index:llm:check

Split timed-out suites and report exact counts.

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

Use DEV_VERIFIED only if expirySource instrument_master, ContractMasterFact, paper-open contract proof, backtest lot-size regime/source, tests, and reports are all complete.

Do not claim PROD_VERIFIED until owner publishes and /api/build-info confirms the Lane 1 fix commit is live.
