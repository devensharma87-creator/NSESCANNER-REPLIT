# MARKET SCANNER BY DEV
# PROMPT 01 — FINAL CLOSURE A0.1.2
## Behavioural Proof, Governance Reconciliation, and Complete Acceptance Record

**Owner:** Devendra Sharma  
**Timezone:** Asia/Kolkata  
**Defects:** `D-FAB-03 / FX-03`, `D-FAB-04 / FX-04`  
**Current status:** `IMPLEMENTED_UNVERIFIED`  
**Permitted production change:** None, except a minimal non-behavioural test seam if executable testing is otherwise impossible  
**Permitted test change:** Yes, narrowly limited to the missing A0.1 behavioural regression coverage  
**Database mutation:** Prohibited  
**Environment/secret mutation:** Prohibited  
**Deployment/publish/push:** Prohibited  
**Manual Git history mutation:** Prohibited  
**Next checkpoint after acceptance:** Phase A0.2, not Phase A1  

---

## 1. BINDING DECISION

The prior report's verdict,

`ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`,

is **not accepted**.

Keep the checkpoint at:

`IMPLEMENTED_UNVERIFIED`

Reasons:

1. The report admits that the non-null, above-spot VP case has no behavioural test.
2. The executable `getOptionSignals -> buildSignalsForIndex -> scoreConfluence` boundary is not behaviourally exercised; a source regex is not execution proof.
3. The no-VWAP target quarantine is supported only by an arithmetic replica and source-text inspection; `detectTrendContinuation` is not executed with manipulated VP fixtures.
4. Absence of VP-derived reasons is proven only at the isolated `scoreConfluence` level, not at the index-F&O result boundary.
5. The required raw `git show --stat` evidence for both commits was not included.
6. The assertion `DEPLOYED=NO` was inferred from the absence of a publish event. Absence of evidence is not authoritative deployment proof.
7. The submitted report is physically incomplete: it ends during §10 and omits the remainder of the acceptance checklist and §11 `Next Checkpoint`.

Do not repeat the broad audit. Close only the enumerated gaps in this prompt.

---

## 2. AUTHORITATIVE SCOPE

### 2.1 Code already present and to be preserved

Preserve the intended A0.1 production changes:

- `artifacts/api-server/src/lib/optionSignals.ts`
  - index-F&O confluence construction explicitly supplies `vp: null`;
- `artifacts/api-server/src/lib/optionSignals.ts`
  - the no-VWAP target path does not consume VP POC/VAH/VAL;
- `artifacts/api-server/src/lib/confluenceEngine.ts`
  - the comment describes the enforced caller boundary and does not falsely claim VP is “naturally null.”

Do not redesign these changes merely to make testing convenient.

### 2.2 Permitted edits

Edit only the smallest necessary test surface:

- `artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts`;
- optionally, a dedicated test file colocated with the tested module if that produces clearer ownership and avoids duplication;
- only if unavoidable, a minimal non-behavioural test seam in `optionSignals.ts`, such as exporting an existing internal function without changing its implementation.

If a production seam is required:

1. explain why public entry-point testing cannot reliably reach the branch;
2. keep the seam side-effect-free and runtime-neutral;
3. do not change any condition, formula, threshold, factor, weight, target, stop, size, provider, cache, route, response, or persistence behaviour;
4. show the exact diff proving it is non-behavioural.

### 2.3 Prohibited edits

Do not change:

- strategy eligibility or setup-selection logic;
- thresholds, weights, confidence, scoring, sizing, targets, stops, or risk;
- provider policy or data-source precedence;
- option-chain logic;
- paper-trading or broker-execution logic;
- C0 blocks;
- database schema or data;
- API contracts or UI;
- deployment configuration;
- secrets or environment variables;
- unrelated tests, formatting, documentation, or cleanup.

Do not create `optionChainProvider.test.ts`; that missing file is unrelated to the A0.1 defects.

---

## 3. REQUIRED PROFESSIONAL TEST IMPLEMENTATION

Use executable tests with controlled fixtures. Do not use source-text regexes or duplicate arithmetic implementations as the primary proof.

Test names must include the stable defect ID and the behaviour being protected.

### Test A — Raw bearish/above-spot VP sensitivity

Prove why the enforced boundary is load-bearing:

1. call the real `scoreConfluence`;
2. use a bearish fixture;
3. compare `vp: null` with a non-null VP whose relevant levels are above spot;
4. prove that raw confluence behaviour differs when a non-null VP is allowed;
5. prove the VP factor has non-zero weight in the unguarded case.

This complements the existing bullish/below-spot proof. Both directions must be executable and deterministic.

### Test B — Executable index-F&O caller boundary, bullish path

Exercise the real caller path at the narrowest reliable executable boundary:

- preferred: public `getOptionSignals`;
- acceptable: the real `buildSignalsForIndex` implementation through a minimal test seam;
- unacceptable as primary proof: reading source text and matching `vp: null`.

Inject an upstream context containing a deliberately non-null, extreme VP sentinel. Prove that the actual confluence invocation receives `vp: null` for a bullish index-F&O path.

