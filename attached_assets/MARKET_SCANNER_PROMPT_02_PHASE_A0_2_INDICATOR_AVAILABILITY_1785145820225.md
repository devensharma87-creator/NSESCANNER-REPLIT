# MARKET SCANNER BY DEV
# PROMPT 02 — PHASE A0.2
## Indicator Availability, Zero-Volume Fail-Closed Contract, and Structural Truth

**Owner:** Devendra Sharma  
**Timezone:** Asia/Kolkata  
**Platform:** `marketscannerbydev.in`  
**Defects:** `D-FAB-01 / FX-01`, `D-FAB-02 / FX-02`, `D-FAB-05 / FX-05`  
**Accepted predecessor:** Phase A0.1 at `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`  
**Accepted A0.1 checkpoint:** `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0`  
**Production state:** `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`  
**Permitted scope:** Evidence-first inspection, minimal fail-closed implementation, focused tests, durable evidence  
**Deployment/publish/push:** Prohibited  
**Operational database use:** Prohibited  
**Environment/secret mutation:** Prohibited  

---

## 1. MISSION

Close the related indicator-availability cluster without reopening A0.1:

1. `D-FAB-01 / FX-01`
   - `volumeProfile()` must return unavailable when its volume input is zero or numerically invalid;
   - it must never manufacture POC/VAH/VAL from unusable volume;
2. `D-FAB-02 / FX-02`
   - remove every false prose assertion that index VP is “naturally,” “always,” or implicitly null;
   - preserve executable enforcement and structural tests instead of trusting comments;
3. `D-FAB-05 / FX-05`
   - `sessionVwap()` must return unavailable when volume is zero or numerically invalid;
   - it must never fail soft to HLC3 or another price-only substitute while labelling the result VWAP.

This is an evidence-first checkpoint. Existing code and tests may already satisfy part of the contract. Do not rewrite correct code merely to show activity.

For every defect classify the current state before editing:

- `ALREADY_IMPLEMENTED_AND_TESTED`;
- `IMPLEMENTED_BUT_TEST_INCOMPLETE`;
- `PARTIALLY_IMPLEMENTED`;
- `DEFECT_PRESENT`;
- `BLOCKED`.

Only change what literal evidence proves is missing.

---

## 2. BINDING NON-GOALS

Do not:

- change any signal threshold, factor weight, strategy rule, confidence floor, setup eligibility, target, stop, size, risk, or cooldown;
- activate or retire `TREND_CONTINUATION`, `VOLUME_BREAKOUT`, or `MEAN_REVERSION`;
- modify `D-FAB-03 / FX-03` or `D-FAB-04 / FX-04`;
- remove or weaken `isIndexFno: boolean`, `vp: null`, or the index-F&O VP engine guard;
- implement `D-FAB-06`, `D-FAB-07`, or `D-FKE-05`;
- redesign provider precedence or integrate Kite, Upstox, IndianAPI, Yahoo, or any new API;
- change API/UI contracts unless required solely to preserve an already-defined nullable indicator field;
- mutate operational data, schema, secrets, environment variables, or deployment configuration;
- run a live broker or market-data dependency;
- place any order.

No substitute heuristic is authorised. Missing indicator data must remain unavailable.

---

## 3. STAGE 0 — REPOSITORY AND GOVERNANCE BASELINE

Before editing, return exact output for:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git merge-base 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
git log --oneline --decorate -8
```

Expected starting point is the accepted A0.1 checkpoint or a descendant. If the merge-base differs, stop and return `BLOCKED_BASELINE_DIVERGENCE`.

Record all pre-existing modified/untracked files. Preserve them.

Do not run `git add`, `git commit`, `git push`, rebase, amend, reset, revert, cherry-pick, publish, or deploy commands.

If the platform creates an unavoidable automatic checkpoint, preserve it and record its SHA and metadata. Do not rewrite history.

---

## 4. STAGE 1 — COMPLETE DEFINITION AND CALL-SITE INVENTORY

Use repository searches and read every relevant implementation and caller:

```bash
rg -n "function volumeProfile|export function volumeProfile|volumeProfile\\(" \
  artifacts/api-server/src --glob '*.ts'

rg -n "function sessionVwap|export function sessionVwap|sessionVwap\\(" \
  artifacts/api-server/src --glob '*.ts'

rg -n "function rollingVwap|export function rollingVwap|rollingVwap\\(" \
  artifacts/api-server/src --glob '*.ts'

