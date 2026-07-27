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
**Revision:** 2 — incorporates the Task #156 pre-implementation review
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
     - generic theoretical branch maximum = `43`;
     - current cash-index operational maximum = `35` because authoritative volume confirmation cannot fire;
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
- removal of the downstream `effectiveVwap = spot` or equivalent numeric substitute discovered in the `MEAN_REVERSION` decision path;
- detector definitions and their direct callers;
- one authoritative setup-availability representation;
- API serialization required to expose honest availability;
- the exact UI/rulebook surfaces that currently describe these setups as active;
- deterministic tests and durable evidence.

### Explicitly out of scope

Do not:

- reopen or change the accepted A0.1/A0.2 indicator primitives and confluence policy;
- leave the newly discovered downstream spot-as-VWAP substitute in place merely because it currently suppresses `MEAN_REVERSION`; removing that substitute is expressly authorised as an A0.3 residual propagation correction;
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

### 5.3 Mandatory source-of-null distinction

Do not write that detector/context VP is “always null because of A0.1.”

Prove and document the two independent boundaries:

1. A0.2 indicator boundary:
   - zero/unusable cash-index volume causes `volumeProfile()` to return `null`;
   - this explains null VP in the detector context for the current cash-index input;
2. A0.1 confluence boundary:
   - the index-F&O caller passes `vp: null` into `scoreConfluence`;
   - `isIndexFno: true` independently forces the VP confluence factor to zero.

Do not conflate context construction with confluence quarantine. Tests must prove both remain active.

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
- generic theoretical no-VWAP maximum when the volume-confirm condition is true;
- current cash-index operational maximum when `lastVol=avgVol20=0`;
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

For no-VWAP `TREND_CONTINUATION`, preserve both truths:

```text
Generic theoretical branch maximum:
EMA 20 + RSI 15 + volume-confirm 8 = 43 < threshold 50

Current cash-index operational maximum:
EMA 20 + RSI 15 + volume-confirm 0 = 35 < threshold 50
because 0 > 0 × 1.2 is false
```

Do not rewrite the accepted A0.1 record or claim its `43` calculation was erroneous. A0.3 must add the more specific `35` operational result while preserving the generic branch proof.

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

Unless an already-existing equivalent vocabulary is proved and reused, the required index-F&O dispositions are:

| Setup/lane | Availability status | Stable reason |
|---|---|---|
| `VOLUME_BREAKOUT` | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` |
| `MEAN_REVERSION` | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` |
| no-VWAP `TREND_CONTINUATION` | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` |

Confidence arithmetic belongs in structured diagnostic detail or evidence, not inside a volatile reason-code name. Do not use a reason such as `SESSION_VWAP_UNAVAILABLE_CONF_BELOW_THRESHOLD` as the sole stable public contract.

The same authoritative availability decision must govern:

- detector invocation/emission;
- API result;
- UI/rulebook disclosure.

Do not maintain three hand-written, divergent lists.

### 7.1 API/schema invariants

The availability collection must:

- be required on every applicable response containing `setupState`;
- be present in normal, market-closed, stale/degraded, and no-signal responses where the existing response contract returns setup state;
- contain exactly one entry per in-scope setup/lane;
- reject duplicate setup identifiers;
- reject or fail closed on unknown status/reason values;
- preserve the same values through source type, OpenAPI, generated Zod/schema code, route serialization, and client parsing;
- never become an optional decorative field that can be stripped at a contract boundary.

If backward compatibility requires a temporary optional transport field, the production server must still always populate it and the client must fail closed when absent. Record the exception explicitly.

### 7.2 Defence in depth

Implement both:

1. orchestration-level eligibility gating before a detector can emit; and
2. detector-level input guards preventing direct invocation from using unavailable inputs.

Inventory every direct detector caller and prove none can bypass these boundaries. A central loop gate alone is insufficient.

---

## 8. REQUIRED DISPOSITION BY SETUP

### 8.1 `VOLUME_BREAKOUT`

For index F&O:

- it must not be presented as active while cash-index volume is unavailable;
- it must not evaluate `0 > 0` and silently disappear;
- its unavailable status must be based on the index-F&O authoritative-input policy, not only on a transient numeric `lastVol` check that could reactivate after a provider anomaly;
- it must not fabricate or substitute volume;
- it must have an explicit unavailable/retired result;
- its detector must independently fail closed when called directly without authoritative volume;
- the production orchestration path must not emit it;
- the API/UI must disclose why.

Document accurately:

- detector-context VP is null for current cash-index candles because A0.2 rejects unusable volume;
- confluence receives `vp: null` independently because of A0.1;
- these are separate controls.

Preserve existing valid non-index behavior.

### 8.2 `MEAN_REVERSION`

Prove the exact reason it is near-impossible/unavailable.

The pre-edit exploration identified a downstream fallback equivalent to:

```text
effectiveVwap = vwapRaw ?? spot
```

Treat that as a defect, not a valid neutralisation technique.

Required correction:

- remove the spot-as-VWAP numeric substitute from the decision path;
- require `vwapAvailable === true`;
- require finite, non-null authoritative `vwapRaw`;
- return unavailable/null before calculating distance when VWAP is absent;
- ensure the last caller-visible value remains unavailable;
- retain orchestration gating as an additional boundary.

Record this precisely as:

`A0_2_RESIDUAL_PROPAGATION_GAP_DISCOVERED_IN_A0_3`

This does not reopen the accepted `sessionVwap()` primitive contract. It closes a downstream consumer that continued to create a numeric proxy.

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
- prove generic theoretical maximum `43 < 50`;
- separately prove current cash-index operational maximum `35 < 50`;
- do not assert that either maximum can emit at `50`;
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
- add only a new disclosure strip while leaving another rulebook, card, badge, tooltip, strategy count, or “monitoring” label that still presents the setup as active;
- call it “monitoring” if it cannot emit;
- imply that a quiet day explains zero signals;
- show “0 signals” as evidence that the setup ran successfully;
- display fake inputs;
- expose internal stack traces or implementation jargon;
- alter the separate F&O header VWAP value (`D-FKE-05`) in this task.

If the UI currently has no setup-status surface, add the smallest professional disclosure to the existing rulebook/strategy section. Do not redesign unrelated pages.

Produce a literal before/after inventory of every affected UI claim. Acceptance requires zero contradictory active/monitoring claims for the in-scope index-F&O setups.

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
9. direct detector invocation fails closed even if the orchestration gate is bypassed;
10. anomalous non-zero numeric volume cannot silently reactivate index-F&O eligibility without an authorised provenance/policy change.

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
9. source and behavioral proof show the pre-edit `effectiveVwap = spot` or equivalent fallback is absent;
10. direct detector invocation with `vwapAvailable=false` and extreme otherwise-qualifying inputs still fails closed;
11. a later valid bar/value cannot resume a fabricated mean-reversion calculation after VWAP is unavailable for the supplied context.

### 10.3 no-VWAP `TREND_CONTINUATION`

At minimum:

1. generic theoretical arithmetic proves `43 < 50`;
2. current cash-index operational arithmetic proves `35 < 50`;
3. the difference between `43` and `35` is explicitly explained and tested;
4. branch threshold remains unchanged;
5. no VP/POC/VAH/VAL contribution returns;
6. branch has explicit unavailable/retired status for index F&O;
7. branch is not presented as an active fallback;
8. real caller emits no index-F&O signal from this branch;
9. bullish and bearish symmetry is proved;
10. valid VWAP-available non-index behavior remains unchanged.

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
11. orchestration gate and detector-level guard are independently proved;
12. every direct detector caller is inventoried;
13. availability contains exactly one entry per in-scope setup/lane;
14. duplicate identifiers, unknown status, and missing availability fail closed;
15. OpenAPI, generated schema/Zod, route response, and client parsing preserve the field;
16. normal, market-closed, stale/degraded, and no-signal setup-state responses retain honest availability;
17. every active-count/rulebook/tooltip/monitoring surface agrees with the authoritative availability result.

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
- OpenAPI/generated Zod parity;
- route response normal/degraded/no-signal variants;
- setup/rulebook UI;
- active-count and contradictory-label removal;
- paper-trade admission;
- C0 containment.

The accepted A0.1/A0.2 relevant collection contained 160 passing tests. Report the exact current baseline and preserve all of them. Do not use a target number of “30–35 new tests” as an acceptance substitute; every matrix item must map to an executable named or parameterized case.

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
17. detector-context null versus confluence-quarantine distinction;
18. `A0_2_RESIDUAL_PROPAGATION_GAP_DISCOVERED_IN_A0_3` and removal of the spot-as-VWAP decision fallback;
19. generic `43` versus cash-index operational `35` confidence proof;
20. orchestration and detector-level defence-in-depth proof;
21. shared-boundary tests;
22. required/exhaustive API and generated-schema round-trip;
23. complete UI active-claim inventory and disposition;
24. valid non-index preservation;
25. A0.1 non-regression;
26. A0.2 non-regression;
27. C0/live-execution proof;
28. individual test results;
29. normal-order result;
30. reverse-order result;
31. API typecheck;
32. frontend/workspace typecheck/build, if applicable;
33. diff hygiene;
34. changed-file classification;
35. Git/checkpoint governance;
36. deployment classification;
37. residual Phase A0 register;
38. next checkpoint.

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
17. production is not inferred;
18. detector-context VP null and confluence `vp: null` are accurately distinguished;
19. the downstream spot-as-VWAP fallback is removed, not merely bypassed by the orchestration gate;
20. generic `43` and current cash-index `35` confidence maxima are both preserved and proved;
21. orchestration and detector-level guards independently fail closed;
22. availability is required/exhaustive across API and generated-schema boundaries;
23. no contradictory active/monitoring/count UI claim remains.

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
