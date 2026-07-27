# MARKET SCANNER — PROMPT 03 ACCEPTANCE DELTA A0.3.1

## Correct Phase A0.3 and produce final acceptance evidence

### Role

You are the implementation and verification engineer for the Market Scanner repository.

This is a narrow acceptance-delta task. Inspect the actual repository, correct the Phase A0.3 implementation where it conflicts with the authoritative contract below, run every required gate, and produce durable evidence.

Do not rely on prior completion summaries. Source code, generated artifacts, executable tests, command output, and Git state are the evidence.

---

## 1. Current disposition

The Phase A0.3 implementation is:

`IMPLEMENTED_UNVERIFIED`

Do not label it complete or accepted until every mandatory item in this prompt is satisfied.

Accepted predecessor checkpoints must remain intact:

- Phase A0.1 checkpoint: `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0`
- Phase A0.2 checkpoint: `b611fd26ce55424df2c8802cd99f10d3725f2d01`
- Phase A0.2 accepted relevant regression baseline: `160` tests

Production remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Do not deploy, publish, push, change databases, rotate secrets, or begin Phase A0.4.

---

## 2. Non-negotiable system policy

- Kite is the sole trade-grade market-data source.
- Upstox is compare-only.
- IndianAPI is research/fundamentals-only.
- Yahoo data is excluded from trade-decision paths.
- F&O C0 and Equity C0 remain enabled.
- Paper auto-opening remains disabled.
- Swing remains dry-run.
- Live execution remains disabled.
- Do not add substitute volume, proxy VWAP, synthetic indicators, threshold changes, confidence changes, target changes, stop changes, sizing changes, or cooldown changes.

---

## 3. Required authoritative availability contract

The public contract must use the following stable classifications and reason codes exactly.

| Setup/lane | Status | Reason code | Meaning |
| --- | --- | --- | --- |
| `VOLUME_BREAKOUT` | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` | Required authoritative index-volume input is unavailable. |
| `MEAN_REVERSION` | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` | Required authoritative session VWAP is unavailable. |
| `TREND_CONTINUATION_NO_VWAP` | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | The no-VWAP lane is deliberately retired under current index-F&O policy. |

Mandatory rules:

1. Do not classify all three entries as `RETIRED_INDEX_FNO_POLICY`.
2. Do not publish `SESSION_VWAP_UNAVAILABLE_CONF_BELOW_THRESHOLD` as a reason code.
3. Confidence arithmetic belongs in internal diagnostics, tests, and evidence—not in a volatile public reason code.
4. Explanations must be factual, stable, and free of unsupported provider claims.
5. Unknown or missing availability states must fail closed.

---

## 4. Preserve both no-VWAP confidence facts

Both facts are correct and must be retained without rewriting accepted history:

1. Generic theoretical no-VWAP branch maximum:

   `EMA stack 20 + healthy RSI 15 + volume confirmation 8 = 43`, which is below the emission threshold of `50`.

2. Current cash-index operational maximum:

   `EMA stack 20 + healthy RSI 15 + volume confirmation 0 = 35`, because zero index volume cannot satisfy `lastVol > avgVol20 * 1.2`.

Required proof:

- Add behavioral or direct unit assertions proving `43 < 50`.
- Add behavioral or direct unit assertions proving the current cash-index maximum is `35 < 50`.
- Prove the no-VWAP lane is retired by policy before detector emission.
- Do not describe the accepted A0.1 figure of 43 as an error.

---

## 5. Correct Volume Profile provenance

Keep these two boundaries distinct in code comments, tests, and evidence:

1. Phase A0.2 indicator/context boundary:
   `volumeProfile()` returns `null` when the authoritative input window has no usable positive volume.

2. Phase A0.1 confluence boundary:
   index-F&O confluence is independently called with `vp: null` and `isIndexFno: true`, so Volume Profile is not scored even if a non-null VP object is present in a test or future context.

Do not write “`vp = null always because of A0.1 policy`.” That collapses two independent protections and is inaccurate.

Required tests must continue proving the A0.1 confluence boundary using a deliberately non-null VP precondition.

---

## 6. Delete the spot-as-VWAP fallback

The source must not retain a decision-path assignment equivalent to:

```ts
const effectiveVwap = vwapRaw ?? spot;
```

or:

```ts
const effectiveVwap = spot;
```

for index-F&O mean-reversion decisions.

Adding `if (!c.vwapAvailable) return null` before an existing fallback is insufficient. Remove the misleading fallback from the relevant decision path and use authoritative VWAP only after the availability guard.

Required proof:

- Source-text assertion or explicit repository search proving the prohibited fallback is absent from the relevant path.
- Unit test proving `MEAN_REVERSION` cannot emit without authoritative session VWAP.
- Unit test proving no spot-derived VWAP value appears in drivers, diagnostics, or serialized results.

---

## 7. One canonical availability function

Maintain one pure authoritative function, such as:

```ts
computeIndexFnoSetupAvailability(...)
```

It must:

