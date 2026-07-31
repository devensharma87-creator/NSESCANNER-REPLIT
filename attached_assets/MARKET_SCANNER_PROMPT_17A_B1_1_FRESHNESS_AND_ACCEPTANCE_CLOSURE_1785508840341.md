# MARKET SCANNER — PROMPT 17A

## B1.1 Future-Timestamp, Fallback-Provenance and Acceptance Closure

### Instruction to the Replit coder

Preserve the completed Prompt 17 work:

- provider capability registry;
- `optionSignals.ts` migration to `getOptionChain("TRADE_GRADE")`;
- `paperTradingCombo.ts` migration to `getOptionChain("TRADE_GRADE")`;
- provider capability diagnostics;
- the 44 passing B1.1 tests;
- all A0.3, B0 and P0.1B safeguards.

This is one narrow B1.1 closure pass. Do not reopen the full provider inventory and do not start B1.2 or B2.

Do not provision a database, execute Prompt 15, change strategy logic, create live broker orders, contact live providers from tests, commit, push or deploy.

---

# 1. Confirmed blocker

The previous implementation discovered this behavior:

> `computeFreshness` uses `Math.max(0, ageSec)`, so a future provider timestamp becomes age `0` and is classified fresh.

The test was changed to document that behavior.

That is not acceptable for an accuracy-critical trading data backbone. A timestamp materially in the future is not fresh data. It is invalid or freshness-unverified data and must not become tradeable.

Do not weaken the requirement to match the existing implementation. Correct the implementation and make the test load-bearing.

---

# 2. Anti-loop sequence

1. Record read-only Git state once.
2. Read only the freshness function, its types, the production callers changed by Prompt 17, the option-chain facade and the B1.1 tests.
3. Implement the three closure gates below.
4. Run targeted tests.
5. Run the complete verification battery once.
6. Correct the existing B1.1 evidence file.
7. Return the result and stop.

Documentation/attachment-only platform auto-commits may be recorded and ignored. Stop only for an unexpected source/test/schema/build/deployment change.

---

# 3. Gate B1.1-C1 — Future timestamp must fail honesty checks

## 3.1 Required freshness semantics

Introduce or reuse one named, centralized clock-skew tolerance derived from the project’s accepted clock-health/freshness policy.

For:

```ts
rawAgeMs = nowMs - asOfMs
```

required behavior is:

1. `rawAgeMs >= 0`:
   - evaluate normally against the domain/purpose freshness budget.
2. `rawAgeMs < 0` but within a small justified negative-skew tolerance:
   - do not silently lose the sign;
   - retain/report the observed clock skew;
   - freshness may be accepted only if the policy explicitly permits that uncertainty.
3. `rawAgeMs` is more negative than the allowed tolerance:
   - return an explicit invalid/unverified classification;
   - use a stable reason such as `FUTURE_TIMESTAMP` or the project’s canonical equivalent;
   - do not classify it `LIVE`/fresh;
   - do not clamp it to zero;
   - do not permit trade decision, paper admission, contract selection or exit confirmation.
4. Missing/invalid/unparseable timestamp:
   - return unverified/unavailable;
   - never use `receivedAt` or `Date.now()` as a fabricated authoritative `asOf`.

Preserve both the raw signed age/skew and the normalized display age if the contract supports them. Do not expose impossible negative “freshness age” as a misleading UI value.

## 3.2 Required tests

Add exact boundary tests using an injected clock:

- timestamp equal to `now`;
- timestamp one unit inside negative-skew tolerance;
- timestamp exactly at the tolerance boundary;
- timestamp one unit beyond the tolerance;
- timestamp materially in the future;
- timestamp exactly at the fresh/stale boundary;
- timestamp one unit beyond the stale boundary;
- missing timestamp;
- invalid timestamp;
- freshly received prior-session timestamp;
- future-timestamp envelope passed to `TRADE_DECISION`;
- future-timestamp envelope passed to `PAPER_ADMISSION`;
- future-timestamp option premium passed to exit monitoring.

The three trade-sensitive cases must fail closed with the explicit reason. Do not merely test the pure helper in isolation.

---

# 4. Gate B1.1-C2 — Fallback provenance must be produced by the real route

The previous test manually passed `fallbackUsed: true` because `pointFromMeta` does not infer fallback use from warnings. That may be appropriate for a low-level normalizer, but manually forcing the expected flag in a unit fixture does not prove production routing sets it correctly.

Do not infer fallback solely from arbitrary warning text.

Instead prove the real routing/facade behavior:

1. Primary Kite success:
   - `fallbackUsed === false`;
   - source is Kite;
   - no primary-failure reason.
2. Kite failure + approved Upstox secondary success:
   - `fallbackUsed === true`;
   - source is Upstox;
   - primary failure reason is preserved;
   - Upstox `asOf`/freshness controls the result;
   - no field is borrowed from the failed Kite response.
