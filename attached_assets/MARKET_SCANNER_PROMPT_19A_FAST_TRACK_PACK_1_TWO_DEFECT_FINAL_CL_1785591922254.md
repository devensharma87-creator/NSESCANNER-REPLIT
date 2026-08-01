# MARKET SCANNER — PROMPT 19A

## Fast-Track Pack 1: Two-Defect Final Closure and Freeze

### Instruction to the Replit coder

Prompt 19 has completed the broad Pack 1 implementation and reported:

```text
api-server full suite: 4,528/4,528
scanner suite: 843/843
Pack-level tests: 51/51
five TypeScript checks: clean
```

However, Pack 1 cannot be frozen while two explicitly in-scope production defects are deferred as follow-ups:

```text
#167 — Index-detail null direction/colour handling
#168 — F&O paper-trading summary error handling
```

Implement these two corrections now. Do not open another audit, roadmap, phase, provider migration or generalized UI pass.

The current status is:

```text
PACK_1_FINAL_CLOSURE_PENDING_TWO_CONFIRMED_DEFECTS
```

No manual commit, push, pull, fetch, publish or deployment is authorized.

---

# 1. Objective

Close only the two confirmed Prompt 19 defects, prove their behavior through the real production components, preserve every accepted safeguard, update the existing Pack 1 evidence, and freeze Pack 1.

This is the only authorized sequence:

1. Read the exact two production components and their existing tests.
2. Implement defect #167.
3. Implement defect #168.
4. Add or extend production-component tests.
5. Run targeted verification.
6. Run the Pack 1 closing battery once.
7. Update the existing Pack 1 evidence file.
8. Return the final verdict and stop.

Do not create further follow-up tasks for these defects. Do not defer them again.

---

# 2. Frozen scope

Do not modify:

- A0.3 F&O setup availability or VWAP decision-path logic;
- B0 alerting, market-state or clock-drift logic;
- B1.1 canonical provider routing or future-timestamp handling;
- F&O signal formulas, thresholds, weights, vetoes, entries, stops or targets;
- swing-trading decision or execution logic;
- trade-ledger mutation or operational residue;
- database test provisioning or `DB_TEST_RUNTIME_AUTHORIZED`;
- Kite/Upstox/IndianAPI activation or credentials;
- Yahoo provider retirement;
- authentication or authorization;
- dependencies, migrations, infrastructure or deployment configuration;
- chart library, Pine import or drawing-toolbar behavior.

Preserve every Prompt 18 and Prompt 19 correction already passing.

The canonical data rule remains mandatory: touched components must consume their existing canonical API/query layer and must not add direct calls to Kite, Upstox, IndianAPI, Yahoo or any other external provider.

---

# 3. Defect #167 — Index-detail null direction and colour

Locate the actual navigable index-detail route, its production component and the exact direction/colour expression that treats a missing value as positive, bullish, green or upward.

## Required correction

For every relevant index-detail metric—especially `changePercent`, `changePct`, absolute change or the project-equivalent field—enforce these semantics:

| Input state | Required presentation |
|---|---|
| finite positive value | Existing positive/up styling |
| finite negative value | Existing negative/down styling |
| exact zero | Existing explicit zero/neutral convention; never infer bullishness merely from `>= 0` |
| `null` or `undefined` | Neutral/no-data presentation such as `—` or the existing shared unavailable label |
| `NaN`, `Infinity`, `-Infinity` | Neutral/no-data presentation |
| API failure with no usable cached data | Explicit error state, not zero or neutral market movement |

The component must not contain logic equivalent to:

```ts
(changePct ?? 0) >= 0
(changePercent || 0) >= 0
Number(changePct ?? 0)
```

Do not fabricate `0`, `UP`, positive tone, bullish colour, green arrow or positive accessibility text when the source value is missing or non-finite.

Use an existing shared finite-value/direction helper if one already owns these semantics. Do not introduce a broad refactor merely to remove one expression.

Preserve the canonical source, timestamp, freshness, snapshot and provenance already supplied by the page's API/query contract.

## Load-bearing production-component tests

Render the real production index-detail component or its smallest real routed production boundary and prove:

1. positive finite change renders the existing positive treatment;
2. negative finite change renders the existing negative treatment;
3. exact zero follows the existing neutral/zero convention;
4. `null` renders no-data/neutral and no green/up/bullish treatment;
5. `undefined` renders no-data/neutral;
6. non-finite values cannot render positive or negative market direction;
7. an initial API error with no usable data renders the component's explicit error state;
8. no direct provider call was added.

Do not satisfy this gate only through regex, source-text or pure-helper tests.

---

# 4. Defect #168 — F&O paper-trading summary error state

Locate the real F&O paper-trading page/summary component and the query that supplies its summary totals.

## Required correction

The component must distinguish at least:

```text
INITIAL_LOADING
READY_WITH_DATA
EMPTY_VALID
INITIAL_ERROR_WITHOUT_DATA
REFETCH_ERROR_WITH_USABLE_CACHED_DATA
```

Required behavior:

- Initial loading: show the existing loading/skeleton state; do not show fabricated totals.
- Successful data: render the canonical summary values.
- Valid empty result: show the existing honest empty state; use zero only when the API explicitly returns a valid zero.
- Initial error without usable data: show a visible, useful error state with retry/recovery action where the application already supports it.
- Refetch error with usable cached data: retain the last usable values but visibly label the summary stale/degraded or refresh-failed; do not silently present them as current.

