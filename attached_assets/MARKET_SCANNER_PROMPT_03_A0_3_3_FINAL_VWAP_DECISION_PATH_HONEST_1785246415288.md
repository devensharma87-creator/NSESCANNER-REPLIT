# MARKET SCANNER — PHASE A0.3.3

## Final VWAP Decision-Path Honesty Closure

### Professional implementation and acceptance prompt

---

## 1. Mission

Fix exactly one confirmed remaining Phase A0.3 defect:

> When authoritative session VWAP is unavailable, the current code can still derive `effectiveVwap`/`pivotRef` from `spot` and pass that value into VWAP-labelled confluence and directional-veto inputs. This can allow spot to influence confidence, drivers, direction, entry gates or stop geometry as though it were VWAP.

This is a narrow root-cause correction—not another audit.

Do not roam into unrelated modules.
Do not restart A0.1, A0.2 or the completed portions of A0.3.
Do not begin Phase A0.4.
Do not change strategy thresholds, confidence weights, targets, stops, sizing, cooldowns or execution policy except where strictly necessary to remove the fabricated VWAP dependency.
Do not deploy, publish, push, change databases or change secrets.
Do not create another manual commit.

Current disposition:

`A0_3_NOT_ACCEPTED — ONE_CONFIRMED_DECISION_PATH_FABRICATION_REMAINS`

Expected starting HEAD from the latest verified record:

`62552dcad00023e6606933b38c33c4b97b76fe05`

Record the actual HEAD. Do not assume it matches.

The existing evidence file may be modified in the working tree. Preserve it and update it carefully; do not discard unrelated user changes.

Production remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## 2. Already accepted/proven areas — freeze them

The following are not to be redesigned:

- A0.1 independent index-F&O confluence Volume Profile boundary:
  - `vp: null`;
  - `isIndexFno: true`;
  - VP factor neutral with zero weight.
- A0.2 fail-closed indicator contamination contracts.
- Nine-record index-F&O availability contract:
  - NIFTY × 3;
  - BANKNIFTY × 3;
  - SENSEX × 3.
- Availability classification:
  - VOLUME_BREAKOUT unavailable;
  - MEAN_REVERSION unavailable;
  - no-VWAP TREND_CONTINUATION retired.
- Actual OpenAPI/Zod/client propagation.
- Actual production disclosure component.
- Route availability across the six response states.
- Paper-admission exclusion and C0 policy.
- VWAP-available TREND_CONTINUATION behavior.

Existing accepted results to preserve:

- baseline: `160/160`;
- A0.3 API acceptance: `213/213`;
- paper admission/C0: `35/35`;
- scanner: `843/843`;
- normal/reverse acceptance run: `408/408`;
- full API server: `4279 passed`, `3 documented DB-isolation skips`, `0 failed`.

If any count legitimately changes because tests are added or replaced, explain the exact file-level difference.

---

## 3. Confirmed contradiction

The latest consumer table states that `pivotRef` originates from:

```ts
effectiveVwap = vwapRaw ?? spot
```

and is consumed as follows:

| Consumer | Reported influence |
| --- | --- |
| `detectEmaPullback` | Entry eligibility and direction |
| `detectBaselineOutlook` | Stop geometry |
| `scoreConfluence` connector | VWAP confidence factor and driver |
| `evaluateDirectionalVetoes` connector | Directional veto |

This contradicts the conclusion that:

> `pivotRef` is never scored or used as VWAP.

In particular, passing a spot-derived value through an argument or field named `vwap` is prohibited even if the local variable is named `pivotRef`.

The fix must remove this contradiction at the production decision boundary.

---

## 4. Authoritative semantic model

Use these semantics consistently:

```ts
authVwap: number | null;
vwapAvailable: boolean;
```

Required invariant:

```ts
vwapAvailable === (authVwap !== null)
```

If the code permits a temporary mismatch during construction, normalize it once in `buildContext()` and fail closed. Do not allow downstream functions to guess availability.

### Authoritative VWAP

Only `authVwap` may:

- be passed through a parameter named `vwap`;
- influence a VWAP confluence factor;
- generate a VWAP driver;
- trigger a VWAP directional veto;
- be serialized as `signal.vwap`;
- be shown to the user as VWAP;
- support a detector whose documented prerequisite is VWAP.

### Non-VWAP geometry

If the existing system genuinely requires a spot-based geometric anchor, use an explicitly non-indicator name such as:

```ts
spotGeometryAnchor
```

It must:

- never be passed through a `vwap` property or parameter;
- never be called VWAP in detail text, drivers, diagnostics, API responses or UI;
- never influence VWAP confidence;
- never trigger a VWAP veto;
- never re-enable a setup unavailable because VWAP is absent.

Do not retain:

```ts
effectiveVwap = vwapRaw ?? spot
```

Do not retain an equivalent value that is later passed as `vwap`.

---

## 5. Required disposition for each confirmed consumer

### 5.1 `scoreConfluence`

Inspect the actual `ConfluenceInputs` type and every construction site.

Required behavior:

- `vwap` must accept `number | null`, or VWAP availability must be represented by an equally explicit typed contract;
- pass `authVwap`, never `pivotRef` or spot;
- when `authVwap === null`:
  - VWAP factor exists only as an honest diagnostic if required;
  - VWAP factor weight is exactly `0`;
  - polarity is `neutral`;
  - it contributes zero to confluence score;
  - it creates no driver;
  - detail text states that authoritative session VWAP is unavailable;
- when `authVwap !== null`, preserve the existing legitimate VWAP scoring behavior.

Search every `scoreConfluence()` caller. No caller may pass a fallback value as VWAP.

### 5.2 `evaluateDirectionalVetoes`

Inspect the actual veto input type and every caller.

Required behavior:

- accept authoritative VWAP as nullable/optional;
- pass `authVwap`, never a spot-derived fallback;
- when VWAP is unavailable, skip only the VWAP-specific veto rule;
- preserve all other independent veto rules;
- emit an honest diagnostic/suppression explanation if the system records evaluated and unavailable veto inputs;
- do not silently substitute spot;
- preserve existing behavior when authoritative VWAP exists.

### 5.3 `detectEmaPullback`

Determine from current source and accepted behavior whether session VWAP is a required prerequisite for this detector.

Because strategy redesign is prohibited, use the safest behavior:

- if the detector currently depends on a VWAP comparison, require `authVwap !== null`;
- otherwise fail closed before evaluating that comparison;
- do not replace the comparison with spot, EMA, typical price or another proxy;
- do not loosen the detector to emit more signals;
- record the unavailability reason through the existing suppression/availability mechanism where appropriate.

Preserve the VWAP-available detector behavior.

### 5.4 `detectBaselineOutlook`

Separate VWAP-derived geometry from non-VWAP geometry explicitly.

If authoritative VWAP exists:

- use `authVwap` in the existing VWAP-aware calculation.

If authoritative VWAP is unavailable:

- do not call a spot anchor VWAP;
- do not serialize it as VWAP;
- retain the existing numerical spot-based geometry only if it was already the intended behavior;
- implement that branch explicitly as spot/EMA/ATR geometry;
- ensure driver/detail/UI text identifies it honestly as spot-based or EMA/ATR-based geometry;
- do not add confidence for unavailable VWAP;
- do not create a VWAP driver.

Do not invent a new stop formula. Preserve the existing numeric result where the previous formula effectively used spot, while correcting its provenance and labelling.

---

## 6. Production source requirements

Perform a complete bounded search in the relevant F&O decision path for:

- `effectiveVwap`;
- `vwapRaw ?? spot`;
- ternaries selecting spot when VWAP is missing;
- `pivotRef`;
- `authVwap`;
- `vwap:`;
- `.vwap`;
- VWAP factor labels;
- VWAP driver labels;
- VWAP veto logic.

Classify every match as one of:

1. authoritative VWAP;
2. explicit non-VWAP spot geometry;
3. prohibited substitute;
4. unrelated type/module.

There must be zero category-3 matches after the fix.

Do not perform mechanical global replacement without inspecting semantics.

---

## 7. Required load-bearing tests

Add one focused production-boundary test file or extend the existing `pivotRefInventory.a032.test.ts`. Prefer behavioral tests over regex assertions.

