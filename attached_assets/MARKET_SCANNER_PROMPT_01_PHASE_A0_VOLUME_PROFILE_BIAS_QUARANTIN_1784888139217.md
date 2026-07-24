# MARKET SCANNER BY DEV
# PROMPT 01 — PHASE A0: VOLUME-PROFILE DIRECTIONAL-BIAS QUARANTINE

**Programme:** Final Market Scanner Remediation Programme  
**Checkpoint:** A0.1  
**Primary defects:** `D-FAB-03`, `D-FAB-04`  
**Primary fixes:** `FX-03`, `FX-04`  
**Owner:** Devendra Sharma  
**Platform:** `marketscannerbydev.in`  
**Authoritative timezone:** `Asia/Kolkata` / IST  
**Operating scope:** Owner-only research, analysis and supervised paper trading  
**Live broker execution:** NOT AUTHORISED and must remain disabled  
**Maximum status allowed by this checkpoint:** `UNIT_VERIFIED` or `DEV_VERIFIED`  

---

## 1. ROLE AND MISSION

Act as the senior engineer and independent evidence custodian for Market Scanner by Dev.

This is the first implementation checkpoint under the final deduplicated remediation roadmap. Your mission is to re-verify and, only if still present, eliminate every volume-profile-derived directional scoring influence from the index F&O decision path.

The affected universe is:

- NIFTY
- BANKNIFTY
- SENSEX
- any other index that uses the same F&O confluence or signal-generation path

This is a narrow safety quarantine. It is not a redesign of the strategy engine.

Do not begin another defect, phase or improvement. Do not make adjacent “helpful” changes.

---

## 2. CONTROLLING DEFECT STATEMENT

Historical code evidence from the 7 July 2026 audit reported:

- `volumeProfile()` in `indicators.ts` accepted zero-volume index series and returned a non-null, degenerate volume profile;
- its POC/VAH/VAL values were consequently not genuine volume-profile evidence;
- `confluenceEngine.ts` used that result to award approximately `+3` to bullish setups and `-3` to bearish setups;
- `optionSignals.ts` also contained an asymmetric “Above POC” directional driver worth approximately `+8`;
- all three principal traded indices have no trustworthy exchange-traded constituent volume series suitable for this implementation;
- the resulting volume-profile contribution could therefore create a systematic bullish tilt.

The cited historical line numbers include:

- `indicators.ts:155-198`
- `confluenceEngine.ts:141-178`
- `optionSignals.ts:627,635`

Treat these as navigation hints only. Line numbers may have moved, branches may differ and the defect may already have been changed. Current source is authoritative.

The required safety invariant is:

> An unavailable, zero, non-finite, synthetic, proxy, stale or otherwise untrusted volume series must contribute zero directional points, zero confidence, zero trigger eligibility and zero tradeability to an index F&O decision.

“Zero contribution” does not mean fabricating a numeric market value of zero. It means the factor is absent from decision-making and explicitly unavailable wherever its state is exposed.

---

## 3. AUTHORITY AND BRIGHT LINES

### 3.1 Authorised in this checkpoint

You may:

- inspect the repository and current source;
- trace all volume-profile inputs and consumers in the index F&O path;
- add or update narrowly scoped unit/regression tests;
- remove or disable volume-profile-derived directional points, reasons and eligibility effects from index F&O decisions;
- make the smallest source change required to enforce the invariant;
- update an existing authoritative defect/fix/test register if one already exists.

### 3.2 Not authorised

You must not:

- change signal thresholds, confidence thresholds, risk/reward gates or setup weights unrelated to volume profile;
- replace volume profile with price location, candle position, HLC3, VWAP, moving averages, OI, PCR or another heuristic;
- retune the strategy to restore the former signal count;
- change position sizing, lot sizing, entries, exits, stop losses, targets, cooldowns, trade caps or capital rules;
- modify `volumeProfile()` itself unless compilation makes a boundary-only quarantine technically impossible; that primitive is handled by the next checkpoint;
- modify `sessionVwap()`; that is a separate checkpoint;
- change market-calendar, IST, expiry or instrument-resolution logic;
- change Kite, Upstox, IndianAPI, Yahoo or TradingView integrations;
- change database schemas, run DDL, run DML or mutate any database;
- use an operational, development or production database as a test database;
- change environment variables, secrets, deployment configuration or feature flags;
- print secret values, tokens, passwords, connection strings or encrypted session material;
- enable paper automatic opening, swing automatic opening or live broker execution;
- weaken or remove C0 containment;
- commit, merge, rebase, push, publish or deploy;
- rewrite unrelated code or perform route/UI redesign;
- claim production verification.

