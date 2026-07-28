# MARKET SCANNER — PROMPT 03 FINAL ACCEPTANCE DELTA A0.3.2

## Replace mirrored tests with production-boundary proof and close Phase A0.3

### Role

Act as the senior implementation and verification engineer for the Market Scanner repository.

This is a final, narrowly bounded acceptance-delta task. Do not perform another broad audit. Do not begin Phase A0.4. Inspect the real production code and correct only the unresolved A0.3 acceptance blockers defined below.

Do not rely on earlier narrative summaries, copied schemas, mirrored test components, or source inspection alone. Acceptance requires executable proof against the actual production domain function, route serializer, generated schema, frontend component, and paper-admission boundary.

---

## 1. Current disposition

Current Phase A0.3 status:

`A0_3_NOT_ACCEPTED`

Reason:

`IMPLEMENTATION_NEAR_COMPLETE_BUT_PRODUCTION_BOUNDARY_PROOF_INVALID`

Expected current repository HEAD from the previous report:

`d3c6083`

Record the actual HEAD before taking any action. Do not assume it matches.

Accepted predecessors that must remain ancestors and regression-clean:

- Phase A0.1: `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0`
- Phase A0.2: `b611fd26ce55424df2c8802cd99f10d3725f2d01`
- Accepted A0.2 regression baseline: `160` tests

Production status remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Do not deploy, publish, push, alter production databases, change secrets, or enable execution.

Do not manually commit. If the platform automatically creates a checkpoint, record it after all work is complete.

---

## 2. Preserve the authoritative public contract

The final API contract must contain these exact setup/lane classifications:

| Setup/lane key | Status | Reason code | Eligible |
| --- | --- | --- | --- |
| `VOLUME_BREAKOUT` | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` | `false` |
| `MEAN_REVERSION` | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` | `false` |
| `TREND_CONTINUATION_NO_VWAP` | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | `false` |

Additional rules:

- scope must be `INDEX_FNO`;
- no obsolete reason code may remain;
- no unavailable or retired entry may be treated as active;
- explanations must be factual and stable;
- do not claim that any provider will “always” return a particular value;
- the active VWAP-available `TREND_CONTINUATION` lane must remain unchanged and reachable.

---

## 3. Resolve the global-versus-per-index ambiguity

The current reported `3/2` cardinality is not acceptable for a supposedly global policy. Select and implement one coherent model.

### Required design: per-index availability records

Use per-index records for:

- NIFTY
- BANKNIFTY
- SENSEX

Every record must include:

```ts
indexSymbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
setupKey:
  | "VOLUME_BREAKOUT"
  | "MEAN_REVERSION"
  | "TREND_CONTINUATION_NO_VWAP";
```

For the current authorised index-F&O policy, return exactly:

`3 supported indices × 3 setup/lane records = 9 records`

Identity and deduplication key:

`indexSymbol + setupKey`

Requirements:

- exactly nine records in every relevant API response state;
- no deduplication using `setupKey` alone;
- deterministic index order: NIFTY, BANKNIFTY, SENSEX;
- deterministic setup order: VOLUME_BREAKOUT, MEAN_REVERSION, TREND_CONTINUATION_NO_VWAP;
- no record may disappear merely because index-context construction failed;
- the canonical availability contract must be computable independently of signal emission success;
- the UI may group identical explanations, but the API must preserve per-index truth.

Do not retain a context-dependent “sometimes two, sometimes three global records” design.

---

## 4. Remove fail-open fallback behavior

The production route must not use:

```ts
indexFnoSetupAvailability ?? []
```

or any equivalent silent fallback that converts a missing required contract into an empty array.

Required behavior:

- construct the complete nine-record contract from the canonical availability function even when no signal bundle was produced;
- validate the result before serialization;
- missing, malformed, duplicated, incomplete, or unknown availability data must fail closed as an internal contract error or explicit degraded response;
- never present a missing contract to the UI as “no unavailable setups.”