- return the exact status/reason combinations in Section 3;
- include `scope: "INDEX_FNO"`;
- expose a stable setup/lane key;
- set `eligibleForEmission: false` for all three unavailable/retired entries;
- list the actual missing authoritative inputs where applicable;
- avoid duplicate entries;
- be deterministic for the same input;
- be the source used by orchestration, API serialization, and UI disclosure.

Do not create separate rulebooks in the detector layer, route, and frontend.

---

## 8. Preserve two-layer enforcement

Both layers are required:

### 8.1 Orchestration pre-gate

`buildSignalsForIndex()` must compute availability before detector execution and skip the affected detector/lane.

The suppression record must be structured and must include the stable setup/lane key and reason code.

### 8.2 Detector-level fail-closed guard

Direct detector invocation must still fail closed when its authoritative input is unavailable.

Do not depend only on detector-level `return null`; that recreates silent structural death.

Do not depend only on orchestration; direct tests and future call sites must remain safe.

---

## 9. Fix the per-index contract and deduplication ambiguity

The availability output must truthfully represent every supported index:

- NIFTY
- BANKNIFTY
- SENSEX

Use one of these designs:

### Preferred design: per-index records

Each entry contains `indexSymbol`. Return exactly three setup/lane records per supported index, for an exact total of nine records.

Uniqueness key:

`indexSymbol + setupKey`

Do not deduplicate only by `setupKey`.

### Permitted alternative: explicitly global policy object

Use this only if the availability state is genuinely independent of per-index runtime context. Make the type and API name explicitly global, compute it once, and do not misleadingly derive it from individual index contexts.

Whichever design is selected:

- document the decision;
- prove exact cardinality;
- prove no duplicates;
- prove deterministic ordering;
- prove all supported indices or global scope are represented;
- prove all response states carry the same authoritative contract.

---

## 10. API and generated-artifact requirements

The availability field must be required in the applicable `setupState` schema and must survive:

1. domain result;
2. route serialization;
3. OpenAPI schema;
4. generated Zod schema;
5. generated/shared TypeScript client types;
6. frontend query result;
7. frontend rendering.

Required response-state coverage:

- normal signals;
- no emitted signals;
- market closed;
- stale or suppressed data;
- one index failing;
- all indices failing before `buildSignalsForIndex()` completes.

The contract must not disappear or become an empty accidental default in any relevant state.

Unknown status values, unknown reason codes, missing required fields, and duplicate identity keys must fail closed in validation or handling.

Generated artifacts:

- Prefer the repository’s official code-generation command.
- If manual edits are unavoidable, prove byte/semantic parity with the generator or document why generation is unavailable.
- Do not leave stale `dist` declarations as the only reason typechecks pass.
- Re-run a clean build/typecheck path from source.

---

## 11. Frontend disclosure requirements

The options UI must render a compact, professional availability disclosure derived only from the API contract.

It must:

- distinguish `UNAVAILABLE_REQUIRED_INPUT` from `RETIRED_INDEX_FNO_POLICY`;
- show the setup/lane name;
- show the stable factual explanation;
- expose the reason code in an inspectable detail or testable element;
- avoid claiming unavailable or retired setups are active, monitoring, eligible, live, or waiting for a signal;
- exclude them from active/live setup counts;
- preserve existing expiry-day and market-state banners;
- handle all required response states without crashing;
- avoid duplicate disclosures.

Search the complete relevant page/component tree for contradictory static labels, hard-coded counts, monitoring text, badges, tooltips, and empty-state messages. Correct every contradiction within the Phase A0.3 surface.

Add component/render tests. Backend-only tests are not sufficient evidence for the UI contract.

---

## 12. Required executable test matrix

Tests must inspect behavior and serialized values. Source-regex checks are supplementary only.

### 12.1 Availability classification

- VOLUME_BREAKOUT has the exact required status and reason.
- MEAN_REVERSION has the exact required status and reason.
- no-VWAP TREND_CONTINUATION has the exact required status and reason.
- All have `eligibleForEmission === false`.
- Missing-input lists are correct.
- Scope and identity fields are correct.

### 12.2 Orchestration

- Affected detectors/lanes are not invoked when gated.
- Suppression records contain stable identity and reason.
- VWAP-available TREND_CONTINUATION remains eligible and reachable.
- No threshold, score, target, stop, size, or cooldown behavior changed.

### 12.3 Direct detector safety

- VOLUME_BREAKOUT fails closed without required authoritative input.
- MEAN_REVERSION fails closed without session VWAP.
- no-VWAP TREND_CONTINUATION cannot emit.
- Spot is never substituted for VWAP.

### 12.4 Phase A0.1 non-regression

- Confluence caller passes `isIndexFno: true`.
- Confluence caller passes `vp: null`.
- A deliberately non-null `volumeProfile()` precondition proves that boundary is active rather than vacuous.
- Returned Volume Profile factor remains `weight: 0` and `polarity: "neutral"`.
- Emitted signal drivers contain no VP-derived driver.

### 12.5 Phase A0.2 non-regression

- `sessionVwap()` fail-closed contamination contract remains intact.
- `volumeProfile()` fail-closed contamination contract remains intact.
- No HLC3/typical-price fallback is restored.

