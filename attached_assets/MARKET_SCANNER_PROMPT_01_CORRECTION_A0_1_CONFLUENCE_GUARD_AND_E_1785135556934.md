# MARKET SCANNER BY DEV
# PROMPT 01 — CORRECTION ROUND: A0.1 CONFLUENCE GUARD AND EVIDENCE CLOSURE

**Owner:** Devendra Sharma  
**Platform:** `marketscannerbydev.in`  
**Checkpoint:** A0.1 correction — do not start A0.2 or A1  
**Defects:** `D-FAB-03`, `D-FAB-04`  
**Fixes:** `FX-03`, `FX-04`  
**Current submitted verdict:** REJECTED AS `UNIT_VERIFIED`  
**Correct current status:** `IMPLEMENTED_UNVERIFIED`  
**Live broker execution:** NOT AUTHORISED  

---

## 1. PURPOSE

Continue from the existing uncommitted Prompt 01 patch. Preserve the useful changes already made. Correct only the acceptance failures listed below.

Do not discard, reset or reimplement the current patch. Do not begin containment logging, production backfill, API integration or any later roadmap item.

---

## 2. WHY THE PREVIOUS RESULT WAS NOT ACCEPTED

The previous response correctly removed the `Above POC` / `Below POC` `+8` contributions and VP-derived target references from the no-VWAP index branch. That is useful progress on `D-FAB-04`.

However, it did not close `D-FAB-03`:

- `scoreVolumeProfile()` remains capable of assigning directional weight whenever it receives a non-null VP;
- the caller reportedly passes `vp: ctx.vpIntraday`;
- the implementation relies on upstream null propagation rather than an enforced index-F&O decision-boundary rule;
- the only confluence test reported proves `vp=null` returns weight zero;
- it does not prove that a non-null, fabricated, proxy or anomalous VP is incapable of changing an index F&O score;
- a comment stating that index VP is “always null” is not a control and recreates the same convention-not-contract failure identified by `D-FAB-02`.

The evidence response also contains these unresolved problems:

1. It summarises command results rather than providing the requested raw output.
2. The regression command lists five test files, while the result says “3 test files”; the mismatch is unexplained.
3. The baseline omits the merge base and literal Git outputs.
4. No post-change `HEAD` / status proof was supplied.
5. Live broker disablement was inferred from C0 and lack of `openPaperTrade` edits. C0, paper-trade containment and live broker execution are separate controls and must not substitute for one another.
6. The stated next checkpoint skips the unfinished Phase A0 items and jumps to A1.

---

## 3. SCOPE

### Authorised

- Preserve and complete the existing three-file patch.
- Add the smallest explicit decision-boundary guard required to ensure index F&O confluence cannot consume VP.
- Replace any prose-only invariant with an executable structural invariant and regression test.
- Add missing tests for the already changed VP-derived target calculation.
- Produce complete literal evidence.

### Not authorised

- No threshold, unrelated weight, strategy, setup, sizing, entry, exit, SL, target, risk, provider or calendar changes.
- No database access, DDL, DML, migration or backfill.
- No environment mutation.
- No secret output.
- No commit, merge, rebase, push, publish or deploy.
- No A0.2, A1 or later work.
- Do not delete or overwrite unrelated changes.

---

## 4. REQUIRED CORRECTION — EXECUTABLE INDEX-F&O BOUNDARY

Current source must enforce:

> For an index F&O evaluation, confluence receives no volume-profile decision input, even if an upstream context accidentally or intentionally contains a non-null VP object.

Implement the narrowest safe form supported by the current architecture.

Acceptable patterns include:

- explicitly pass `vp: null` at the index F&O confluence caller; or
- pass an existing, trusted instrument/data capability and have the confluence boundary reject VP unless genuine decision-grade volume is explicitly authorised.

Do not build a new provider framework in this correction.

The guard must be executable. A comment, naming convention, symbol assumption or current upstream null behaviour is insufficient.

If `getOptionSignals()` is exclusively an index F&O path, prove that from every caller and use the minimal explicit boundary. If it is shared with equities, use the smallest existing instrument classification to guard only index F&O.

Remove or rewrite the new “always null” comment so it describes the enforced rule rather than predicting upstream behaviour.

---

## 5. MANDATORY TESTS

### 5.1 Confluence non-null injection test

For each relevant index classification, deliberately inject a non-null VP with:

- POC below spot;
- POC above spot;
- different VAH and VAL values;
- finite but economically absurd values.

Prove that changing only those VP fields cannot alter:

- total confluence score;
- bullish or bearish direction;
- confidence;
- tier;
- setup eligibility;
- signal eligibility;
- decision reasons.

Testing only `vp=null` is not sufficient.

### 5.2 Symmetry test