The production schema must reject:

- a missing availability field;
- an empty array for this index-F&O response;
- fewer or more than nine records;
- duplicate `indexSymbol + setupKey` identities;
- unknown indices;
- unknown setup keys;
- unknown statuses;
- unknown reason codes;
- invalid status/reason pairings;
- `eligibleForEmission: true` for these three entries.

---

## 5. Test the real production schema

Delete or replace every acceptance test that constructs an inline Zod mirror of the production response schema.

The acceptance test must import the actual exported production Zod schema generated or consumed by the application.

Required test flow:

1. Build an actual domain result using the production availability function.
2. Serialize it through the production route serializer or a production serializer extracted from the route.
3. Parse the result with the actual generated response schema.
4. Assert the nine final records and exact field values.

Negative tests must mutate a valid real response and prove the actual schema or production validator rejects each invalid case listed in Section 4.

Do not copy the production shape into the test.
Do not create a second schema inside the test.
Do not use `as unknown as` to bypass the contract being tested.

---

## 6. Add executable route-state tests

Source citations are supplementary. They do not replace route behavior.

Test the actual production serializer or HTTP route using controlled mocks for all six states:

1. normal response with signals;
2. valid response with no emitted signals;
3. market closed;
4. stale or suppressed market data;
5. one supported index failing while the other two complete;
6. all supported indices failing before signal-context construction.

For every state assert:

- HTTP/domain result remains truthful for that state;
- `setupState.indexFnoSetupAvailability` is present;
- it contains exactly nine records;
- all nine identities are unique;
- ordering is deterministic;
- all required status/reason pairs are correct;
- the route does not substitute `[]`;
- schema parsing uses the real generated schema.

If authentication normally wraps the route, test the production serializer directly through an exported production function or use the repository’s authenticated route-test harness. Do not duplicate route logic inside the test.

---

## 7. Test the real frontend component

The existing test that defines a minimal `DisclosureStrip` copy is not acceptance evidence.

Refactor the production disclosure into an exported component in the production source tree, for example:

```tsx
export function IndexFnoSetupAvailabilityStrip(props: ...)
```

Requirements:

- `options.tsx` must import and render this exact component;
- tests must import this exact production component;
- delete the mirrored test-only component;
- do not duplicate its filtering, grouping, counting, or rendering logic in tests.

Production-component render tests must prove:

- amber unavailable-required-input group renders VOLUME_BREAKOUT and MEAN_REVERSION;
- purple retired-policy group renders TREND_CONTINUATION_NO_VWAP;
- index identity is shown or otherwise inspectable;
- duplicate API entries cannot create duplicate disclosures;
- malformed or incomplete input renders an explicit unavailable/degraded state, not an empty strip;
- active/live setup count excludes all nine unavailable/retired entries;
- expiry-day messaging remains truthful;
- normal, no-signal, closed, stale, partial-failure, and all-failure states render safely;
- no “active,” “monitoring,” “waiting,” “eligible,” or equivalent contradictory claim remains for these entries;
- the strip disappears only when the authoritative contract explicitly supports that outcome—not because a required field is missing.

Use the real production component with the project’s existing Vitest/jsdom setup. Rendering copied JSX is prohibited.

---

## 8. Remove or quarantine the remaining spot-as-VWAP proxy

The prior report admits:

> `c.vwap`—the effectiveVwap spot proxy—still exists for geometry callers in other detectors.

That cannot remain unexplained.

Search all reads and writes of:

- `effectiveVwap`;
- `vwapRaw ?? spot`;
- equivalent ternaries or nullish fallbacks;
- `c.vwap`;
- any field that can contain spot while labelled as VWAP.

Preferred fix:

- change authoritative VWAP to `number | null`;
- remove all spot-as-VWAP substitution;
- add explicit input-availability guards to every consumer;
- ensure no unavailable VWAP can influence entry, confidence, direction, driver, target, stop, suppression, or paper admission.