rg -n "naturally null|always null|zero.volume|HLC3|typical price|vwapAvailable|vpIntraday" \
  artifacts/api-server/src --glob '*.ts'
```

Produce a call-site table with:

- file and function;
- consumer lane;
- input source;
- whether the input carries trusted provenance;
- current missing/zero/non-finite behaviour;
- whether the output reaches a decision, API, persistence, or display field;
- scope classification:
  - `INDEX_FNO_DECISION_CRITICAL`;
  - `EQUITY_OR_SWING`;
  - `DISPLAY_ONLY`;
  - `TEST_ONLY`;
  - `UNRELATED`.

Do not infer source trust merely from a variable name.

---

## 5. D-FAB-01 — AUTHORITATIVE `volumeProfile()` CONTRACT

### 5.1 Required return contract

`volumeProfile()` must return `null`/unavailable when any required condition fails:

- insufficient bars for the function’s declared warm-up;
- OHLC/volume arrays have inconsistent lengths;
- required OHLC values are non-finite;
- any volume is non-finite;
- any volume is negative;
- total usable volume is `<= 0`;
- price range is non-finite or non-positive;
- the calculated profile would contain non-finite or invalid levels.

Zero-volume bars may coexist with positive-volume bars. Do not reject a valid equity series merely because some bars have zero volume. The total-volume and input-validity rules remain decisive.

Do not:

- replace invalid volume with `0`;
- use candle count as volume;
- assign equal synthetic volume;
- fall back to close-frequency or price-only bucketing while labelling the result Volume Profile;
- use `Math.max(0, volume)` to hide negative/invalid inputs;
- silently truncate mismatched arrays.

### 5.2 Required valid-output invariants

For a valid positive-volume series, prove:

- result is non-null;
- POC, VAH, and VAL are finite;
- every level lies within the supplied finite price range;
- `VAL <= VAH`;
- POC lies inside the constructed profile domain;
- repeated execution with identical inputs is deterministic.

Do not change the currently authorised binning algorithm unless a separate defect is proven. This checkpoint is about availability honesty, not profile-model redesign.

### 5.3 Caller propagation

Prove that a null profile:

- remains null in context;
- does not become `{0,0,0}` or another placeholder;
- produces no POC/VAH/VAL decision evidence;
- cannot affect index-F&O scoring because A0.1’s mandatory engine policy remains active.

---

## 6. D-FAB-05 — AUTHORITATIVE `sessionVwap()` CONTRACT

### 6.1 Required return contract

`sessionVwap()` must return `null`/unavailable when:

- input arrays are empty where a result is required;
- input lengths are inconsistent;
- required high/low/close/volume values are non-finite;
- any volume is negative;
- cumulative usable volume is `<= 0`;
- weighted numerator or final result is non-finite.

It must not return:

- HLC3;
- close;
- typical price;
- previous VWAP;
- zero;
- another cached or price-only substitute

while describing the result as live/session VWAP.

### 6.2 Valid positive-volume behaviour

For valid positive-volume data:

- use the existing authorised typical-price definition;
- compute the real volume-weighted value;
- allow zero-volume bars to contribute zero weight when other valid positive volume exists;
- prove the result using a small hand-verifiable fixture;
- prove the result is finite and deterministic.

Do not change session boundaries, market hours, timeframe selection, or price basis unless the existing implementation contradicts its declared contract.

### 6.3 Caller propagation

Prove end to end at unit level:

- `sessionVwap(...) === null` for zero-volume index candles;
- context retains `vwapRaw === null`;
- `vwapAvailable === false`;
- no `Spot above VWAP`, `Spot below VWAP`, `VWAP reclaim`, or equivalent positive decision driver is emitted from that unavailable value;
- the code does not replace null with spot/HLC3 before response or scoring.

Do not fix the separate F&O header placeholder `D-FKE-05 / FY-17` here. Record it as pending.

---

## 7. D-FAB-02 — REPLACE PROSE ASSUMPTIONS WITH ENFORCEMENT

Search the full relevant source tree for assertions that VP or VWAP is:

- “naturally null”;
- “always null”;
- guaranteed unavailable solely because current upstream data usually has zero volume;
- safe because a particular caller presently passes null.

For every match:

- delete false wording;
- replace necessary comments with the actual enforced policy and identifier;
- avoid claims about every future provider;
- link the explanation to executable guards/tests, not data folklore.

Required invariant:

> Index-F&O VP scoring is explicitly disabled by the mandatory `isIndexFno` policy and the current caller also passes `vp: null` as defence in depth.

For indicator primitives, comments must describe input-validation behaviour only. They must not claim source provenance that the function cannot inspect.

If A0.1 already completely fixed the false comment, mark the source portion `ALREADY_IMPLEMENTED_AND_TESTED`; do not create duplicate comments or tests.

---

## 8. NUMERIC AND TRUST BOUNDARY

Keep two concepts separate:

1. **Numeric validity**, which indicator helpers can enforce:
   - finite values;
   - non-negative volume;
   - aligned arrays;
   - positive cumulative volume;
2. **Provider/provenance trust**, which belongs to the upstream data layer.

Do not claim that `volumeProfile()` or `sessionVwap()` validates Kite/Upstox/IndianAPI provenance if it receives only numeric arrays.

If provider trust is not available at these function boundaries:

- state the limitation honestly;
- prove the existing upstream caller/source policy;
- create no new provider abstraction in this checkpoint;
- carry any missing provenance gate to the structured-data/provider phase without reusing D-FAB-01 or D-FAB-05.

---

## 9. REQUIRED EXECUTABLE TEST MATRIX

Prefer extending the existing `indicators.test.ts` and relevant option-signal regression file. Do not create duplicate tests with different names for the same invariant.

### 9.1 `volumeProfile()` tests

At minimum:

1. all-zero volume returns null;
2. negative volume returns null;
3. `NaN` volume returns null;
4. `Infinity` volume returns null;
5. non-finite OHLC returns null;
6. mismatched array lengths return null;
7. insufficient warm-up returns null;
8. non-positive price range returns null;
9. mixed zero and positive valid volume returns a finite profile;
10. valid positive-volume fixture returns ordered in-range POC/VAH/VAL;
11. identical input produces an identical result;
12. input arrays are not mutated.

### 9.2 `sessionVwap()` tests

At minimum:

1. all-zero volume returns null;
2. negative volume returns null;
3. `NaN` volume returns null;
4. `Infinity` volume returns null;
5. non-finite OHLC returns null;
6. mismatched array lengths return null;
7. empty input returns null;
8. mixed zero and positive valid volume uses only real weights;
9. hand-verifiable positive fixture equals the authorised weighted calculation;
10. all-zero input does not return HLC3, close, or spot;
11. identical input produces an identical result;
12. input arrays are not mutated.

### 9.3 Propagation tests

At minimum:

1. real zero-volume index fixture yields `vp === null`;
2. real zero-volume index fixture yields `vwapRaw === null`;
3. `vwapAvailable === false`;
4. no VP directional driver reaches an index-F&O result;
5. no VWAP directional/reclaim driver reaches the result when unavailable;
6. A0.1’s `isIndexFno === true` and `vp === null` assertions continue to pass;
7. valid positive-volume non-index paths retain their existing behaviour.

Use actual functions and callers. Source-text assertions may supplement but not replace behavioural execution.

---

## 10. TEST QUALITY REQUIREMENTS

All tests must be:

- deterministic;
- market-clock independent or use explicit fake time;
- network-free;
- database-free;
- secret-free;
- isolated from module-level cooldown/cache state;
- order-independent;
- explicit about expected nullability;
- free of broad `as any` or assertion weakening.

If shared fixtures are modified, make new behaviour opt-in through a named parameter. Do not silently change every existing test’s volume geometry merely to satisfy one new case.

Run the focused tests once in normal order and once in reversed file order if the runner supports explicit path ordering. Any order-dependent failure blocks acceptance.

---

## 11. REQUIRED VALIDATION

Run each existing relevant file individually:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/indicators.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/confluenceEngine.vwapGuard.test.ts"
```

