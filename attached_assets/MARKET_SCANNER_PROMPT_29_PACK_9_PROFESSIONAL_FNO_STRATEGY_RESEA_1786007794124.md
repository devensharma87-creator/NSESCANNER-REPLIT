# MARKET SCANNER PROMPT 29 — PACK 9 PROFESSIONAL F&O STRATEGY RESEARCH, QUALIFICATION AND DISABLED IMPLEMENTATION

## 1. Mission

Design, backtest, independently validate and—only when objectively qualified—implement up to four professional-grade intraday F&O strategy families for NIFTY, BANKNIFTY and SENSEX.

The required outcome is not “four strategies at any cost.” The professional outcome is:

- four strategies qualify under pre-registered, net-of-cost, out-of-sample standards; or
- fewer strategies qualify and the rest are explicitly rejected; or
- the historical option-premium foundation is insufficient and implementation is blocked honestly.

No strategy may be called profitable, robust, universal or paper-ready merely because it looks good in-sample.

This pack may implement qualified strategies behind hard-disabled V2 feature flags, but it must not activate `FNO_PAPER_V2`, change the existing production cohort, or place any broker order.

## 2. Project boundary

Work only on Stock Scanner Pro:

- `artifacts/api-server/**`
- `artifacts/scanner/**` only for owner research/diagnostic presentation if required;
- `lib/api-zod/**` and `lib/api-client-react/**` only for approved research contracts;
- audit/research evidence.

`artifacts/global/**` is the separate frozen Global Multi Asset Scanner project and is excluded from all reads, edits, tests, builds and evidence counts.

## 3. Frozen production behavior

Do not modify:

- existing F&O strategy formulas, thresholds or results;
- existing swing strategy behavior;
- current signals, admissions, exits, targets, stops, confidence, vetoes, sizing or capital controls;
- historical paper trades, P&L, ledgers or audit history;
- Pack 7/8 provider roles;
- Yahoo retained global delayed-analytics role;
- Kite canonical trading role;
- Upstox shadow-only role;
- IndianAPI fundamentals-only role;
- live broker hard blocks;
- `DB_TEST_RUNTIME_AUTHORIZED = false as boolean`.

No operational DB mutation, manual commit, push, pull, fetch, publish or deployment.

## 4. Gate 0 — Finish the continuous provider observation

During an open-market window, run the accepted Pack 7 parity observer continuously for at least 30 elapsed minutes—not quick rounds—and collect the three verified indices plus at least five verified equities.

Run this passively while Gates 1–4 are being executed. Do not wait idly.

Requirements:

- central parity thresholds unchanged;
- minimum 20 comparable samples per instrument;
- correct comparison-time capture after fetch completion;
- zero false future-timestamp classifications from probe latency;
- actual future timestamps still fail closed;
- zero shadow influence on canonical values or trading paths;
- p50/p95/max delta, skew and latency reported.

This closes the only remaining duration limitation from Packs 7/8.

## 5. Gate 1 — Historical data-foundation audit

Before designing parameters, audit every dataset available for professional option-premium backtesting.

Produce a machine-readable inventory covering:

- source tables/files/warehouses;
- observation range and trading sessions;
- indices and expiries;
- strikes relative to ATM;
- CE/PE coverage;
- snapshot frequency and gaps;
- quote fields, bid/ask, LTP, OI, volume, IV and Greeks availability;
- spot/index candles and context fields;
- timestamp timezone and ordering;
- duplicated/future/out-of-session rows;
- contract identity and expiry roll;
- historical lot-size changes by effective date;
- corporate/exchange-calendar handling;
- missing entry/exit premium rates;
- survivorship and selection bias;
- spread-leg synchronization;
- transaction-cost inputs;
- test/train leakage risks.

Reconcile the previously reported option-chain snapshot range/count with current storage. Do not quote old counts as current without verifying them.

Required data-quality gates:

- no synthetic option chains or premiums;
- no interpolation presented as executable price;
- no future candle/snapshot leakage;
- no use of the same end-of-bar information to create and fill a signal unless the execution model explicitly enters on the next eligible quote;
- no zero-price fallback for missing premiums;
- excluded outcomes counted and disclosed by reason;
- spread legs aligned to an executable timestamp policy;
- costs and lot sizes effective for the historical date.

If the data cannot support chronological out-of-sample testing for all three indices, return `BLOCKED_PACK_9_DATA_FOUNDATION_INSUFFICIENT` after completing the audit and remediation plan. Do not fabricate history.

## 6. Gate 2 — Freeze the research protocol before viewing results

Write and hash a pre-registration section before running the candidate backtests. It must freeze:

- candidate hypotheses;
- allowed input fields;
- entry decision timestamp;
- execution/fill model;
- contract, strike and expiry selection;
- exit, stop, target and time-stop rules;
- maximum trades/day and overlap policy;
- transaction costs, slippage and spread assumptions;
- chronological train/validation/test split;
- walk-forward schedule;
- regime definitions;
- qualification metrics and minimum samples;
- parameter-search space and maximum trials;
- tie-breaking and rejection rules.