### 3.3 Required containment state

The following protections must remain unchanged:

- `FNO_AUTO_OPEN_C0_BLOCKED = true`, or the current equivalent named source-level hard block;
- `EQUITY_AUTO_OPEN_C0_BLOCKED = true`, or its current equivalent;
- live broker execution disabled;
- automatic paper opening disabled wherever the current containment programme requires it;
- Swing containment unchanged.

Do not expose secret values while verifying these controls. Report only the control name, source location and boolean/structural state.

---

## 4. STAGE 0 — REPOSITORY AND EVIDENCE FREEZE

Before editing, produce literal evidence for:

1. repository root;
2. applicable `AGENTS.md`, project instructions and repository-specific rules;
3. current branch;
4. exact `HEAD` SHA;
5. upstream branch and ahead/behind state;
6. merge base with the intended base branch;
7. `git status --short`;
8. changed and untracked files;
9. whether any relevant file already has uncommitted user changes;
10. package manager, workspace layout and relevant test/typecheck commands.

Rules:

- Preserve every unrelated change.
- If the worktree is unexpectedly dirty in a file required by this checkpoint, stop before editing and report the overlap.
- Do not use destructive Git operations.
- Do not “clean up” unrelated files.
- Record the pre-change state in the final evidence report.

---

## 5. STAGE 1 — CURRENT-STATE FORENSICS

Use current source—not assumptions from the audit—to build a complete call graph for the defect.

### 5.1 Required searches

Find and report every relevant definition and consumer of:

- `volumeProfile`
- POC, VAH and VAL fields
- “Above POC” and “Below POC” reasons
- volume-profile confluence factors
- confluence score mutations
- directional score mutations
- confidence score mutations
- setup eligibility derived from volume profile
- signal-card drivers or explanations derived from volume profile
- paper-trade or tradeability gates that consume those values

Search the entire repository, including:

- API/server code;
- shared packages;
- scanner/frontend code;
- generated contracts if committed;
- tests and fixtures;
- backtest and replay code;
- reports and notifications.

Separate results into:

- `INDEX_FNO_DECISION_CRITICAL`
- `DISPLAY_ONLY`
- `BACKTEST_OR_REPLAY`
- `EQUITY_OR_NON_INDEX`
- `TEST_OR_FIXTURE`
- `DEAD_OR_REFERENCE_ONLY`
- `UNKNOWN_REQUIRES_EVIDENCE`

Do not declare code dead merely because there is no obvious import. Prove its consumer state.

### 5.2 Required input-truth proof

For each index using this path, prove from code or an existing non-mutating fixture:

- where the volume array originates;
- whether it is exchange volume, zero-filled, absent, synthetic, proxy or transformed;
- how missing/non-finite values are handled;
- whether a zero-total-volume guard exists;
- whether the returned profile can affect direction, score, confidence, trigger, setup classification, entry, risk or tradeability.

Do not query or mutate production merely to obtain this proof.

### 5.3 Decision gate

After inspection, choose exactly one outcome:

#### Outcome A — Defect still exists

Proceed with the minimal quarantine described in Stage 2.

#### Outcome B — Defect is already fully fixed

Make no functional change. Add only missing regression tests if they are genuinely absent and within scope. Provide literal current-code and test evidence. Do not reimplement the fix.

#### Outcome C — Historical diagnosis does not match current architecture

Stop without functional edits. Provide the actual call graph, explain the mismatch and identify the smallest corrected checkpoint. Do not improvise a new strategy design.

---

## 6. STAGE 2 — MINIMAL FAIL-CLOSED QUARANTINE

If Outcome A applies, enforce the following:

