# MARKET SCANNER BY DEV
# PROMPT 03 — PHASE A0.3
## Index-F&O Setup Viability, Honest Retirement, and No-Substitute Enforcement

**Owner:** Devendra Sharma
**Timezone:** Asia/Kolkata
**Platform:** `marketscannerbydev.in`
**Accepted predecessor:** Phase A0.2
**Accepted A0.2 checkpoint:** `b611fd26ce55424df2c8802cd99f10d3725f2d01`
**Accepted A0.1 checkpoint:** `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0`
**Primary defects:** `D-FAB-06 / FX-06`, `D-FAB-07 / FX-07`
**Carried issue:** non-emitting no-VWAP `TREND_CONTINUATION` lane
**Current production state:** `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
**Deployment/publish/push:** Prohibited
**Operational database use:** Prohibited
**Live market/broker dependency:** Prohibited

---

## 1. MISSION

Remove the final “active but structurally unusable” index-F&O setup states covered by this checkpoint:

1. `VOLUME_BREAKOUT`
   - audited as dead for cash-index candles because its volume confirmation resolves to `0 > 0`;
2. `MEAN_REVERSION`
   - audited as near-impossible/unusable on indices;
3. the no-VWAP branch of `TREND_CONTINUATION`
   - already proved non-emitting after the VP-bias removal:
     - maximum reachable confidence = `43`;
     - branch threshold = `50`;
     - no authorised VP contribution remains.

The professional result is not “make every setup fire.” The result is:

> Every setup presented as active must be executable from authoritative inputs under its authorised rules. A setup that requires unavailable index volume/VWAP must be explicitly unavailable or retired for index F&O, with one machine-readable reason and one honest user-facing disclosure. No synthetic substitute is permitted.

This task must end with no setup in scope that is:

- listed as active;
- invoked as though eligible;
- incapable of emitting under the authorised index-F&O data contract;
- silently suppressed without a reason;
- restored by fabricated volume/VWAP, arbitrary confidence points, or threshold relaxation.

---

## 2. BINDING OWNER RULING

The following decision is authorised for this checkpoint:

### 2.1 Safe disposition

For index F&O:

- if a setup requires authoritative traded volume or session VWAP that is unavailable for the cash-index candle series, retire/mark that setup unavailable for index F&O;
- do not replace the missing input;
- do not weaken its threshold;
- do not add compensating score;
- do not route another provider or instrument into the strategy;
- preserve the detector for any non-index lane where its existing authorised inputs remain valid.

### 2.2 Limited restoration

A setup may remain active only if repository evidence proves all of the following without changing policy:

1. its existing documented formula is internally consistent;
2. it uses already-authorised, already-present, trustworthy inputs;
3. no threshold, factor weight, confidence floor, target, stop, regime condition, timing rule, or risk rule changes;
4. the real production caller can emit it in both applicable directions using valid deterministic fixtures;
5. the fixture satisfies every declared prerequisite without `as any`, mocking the detector result, or bypassing normal caller gates.

If making a setup reachable requires any strategy/threshold/weight/input-source decision, do not choose one. Classify:

`BLOCKED_OWNER_RULING_REQUIRED`

### 2.3 No semantic relabelling

Do not rename an EMA/RSI-only setup “volume breakout” or “VWAP mean reversion.” If the defining input is missing, the named setup is unavailable.

---

## 3. STRICT SCOPE

### In scope

- `D-FAB-06 / FX-06`;
- `D-FAB-07 / FX-07`;
- carried no-VWAP `TREND_CONTINUATION` viability;
- detector definitions and their direct callers;
- one authoritative setup-availability representation;
- API serialization required to expose honest availability;
- the exact UI/rulebook surfaces that currently describe these setups as active;
- deterministic tests and durable evidence.

### Explicitly out of scope

Do not:

- change `D-FAB-01` through `D-FAB-05`;
- weaken A0.1’s `isIndexFno` guard or caller `vp: null`;
- change A0.2’s fail-closed indicator contracts;
- implement `D-FKE-05 / FY-17` VWAP-header placeholder handling;
- implement `D-FAB-08 / FX-08` trigger wording;
- add futures-volume, ETF-volume, option-volume, option-chain-volume, breadth, proxy-volume, or another substitute;
- integrate Kite, Upstox, IndianAPI, Yahoo, NSE scraping, or a new API;
- change provider precedence;
- change any strategy threshold, confidence contribution, weight, floor, target, stop, risk/reward, sizing, cooldown, expiry, or market-hours rule;
- create a new strategy;
- activate live or automatic execution;
- alter C0;
- mutate schema, operational data, environment variables, or secrets;
- use a live database;
- deploy, publish, or push;
- perform the 30-day CALL/PUT production study;
- claim Phase A0 as fully production-closed.

`D-FKE-05 / FY-17` remains reserved for the next display-honesty checkpoint.

---

## 4. STAGE 0 — REPOSITORY BASELINE

Before editing, return literal output and exit codes for:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git status --branch --short
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git merge-base b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
git merge-base --is-ancestor b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
git log --oneline --decorate -10
```