### 12.6 API contract

- Zod accepts every valid required status/reason pair.
- Zod rejects missing required fields and invalid enum values.
- Route tests inspect the actual serialized `setupState`.
- All response states in Section 10 are covered.
- Cardinality, uniqueness, and deterministic order are asserted.

### 12.7 Frontend

- Disclosure renders from API data.
- Unavailable and retired states use truthful distinct text.
- No duplicates render.
- Active/live count excludes all unavailable/retired entries.
- Normal, empty, closed, stale, partial-failure, and all-failure states remain stable.

### 12.8 Trading boundary

- Unavailable/retired setups cannot reach paper-admission logic.
- Paper auto-opening remains disabled.
- F&O C0 and Equity C0 remain enabled.
- No live execution path is enabled.

---

## 13. Mandatory validation gates

First identify the repository’s actual package scripts. Use the project’s package manager and exact supported commands.

At minimum, record and pass:

1. The accepted `160`-test A0.2 regression set unchanged.
2. All new A0.3/A0.3.1 backend tests.
3. Normal-order combined run.
4. Reverse-order combined run.
5. Relevant route/API tests.
6. Relevant frontend component tests.
7. API server typecheck.
8. API schema/Zod typecheck or build.
9. API client typecheck/build from source.
10. Scanner/frontend typecheck.
11. Full-workspace typecheck.
12. Relevant production build, if the repository supports it without deployment.
13. `git diff --check`.
14. Searches proving prohibited fallback and obsolete reason codes are absent.
15. Searches proving no contradictory UI claims remain in scope.

Do not report only aggregate totals. Record per-file or per-suite counts so the accepted 160-test baseline and the new tests are auditable separately.

No skipped, `.only`, quarantined, or silently excluded acceptance tests.

---

## 14. Stage 0 and final Git evidence

Before editing, record:

```bash
git rev-parse HEAD
git status --short
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
git rev-list --left-right --count '@{u}...HEAD' 2>/dev/null || true
git merge-base --is-ancestor b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
git diff --stat
git diff --name-status
```

At completion, repeat the read-only Git pass and record:

- exact final HEAD/checkpoint SHA;
- branch and upstream state;
- exact modified/new file list;
- exact diff stat;
- working-tree state;
- confirmation that both accepted ancestors remain ancestors;
- confirmation that no unrelated files were changed.

If the platform creates an automatic checkpoint, record its exact SHA. Do not manually commit or push unless separately authorized.

Resolve the inconsistency between “9 modified files” and “7 modified plus 3 new files” using actual Git output.

---

## 15. Evidence record

Update or replace the current Phase A0.3 evidence only after inspecting its actual contents.

Authoritative output:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

It must contain, explicitly:

1. task scope;
2. PRE_TASK_HEAD;
3. accepted ancestor checks;
4. initial working-tree state;
5. pre-edit classification;
6. exact public status/reason matrix;
7. 43-point theoretical proof;
8. 35-point operational proof;
9. VP-null provenance distinction;
10. spot-as-VWAP fallback removal proof;
11. canonical function design;
12. orchestration gate proof;
13. detector guard proof;
14. per-index/global design decision;
15. exact cardinality proof;
16. uniqueness proof;
17. ordering proof;
18. domain propagation;
19. route serialization;
20. OpenAPI change;
21. Zod change;
22. client type change;
23. code-generation/parity evidence;
24. normal-response proof;
25. no-signal-response proof;
26. closed-market proof;
27. stale/suppressed proof;
28. partial-failure proof;
29. all-failure proof;
30. frontend disclosure proof;
31. active-count proof;
32. contradictory-copy search;
33. paper-admission exclusion;
34. C0 and execution-policy preservation;
35. complete test results, baseline and new separated;
36. complete typecheck/build results;
37. final Git pass and exact changed-file inventory;
38. final verdict and production status.

Terminate the file exactly with:

`END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD`

Do not rewrite accepted A0.1 or A0.2 evidence files.

---

## 16. Permitted final verdict

Use this verdict only if every gate passes:

`ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Defect/setup disposition:

- D-FAB-06 / VOLUME_BREAKOUT: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- D-FAB-07 / MEAN_REVERSION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- no-VWAP TREND_CONTINUATION carry-forward: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- production: `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

The remaining governance exception is production verification/publication only, unless the completed evidence identifies another explicit unresolved limitation.

If any mandatory gate remains incomplete, use:

`A0_3_NOT_ACCEPTED`

and list each blocker precisely. Do not soften blockers into warnings.

---

## 17. Final response format

Return:

1. final verdict;
2. exact checkpoint/HEAD;
3. concise correction summary;
4. exact public availability matrix;
5. changed-file inventory;
6. test results with the accepted 160 baseline separated from new tests;
7. typecheck/build results;
8. API/UI/paper-admission proof summary;
9. unresolved governance exceptions;
10. evidence-file path;
11. production status.

Do not claim deployment.
Do not begin Phase A0.4.
Do not substitute a narrative summary for executable proof.