The assertion must observe real runtime data passed to the real scoring boundary, not a re-created copy of the production object literal.

### Test C — Executable index-F&O caller boundary, bearish path

Repeat Test B for the bearish path. Prove the same fail-closed boundary is direction-independent.

### Test D — End-result reason quarantine

Using executable index-F&O signal generation:

1. run with an extreme non-null upstream VP sentinel;
2. assert that the emitted result contains no VP-derived reason, factor, label, or explanation;
3. cover bullish and bearish results, either in two tests or one table-driven test;
4. inspect all relevant serialized reason/factor fields, not only one selected string.

### Test E — Real no-VWAP target invariance

Call the real `detectTrendContinuation` path with a fixture that actually produces a candidate while VWAP is unavailable.

Run at least two otherwise-identical cases:

- VP fixture 1: deliberately extreme POC/VAH/VAL below spot;
- VP fixture 2: deliberately extreme POC/VAH/VAL above spot.

Prove:

1. the real detector executes and returns a comparable candidate in both cases;
2. entry, target, stop, direction, and setup identity are unchanged;
3. no VP/POC/VAH/VAL reason is present;
4. the target equals the current authorised non-VP formula from production code;
5. no test copies the old or new production algorithm as its own substitute implementation.

### Test F — Guard against accidental reintroduction

Retain a structural guard only as a secondary belt-and-braces assertion if useful. The behavioural tests above are mandatory and cannot be replaced by regex inspection.

### Duplication rule

Do not keep two tests that prove the same invariant at the same layer. Consolidate fixtures and use table-driven cases where that improves clarity. Every test must have one distinct purpose.

---

## 4. TEST ISOLATION AND QUALITY RULES

All tests must be:

- deterministic;
- independent of market hours and current date;
- independent of live broker/API/network access;
- independent of operational databases;
- free of secrets;
- isolated from shared mutable module state;
- explicit about mocked time and dependencies;
- safe to run repeatedly and in any order.

Use the repository's existing test conventions. Do not add a new test framework or dependency.

Do not weaken assertions merely to make the suite pass. Do not snapshot broad unstable objects when precise field assertions are available.

---

## 5. REQUIRED VALIDATION

First prove the repository root, branch, and current HEAD.

Run every relevant test file individually using its exact repository-relative path. At minimum:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"
```

If a new dedicated A0.1 test file is created, run it separately as well.

Then run the relevant combined regression set:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/indicators.test.ts" \
  "src/lib/fnoPaperRiskGuards.test.ts"
```

Include any new dedicated file in the combined command.

Run typecheck:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```

Run diff hygiene only over the work actually being accepted:

```bash
git diff --check
```

If an unavoidable automatic checkpoint occurs before validation, also run `git diff --check <pre-task-head>..HEAD`.

For every command report:

- exact command;
- exit code;
- exact final runner summary;
- pass/fail/blocked status.

No `ABSORBED`, “covered elsewhere,” or inferred-pass language is allowed.

---

## 6. COMPLETE COMMIT-SCOPE EVIDENCE

Capture the pre-task HEAD before editing.

Provide exact, unedited output for:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git show --no-ext-diff --format=fuller --stat \
  df1a132aa7f5294644868377e2e7b2d3c90d674d
git show --no-ext-diff --format=fuller --stat \
  a9063ac0c9d4229070a05fc7a0dc6ff863dece6f
git diff --name-status \
  df1a132aa7f5294644868377e2e7b2d3c90d674d^..a9063ac0c9d4229070a05fc7a0dc6ff863dece6f
git diff --no-ext-diff \
  df1a132aa7f5294644868377e2e7b2d3c90d674d^..a9063ac0c9d4229070a05fc7a0dc6ff863dece6f \
  -- artifacts/api-server/src/lib/optionSignals.ts \
     artifacts/api-server/src/lib/confluenceEngine.ts \
     artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts
```

Show the current task diff separately. Do not mix earlier programme commits into the A0.1 scope.

Classify every changed file as:

- authorised production logic;
- authorised test;
- evidence/prompt artifact;
- unrelated.

The acceptance gate requires zero unrelated code changes.

Do not abbreviate raw output with phrases such as “multiple files/remotes omitted.” Redact only credentials or secret tokens, never repository identity or non-secret evidence.

---

## 7. GIT AND PLATFORM GOVERNANCE

Do not run:

- `git add`;
- `git commit`;
- `git push`;
- `git reset`;
- `git revert`;
- `git rebase`;
- `git cherry-pick`;
- force operations;
- deployment or publish commands.

If Replit-Helium creates an unavoidable automatic checkpoint:

1. do not rewrite or erase it;
2. record the new SHA, author, timestamps, changed-file list, and checkpoint metadata;
3. label it `AUTOMATIC_PLATFORM_CHECKPOINT`;
4. prove whether it is ahead of `origin/main`;
5. state that no manual commit or push command was issued.

Never claim a commit is “local-only” merely because no push was intentionally executed. Use upstream reachability evidence.

---

## 8. DEPLOYMENT STATUS — NO INFERENCE

Do not write `DEPLOYED=NO` based only on:

- no remembered publish action;
- no Git log entry;
- local branch being ahead of origin;
- absence of evidence.

Use an authoritative read-only deployment identity if the platform exposes one, such as:

- current production release/deployment record;
- deployed commit SHA;
- immutable build/release ID mapped to a commit;
- deployment history showing timestamps and source revisions.

Do not expose secrets.

Classify the result exactly as one of:

- `PROVEN_NOT_DEPLOYED_FROM_A0_1_COMMITS`;
- `PROVEN_DEPLOYED`;
- `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`.

If platform access cannot prove it, use `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`. Do not guess.

This task must not change production.

---

## 9. DEFECT AND VERIFICATION STATUS

Do not mark either defect `CLOSED` merely because code and unit tests pass.

Allowed states:

| Defect | Before this task | Maximum state after complete passing evidence |
|---|---|---|
| `D-FAB-03 / FX-03` | `IMPLEMENTED_UNVERIFIED` | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| `D-FAB-04 / FX-04` | `IMPLEMENTED_UNVERIFIED` | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |

`DEV_VERIFIED`, `STAGING_VERIFIED`, `PROD_VERIFIED`, and `CLOSED` are prohibited in this checkpoint.

The remaining Phase A0 register must preserve these meanings:

| ID | Correct description | Status here |
|---|---|---|
| `D-FAB-01 / FX-01` | `volumeProfile()` must return unavailable on zero/untrusted volume | Do not implement here |
| `D-FAB-02 / FX-02` | Replace the false “naturally null” assertion with enforced structural invariants | Do not implement here |
| `D-FAB-05 / FX-05` | `sessionVwap` must not fail soft to HLC3 on zero/untrusted volume | Do not implement here |
| `D-FAB-06 / FX-06` | `VOLUME_BREAKOUT` is dead for zero-volume indices; fix or honestly retire | Not started |
| `D-FAB-07 / FX-07` | Index `MEAN_REVERSION` is near-impossible; fix or honestly retire | Not started |
| `D-FKE-05 / FY-17` | VWAP placeholder leaks into the F&O header, commonly equalling spot | Not started |

Do not renumber, reinterpret, merge, or duplicate these IDs.

---

## 10. ACCEPTANCE GATES

Return `ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` only if all are true:

1. bearish/above-spot raw VP sensitivity is behaviourally proven;
2. bullish and bearish executable index-F&O caller paths prove `vp: null`;
3. executable result serialization contains no VP-derived explanation;
4. the real no-VWAP detector target is invariant under extreme VP manipulation;
5. all new and existing relevant tests pass individually;
6. the relevant combined regression run passes;
7. typecheck passes;
8. diff hygiene passes for the current task;
9. exact diffs show no unrelated code change;
10. both historical commits and any new automatic checkpoint are completely recorded;
11. upstream reachability is proven without a push;
12. deployment status is reported using the exact evidence-based classification in §8;
13. the final report is complete and not truncated.

If a code/test gate fails, return:

`IMPLEMENTED_UNVERIFIED`

If access, tooling, or repository state prevents a required check, return:

`BLOCKED`

List each blocker precisely. Do not compensate with unsupported claims.

---

## 11. REQUIRED COMPLETE FINAL REPORT

Write the durable evidence report to:

`artifacts/audit-evidence/PHASE_A0_1_2_FINAL_CLOSURE.md`

Creating this evidence file is authorised. Do not edit unrelated documentation.

The report must contain:

1. `Verdict`
2. `Why the previous verdict was rejected`
3. `Pre-task repository state`
4. `Exact changed-file inventory`
5. `Production-code diff or explicit no-production-change proof`
6. `Test implementation review`
7. `Individual test results`
8. `Combined regression result`
9. `Typecheck result`
10. `Diff-hygiene result`
11. `Historical commit evidence`
12. `Automatic-checkpoint evidence, if any`
13. `Origin/upstream reachability`
14. `Deployment-status classification`
15. `D-FAB-03 status`
16. `D-FAB-04 status`
17. `Remaining Phase A0 register`
18. `Acceptance checklist with every gate marked PASS, FAIL, or BLOCKED`
19. `Next Checkpoint`

The response to the owner must be concise and include:

- verdict;
- tests and typecheck totals;
- changed files;
- Git/checkpoint status;
- deployment-status classification;
- unresolved blockers, if any;
- exact report path.

Before responding, verify the report exists and ends with:

`END OF PHASE A0.1.2 FINAL CLOSURE REPORT`

Do not start Phase A0.2 in this task.

---

## 12. BINDING SYSTEM SAFETY

Throughout this task:

- owner-only remains unchanged;
- Kite remains the sole trade-grade source;
- Upstox remains compare-only;
- IndianAPI remains research-only;
- Yahoo remains absent from trade paths;
- F&O C0 and Equity C0 remain enabled;
- paper auto-opening remains disabled unless already explicitly authorised;
- swing broker execution remains dry-run only;
- live broker execution remains unauthorised;
- no operational database is mutated;
- no order is placed;
- no production publish or deployment occurs.

This is the final bounded closure of Prompt 01. Make the tests executable, the evidence complete, and every claim no stronger than the proof.