Expected:

- accepted A0.2 is an ancestor;
- current branch is expected to be `main`;
- upstream is expected to be `origin/main`;
- local history may remain ahead because push is prohibited.

Record:

- `PRE_TASK_HEAD`;
- every modified/untracked file;
- all platform-supplied prompt attachments;
- whether the tracked working tree is clean.

If `b611fd26...` is not an ancestor, stop:

`BLOCKED_BASELINE_DIVERGENCE`

Do not alter Git history.

---

## 5. COMPLETE SETUP INVENTORY

Search before editing:

```bash
rg -n \
  "VOLUME_BREAKOUT|MEAN_REVERSION|TREND_CONTINUATION|detectVolumeBreakout|detectMeanReversion|detectTrendContinuation" \
  artifacts --glob '*.{ts,tsx,js,jsx,json,md}'

rg -n \
  "setupState|setupStatus|setupAvailability|availableSetups|activeSetups|strategy|strategies|rulebook|detector" \
  artifacts/api-server/src artifacts/*/src --glob '*.{ts,tsx}'

rg -n \
  "lastVol|avgVol20|vwapRaw|vwapAvailable|sessionVwap|rollingVwap|volumeProfile|isIndexFno" \
  artifacts/api-server/src/lib --glob '*.ts'
```

Read every relevant:

- detector;
- context builder;
- orchestration loop;
- result serializer;
- response schema;
- OpenAPI/Zod boundary;
- cache/storage writer, if any;
- frontend setup/rulebook/strategy display;
- existing test;
- audit evidence file.

Produce two tables.

### 5.1 Definition/caller/display inventory

For every setup in scope record:

- definition file/function;
- all direct and indirect callers;
- prerequisites;
- confidence arithmetic;
- emission threshold/floor;
- target/stop dependencies;
- direction support;
- index/non-index use;
- API field;
- persisted field, if any;
- UI/rulebook location;
- current label/status;
- current missing-input behavior.

### 5.2 Input-authority inventory

For every prerequisite record:

- field;
- numeric meaning;
- source;
- provider/provenance;
- timeframe/session;
- nullable contract;
- current index-F&O availability;
- whether A0.1/A0.2 quarantines it;
- whether substituting another field would change strategy semantics.

Do not infer trust from a variable name.

---

## 6. PRE-EDIT VIABILITY PROOF

Classify each lane before editing:

- `ACTIVE_AND_REACHABLE`;
- `ACTIVE_BUT_STRUCTURALLY_DEAD`;
- `ACTIVE_BUT_INPUT_UNAVAILABLE`;
- `MATHEMATICALLY_REACHABLE_BUT_OPERATIONALLY_UNAVAILABLE`;
- `ALREADY_HONESTLY_RETIRED`;
- `DEFECT_PRESENT_RESTORABLE_WITHOUT_POLICY_CHANGE`;
- `BLOCKED_OWNER_RULING_REQUIRED`.

### 6.1 Required analytical worksheet

For each direction and setup show:

- each prerequisite Boolean;
- each confidence contribution;
- maximum reachable raw confidence;
- emission threshold;
- downstream high-conviction floor;
- target/stop validity requirements;
- any mutually contradictory predicates;
- effect of `vwapAvailable === false`;
- effect of `lastVol === 0` and `avgVol20 === 0`;
- effect of A0.1 `vp: null`;
- final reachability conclusion.

Cover:

- `VOLUME_BREAKOUT` bullish;
- `VOLUME_BREAKOUT` bearish, if supported;
- `MEAN_REVERSION` bullish;
- `MEAN_REVERSION` bearish;
- `TREND_CONTINUATION` VWAP-available bullish;
- `TREND_CONTINUATION` VWAP-available bearish;
- `TREND_CONTINUATION` no-VWAP bullish;
- `TREND_CONTINUATION` no-VWAP bearish.