The untouched test period must remain inaccessible to parameter selection. Record a hash of the frozen protocol and test-period boundaries before any final test evaluation.

Do not loosen standards after seeing results. Any change requires a new experiment ID and invalidates the previous untouched test.

## 7. Gate 3 — Candidate strategy families

Research a diversified candidate set, not cosmetic variations of one rule. Include at least these professional archetypes where the verified data supports them:

1. **Opening-range momentum breakout** — price structure, trend/regime and liquidity confirmation; execution only after the range is complete.
2. **Trend pullback/continuation** — EMA/price structure and momentum/ADX-style context without using fabricated cash-index volume or session VWAP.
3. **Compression-to-expansion breakout** — ATR/range compression followed by confirmed expansion; option OI/volume filters only when historical fields are genuinely available.
4. **Defined-risk directional debit spread** — synchronized real premiums, correct width/lot/date-aware payoff and liquidity constraints.
5. **Failed-breakout/reversal candidate** — only with an independently defined price-structure anchor; do not resurrect the retired cash-index VWAP mean-reversion path.
6. **Volatility expansion candidate** such as a long straddle/strangle — only if synchronized real two-leg premiums and exits are available.
7. **Defined-risk premium-selling candidate** such as an iron fly/condor — research-only unless bid/ask, synchronized legs, margin/risk and tail-loss modeling are adequate.
8. Existing accepted setups as benchmark controls, without modifying them.

The goal is to qualify up to four distinct families. A universal strategy must pass independently on NIFTY, BANKNIFTY and SENSEX using the same economic logic. Index-specific contract resolution and date-effective lot size are allowed; arbitrary per-index curve-fit rules are not.

If a candidate passes only one or two indices, classify it as index-scoped research and do not count it among the four universal strategies.

## 8. Gate 4 — Professional execution and cost model

All results must use real, executable premium evidence wherever possible.

Model and disclose:

- next-eligible-quote fills;
- bid/ask or conservative LTP slippage policy;
- brokerage;
- STT;
- exchange transaction charges;
- GST;
- SEBI charges;
- stamp duty;
- multi-leg cost multiplication;
- partial/missing leg handling;
- maximum adverse fill bound;
- expiry-day behavior;
- market-close time stop;
- gap/tail loss;
- rejected/unfilled signals.

Report gross P&L, every cost component and net P&L separately. Never infer an exit premium from the underlying move and present it as real option P&L.

If a delta proxy is used for exploratory comparison, label it `MODELLED_DIRECTIONAL_PROXY`, exclude it from qualification, and never combine it with real-premium results.

## 9. Gate 5 — Chronological validation and robustness

For every candidate and index, run:

- chronological training;
- validation used for bounded selection;
- untouched final test;
- walk-forward analysis;
- monthly/weekly stability;
- trending, ranging, high-volatility, low-volatility, gap and expiry-day regimes;
- parameter-neighborhood stability;
- cost/slippage stress;
- delayed-entry stress;
- missed-fill stress;
- index-by-index and combined results;
- trade-sequence/bootstrap or equivalent uncertainty analysis;
- multiple-testing/selection-bias control appropriate to the number of trials.

Prohibit random shuffled train/test splits for time-series qualification.

Required reporting includes:

- trades and sessions;
- win/loss/scratch/expired counts;
- expectancy per trade and per unit risk;
- profit factor;
- gross/net P&L;
- maximum drawdown and duration;
- average/median win and loss;
- payoff ratio;
- Sharpe/Sortino where statistically meaningful;
- tail loss/CVaR or equivalent;
- maximum consecutive losses;
- time in trade and trades/day;
- target, stop and time-exit distribution;
- excluded/missing-premium rate;
- turnover and total costs;
- confidence intervals;
- sample-size warnings.

Never rank strategies by win rate alone.

## 10. Gate 6 — Pre-registered qualification rules

Freeze numeric acceptance thresholds before evaluating the untouched test. Thresholds must be professionally justified and must include, at minimum:

- minimum overall and per-index trade/session samples;
- positive net expectancy after all costs on the untouched test;
- profit factor above the frozen minimum on combined and per-index test sets;
- maximum drawdown within the frozen risk budget;
- acceptable tail loss and consecutive-loss behavior;
- bounded missing-premium/unfilled rate;
- parameter-neighborhood stability;
- no single day, expiry or index accounting for an excessive share of profit;
- no catastrophic failure in an identified regime;
- cost/slippage stress survival;
- no lookahead, synthetic-premium or data-integrity violation.

Qualification classes:

- `UNIVERSAL_FNO_V2_QUALIFIED` — passes all three indices and all gates;
- `INDEX_SCOPED_RESEARCH_ONLY` — passes only a subset;
- `MORE_DATA_REQUIRED` — promising but under-sampled;
- `REJECTED_NO_EDGE`;
- `REJECTED_UNSTABLE`;
- `REJECTED_COST_SENSITIVE`;
- `REJECTED_DATA_INTEGRITY`.

