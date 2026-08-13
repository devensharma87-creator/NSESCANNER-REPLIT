# PHASE 0.7B — FINAL AUTHORITY-TIME CORRECTION
## DO NOT CHECKPOINT YET

The provider-free boot isolation and read-only restoration proof are accepted. However, the reported current-authority result contradicts the owner-approved BSE authority policy.

## Observed contradiction

Restored snapshot:

```text
saved_at = 2026-08-12 12:58:44.459928 UTC
generation = P06-b1632484542c83eb
```

Controlled boot:

```text
2026-08-13 09:34:15 UTC
approximately 2026-08-13 15:04 IST
```

The approved policy says BSE List-of-Scrips authority expires at the next IST midnight and requires a current-day retrieval. A generation persisted on 12 August should therefore not report `CURRENT_AUTHORITATIVE` on 13 August unless the committed source evidence independently and validly proves a 13 August retrieval.

Reported result:

```text
RESTORED_CURRENT
CURRENT_AUTHORITATIVE
blocker = none
```

This must be investigated before checkpointing.

---

## A. READ-ONLY FORENSIC TRACE FIRST

Do not modify code initially.

For the selected durable manifest, report the exact committed values for:

- manifest `generatedAt`;
- snapshot `saved_at`;
- BSE List-of-Scrips retrieval timestamp;
- BSE source effective date;
- BSE source hash;
- calendar commitment creation time;
- latest completed BSE session claimed;
- stored `validUntilMs`, if present;
- boot evaluation timestamp;
- IST calendar date derived from each timestamp;
- authority evaluator input and output;
- exact branch that produced `CURRENT_AUTHORITATIVE`.

Label each value:

- `STORED`
- `DERIVED`
- `RUNTIME_EVALUATED`

Do not rely on logs alone. Trace the actual committed manifest and production evaluator.

---

## B. REQUIRED AUTHORITY CONTRACT

Integrity and current authority must remain separate.

A valid Schema-5 payload may restore successfully after its authority expires, but it must become:

```text
restorationState = RESTORED_LAST_KNOWN
authorityState = LAST_KNOWN or STALE
blockerCode = AUTHORITY_EXPIRED
canAuthorizeUniverse = false
```

It must not authorize:

- complete live-coverage claims;
- a new subscription denominator;
- scanner-universe authority;
- trade-grade readiness;
- actionable signals;
- paper trading;
- orders.

Do not reject or delete the intact generation merely because it expired. Install it only as last-known metadata/universe evidence under the existing accepted contract.

---

## C. DETERMINE THE ROOT CAUSE

Explicitly check for:

1. UTC date compared instead of IST date.
2. `saved_at` mistakenly used as source retrieval time.
3. Stored authority boolean trusted instead of re-evaluated.
4. `validUntilMs` missing or ignored.
5. Midnight boundary calculated in UTC.
6. Calendar validity incorrectly treated as BSE source validity.
7. Boot evaluator using the committed historical instant instead of current boot time.
8. Coverage bridge reading raw manifest authority rather than settled restoration authority.
9. A fixture/test clock leaking into runtime.
10. Seconds-versus-milliseconds conversion.
11. Source retrieval timestamp parsed incorrectly.
12. Current authority memo surviving from an earlier process state.

If committed evidence genuinely contains a future timestamp relative to `saved_at`, treat that as an integrity inconsistency and fail closed. Do not explain it away.

---

## D. MINIMUM CORRECTION

If the report is a logging/diagnostic error only, correct the diagnostic source.

If runtime authority is actually wrong, correct the single current-time authority boundary and every direct consumer of that result.

Do not:

- rebuild the registry;
- refresh BSE data;
- download sources;
- modify the stored generation;
- rewrite its checksum;
- change the approved midnight policy;
- introduce a grace period;
- make provider calls;
- change subscriptions;
- alter safety locks.

---

## E. TARGETED TESTS

Use the real restoration and authority functions.

Required boundaries:

1. Source retrieved today in IST before expiry → current.
2. Source retrieved yesterday in IST → expired.
3. `23:59:59.999 IST` on retrieval day → current if otherwise valid.
4. Exactly `00:00:00.000 IST` next day → expired.
5. UTC midnight must not control expiry.
6. Weekend/non-session next day still expires at IST midnight.
7. Holiday next day still expires at IST midnight.
8. Intact expired manifest restores as last-known.
9. Expired manifest cannot authorize coverage.
10. Expired manifest cannot authorize trade-grade readiness.
11. Stored `CURRENT` flag cannot override runtime expiry.
12. Future retrieval timestamp relative to generation persistence fails closed.
13. Repeated evaluation at the same instant is deterministic.
14. All four safety locks remain false.

Do not weaken existing tests to accommodate the observed result.

---

## F. RUNTIME RE-PROOF

Because this issue directly affects the runtime result, one additional controlled boot is authorized only if code or diagnostics change.

Use the already implemented provider-free proof mode.

Expected for the unchanged August 12 snapshot during an August 13 boot:

```text
integrity = valid
restoration = RESTORED_LAST_KNOWN
authority = expired/non-authoritative
blocker = AUTHORITY_EXPIRED
provider calls = 0
WebSockets = 0
subscriptions = 0
schedulers = 0
ingestors = 0
notifications = 0
database mutations = 0
```

Capture database before/after evidence once. Do not rebuild or refresh the generation to make it current.

If it still reports current, stop with:

```text
PHASE_0_7B_BLOCKED — EXPIRED_BSE_AUTHORITY_STILL_LABELLED_CURRENT
```

---

## G. REPOSITORY CONTROL

Do not commit, push, merge or deploy.

Inspect auto-commit `e6ba531` but do not alter history. Report all additional modified/untracked files separately.

Do not rerun broad suites or builds. Run only affected authority/restoration tests, TypeScript and the one justified controlled boot.

---

## REQUIRED FINAL VERDICT

Only if the corrected runtime proof reports the August 12 generation as non-authoritative on August 13:

```text
SCHEMA_5_REGISTRY_BOOT_RESTORATION_VERIFIED_IN_DEVELOPMENT —
EXPIRED_BSE_AUTHORITY_RESTORED_LAST_KNOWN —
ZERO_STALE_AUTHORITY_LABELLED_CURRENT —
PROVIDER_FREE_BOOT_MODE_ENFORCED —
ZERO_DATABASE_WRITES —
ZERO_PROVIDER_SUBSCRIPTION_OR_SCHEDULER_SIDE_EFFECTS —
OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED
```

Otherwise:

```text
PHASE_0_7B_BLOCKED — EXPIRED_BSE_AUTHORITY_STILL_LABELLED_CURRENT
```

Stop after reporting. Do not begin the three-WebSocket phase.
