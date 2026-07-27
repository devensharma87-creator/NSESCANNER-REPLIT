# MARKET SCANNER BY DEV
# PROMPT 02 — FINAL ACCEPTANCE PASS A0.2.2
## Post-Checkpoint Read-Only Closure

**Owner:** Devendra Sharma
**Timezone:** Asia/Kolkata
**Platform:** `marketscannerbydev.in`
**Accepted A0.1 checkpoint:** `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0`
**A0.2 pre-delta checkpoint:** `05334bd9bb2f31743bab62683f0eb0995cfd6f6a`
**Production status:** `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## 1. PURPOSE

This is the final read-only acceptance pass for Phase A0.2.

The A0.2.1 implementation has already reported:

- contaminated-series fail-closed behavior for `sessionVwap()` and `volumeProfile()`;
- 110/110 indicator tests;
- 43/43 zero-volume option-signal tests;
- 7/7 confluence-guard tests;
- 160/160 combined tests in normal and reverse order;
- clean API and workspace typechecks;
- clean diff hygiene;
- corrected test-count arithmetic;
- exact evidence terminator.

Do not implement, refactor, format, rename, delete, move, or regenerate anything in this pass.

Do not rerun the entire test suite unless the post-checkpoint tree differs from the tree that produced the recorded 160/160 results.

Do not start Phase A0.3.

---

## 2. ABSOLUTE PROHIBITIONS

Do not run:

- `git add`;
- `git commit`;
- `git push`;
- rebase;
- amend;
- reset;
- revert;
- cherry-pick;
- checkout/switch;
- clean;
- stash;
- file deletion;
- deployment or publish commands.

Do not change:

- source code;
- tests;
- evidence files;
- prompt files;
- configuration;
- dependencies;
- database state;
- environment or secrets.

This pass is evidence-only.

---

## 3. CAPTURE THE POST-CHECKPOINT STATE

Run exactly:

```bash
git branch --show-current
git status --short
git status --branch --short
git rev-parse HEAD
git rev-parse 05334bd9bb2f31743bab62683f0eb0995cfd6f6a
git merge-base 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
git merge-base --is-ancestor 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git log --oneline --decorate -10
git show --no-ext-diff --format=fuller --stat HEAD
git diff --name-status 05334bd9bb2f31743bab62683f0eb0995cfd6f6a..HEAD
git diff --stat 05334bd9bb2f31743bab62683f0eb0995cfd6f6a..HEAD
git diff --check 05334bd9bb2f31743bab62683f0eb0995cfd6f6a..HEAD
```

Record every command and exit code.

### Required decision

If `HEAD` is still `05334bd9...` and the A0.2.1 files remain modified/untracked, return:

`IMPLEMENTED_UNVERIFIED_PENDING_PLATFORM_CHECKPOINT`

Do not manufacture a checkpoint.

If a later automatic platform checkpoint contains the A0.2.1 changes, continue.

---

## 4. EXPECTED A0.2.1 CHANGESET

The post-`05334bd9...` checkpoint may contain only the already-reviewed A0.2.1 work:

- `artifacts/api-server/src/lib/indicators.ts`;
- `artifacts/api-server/src/lib/indicators.test.ts`;
- `artifacts/api-server/src/lib/optionSignals.ts`;
- `artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md`;
- the supplied prompt under `attached_assets/`, only if the platform automatically preserves attachments.

For every actual changed file provide:

- exact path;
- status;
- purpose;
- whether production, test, evidence, or platform-preserved prompt;
- confirmation that it was present in the tested working tree.

Any unrelated source/config/dependency change blocks acceptance.

Do not delete an automatically preserved attachment merely to make the tree smaller. Classify it honestly.

---

## 5. VERIFY THE COMMITTED CONTRACT WITHOUT EDITING

Use read-only searches/diffs to prove the final checkpoint contains:

### `sessionVwap()`

- a pre-validation step;
- any non-finite required OHLC value fails the supplied window closed;
- any non-finite or negative volume fails the supplied window closed;
- invalid data is not skipped with a later non-null resume;
- all-zero volume stays unavailable;
- valid finite zero-plus-positive volume retains true volume weighting;
- no HLC3/close/spot/previous-VWAP substitute.

### `volumeProfile()`

- a pre-validation step for the actual profile input window;
- any non-finite required OHLC value returns `null`;
- any non-finite or negative volume returns `null`;
- invalid data is not skipped while a profile is built from remaining bars;
- all-zero total volume returns `null`;
- valid finite mixed zero-plus-positive volume remains supported;
- no synthetic volume or price-only fallback.

### A0.1

- `isIndexFno` remains required;
- index-F&O scoring remains explicitly VP-disabled;
- caller defence-in-depth `vp: null` remains;
- no A0.1 source/test weakening.

Return file/line references. Do not make source-text claims without reading the committed file.

---

## 6. VERIFY THE COMMITTED TEST AND EVIDENCE RECORD

Run read-only inspection:

```bash
rg -n \
  "contaminated|negative|NaN|Infinity|does not resume|fail.closed|input arrays|not.toHaveBeenModified|determin" \
  artifacts/api-server/src/lib/indicators.test.ts