Use mirrored bullish and bearish inputs. Prove that no VP-derived point or reason appears in either direction.

### 5.3 Target quarantine test

Directly test the already changed no-VWAP target logic:

- a non-null VP with VAH above `R1` cannot widen the bullish target;
- a non-null VP with VAL below `S1` cannot widen the bearish target;
- the pivot/ATR result remains identical with VP absent or manipulated.

### 5.4 Existing behavioural protection

Run the relevant:

- zero/missing/non-finite volume tests;
- option-signal tests;
- confluence tests;
- signal contract/serialization tests;
- F&O paper-admission safety tests;
- C0 containment tests;
- TypeScript typecheck.

If a required suite needs a database, use only a separately isolated test database that passes the identity guard. Otherwise report `BLOCKED_TEST_DB`. Never use `DATABASE_URL`.

Do not claim five test files ran when the runner reports three. Reconcile the exact collected-file count.

---

## 6. CONTROL PROOF — NO SUBSTITUTION

Report these as separate rows:

1. F&O source-level C0 hard block.
2. Equity source-level C0 hard block.
3. Paper automatic-opening control.
4. Swing automatic-opening control.
5. Live broker order-execution control.

For each, provide:

- exact source/config identifier;
- exact file path;
- current non-secret state;
- how the state was verified;
- whether this patch changed it.

Do not infer live broker disablement from C0. Do not infer C0 from an entry cutoff, degraded mode, absent code change or another defence.

Do not print secret or connection values.

---

## 7. REQUIRED RAW EVIDENCE

Provide the exact command and unedited output for:

- applicable project instructions discovered;
- `git branch --show-current`;
- `git rev-parse HEAD`;
- upstream;
- ahead/behind count;
- merge base with the intended base branch;
- pre-correction `git status --short`;
- pre-correction diff names and diff stat;
- every test command;
- every test runner result, including collected file count;
- typecheck;
- post-correction `git status --short`;
- post-correction diff names and diff stat;
- post-correction `git rev-parse HEAD`.

Confirm that pre- and post-correction `HEAD` are identical, proving no commit occurred.

Do not replace raw output with prose or a manually created table.

---

## 8. CORRECT DEFECT CLASSIFICATION

Based on the previous evidence:

- `D-FAB-01` appears historically fixed by the existing `totalVol <= 0` guard, but remains open until its own named test/evidence checkpoint.
- Current active production bias from `D-FAB-03` is not proven because upstream VP currently returns null for zero-volume indices.
- The remaining issue is a latent structural decision-boundary vulnerability until this correction enforces the rule.
- Do not repeat the unqualified statement that the current engine is actively biased unless current runtime evidence proves non-null VP reached index confluence.

Use the precise classification:

`LATENT_STRUCTURAL_RISK` before the correction, followed by `UNIT_VERIFIED` only after the non-null injection tests pass.

---

## 9. ACCEPTANCE GATE

This correction passes only if:

- [ ] Existing useful `D-FAB-04` changes are preserved.
- [ ] Index F&O confluence explicitly receives no VP decision input.
- [ ] A deliberately non-null VP cannot alter index F&O confluence.
- [ ] VP cannot alter the changed no-VWAP targets.
- [ ] The prose-only “always null” assumption is removed or backed by executable enforcement.
- [ ] Raw test output is supplied.
- [ ] Test-file collection count is reconciled.
- [ ] Contract/serialization and paper-admission coverage is run or honestly blocked.
- [ ] C0, paper, swing and live-broker controls are proven separately.
- [ ] Merge base and raw Git evidence are supplied.
- [ ] Pre/post `HEAD` match.
- [ ] No database, environment, schema, commit or deployment action occurred.
- [ ] No later-phase work began.

If any item fails, return `IMPLEMENTED_UNVERIFIED` or `BLOCKED`. Do not return `UNIT_VERIFIED`.

---

## 10. REQUIRED FINAL RESPONSE

Use these sections:

1. `Checkpoint Verdict`
2. `Correction of Prior Claims`
3. `Raw Git Evidence`
4. `Executable Boundary Guard`
5. `Changed Files`
6. `Raw Test and Typecheck Output`
7. `Separate Containment-Control Proof`
8. `Acceptance Gate`
9. `Residual Phase A0 Work`
10. `No-Deployment Statement`

Do not recommend Phase A1 as the next checkpoint.

The next checkpoint after acceptance is Phase A0.2, covering the remaining fabrication-kill items in dependency order:

- `D-FAB-01 / FX-01`
- `D-FAB-02 / FX-02`
- `D-FAB-05 / FX-05`
- `D-FAB-06 / FX-06`
- `D-FAB-07 / FX-07`
- `D-FKE-05 / FY-17`

Stop after delivering the correction evidence.