1. No POC, VAH, VAL or volume-profile location derived from an untrusted index-volume series may add or subtract points in the F&O confluence score.
2. No “Above POC”, “Below POC”, “Inside Value”, “Outside Value” or equivalent volume-profile reason may influence:
   - direction;
   - setup selection;
   - confidence;
   - signal tier;
   - trigger eligibility;
   - entry eligibility;
   - paper-trade admission;
   - risk sizing;
   - stop or target selection.
3. Do not compensate by changing another factor or threshold.
4. Do not preserve the former score by replacing the factor with a constant.
5. If the API or UI expects a diagnostic field, preserve the contract using an explicit unavailable/not-applicable state rather than a fabricated number.
6. Do not remove generic volume-profile analytics used by unrelated, legitimately volume-bearing instruments unless current evidence proves they share the unsafe decision path.
7. Keep the patch minimal, typed and reversible.

Preferred implementation:

- quarantine at the narrowest shared index-F&O decision boundary;
- use an explicit capability/trust check rather than a fragile symbol-name list if the existing architecture already exposes instrument/data capabilities;
- do not build a new provider or capability framework in this checkpoint.

If a proper capability signal does not exist, use the smallest safe existing index classification and record the architectural limitation for a later checkpoint.

---

## 7. STAGE 3 — MANDATORY TESTS

Add or update focused tests that prove behaviour, not comments.

### 7.1 Structural tests

Prove:

- every index F&O volume-profile scoring consumer is disabled or guarded;
- no alternate index F&O code path can reintroduce the same points;
- no volume-profile reason is emitted as a decision driver for untrusted index volume;
- C0 constants and execution-disable protections remain unchanged.

### 7.2 Behavioural tests

At minimum, create deterministic cases for:

1. all-zero volume series;
2. missing volume series;
3. non-finite volume values;
4. price series above a fabricated POC;
5. price series below a fabricated POC;
6. mirrored bullish and bearish price structures;
7. an unrelated volume-bearing non-index consumer, if one exists and can be tested safely.

For the index F&O cases, prove:

- changing only POC/VAH/VAL cannot change direction, confluence points, confidence, tier or eligibility;
- no asymmetric bullish or bearish volume-profile points remain;
- no NaN, Infinity, fake zero or fallback value reaches the output;
- no replacement heuristic silently takes over.

### 7.3 Regression tests

Run the narrowest relevant existing regression suites covering:

- F&O signal generation;
- confluence scoring;
- direction consistency;
- paper-trade admission;
- signal serialization/contracts;
- source/provenance honesty;
- C0 containment.

Then run the repository’s established typecheck and relevant broader suite.

If a test requires a database:

- run it only when a dedicated isolated test database passes the existing identity guard;
- never fall back to `DATABASE_URL`;
- otherwise report that test as `BLOCKED_TEST_DB`, with no fabricated pass.

Do not weaken tests, reduce assertions, add broad skips or update snapshots merely to obtain green output.

---

## 8. STAGE 4 — READ-ONLY IMPACT EVIDENCE

Where an existing local fixture or replay harness permits, produce a deterministic before/after comparison using identical inputs:

- total evaluations;
- CALL directions;
- PUT directions;
- neutral/rejected evaluations;
- score changes attributable only to removal of the volume-profile factor;
- any setup whose eligibility changes.

This comparison is diagnostic, not a performance claim.

For the requested 30-day CALL/PUT split:

- use only an already available immutable/read-only history or replay dataset;
- state the exact date range, row count, exclusions and provenance;
- do not mutate a database;
- do not claim the result proves profitability;
- if the data or replay mechanism is unavailable, report `LIVE_SAMPLE_PENDING` or `BLOCKED_DATASET` rather than inventing a result.

All pre-quarantine performance evidence remains statistically contaminated until separately revalidated under Phase J.

---

## 9. ACCEPTANCE GATE

This checkpoint passes only if every applicable item below has literal evidence:

- [ ] Current branch, SHA and worktree recorded.
- [ ] Full repository search and decision-path call graph supplied.
- [ ] Current existence or prior closure of `D-FAB-03` and `D-FAB-04` proven.
- [ ] No untrusted index volume-profile value affects any F&O directional or tradeability decision.
- [ ] No “Above POC” or equivalent asymmetric driver affects index F&O decisions.
- [ ] No substitute heuristic, constant points or threshold compensation introduced.
- [ ] Missing/untrusted data remains explicitly unavailable—not fabricated as zero.
- [ ] Focused zero/missing/non-finite/mirrored tests pass.
- [ ] Direction, serialization, paper-admission and containment regressions pass.
- [ ] Typecheck passes.
- [ ] No operational database used.
- [ ] No schema, DDL, DML, environment, secret or deployment change.
- [ ] C0 remains enabled.
- [ ] Live broker execution remains disabled.
- [ ] Diff is limited to the proven decision path, tests and an existing authoritative register.
- [ ] Residual related defects are listed without being implemented.