3. Trade-grade option-chain request with Kite unavailable:
   - NSE display fallback must not be used;
   - result is unavailable/degraded with stable reason;
   - paper admission remains blocked.
4. Display-only request where NSE/Yahoo fallback is intentionally allowed:
   - `fallbackUsed === true`;
   - source/trust tier is explicit;
   - result cannot cross into tradeable/paper/exit purpose.
5. Unconfigured Upstox/IndianAPI:
   - `NOT_CONFIGURED`;
   - no attempted fabricated success;
   - no request to a made-up endpoint.

Test actual production facades or migrated consumers with mocked transports. Do not manufacture final metadata by calling a normalizer with the answer already supplied.

Also run a production search proving both migrated high-risk consumers no longer call legacy `fetchOptionChain`.

Permitted display/observation consumers may remain only with explicit non-tradeable purpose and provenance.

---

# 5. Gate B1.1-C3 — Complete acceptance verification

The prior response reported only API-server/scanner TypeScript and the API full suite. Complete the Prompt 17 verification record without another broad code pass.

Run and report exact commands and counts for:

1. corrected B1.1 test file;
2. future timestamp trade-boundary tests;
3. actual fallback routing tests;
4. option-signal TRADE_GRADE tests;
5. paper-trading TRADE_GRADE/premium-trust tests;
6. provider capability and diagnostics tests;
7. canonical instrument/contract resolver tests;
8. A0.3 behavioral regression;
9. B0 alert/market-state regression;
10. API-server `test:full` under the accepted non-DB configuration;
11. scanner full suite;
12. API-server typecheck;
13. API-Zod typecheck;
14. API-client-react typecheck;
15. actual web-application typecheck;
16. scanner typecheck;
17. API-server production build;
18. actual web-application production build;
19. scanner production build;
20. process-wide zero-PostgreSQL-connection tripwire;
21. ordinary-test zero-live-provider-network proof;
22. `git diff --check`.

Inspect actual package names/scripts. If a package does not exist, identify the real owner package instead of omitting it.

No live provider request may be made by the test battery.

No `.skip`, `.only`, retries, arbitrary sleeps or weakened assertions may be introduced.

If anything fails, identify the exact file/test and cause. Do not call it pre-existing, flaky or timing-related without proof.

---

# 6. Evidence integrity

Update only:

```text
artifacts/audit-evidence/PHASE_B1_1_CANONICAL_LIVE_DATA_BACKBONE.md
```

The corrected record must contain:

- starting and final observed HEAD;
- branch/upstream/ahead-behind without fetching;
- tracked/staged/untracked state;
- exact changed-file inventory;
- old and corrected future-timestamp behavior;
- chosen negative-skew tolerance and justification;
- exact freshness boundary table;
- production fallback provenance table;
- proof legacy option-chain calls are absent from migrated consumers;
- exact per-file tests and reconciled totals;
- all typecheck/build results;
- zero-DB and zero-live-provider-network results;
- provider capability/activation status;
- confirmation no strategy rule changed;
- confirmation Prompt 15/DB provisioning was not executed;
- confirmation no operational data mutation, commit, push or deployment occurred;
- SHA-256 after final write;
- exactly one terminator as the final nonblank line:

```text
END_PHASE_B1_1_FRESHNESS_AND_ACCEPTANCE_CLOSURE
```

Do not leave an older terminator after it.

---

# 7. Verdict

Return:

```text
ACCEPT_B1_1_CANONICAL_LIVE_DATA_BACKBONE
```

only if:

- materially future timestamps cannot be fresh/tradeable;
- exact clock-skew/freshness boundaries pass;
- production routing produces truthful fallback metadata;
- TRADE_GRADE cannot use NSE/Yahoo fallback;
- all configured paths and disabled capabilities are honest;
- the full verification and evidence record is complete.

If the Kite-first backbone passes but external credentials remain absent, the accepted verdict may be accompanied by:

```text
PROVIDER_ACTIVATION_PENDING — UPSTOX / INDIANAPI NOT_CONFIGURED
```

That is not a blocker and must not trigger another audit.

If any accuracy gate fails, return:

```text
B1_1_NOT_ACCEPTED — <single precise blocker>
```

Do not start B1.2 or B2 in this task.

---

# 8. Final response format

Return only:

1. **Verdict**
2. **Future-timestamp correction and boundaries**
3. **Production fallback-provenance proof**
4. **TRADE_GRADE migration proof**
5. **Provider capability state**
6. **Exact tests and totals**
7. **Typechecks and builds**
8. **Git/changed-file record**
9. **Evidence SHA-256 and terminator**
10. **Provider activation pending, if applicable**
11. **Next phase B1.2 — not started**
12. **Production status**

No command diary. No new audit. No new roadmap. No deployment.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