rg -n \
  "ACCEPT_A0_2_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION|IMPLEMENTED_UNVERIFIED|30 new|28 new|160/160|PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED" \
  artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md

tail -n 1 artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md
```

Confirm:

- baseline: 73 + 43 + 7 = 123;
- A0.2: 101 + 43 + 7 = 151;
- A0.2.1: 110 + 43 + 7 = 160;
- A0.2 added 28 executable cases, not 30;
- A0.2.1 added 9 executable cases;
- the test matrix identifies exact named/parameterized cases;
- no evidence section still says invalid bars are intentionally skipped;
- the overall verdict appears exactly as:

`ACCEPT_A0_2_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

- the final line is exactly:

`END OF PHASE A0.2 INDICATOR AVAILABILITY RECORD`

If the exact verdict is absent or malformed, report the discrepancy. Do not edit it during this evidence-only pass.

---

## 7. BRANCH-GOVERNANCE EXPLANATION

The accepted A0.1 record previously identified:

`phase0/authorized-remediation-20260720`

The latest A0.2.1 response identified:

`main`

Explain this difference using read-only Git evidence:

```bash
git branch -vv
git branch --contains 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0
git branch --contains 05334bd9bb2f31743bab62683f0eb0995cfd6f6a
git branch --contains HEAD
git reflog --date=iso --decorate -30
```

Classify one:

- `SAME_HISTORY_DIFFERENT_LOCAL_BRANCH_POINTER`;
- `PLATFORM_BRANCH_TRANSITION_EXPLAINED`;
- `PRIOR_BRANCH_RECORD_INACCURATE`;
- `UNEXPLAINED_BRANCH_TRANSITION`;
- `BLOCKED`.

Do not switch branches.

An unexplained branch transition is a governance exception, not permission to modify Git history.

---

## 8. TEST-RERUN DECISION

Do not rerun tests if all of the following are true:

- the automatic checkpoint contains exactly the previously tested dirty-tree changes;
- no later source/test edit exists;
- `git diff --check 05334bd9..HEAD` passes;
- the committed evidence records the exact successful commands and outputs.

In that case classify:

`POST_CHECKPOINT_TREE_MATCHES_TESTED_A0_2_1_STATE`

If the checkpoint includes additional source/test changes, do not assume the earlier 160/160 results apply. Return:

`IMPLEMENTED_UNVERIFIED_POST_TEST_TREE_CHANGED`

Do not modify or test unrelated changes in this pass.

---

## 9. FINAL ACCEPTANCE RULE

Return the success verdict only if:

1. `HEAD` is later than `05334bd9...`;
2. A0.1 is an ancestor;
3. the checkpoint contains exactly the tested A0.2.1 implementation/evidence plus any honestly classified platform-preserved prompt;
4. the working tree is clean;
5. the indicator contracts are present in committed source;
6. the contaminated-series tests are present in committed tests;
7. test arithmetic is corrected;
8. the evidence verdict is exact;
9. the evidence terminator is exact;
10. no unrelated source/config/dependency change exists;
11. branch state is explained;
12. production remains unverified.

Exact success verdict:

`ACCEPT_A0_2_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Per-defect:

- `D-FAB-01 / FX-01` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-02 / FX-02` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-05 / FX-05` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`.

Residual governance exceptions:

- production deployment remains unverified;
- the carried no-VWAP `TREND_CONTINUATION` viability issue remains for Phase A0.3;
- any branch-transition exception found in Section 7.

Do not use `DEV_VERIFIED`, `STAGING_VERIFIED`, `PROD_VERIFIED`, or `CLOSED`.

---

## 10. REQUIRED OWNER-FACING RESPONSE

Return:

1. exact final SHA;
2. branch;
3. upstream;
4. ahead/behind;
5. clean/dirty status;
6. A0.1 ancestor result;
7. post-`05334bd9` changed-file list;
8. committed contract proof;
9. committed test-count reconciliation;
10. evidence verdict line;
11. evidence terminator;
12. branch-transition classification and evidence;
13. exact overall verdict;
14. exact per-defect verdicts;
15. residual governance exceptions;
16. `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`;
17. explicit statement: `PHASE_A0_3_NOT_STARTED`.

Do not make any code or repository change in producing this response.