### 6.2 Behavioral precondition

Where technically possible, add a temporary or permanent test that invokes the real detector/caller with controlled valid inputs and proves the pre-edit classification.

Do not modify a threshold merely to demonstrate reachability.

---

## 7. AUTHORITATIVE SETUP-AVAILABILITY CONTRACT

Reuse an existing setup-state model if one exists. Do not create parallel concepts with conflicting meanings.

There must be one authoritative result for each setup and index:

```text
ACTIVE
UNAVAILABLE_REQUIRED_INPUT
RETIRED_INDEX_FNO_POLICY
```

If the existing code uses different names, preserve the existing vocabulary and map it explicitly in evidence.

Each unavailable/retired result must include:

- stable setup identifier;
- machine-readable reason code;
- concise user-facing explanation;
- missing/untrusted prerequisite list;
- applicability scope (`INDEX_FNO`);
- explicit `eligibleForEmission: false` or its existing equivalent.

Recommended stable reason codes, only if no equivalent exists:

```text
INDEX_VOLUME_UNAVAILABLE
SESSION_VWAP_UNAVAILABLE
SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY
```

Do not use a generic `UNKNOWN` reason when a precise cause is known.

The same authoritative availability decision must govern:

- detector invocation/emission;
- API result;
- UI/rulebook disclosure.

Do not maintain three hand-written, divergent lists.

---

## 8. REQUIRED DISPOSITION BY SETUP

### 8.1 `VOLUME_BREAKOUT`

For index F&O:

- it must not be presented as active while cash-index volume is unavailable;
- it must not evaluate `0 > 0` and silently disappear;
- it must not fabricate or substitute volume;
- it must have an explicit unavailable/retired result;
- the production orchestration path must not emit it;
- the API/UI must disclose why.

Preserve existing valid non-index behavior.

### 8.2 `MEAN_REVERSION`

Prove the exact reason it is near-impossible/unavailable.

If it requires unavailable session VWAP or index volume:

- retire/mark unavailable for index F&O;
- do not substitute spot, HLC3, close, previous VWAP, VP levels, or another indicator.

If it is unreachable because existing predicates contradict each other:

- do not arbitrarily weaken them;
- retire it for index F&O;
- record the contradiction.

Only keep it active if Section 2.2 is fully satisfied.

Preserve valid non-index behavior.

### 8.3 no-VWAP `TREND_CONTINUATION`

Resolve the A0.1 carry-forward without changing scoring:

- do not change the `50` branch threshold;
- do not add back POC/VP points;
- do not add substitute confidence;
- do not assert that a `43` maximum can emit at `50`;
- do not leave it described as an active fallback.

For index F&O, mark the no-VWAP branch unavailable/retired under current policy.

Preserve the VWAP-available branch for valid non-index data unless literal evidence proves a separate defect.

Update the A0.1 Test E carry-forward classification from:

`TARGET_RESULT_INVARIANCE_NOT_APPLICABLE_UNDER_CURRENT_NON_EMITTING_BRANCH`

to an explicit retired/unavailable policy classification, but do not rewrite or weaken the accepted A0.1 historical evidence file.

Create a new A0.3 record that references the earlier classification and its resolution.

---

## 9. HONEST API AND UI DISCLOSURE

Update only the surfaces that currently state or imply that an in-scope setup is active for index F&O.

Required meaning:

> Unavailable for index F&O under the current authorised data policy because the required traded volume/session VWAP is unavailable. No substitute is used.

Use concise product wording, but preserve:

- setup name;
- availability status;
- reason;
- applicability.

Do not:

- show an unavailable setup in an “Active” count;
- call it “monitoring” if it cannot emit;
- imply that a quiet day explains zero signals;
- show “0 signals” as evidence that the setup ran successfully;
- display fake inputs;
- expose internal stack traces or implementation jargon;
- alter the separate F&O header VWAP value (`D-FKE-05`) in this task.

If the UI currently has no setup-status surface, add the smallest professional disclosure to the existing rulebook/strategy section. Do not redesign unrelated pages.

### Required rendering states

Test:

1. active and reachable;
2. unavailable required input;
3. retired by index-F&O policy;
4. unknown/error state, if the existing contract supports it.

Unavailable is not the same as bearish, neutral, no-signal, or market-closed.

---

## 10. REQUIRED EXECUTABLE TEST MATRIX

Use real functions and caller seams. No source-text-only closure.