At most four strategies may receive `UNIVERSAL_FNO_V2_QUALIFIED`. Zero is a valid professional result.

## 11. Gate 7 — Independent reproduction and invariants

For every qualified candidate:

- run a second independent calculation path or replay implementation;
- reconcile trade count, entry/exit identity, gross P&L, costs and net P&L;
- prove immutable plan snapshots;
- prove deterministic reruns from identical input/version;
- prove no signal can use post-decision data;
- prove contract and lot-size date correctness;
- prove option-leg synchronization;
- prove missing data fails closed;
- prove no Yahoo/Upstox-shadow/IndianAPI value enters trade qualification contrary to accepted policy.

Any unexplained reconciliation difference blocks qualification.

## 12. Gate 8 — Disabled production implementation

Implement only candidates classified `UNIVERSAL_FNO_V2_QUALIFIED`.

Implementation requirements:

- isolated V2 strategy modules and typed contracts;
- unique immutable strategy/version ID;
- feature flag default `false`;
- no registration in the existing production detector loop;
- no signal emission to the current cohort;
- no paper-trade creation;
- no Telegram trade alert;
- no broker order;
- deterministic reason codes for every accept/reject;
- canonical Kite trade-grade data only;
- existing guardrails applied unchanged unless a later activation prompt explicitly validates V2-specific additions;
- clear setup availability by index and required data capability.

Research UI/API may show results and qualification status, but must label strategies `DISABLED — NOT YET PAPER-ACTIVE`.

Do not implement rejected candidates as hidden trade paths.

## 13. Gate 9 — Load-bearing tests

Add executable tests covering at least:

1. data inventory and coverage arithmetic;
2. duplicate/future/out-of-session detection;
3. contract/expiry/lot-size historical identity;
4. no same-bar lookahead;
5. next-eligible-quote execution;
6. missing-premium fail-closed behavior;
7. synchronized multi-leg fills;
8. complete transaction costs;
9. gross-to-net reconciliation;
10. chronological split isolation;
11. untouched-test protection;
12. bounded parameter search;
13. walk-forward determinism;
14. regime metrics;
15. sample-size gates;
16. universal versus index-scoped classification;
17. cost/slippage stress;
18. strategy contribution concentration;
19. independent replay reconciliation;
20. V2 feature flags default false;
21. zero current-cohort signal/paper/broker impact;
22. provider-policy invariants;
23. Pack 7/8 continuous observation carryover;
24. Global-project exclusion.

Tests must use deterministic historical fixtures/snapshots. No live provider call or operational DB mutation is allowed in the deterministic battery.

## 14. Gate 10 — Verification battery

Run and record:

- API-server non-DB floor: 5,964 tests;
- scanner floor: 1,250 tests;
- typechecks: api-server, scanner, api-zod, api-client-react;
- API-server and scanner production builds;
- `git diff --check`;
- `.skip`, `.only`, retries, arbitrary sleeps and assertion-weakening audit;
- zero operational DB mutation;
- zero broker/live signal impact;
- built-client credential sentinel scan;
- confirmation that existing strategy baselines remain identical;
- confirmation that Global is untouched.

## 15. Evidence deliverables

Write:

`artifacts/audit-evidence/FAST_TRACK_PACK_9_PROFESSIONAL_FNO_STRATEGY_RESEARCH_AND_QUALIFICATION.md`

Also produce machine-readable artifacts for:

- data-quality inventory;
- frozen research protocol and hash;
- experiment registry;
- candidate/parameter registry;
- trade-level backtest output with exclusion reasons;
- cost reconciliation;
- walk-forward/OOS metrics;
- qualification matrix;
- independent-replay reconciliation;
- qualified disabled strategy manifest.

Evidence must state what was tested, what failed, what remains uncertain and why. Do not hide rejected strategies or unsuccessful trials.

Final nonblank line:

`END_FAST_TRACK_PACK_9_PROFESSIONAL_FNO_STRATEGY_RESEARCH_AND_QUALIFICATION`

Return exactly one:

- `ACCEPT_PACK_9_FOUR_UNIVERSAL_FNO_V2_STRATEGIES_QUALIFIED_AND_IMPLEMENTED_DISABLED`;
- `PARTIAL_PACK_9 — <number qualified, classifications and exact remaining requirements>`;
- `BLOCKED_PACK_9_DATA_FOUNDATION_INSUFFICIENT — <exact missing coverage>`;
- `REJECT_PACK_9_NO_STRATEGY_MET_PROFESSIONAL_QUALIFICATION`;
- `BLOCKED_PACK_9 — <exact failed safety or integrity gate>`.

Do not activate FNO_PAPER_V2 or SWING_PAPER_V2 in this task. Their independent-cohort activation becomes the next roadmap pack only after qualification evidence is accepted.
