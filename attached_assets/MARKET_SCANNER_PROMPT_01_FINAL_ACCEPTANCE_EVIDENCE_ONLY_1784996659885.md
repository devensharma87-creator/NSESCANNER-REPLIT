# MARKET SCANNER BY DEV
# PROMPT 01 — FINAL ACCEPTANCE AUDIT (EVIDENCE ONLY)

**Owner:** Devendra Sharma  
**Checkpoint:** Phase A0.1 — `D-FAB-03`, `D-FAB-04`  
**Current technical state:** CODE FIX PLAUSIBLE, CHECKPOINT NOT ACCEPTED  
**Current programme status:** `IMPLEMENTED_UNVERIFIED`  
**Permitted activity:** Read-only inspection and test execution only  
**Code changes:** PROHIBITED  
**Git history changes:** PROHIBITED  
**Deployment:** PROHIBITED  

---

## 1. MISSION

Perform the final evidence-only acceptance audit of the two local Phase A0.1 commits:

- earlier Phase A0 commit reportedly at `df1a132aa7f5294644868377e2e7b2d3c90d674d`;
- correction commit reportedly at `a9063ac0c9d4229070a05fc7a0dc6ff863dece6f`.

Do not change code. Do not add tests. Do not create another checkpoint or commit. Do not reset, revert, amend, squash, rebase, cherry-pick or rewrite either commit.

The purpose is to determine whether the existing code can be accepted, while recording the governance violation that commits were created despite the no-commit instruction.

---

## 2. NON-NEGOTIABLE GOVERNANCE RULING

The previous response cannot be accepted as `UNIT_VERIFIED` because:

1. Prompt 01 and its correction explicitly prohibited commits.
2. The reported pre-fix and post-fix HEAD values differ.
3. The acceptance checklist required identical pre/post HEAD.
4. The response omitted that failed gate from its final checklist.

Do not attempt to erase this history. Preserve both commits and classify how each was created:

- manual `git commit`;
- Replit/Coder automatic checkpoint;
- another mechanism;
- unknown.

State whether either commit was pushed, published or deployed. Prove it with Git evidence; do not infer.

---

## 3. SOURCE AND DIFF EVIDENCE

Provide exact, unedited command output for:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git merge-base e7ae078368ff076e3f2d27322b353397327ab2e5 HEAD
git log --oneline --decorate -10
git show --no-ext-diff --format=fuller --stat df1a132aa7f5294644868377e2e7b2d3c90d674d
git show --no-ext-diff --format=fuller --stat a9063ac0c9d4229070a05fc7a0dc6ff863dece6f
git diff --check e7ae078368ff076e3f2d27322b353397327ab2e5..HEAD
git diff --name-status e7ae078368ff076e3f2d27322b353397327ab2e5..HEAD
git diff --no-ext-diff df1a132aa7f5294644868377e2e7b2d3c90d674d..a9063ac0c9d4229070a05fc7a0dc6ff863dece6f -- \
  artifacts/api-server/src/lib/optionSignals.ts \
  artifacts/api-server/src/lib/confluenceEngine.ts \
  artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts
```

If a command fails, include the command, exit code and raw failure output.

Do not print credential-bearing remote URLs. If `git remote -v` contains a credential, redact only the credential and preserve the host/repository identity.

---

## 4. TEST-FILE COLLECTION — NO “ABSORBED” CLAIMS

The previous explanation that distinct test files were “absorbed” through Vitest workspace deduplication is not accepted without literal proof.

First prove whether each file exists:

```bash
for f in \
  artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts \
  artifacts/api-server/src/lib/indicators.test.ts \
  artifacts/api-server/src/lib/confluenceEngine.test.ts \
  artifacts/api-server/src/lib/fnoPaperRiskGuards.test.ts \
  artifacts/api-server/src/lib/optionChainProvider.test.ts
do
  if test -f "$f"; then
    printf 'EXISTS %s\n' "$f"
  else
    printf 'MISSING %s\n' "$f"
  fi
done
```

Then run each existing file separately using its exact repository-relative path and a verbose reporter. Include the exact command, exit code and full final runner summary for every file.

Required individual runs:

1. `optionSignals.zeroVolume.test.ts`
2. `indicators.test.ts`
3. `confluenceEngine.test.ts`
4. `fnoPaperRiskGuards.test.ts`
5. `optionChainProvider.test.ts`

Do not combine paths until each individual result is proven.

If a named file does not exist, report `MISSING_TEST_FILE`. Do not claim its coverage was absorbed by another file unless the repository configuration and collected test names prove that exact relationship.

Run typecheck separately and include its exit code:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```

No operational database may be used.