Run the combined three-file collection:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/indicators.test.ts" \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/confluenceEngine.vwapGuard.test.ts"
```

Run the same three paths in reverse order.

Run:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
pnpm run typecheck
git diff --check
```

Report exact commands, exit codes, collected file counts, test counts, and final summaries.

If an existing named test file is missing, report `MISSING_TEST_FILE`; do not invent that it was absorbed elsewhere.

---

## 12. DIFF AND SCOPE PROOF

Provide:

```bash
git status --short
git diff --name-status
git diff --stat
git diff --check
git diff --no-ext-diff -- \
  artifacts/api-server/src/lib/indicators.ts \
  artifacts/api-server/src/lib/indicators.test.ts \
  artifacts/api-server/src/lib/optionSignals.ts \
  artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts \
  artifacts/api-server/src/lib/confluenceEngine.ts \
  artifacts/api-server/src/lib/confluenceEngine.vwapGuard.test.ts
```

Classify each changed file:

- authorised indicator contract;
- authorised propagation fix;
- authorised structural comment/invariant;
- authorised test;
- authorised evidence;
- prompt artifact;
- unrelated.

Acceptance requires:

- zero unrelated production changes;
- no threshold/weight/strategy/risk change;
- no regression to A0.1;
- no formatting-only churn outside touched blocks.