Do not convert missing or failed summary fields to:

```text
₹0.00
0 trades
0 wins
0 losses
0% return
EMPTY_SUCCESS
```

unless those values came from a successfully parsed canonical response.

Do not conflate `isError`, `isLoading`, empty data and stale cached data. Respect the actual query library semantics in the repository, including `dataUpdatedAt`, `isRefetchError`, `errorUpdatedAt` or their project-equivalent fields where applicable.

Preserve:

- the existing F&O paper-trading API and schema contract;
- immutable trade records;
- gross/net/charges/STT calculations;
- IST session/date behavior;
- INFO_ONLY versus tradeable distinctions;
- authentication and owner/subscriber access rules.

Do not alter F&O business logic in this prompt.

## Load-bearing production-component tests

Render the real production paper-trading summary component or its smallest real routed production boundary and prove:

1. initial loading does not show fabricated zero totals;
2. successful non-empty data renders the supplied values;
3. valid empty data renders the truthful empty state;
4. initial request failure renders an explicit error state;
5. failure does not render fabricated zero totals;
6. refetch failure with usable cached data retains the values and marks them stale/degraded;
7. retry/recovery interaction calls the existing refetch mechanism when one is exposed;
8. no direct provider call was added.

Do not satisfy this gate only through mocked helper return values or source-string assertions.

---

# 5. Canonical cross-tab data rule

This prompt must not create another data path.

For touched index-detail and paper-trading surfaces:

- consume the existing canonical API/query clients;
- preserve canonical instrument identity;
- preserve IST timestamps and centralized formatting/rounding;
- preserve source, `asOf`, freshness, snapshot and degradation metadata where present;
- never substitute one provider silently;
- never calculate a shared metric differently from its canonical service;
- never introduce a component-specific network request to an external provider.

If a provider value is unavailable, render that fact honestly rather than filling the UI with a substitute.

---

# 6. Verification

## 6.1 Targeted verification

Run the exact new/updated component test files and the existing Prompt 19 pack-level test file.

Report per-file counts. Preserve at minimum the existing Pack 1 baseline:

```text
p19.packTests.test.ts: 51/51
```

The count may increase. It must not decrease through deletion, skip, quarantine or weakened assertions.

## 6.2 Static checks

Run the repository's actual commands for:

- Global/web application TypeScript;
- Scanner application TypeScript;
- API server TypeScript;
- API Zod TypeScript;
- API client React TypeScript;
- the relevant Global/web production build;
- the relevant Scanner production build if required by the existing Pack 1 battery;
- `git diff --check`.

Search the changed production code for new direct provider imports/calls and for new null-as-zero direction expressions.

## 6.3 Regression checks

Run the Pack 1 closing regression once:

- full API-server non-DB suite;
- full Scanner suite;
- the complete Prompt 19 targeted/component suite;
- all affected frontend tests.

Use the reported results as the minimum preserved baseline:

```text
api-server: 4,528 passing / 0 failing
scanner: 843 passing / 0 failing
Prompt 19 pack tests: 51 passing / 0 failing
```

New tests should increase the appropriate total. Reconcile the increase exactly.

Do not execute DB-only suites. Do not contact live providers.

## 6.4 Integrity

Prove that the changes introduce no:

- `.skip`, `describe.skip`, `test.skip`, `.only` or retries;
- arbitrary sleeps;
- weakened assertions;
- direct provider access;
- secret output;
- database connection;
- unrelated production changes.

---

# 7. Evidence and Git discipline

Update the existing file only:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_1_COMPLETE_WEBSITE_SURFACES.md
```

Add a concise final-closure section containing:

- exact two-defect production changes;
- exact changed-file inventory;
- actual component-test results;
- complete closing verification counts;
- cross-tab/canonical-source confirmation for the touched surfaces;
- starting and ending HEAD;
- tracked/staged/untracked status;
- confirmation of no manual commit, push or deployment;
- SHA-256 after the evidence write;
- one final terminator as the last nonblank line.

Use this final terminator:

```text
END_FAST_TRACK_PACK_1_TWO_DEFECT_FINAL_CLOSURE
```

If the platform automatically commits attachments or the prior working tree, record the exact event and continue only when the change is documentation/attachment/evidence-only. Stop for an unexpected production/test/schema/migration/dependency/build/deployment change.

Do not create a new evidence file. Do not create another follow-up task. Do not manually commit.

---

# 8. Required final response

Return a concise result—not an execution diary—with these sections:

1. Verdict.
2. Defect #167 correction.
3. Defect #168 correction.
4. Production-component evidence.
5. Targeted and full regression totals.
6. Typecheck/build results.
7. Canonical-data confirmation.
8. Changed-file and Git record.
9. Evidence SHA-256 and terminator verification.
10. Remaining blockers.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_1_COMPLETE_WEBSITE_SURFACES_FINAL
```

This verdict is permitted only when both defects are implemented, their production-component tests pass, and all preserved Pack 1 gates remain green.

If a genuine production-critical blocker prevents completion, return:

```text
BLOCKED_FAST_TRACK_PACK_1_FINAL_CLOSURE
```

with the exact failing command, assertion and production impact. Do not reopen the broader Pack 1 audit.

After the acceptance verdict, freeze Pack 1 and stop. Do not begin Pack 2 until the owner supplies the separate Fast-Track Pack 2 instruction.