If any mandatory item fails, the checkpoint status is `BLOCKED` or `IMPLEMENTED_UNVERIFIED`. It is not complete.

---

## 10. RESIDUAL ITEMS — RECORD BUT DO NOT IMPLEMENT

At the end, explicitly carry forward these related items for later checkpoints:

- `D-FAB-01 / FX-01` — make `volumeProfile()` return unavailable on zero/untrusted volume;
- `D-FAB-02 / FX-02` — remove the false “naturally null” comment and replace it with a structural invariant;
- `D-FAB-05 / FX-05` — make session VWAP unavailable on zero/untrusted volume;
- `D-FAB-06 / FX-06` — fix or honestly retire `VOLUME_BREAKOUT`;
- `D-FAB-07 / FX-07` — fix or honestly retire index `MEAN_REVERSION`;
- `D-FKE-05 / FY-17` — remove any VWAP-equals-spot placeholder from the UI;
- Phase A0 live-sample validation and the 30-day post-fix direction split.

Do not close these IDs through this checkpoint.

---

## 11. REQUIRED FINAL RESPONSE FORMAT

Return one evidence report using exactly these sections:

### A. Checkpoint Verdict

One of:

- `BLOCKED`
- `ALREADY_FIXED_CURRENT_CODE`
- `IMPLEMENTED_UNVERIFIED`
- `UNIT_VERIFIED`
- `DEV_VERIFIED`

State explicitly that production is not verified.

### B. Pre-Change Baseline

Branch, SHA, upstream state, merge base, worktree and relevant commands.

### C. Current-State Root-Cause Proof

Exact current file paths, symbols/functions, line ranges, call graph and classification of every consumer.

### D. Change Made

File-by-file explanation of the minimal patch and why it is within scope.

### E. Explicit Non-Changes

Confirm no changes to thresholds, weights outside volume profile, sizing, risk, stops, targets, providers, calendar, database, environment, containment or execution.

### F. Test Evidence

For every command:

- exact command;
- exit code;
- literal pass/fail totals;
- skipped tests and exact reason;
- no summary-only claims.

### G. Before/After Behaviour

Deterministic comparison using identical inputs. Include the 30-day split only when honestly available.

### H. Diff and Scope Proof

List changed files and provide a concise diff-stat. Confirm unrelated changes were preserved.

### I. Acceptance Checklist

Repeat every checkbox from Section 9 as PASS, FAIL, BLOCKED or NOT APPLICABLE with evidence.

### J. Residual Risks and Next Checkpoint

Carry forward the items from Section 10. Recommend the next single checkpoint, but do not begin it.

### K. Deployment Statement

State:

> No commit, merge, push, production database mutation, environment change, publish or deployment was performed. C0 and live-execution containment remain unchanged.

---

## 12. STOP CONDITIONS

Stop immediately and report if:

- the relevant worktree files contain overlapping uncommitted user changes;
- current architecture materially contradicts the historical diagnosis;
- fixing the factor requires an unrelated threshold or strategy redesign;
- an operational database would be required for tests;
- a secret could be exposed;
- C0 or live-execution containment cannot be proven unchanged;
- tests fail for a reason introduced by the patch;
- a broad rewrite appears necessary;
- production deployment or mutation would be required.

Do not work around a stop condition.

---

## 13. STARTING INSTRUCTION

Begin with Stage 0 and Stage 1 only. Show the evidence freeze and current-state forensic result before making the functional edit. After the evidence confirms Outcome A, continue through the remaining stages within this same bounded checkpoint. If Outcome B or C applies, obey that outcome and stop accordingly.

The objective is not to preserve historical signal counts. The objective is to ensure that unavailable or fabricated index-volume evidence can never bias an F&O decision again.