---

## 13. DURABLE EVIDENCE RECORD

Create:

`artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md`

It must contain:

1. verdict;
2. pre-task Git baseline;
3. current-state classification for each defect;
4. complete definition/call-site inventory;
5. before/after indicator contracts;
6. exact production diff;
7. numeric-validity versus provider-trust boundary;
8. `volumeProfile()` test matrix and results;
9. `sessionVwap()` test matrix and results;
10. end-to-end unit propagation proof;
11. false-comment search and disposition;
12. A0.1 non-regression proof;
13. individual test results;
14. normal-order combined result;
15. reverse-order combined result;
16. API typecheck;
17. full-workspace typecheck;
18. diff hygiene;
19. changed-file classification;
20. Git/checkpoint governance;
21. deployment classification;
22. residual Phase A0 register;
23. next checkpoint.

End exactly with:

`END OF PHASE A0.2 INDICATOR AVAILABILITY RECORD`

---

## 14. ACCEPTANCE STATES

Maximum status available in this task:

- `D-FAB-01 / FX-01` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-02 / FX-02` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-05 / FX-05` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`.

Do not use `DEV_VERIFIED`, `STAGING_VERIFIED`, `PROD_VERIFIED`, or `CLOSED`.

Return one overall verdict:

- `ACCEPT_A0_2_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `IMPLEMENTED_UNVERIFIED`;
- `BLOCKED`.

Acceptance requires every applicable item:

1. zero-volume VP returns null;
2. numerically invalid VP input fails closed;
3. valid positive-volume VP remains correct;
4. zero-volume session VWAP returns null;
5. numerically invalid session VWAP input fails closed;
6. valid positive-volume session VWAP remains correct;
7. no HLC3/spot/close fallback is labelled VWAP;
8. null VP/VWAP propagates without placeholder fabrication;
9. no unavailable VP/VWAP positive decision driver is emitted;
10. false prose assumptions are removed or proven already absent;
11. A0.1 policy guard and tests remain green;
12. normal and reversed test collections pass;
13. API and workspace typechecks pass;
14. diff hygiene passes;
15. no unrelated source change exists;
16. evidence record is complete and terminated;
17. Git/checkpoint status is reported accurately;
18. production status is not inferred.

---

## 15. FINAL GIT AND DEPLOYMENT RECORD

After any automatic platform checkpoint, perform a read-only final pass:

```bash
git rev-parse HEAD
git status --short
git show --no-ext-diff --format=fuller --stat HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
tail -n 1 artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md
```

Do not edit after this pass.

Use:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

unless an authoritative read-only release record proves otherwise.

The evidence file does not need to self-reference the SHA of the automatic checkpoint that contains it; record that final SHA in the owner-facing response.

---

## 16. STANDING SAFETY AND DATA POLICY

Preserve:

- owner-only operation;
- Asia/Kolkata for market logic and user-visible timestamps;
- Kite as the sole trade-grade source;
- Upstox as compare-only;
- IndianAPI as research/fundamental-only;
- Yahoo excluded from trade paths;
- F&O and Equity C0 blocks enabled;
- paper automatic opening disabled/blocked;
- swing broker path dry-run only;
- live broker execution unauthorised;
- no operational database access.

Do not claim an API, consumer, or production deployment is verified without literal evidence.

---

## 17. NEXT CHECKPOINT — DO NOT START HERE

After accepted A0.2:

- Phase A0.3 will address setup viability and honest retirement:
  - `D-FAB-06 / FX-06`;
  - `D-FAB-07 / FX-07`;
  - the carried non-emitting no-VWAP `TREND_CONTINUATION` lane.

`D-FKE-05 / FY-17` remains pending for its dedicated display-honesty checkpoint.

Do not start A0.3, D-FKE-05, or any later phase in this task.