### Test A — confluence null-VWAP boundary

Construct a valid confluence input with:

- `authVwap = null`;
- a normal spot;
- all other non-VWAP factors controlled.

Assert:

- VWAP factor weight is `0`;
- polarity is `neutral`;
- confluence score excludes VWAP;
- drivers exclude VWAP;
- detail states authoritative VWAP unavailable.

### Test B — load-bearing anchor invariance

With `authVwap = null`, execute the same production path using:

- spotGeometryAnchor below spot;
- above spot;
- absurdly high;
- absurdly low.

Assert that changing the non-VWAP anchor cannot change:

- VWAP factor;
- confluence score through VWAP;
- VWAP driver presence;
- VWAP veto result;
- setup availability.

If the anchor legitimately affects an explicitly spot-based stop, test that separately and prove its label is non-VWAP.

### Test C — directional-veto null-VWAP boundary

Call the actual production veto function with:

- authoritative VWAP null;
- identical non-VWAP inputs;
- varied geometry anchors.

Assert:

- the VWAP veto is not applied;
- other veto rules still operate;
- result is invariant to the geometry anchor for VWAP-related decisions.

### Test D — EMA pullback fail-closed

Call the actual detector or build path with:

- VWAP unavailable;
- otherwise emission-favourable EMA/RSI/ATR inputs.

Assert:

- no EMA-pullback signal emits through the VWAP-dependent branch;
- no substitute VWAP is used;
- the suppression reason is truthful where suppression is recorded.

### Test E — baseline geometry honesty

With VWAP unavailable:

- prove the baseline calculation uses the explicitly named non-VWAP branch;
- prove no VWAP driver/detail is emitted;
- prove serialized `signal.vwap` is absent;
- prove any stop result retains the pre-fix numeric behavior if spot geometry was already used.

### Test F — authentic VWAP preservation

With a genuine non-null `authVwap`:

- prove the legitimate VWAP factor still operates;
- prove VWAP veto behavior remains unchanged;
- prove VWAP-dependent detectors remain reachable;
- prove `signal.vwap` serializes the authoritative value.

### Test G — actual caller inspection

Spy on or instrument the actual production call sites.

For every confluence and veto call:

- if authoritative VWAP is absent, the observed `vwap` argument is null/undefined;
- it is never spot or geometry anchor;
- if authoritative VWAP exists, the observed value equals `authVwap`.

### Test H — no fabricated driver

Exercise BULLISH and BEARISH paths with VWAP unavailable.

Assert:

- emitted/returned drivers contain no VWAP label;
- confidence contains no VWAP contribution;
- changing spotGeometryAnchor does not introduce a VWAP driver.

### Test I — source invariant

Supplementary source checks must prove absence from the relevant decision path of:

```ts
vwapRaw ?? spot
vwap: c.pivotRef
vwap: effectiveVwap
```

Allow explicitly documented non-VWAP geometry only under a non-VWAP name.

---

## 8. Existing tests that must remain green

Run focused tests first:

- updated pivot/decision-path honesty tests;
- confluence tests;
- directional-veto tests;
- option-signal availability tests;
- zero-volume tests;
- route serializer tests;
- paper-admission tests.

Then run the complete accepted package once:

### Accepted baseline

- `indicators.test.ts`: 110/110
- `optionSignals.zeroVolume.test.ts`: 43/43
- `confluenceEngine.vwapGuard.test.ts`: 7/7
- total: 160/160

### A0.3 API acceptance

- existing accepted subtotal: 213/213
- plus new A0.3.3 tests

### Trading boundary

- C0: 14/14
- paper admission: 21/21
- total: 35/35

### Scanner

- full scanner regression: 843/843, unless legitimate added tests increase the count

### Order independence

Run the API acceptance files:

- normal order;
- exact reverse order.

### Full regression

- complete API-server suite;
- identify the same three DB-isolation skips;
- zero failures.

No test may be deleted, weakened, skipped, quarantined or converted into a source-only assertion to manufacture a pass.

---

## 9. Typechecks, builds and hygiene

Run and record exact commands for:

1. API server typecheck;
2. API Zod typecheck;
3. API client React typecheck/build;
4. scanner typecheck;
5. full workspace typecheck;
6. scanner production build;
7. API server production build;
8. `git diff --check`;
9. LLM index check.

All must pass.

Do not rebuild or modify generated files unless the public API contract actually changes. This fix should normally remain inside the F&O decision path and tests.

---

## 10. Non-negotiable policy preservation

Prove:

- Kite remains the sole trade-grade data source;
- no Yahoo value enters a trade-decision path;
- no Upstox compare-only value enters a trade-decision path;
- no IndianAPI research value enters a trade-decision path;
- paper auto-opening remains disabled;
- F&O C0 remains enabled;
- Equity C0 remains enabled;
- live execution remains disabled;
- no strategy threshold, confidence weight, target, stop multiplier, size or cooldown changed;
- no production deployment occurred.

---

## 11. Evidence update

Update the existing evidence file:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Do not create another evidence file.
Do not rewrite A0.1 or A0.2 evidence.
Do not create a manual commit for the evidence.

Add a final A0.3.3 section containing:

1. confirmed contradiction;
2. pre-fix consumer table;
3. final semantic model;
4. production changes;
5. post-fix consumer table;
6. confluence null-VWAP result;
7. veto null-VWAP result;
8. EMA-pullback result;
9. baseline-geometry result;
10. authentic-VWAP preservation;
11. actual caller arguments;
12. BULLISH/BEARISH driver proof;
13. source-invariant search;
14. complete test results;
15. typecheck/build results;
16. policy-preservation diff;
17. exact changed-file inventory;
18. final Git state;
19. final verdict;
20. production status.

Record:

- implementation HEAD before evidence write;
- evidence SHA256;
- working-tree status;
- no-commit/no-push/no-deploy statement.

The final line must remain exactly:

`END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD`

Verify the terminator programmatically.

---

## 12. Git discipline

Before editing:

```bash
git rev-parse HEAD
git status --short
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
git rev-list --left-right --count '@{u}...HEAD' 2>/dev/null || true
git merge-base --is-ancestor 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
git merge-base --is-ancestor b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
git diff --name-status
git diff --stat
```

After implementation and validation:

```bash
git rev-parse HEAD
git status --short
git diff --name-status
git diff --stat
git diff --check
sha256sum artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md
tail -n 1 artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md
```

Do not commit.
Do not push.
Do not deploy.
Do not discard the pre-existing evidence-file modification.

Report every modified/new file by exact path.

---

## 13. Acceptance rule

Only if every required gate passes:

`ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Required per-item result:

- D-FAB-06 / VOLUME_BREAKOUT: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- D-FAB-07 / MEAN_REVERSION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- no-VWAP TREND_CONTINUATION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- VWAP decision-path honesty boundary: `UNIT_VERIFIED`
- production: `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

The only remaining governance exception may be production deployment verification.

If spot or a geometry anchor still reaches a VWAP-labelled confidence, driver, veto, detector prerequisite or serialized field:

`A0_3_NOT_ACCEPTED`

Stop and report the exact remaining consumer. Do not soften it into a warning.

---

## 14. Required final response

Return only:

1. final verdict;
2. starting and final observed HEAD;
3. no-commit/no-push/no-deploy statement;
4. exact files changed;
5. pre-fix and post-fix consumer tables;
6. confluence null-VWAP proof;
7. directional-veto null-VWAP proof;
8. EMA-pullback fail-closed proof;
9. baseline geometry honesty proof;
10. authentic-VWAP preservation proof;
11. actual observed connector arguments;
12. BULLISH/BEARISH driver results;
13. source-invariant results;
14. accepted baseline result;
15. A0.3 and new-test results;
16. trading-boundary result;
17. scanner and full API-server results;
18. normal/reverse-order results;
19. typecheck/build results;
20. policy-preservation result;
21. evidence path, SHA256 and terminator;
22. remaining governance exception;
23. production status.

Do not return another tool-action diary.
Do not repeat earlier evidence that has not changed except in the required result tables.
Do not claim completion if any VWAP substitute remains in a decision path.
