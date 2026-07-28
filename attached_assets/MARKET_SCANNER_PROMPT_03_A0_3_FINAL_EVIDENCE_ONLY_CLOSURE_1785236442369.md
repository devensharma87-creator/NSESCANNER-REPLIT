# MARKET SCANNER — PHASE A0.3 FINAL EVIDENCE-ONLY CLOSURE

## Purpose

Phase A0.3 production corrections appear substantially complete. This task is an evidence-only acceptance pass.

Do not perform another broad audit.
Do not change production code unless a required validation fails and the root cause cannot be resolved otherwise.
Do not create another commit, push, publish, deploy, change databases, change secrets, or begin Phase A0.4.

Current disposition:

`A0_3_NOT_ACCEPTED — FINAL_ACCEPTANCE_EVIDENCE_PENDING`

Production:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## 1. Stage 0 — exact current state

Run and record:

```bash
git rev-parse HEAD
git status --short
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
git rev-list --left-right --count '@{u}...HEAD' 2>/dev/null || true
git merge-base --is-ancestor 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
git merge-base --is-ancestor b611fd26ce55424df2c8802cd99f10d3725f2d01 HEAD
git show --stat --oneline a1388b1
git show --stat --oneline 62552dc
git diff --name-status
git diff --stat
```

State explicitly:

- actual starting HEAD;
- whether `62552dc` is the current HEAD;
- whether `a1388b1` and `62552dc` were manual or platform-generated;
- whether anything was pushed;
- working-tree status;
- upstream ahead/behind;
- accepted ancestor results.

Do not create another commit to record this information.

---

## 2. No production changes unless a gate fails

Before editing anything:

1. run every validation in this prompt;
2. collect its complete output;
3. identify whether any result fails;
4. edit only if a real failure exists;
5. document the exact failure, root cause and minimal correction.

Do not modify source merely to improve the report.
Do not rewrite passing tests.
Do not change strategy thresholds, confidence, targets, stops, sizing, cooldowns or execution policy.

---

## 3. Accepted baseline — mandatory separated proof

Run each file separately:

| Suite | Mandatory result |
| --- | ---: |
| `indicators.test.ts` | 110/110 |
| `optionSignals.zeroVolume.test.ts` | 43/43 |
| `confluenceEngine.vwapGuard.test.ts` | 7/7 |
| Accepted baseline | 160/160 |

Record the exact command, test-file count, test count, result and duration for each.

The full API-server suite does not replace this separated baseline.

If any baseline test fails:

- stop acceptance;
- compare against checkpoint `b611fd26ce55424df2c8802cd99f10d3725f2d01`;
- identify the first regressing commit;
- fix the root cause without weakening the test;
- rerun the complete baseline.

---

## 4. A0.3/A0.3.1/A0.3.2 suite inventory

Discover the exact current filenames. Run and report every applicable suite separately, including at minimum:

- `optionSignals.setupAvailability.test.ts`;
- `optionSignals.a031.test.ts`;
- `optionSignals.zeroVolume.test.ts`;
- `pivotRefInventory.a032.test.ts` or its actual filename;
- `routeSerializer.a032.test.ts` or its actual filename;
- `openapiSpecParity.a032.test.ts` or its actual filename;
- Zod/client parity test;
- real production availability-component render test;
- scanner setup-availability test;
- `paperAdmission.a032.test.ts`;
- `c0Enforcement.test.ts`.

For every file report:

- exact path;
- exact number of tests;
- passed/failed/skipped;
- duration.

Do not report only “241/241,” “293/293,” or another aggregate.

---

## 5. Full scanner regression

Run the complete scanner test suite after all final production changes.

Expected historical reference:

`843/843`

If the current legitimate count differs:

- report the new exact count;
- list added, deleted or replaced test files;
- explain the difference.

Confirm that the scanner run includes tests importing the real production availability component.

---

## 6. Real production component proof

Confirm that:

- `options.tsx` imports the production availability component;
- the render test imports the same production component;
- no test-only mirrored component exists;
- the test does not duplicate the production filter/group/count logic.

Report explicit results for:

1. VOLUME_BREAKOUT unavailable group;
2. MEAN_REVERSION unavailable group;
3. TREND_CONTINUATION_NO_VWAP retired group;
4. nine-record input;
5. duplicate handling;
6. missing/malformed contract degraded state;
7. active/live count exclusion;
8. market closed;
9. no signals;
10. stale/suppressed data;
11. partial index failure;
12. all-index failure;
13. truthful expiry-day copy;
14. contradictory-copy search.

---

## 7. Six actual route/serializer states

Use the actual production route serializer or an exported production serializer called by the route.

Do not duplicate the route’s serialization logic in tests.

Report each state individually:

| State | Required result |
| --- | --- |
| Normal signals | Valid response with exactly nine availability records |
| No emitted signals | Valid response with exactly nine records |
| Market closed | Valid truthful response with exactly nine records |
| Stale/suppressed | Valid truthful response with exactly nine records |
| Partial index failure | Valid truthful response with exactly nine records |
| All-index failure | Valid truthful response with exactly nine records |

For every state assert:

- actual response/serializer output;
- actual generated Zod parse;
- NIFTY × 3;
- BANKNIFTY × 3;
- SENSEX × 3;
- composite uniqueness by `indexSymbol + setupKey`;
- deterministic ordering;
- exact status/reason pairs;
- no `?? []`;
- no avoidable HTTP 500 caused by missing signal bundles.

Resolve any `diagnostics: null` contradiction:

- either omit the optional field; or
- intentionally make the schema nullish;
- the actual production response must parse.

---

## 8. Exact contract matrix

Report and assert:

| Setup/lane | Status | Reason | Eligible |
| --- | --- | --- | --- |
| `VOLUME_BREAKOUT` | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` | `false` |
| `MEAN_REVERSION` | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` | `false` |
| `TREND_CONTINUATION_NO_VWAP` | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | `false` |

The production validator must reject:

- missing field;
- empty array;
- fewer or more than nine records;
- duplicate composite identities;
- missing index/setup combinations;
- unknown index;
- unknown setup;
- unknown status;
- unknown reason;
- invalid status/reason pairing;
- `eligibleForEmission: true`.

---

## 9. OpenAPI/Zod/client parity

Prove the actual chain:

`openapi.yaml → generated Zod → shared/generated client types → route serializer → frontend`

The parity test must read the actual `openapi.yaml`.
It must import the actual generated Zod schema.
It must not construct an inline schema mirror.

Report:

- actual OpenAPI file path;
- actual Zod export used;
- client type used;
- generation command, if available;
- if generation is unavailable, the executable structural-parity method;
- exact parity-test count and result.

Typecheck success alone is not parity evidence.

---

## 10. `pivotRef` consumer disposition

List every production read and write of:

- `pivotRef`;
- `authVwap`;
- legacy `Ctx.vwap`;
- `effectiveVwap`;
- `vwapRaw ?? spot`;
- equivalent spot-as-VWAP fallback.

For each `pivotRef` consumer provide:

| File/function | Input origin | Purpose | Affects entry? | Direction? | Confidence? | Target? | Stop? | Driver? | Connector? | User-facing label |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Prove:

- no spot value remains in a field called VWAP;
- `pivotRef` is never scored, serialized or displayed as VWAP;
- unavailable VWAP cannot re-enable a retired/unavailable setup;
- no VWAP-derived driver is fabricated;
- signal serialization exposes authoritative VWAP only when `authVwap !== null`;
- any spot-based geometry is labelled and documented as spot geometry.

Run and report the executable inventory/non-fabrication test.

---

## 11. Paper-admission and C0 proof

Run separately:

- `paperAdmission.a032.test.ts`;
- `c0Enforcement.test.ts`.

Prove:

- all nine unavailable/retired index/setup combinations are blocked before paper admission;
- paper auto-opening remains disabled;
- F&O C0 remains enabled;
- Equity C0 remains enabled;
- live execution remains disabled;
- no execution configuration was weakened.

Report exact counts separately. Do not hide them inside the full API-server total.

---

## 12. Normal and reverse order

Run all A0.3 acceptance suites together:

1. normal order;
2. exact reverse order.