If a separate non-VWAP geometric reference is genuinely required:

- give it a name that does not contain `vwap`;
- document that it is not an indicator;
- prove it is never presented or scored as VWAP;
- prove it does not re-enable any unavailable or retired setup;
- add executable tests for every remaining consumer.

Do not retain a spot value in a field called `vwap`.

Do not change thresholds, confidence weights, target multipliers, stop formulas, sizing, cooldowns, or strategy rules while making this correction.

---

## 9. Prove paper-admission exclusion

Existing generic C0 tests are not enough.

Add direct production-boundary tests proving that signals attributable to:

- VOLUME_BREAKOUT;
- MEAN_REVERSION without authoritative session VWAP;
- TREND_CONTINUATION_NO_VWAP;

cannot enter the paper-admission path.

The tests must use the actual admission function or closest production seam and assert:

- admission is not invoked, or
- it returns an explicit fail-closed rejection with the availability reason.

Also prove:

- paper auto-opening remains disabled;
- F&O C0 remains enabled;
- Equity C0 remains enabled;
- live execution remains disabled;
- no configuration was weakened.

Keep the existing 14 C0 tests and report them separately.

---

## 10. Prove schema/code-generation parity

Identify the repository’s actual OpenAPI and client-generation workflow.

If a supported generator exists:

1. run it from the canonical source;
2. record the command;
3. verify the generated diff is limited to the intended contract;
4. run typechecks/builds from clean source output.

If no generator exists:

- document the search proving that;
- test the actual OpenAPI schema against the actual generated Zod/client contract;
- add a parity test or structural comparison for the availability field;
- do not use an inline mirror as the parity mechanism.

Typecheck success alone is not parity evidence.

Required chain:

`OpenAPI → generated Zod → generated/shared TypeScript types → route → frontend`

---

## 11. Preserve accepted logic and arithmetic

The following must remain executable and green:

- theoretical no-VWAP maximum: `20 + 15 + 8 = 43 < 50`;
- current cash-index operational maximum: `20 + 15 + 0 = 35 < 50`;
- A0.1 independent confluence boundary: `vp: null` and `isIndexFno: true`;
- deliberately non-null Volume Profile fixture proving the confluence boundary is load-bearing;
- A0.2 indicator contamination fail-closed behavior;
- VWAP-available TREND_CONTINUATION remains reachable;
- no fabricated VP/VWAP driver appears;
- no strategy threshold or formula changes.

Keep the A0.1 and A0.2 evidence files unchanged.

---

## 12. Stage 0 Git record

Before editing, run and record:

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

Also record whether commits `33d4320`, `b94732d`, `a4d747b`, and `d3c6083` exist and whether they were manually created or platform-generated.

Do not rewrite, squash, revert, or delete these commits unless separately authorized.

Do not create another manual commit.

---

## 13. Mandatory validation

Use the repository’s actual package manager and supported scripts.

Run and report separately:

### Accepted baseline

- `indicators.test.ts`: 110 tests
- `optionSignals.zeroVolume.test.ts`: 43 tests
- `confluenceEngine.vwapGuard.test.ts`: 7 tests
- baseline total: 160

### Existing A0.3/A0.3.1 suites

- `optionSignals.setupAvailability.test.ts`
- `optionSignals.a031.test.ts`
- production scanner availability test
- production availability component render test

### Supporting boundary suite

- `c0Enforcement.test.ts`: 14 tests
- new direct paper-admission tests

### New A0.3.2 tests

- actual generated schema validation;
- six actual route/serializer states;
- exact nine-record cardinality and identity;
- malformed/missing/duplicate contract rejection;
- real production component rendering;
- spot-proxy removal/non-influence;
- paper-admission exclusion;
- OpenAPI/generated-schema parity.

Run:

1. each relevant file separately;
2. complete normal order;
3. complete reverse order;
4. API server typecheck;
5. API Zod/schema typecheck or build;
6. API client generation/build/typecheck;
7. scanner typecheck;
8. full workspace typecheck;
9. scanner production build;
10. any relevant API production build;
11. `git diff --check`;
12. source searches for prohibited fallbacks, obsolete reason codes, inline schema mirrors, copied disclosure components, `?? []`, contradictory UI text, skipped tests, `.only`, and unrelated changes.

Do not report one ambiguous grand total.

Provide:

- the accepted baseline total;
- existing A0.3/A0.3.1 total;
- supporting C0/admission total;
- new A0.3.2 total;
- complete executed total.

If any historical count changes, explain every addition, deletion, and replacement by file.

No skipped, quarantined, `.only`, or silently excluded acceptance tests.

---

## 14. Evidence record

Update:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Preserve its exact terminator:

`END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD`

The updated record must explicitly add:

1. why inline Zod mirrors were invalid and how they were replaced;
2. actual production schema import and parse evidence;
3. why test-only UI copies were invalid and how they were replaced;
4. actual production component import/render evidence;
5. final per-index nine-record design;
6. cardinality, uniqueness, ordering, and identity results;
7. removal of `?? []`;
8. missing/malformed/duplicate fail-closed behavior;
9. six executable route-state results;
10. remaining spot-proxy inventory and final disposition;
11. paper-admission exclusion results;
12. C0 and execution-policy results;
13. OpenAPI/generated-artifact parity;
14. separated test counts;
15. typecheck and production-build results;
16. exact changed-file inventory;
17. exact Git state without recursive “final SHA” claims;
18. final verdict and production status.

### Avoid the recursive evidence-SHA problem

A tracked evidence file cannot truthfully contain the SHA of a later commit that includes changes made after the file was written.

Inside the evidence file record:

- `IMPLEMENTATION_HEAD_BEFORE_EVIDENCE_WRITE`;
- `EVIDENCE_FILE_SHA256`;
- `WORKTREE_STATE_AT_EVIDENCE_WRITE`;
- any earlier checkpoint SHAs.

After the platform creates a checkpoint, report the final observed checkpoint SHA in the final response. Do not reopen and recommit the evidence merely to insert that SHA.

---

## 15. Final read-only Git pass

After implementation, validation, and evidence writing—but before any platform checkpoint—run:

```bash
git rev-parse HEAD
git status --short
git diff --name-status
git diff --stat
git diff --check
git diff -- artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md
```

Report:

- implementation base HEAD;
- whether the working tree is clean or intentionally modified;
- every changed/new file;
- no unrelated changes;
- upstream ahead/behind;
- accepted ancestor results;
- evidence SHA256;
- whether a platform checkpoint was created afterward.

Do not claim “final HEAD” inside an evidence file and then create further commits.

---

## 16. Permitted verdict

Only if every requirement passes:

`ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Per-item disposition:

- D-FAB-06 / VOLUME_BREAKOUT: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- D-FAB-07 / MEAN_REVERSION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- no-VWAP TREND_CONTINUATION: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- production: `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

The remaining governance exception may be production verification only.

If any production-boundary test, schema check, route state, UI state, paper-admission proof, or Git/evidence requirement is incomplete, use:

`A0_3_NOT_ACCEPTED`

List blockers precisely. Do not convert failures into warnings.

---

## 17. Required final response

Return:

1. final verdict;
2. actual starting HEAD;
3. final observed HEAD or platform checkpoint;
4. whether any manual commit was created during A0.3.2;
5. exact public status/reason matrix;
6. confirmation of exactly nine per-index records;
7. exact changed-file inventory;
8. actual production schema-test results;
9. six route-state results;
10. actual production component-test results;
11. spot-proxy disposition;
12. paper-admission and C0 proof;
13. schema/code-generation parity;
14. separated test counts and total;
15. all typecheck/build results;
16. evidence path, SHA256, and terminator result;
17. unresolved governance exceptions;
18. production status.

Do not provide another general narrative without this evidence.
Do not deploy or push.
Do not begin Phase A0.4.