---

## 5. TEST-CODE INSPECTION

Without editing, provide the exact test names and relevant source excerpts proving:

1. a non-null VP below spot can change raw `scoreConfluence()` when no boundary is applied;
2. a non-null VP above spot can change raw `scoreConfluence()` when no boundary is applied;
3. `buildSignalsForIndex` or its index-F&O confluence construction explicitly supplies `vp: null`;
4. the test exercises the executable caller or otherwise proves the call-site assignment structurally;
5. manipulated POC/VAH/VAL cannot change the no-VWAP index target;
6. bullish and bearish index paths both receive zero VP weight;
7. no VP-derived reason reaches the index-F&O result.

Classify each proof as:

- `BEHAVIOURAL_EXECUTION`
- `SOURCE_STRUCTURE_ONLY`
- `ARITHMETIC_MODEL_ONLY`

Do not describe a source-text regex as an end-to-end behavioural test.

---

## 6. CORRECT THE MATERIAL STATEMENTS

The final report must use these accurate statements:

### Trading logic

Incorrect:

> No trading logic was touched.

Correct:

> An authorised fail-closed trading-decision change was made: index F&O confluence now receives `vp: null`, and VP-derived no-VWAP target influence was removed. No unrelated threshold, weight, sizing, stop, risk or provider logic was changed.

### Current bias

Do not state that current production was actively biased unless production/runtime evidence proves non-null VP entered index confluence.

Use:

> Historical active bias was alleged by the 7 July audit. Current pre-fix source had an upstream zero-volume null guard, so the remaining verified issue was a latent structural re-entry risk. The new caller boundary is intended to close that risk.

### Commit status

Do not say:

> No commit was performed.

Record both commits, who/what created them, and whether they were pushed or deployed.

---

## 7. RESTORE THE CORRECT DEFECT MAP

The previous residual table materially misdescribed the stable IDs. Replace it with this authoritative mapping:

| ID | Correct description | Current status allowed here |
|---|---|---|
| `D-FAB-01 / FX-01` | `volumeProfile()` must return unavailable on zero/untrusted volume | Evidence-only status; do not implement |
| `D-FAB-02 / FX-02` | Remove the false “naturally null” assertion and replace it with a structural invariant | Evidence-only status; do not implement |
| `D-FAB-05 / FX-05` | `sessionVwap` must not fail soft to HLC3 on zero/untrusted volume | Evidence-only status; do not implement |
| `D-FAB-06 / FX-06` | `VOLUME_BREAKOUT` is dead for zero-volume indices; fix or honestly retire | Not started |
| `D-FAB-07 / FX-07` | Index `MEAN_REVERSION` is near-impossible; fix or honestly retire | Not started |
| `D-FKE-05 / FY-17` | VWAP placeholder leaks into the F&O header, commonly equalling spot | Not started |

Do not renumber, reinterpret or reuse these IDs for different defects.

---

## 8. SEPARATE SAFETY-CONTROL EVIDENCE

Report each control independently:

1. F&O C0 source-level block.
2. Equity C0 source-level block.
3. Paper auto-opening mode.
4. Swing automatic/broker mode.
5. Live broker order-placement capability.

For each, provide:

- exact file and identifier;
- current non-secret source/config state;
- exact read-only command used;
- raw relevant output;
- whether either Phase A0.1 commit changed it.

Absence of a `kc.placeOrder` grep match is useful static evidence but is not, by itself, proof of every possible live-order route. State the coverage limit.

---

## 9. ACCEPTANCE DECISION

Return one of:

- `ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- `IMPLEMENTED_UNVERIFIED`
- `BLOCKED`

`ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` is allowed only if:

- all five existing test files run individually and pass;
- missing files are honestly classified;
- typecheck passes;
- the exact diff confirms `vp: null` at the index-F&O boundary;
- target quarantine is proven;
- no unrelated code changed in the two commits;
- both commits are local-only and not deployed;
- the incorrect residual-ID mapping is corrected;
- the unauthorised/automatic commits are permanently recorded as a governance exception.

Do not change code to obtain this verdict.

---

## 10. REQUIRED FINAL FORMAT

1. `Verdict`
2. `Commit Governance Exception`
3. `Raw Git Output`
4. `Exact Diff Review`
5. `Five Individual Test Results`
6. `Typecheck Output`
7. `Test-Proof Classification`
8. `Separate Safety Controls`
9. `Corrected Stable-ID Register`
10. `Acceptance Checklist`
11. `Next Checkpoint`

The next checkpoint, only after acceptance, is Phase A0.2. It is not Phase A1.

Do not make any code, Git-history, database, environment or deployment change during this evidence-only task.