Report:

- ordered file list for both runs;
- exact passed/failed/skipped counts;
- duration;
- confirmation that results are identical;
- confirmation that no cooldown, fake timer, module cache or shared-state leakage exists.

---

## 13. Full API-server suite and skipped-test audit

Run the complete API-server suite.

The previous report stated:

`4279 passed / 3 skipped / 0 failed across 213 test files`

Report the current actual output.

For every skipped test provide:

- exact file;
- exact test name;
- skip mechanism;
- reason;
- Git origin/blame or prior checkpoint evidence;
- proof it is not an A0.1/A0.2/A0.3 acceptance test;
- proof no new `.skip`, `describe.skip`, `test.skip`, `it.skip` or `.only` was introduced.

“Pre-existing skip” without identity and evidence is insufficient.

---

## 14. Typechecks and builds

Report the exact command and result for:

1. API server typecheck;
2. API Zod typecheck/build;
3. API client React generation/build/typecheck;
4. scanner typecheck;
5. full workspace typecheck;
6. scanner production build;
7. relevant API production build;
8. `git diff --check`;
9. LLM index check.

Do not report “indicators typecheck” unless that is an actual package and provide its path.

---

## 15. Test-count reconciliation

Produce a table with four non-overlapping groups:

| Group | Included files | Passed | Skipped | Failed |
| --- | --- | ---: | ---: | ---: |
| Accepted baseline | Exactly the 160-test baseline |  |  |  |
| A0.3 acceptance | Availability, A0.3.1 and A0.3.2 files |  |  |  |
| Trading boundary | Paper admission and C0 |  |  |  |
| Scanner regression | Full scanner suite |  |  |  |

Then state:

- complete non-overlapping total;
- which suites are also included inside the full API-server run;
- which totals must not be added together because one contains another.

Reconcile every previous figure: 241, 293, 843 and 4,282.

---

## 16. Evidence file

Update the existing file only if the missing evidence is not already present:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Do not create another evidence file.
Do not rewrite A0.1 or A0.2 evidence.
Do not create a commit merely to update the evidence.

Record:

- implementation HEAD before evidence write;
- evidence-file SHA256;
- working-tree state at evidence write;
- separated test results;
- skipped-test audit;
- route-state table;
- contract matrix;
- parity result;
- pivotRef inventory;
- paper-admission/C0 result;
- typechecks/builds;
- exact Git state;
- final verdict.

The final line must remain exactly:

`END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD`

Verify the terminator programmatically.

---

## 17. Final read-only Git record

After evidence collection, run:

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
git diff --check
sha256sum artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md
tail -n 1 artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md
```

Provide the exact changed/new file inventory, not merely a count.

State:

- no further manual commit was created;
- nothing was pushed;
- nothing was deployed;
- no database or secret was changed;
- Phase A0.4 was not started.

---

## 18. Acceptance rule

Only if every mandatory gate passes:

`ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Per-item disposition:

- D-FAB-06 / VOLUME_BREAKOUT: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- D-FAB-07 / MEAN_REVERSION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- no-VWAP TREND_CONTINUATION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- production: `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

The only permitted remaining governance exception is production deployment verification.

If any baseline test, route state, real component test, admission test, parity test, typecheck or build fails:

`A0_3_NOT_ACCEPTED`

List the blocker and stop. Do not soften it into a warning.

---

## 19. Required final response — evidence only

Return only:

1. final verdict;
2. starting and final observed HEAD;
3. manual-commit/push/deployment statement;
4. exact contract matrix;
5. nine-record route-state table;
6. accepted 160-test baseline;
7. A0.3 acceptance-suite table;
8. paper-admission/C0 table;
9. full scanner result;
10. normal/reverse-order result;
11. full API-server result and three skipped-test identities;
12. pivotRef consumer table;
13. OpenAPI/Zod/client parity result;
14. typecheck/build table;
15. reconciled non-overlapping totals;
16. exact changed-file inventory;
17. evidence path, SHA256 and terminator;
18. remaining governance exception;
19. production status.

Do not return another execution diary.
Do not repeat “reading files” or tool-action logs.
Do not claim completion without every item above.