### 10.1 `VOLUME_BREAKOUT`

At minimum:

1. zero-volume index context returns explicit unavailable/retired status;
2. detector is not emitted for index F&O;
3. extreme price/RSI/EMA inputs cannot bypass missing authoritative volume;
4. `lastVol=0`, `avgVol20=0` is not treated as a valid failed signal evaluation;
5. no synthetic volume appears in context, drivers, diagnostics, or response;
6. reason code and explanation serialize;
7. UI/rulebook does not count it active;
8. valid positive-volume non-index behavior remains unchanged.

### 10.2 `MEAN_REVERSION`

At minimum:

1. exact pre-edit viability classification is behaviorally demonstrated;
2. unavailable required VWAP/volume returns explicit status;
3. extreme fixtures cannot bypass missing input;
4. bullish and bearish symmetry is proved;
5. no spot/HLC3/close/previous-value fallback;
6. reason code and explanation serialize;
7. UI/rulebook does not count it active when unavailable/retired;
8. valid non-index behavior remains unchanged.

### 10.3 no-VWAP `TREND_CONTINUATION`

At minimum:

1. arithmetic still proves maximum confidence `43 < 50`;
2. branch threshold remains unchanged;
3. no VP/POC/VAH/VAL contribution returns;
4. branch has explicit unavailable/retired status for index F&O;
5. branch is not presented as an active fallback;
6. real caller emits no index-F&O signal from this branch;
7. bullish and bearish symmetry is proved;
8. valid VWAP-available non-index behavior remains unchanged.

### 10.4 Shared boundary

At minimum:

1. one authoritative availability object drives emission and serialization;
2. unavailable setups have `eligibleForEmission=false` or equivalent;
3. no unavailable setup reaches signal drivers;
4. no unavailable setup reaches paper-trade admission;
5. no unavailable setup is counted as active in the UI;
6. no duplicate or contradictory setup status exists;
7. unknown/missing status fails closed;
8. A0.1 VP exclusion remains active;
9. A0.2 VP/VWAP fail-closed tests remain green;
10. C0 remains enabled.

### 10.5 Test quality

All tests must be:

- deterministic;
- network-free;
- database-free;
- secret-free;
- market-clock independent or fixed with explicit Asia/Kolkata time;
- isolated from cooldown/cache state;
- order-independent;
- free of broad `as any`;
- free of mocked detector return values;
- explicit about emitted versus unavailable.

No skipped, todo, only, flaky-retry, or snapshot-update acceptance.

---

## 11. NON-REGRESSION REQUIREMENTS

At minimum rerun:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/indicators.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/confluenceEngine.vwapGuard.test.ts"
```

Also run every discovered test file directly covering:

- option signals;
- setup serialization;
- API response schema;
- setup/rulebook UI;
- paper-trade admission;
- C0 containment.

Run the complete relevant collection:

- once in normal order;
- once in reverse order.

Run:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
pnpm run typecheck
git diff --check
```

If the frontend package has its own test/build/typecheck command and frontend code changes, run those exact package commands.

Report:

- exact command;
- exit code;
- files collected;
- tests collected;
- pass/fail/skip/todo counts;
- duration;
- final summary.

Do not call a missing test file “absorbed.” Report `MISSING_TEST_FILE`.

---

## 12. DIFF AND POLICY PROOF

Return:

```bash
git status --short
git diff --name-status
git diff --stat
git diff --check
git diff --no-ext-diff b611fd26ce55424df2c8802cd99f10d3725f2d01 -- \
  artifacts/api-server/src \
  artifacts/*/src \
  artifacts/audit-evidence
```

Provide a changed-file table:

- path;
- type;
- exact authorised purpose;
- defect closed;
- production/test/evidence/UI;
- unrelated yes/no.

Provide literal proof that the diff contains no change to:

- detector thresholds;
- confluence weights;
- confidence floor;
- target/stop formulas;
- sizing/risk;
- cooldown;
- expiry;
- provider selection;
- A0.1 guard;
- A0.2 indicator contracts;
- C0 constants.

If a formatting tool changes unrelated lines, revert only that task-created churn without disturbing user changes.

---

## 13. DURABLE EVIDENCE RECORD

Create:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

It must contain:

1. exact verdict;
2. pre-task Git baseline;
3. A0.1/A0.2 ancestry;
4. complete setup definition/caller/display inventory;
5. complete input-authority inventory;
6. pre-edit classification for each setup/direction;
7. analytical reachability worksheet;
8. behavioral pre-edit proof;
9. chosen disposition and why;
10. authoritative setup-availability contract;
11. production-source changes;
12. API/schema serialization changes;
13. UI/rulebook disclosure changes;
14. `VOLUME_BREAKOUT` test matrix;
15. `MEAN_REVERSION` test matrix;
16. no-VWAP `TREND_CONTINUATION` test matrix;
17. shared-boundary tests;
18. valid non-index preservation;
19. A0.1 non-regression;
20. A0.2 non-regression;
21. C0/live-execution proof;
22. individual test results;
23. normal-order result;
24. reverse-order result;
25. API typecheck;
26. frontend/workspace typecheck/build, if applicable;
27. diff hygiene;
28. changed-file classification;
29. Git/checkpoint governance;
30. deployment classification;
31. residual Phase A0 register;
32. next checkpoint.

End exactly with:

`END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD`

---

## 14. ACCEPTANCE STATES

Overall success verdict:

`ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Allowed per-setup dispositions:

- `ACTIVE_AND_REACHABLE_UNDER_AUTHORISED_EXISTING_INPUTS`;
- `RETIRED_FOR_INDEX_FNO_UNAVAILABLE_AUTHORITATIVE_INPUT`;
- `BLOCKED_OWNER_RULING_REQUIRED`.

Maximum defect status:

- `D-FAB-06 / FX-06` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-07 / FX-07` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- carried no-VWAP `TREND_CONTINUATION` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`.

Do not use:

- `DEV_VERIFIED`;
- `STAGING_VERIFIED`;
- `PROD_VERIFIED`;
- `CLOSED`;
- `FIXED_AND_LIVE`.

Return `IMPLEMENTED_UNVERIFIED` if implementation exists but any gate is incomplete.

Return `BLOCKED_OWNER_RULING_REQUIRED` if reachability would require a strategy change.

Acceptance requires:

1. no in-scope setup remains active-but-unreachable;
2. no substitute data or confidence is introduced;
3. no strategy/threshold/weight/risk change exists;
4. unavailable status is machine-readable;
5. unavailable status reaches the relevant UI/rulebook;
6. unavailable setups cannot emit;
7. unavailable setups cannot enter paper admission;
8. valid non-index behavior is preserved;
9. bullish/bearish behavior is symmetric where applicable;
10. A0.1 and A0.2 remain green;
11. C0 remains enabled;
12. all relevant tests and typechecks pass;
13. normal/reverse collections pass;
14. diff hygiene passes;
15. evidence is complete and exactly terminated;
16. Git/checkpoint state is exact;
17. production is not inferred.

---

## 15. FINAL GIT PASS

After an unavoidable automatic platform checkpoint, or after all edits if none occurs, run:

```bash
git rev-parse HEAD
git status --short
git status --branch --short
git show --no-ext-diff --format=fuller --stat HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git merge-base b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
git merge-base --is-ancestor b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
tail -n 1 artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md
```

Do not edit after this pass.

If the platform creates a checkpoint, record:

- exact SHA;
- author/committer dates;
- changed-file stat;
- branch;
- upstream;
- ahead/behind;
- clean/dirty state;
- platform-preserved prompt attachment separately.

Do not create a commit manually.

---

## 16. STANDING SAFETY CONTROLS

Preserve and prove:

- owner-only operation;
- Asia/Kolkata for market logic and display;
- Kite as sole trade-grade source;
- Upstox compare-only;
- IndianAPI research/fundamentals-only;
- Yahoo excluded from trade paths;
- F&O C0 enabled;
- Equity C0 enabled;
- paper automatic opening disabled/blocked;
- swing broker path dry-run only;
- no live broker execution;
- no operational database access;
- no order placement.

Static search is supporting evidence only. Do not overclaim exhaustive runtime proof.

---

## 17. RESIDUAL PHASE A0 REGISTER — DO NOT IMPLEMENT

After accepted A0.3, keep open:

1. `D-FKE-05 / FY-17`
   - F&O header VWAP placeholder;
   - dedicated display-honesty checkpoint;
2. 30-day post-fix CALL/PUT open split;
   - must use post-deployment, post-fix production observations;
   - pre-fix contaminated history must not be presented as validation;
3. production deployment verification.

Next checkpoint:

`Phase A0.4 — D-FKE-05 / FY-17 VWAP Header Display Honesty`

Do not start A0.4 in this task.
