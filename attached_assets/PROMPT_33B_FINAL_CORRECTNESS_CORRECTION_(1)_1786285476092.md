# PROMPT 33B — Final Correctness Correction

## Status: NO DEPLOYMENT

Continue the existing Prompt 33B work. Do not create a new pack.

Do **not** deploy, activate scanner evaluation, activate Full-NSE warehouse population, activate V2 paper cohorts, retry a canary, modify strategy logic, change thresholds, or enable broker execution.

The latest commit `f5d96ae` is **not accepted** because the following factual and implementation defects remain.

---

## 1. Correct the NSE security classification

`EQUITY_L.csv` membership and `SERIES=EQ` are not sufficient proof that an instrument is an ordinary company equity.

The NSE capital-market/equity universe may include:

- Ordinary equity shares
- ETFs and mutual-fund units
- REITs and InvITs
- Partly paid securities
- Preference shares
- Debt and hybrid securities
- Other non-company-equity instruments

Integrate the required official NSE reference datasets or authoritative security-type fields needed to distinguish these classes.

The canonical classification must include:

- `ORDINARY_COMPANY_EQUITY_ELIGIBLE`
- `TRADE_TO_TRADE_EQUITY`
- `SME_EQUITY`
- `ETF_OR_MUTUAL_FUND_UNIT`
- `REIT_OR_INVIT`
- `PARTLY_PAID_OR_PREFERENCE`
- `DEBT_OR_HYBRID`
- `SGB`
- `INACTIVE`
- `UNRESOLVED_SECURITY_TYPE`

Only `ORDINARY_COMPANY_EQUITY_ELIGIBLE` may enter the ordinary-equity scanner universe.

If the authoritative security type cannot be determined, classify it as `UNRESOLVED_SECURITY_TYPE` and fail closed. Do not infer ordinary equity solely from:

- `SERIES=EQ`
- Kite `instrument_type=EQ`
- Symbol suffix
- Security-name heuristics

Document every official NSE source, its purpose and its classification precedence.

---

## 2. Produce the complete live reconciliation

Using the same live Kite instrument master and official NSE references consumed by the production code, report exact:

- Kite NSE raw instrument count
- Kite EQ-like instrument count
- NSE reference rows by dataset
- Matches by ISIN
- Matches by symbol
- Kite-only unmatched records
- NSE-only unmatched records
- Duplicate symbols
- Duplicate ISINs
- Missing ISINs
- Parse rejects
- Every final security-class count
- Final ordinary-company-equity scanner universe
- Excluded total
- Unresolved total

Prove the accounting equation:

```text
raw candidate count
= eligible ordinary equities
+ every excluded class
+ unresolved
+ explicitly documented unmatched records
```

Every candidate must belong to exactly one mutually exclusive final class. No instrument may be silently dropped or double-counted.

Run a real development Full Scanner generation using the authoritative join and include its complete:

- `generationId`
- `generatedAt`
- `universeSize`
- `rows`
- `liveQuoteCount`
- `failures`
- `eligibilityBreakdown`
- `countReconciliation`
- `reconciliationValid`
- provider provenance
- reference metadata and hashes

No estimates and no sample-only proof are acceptable.

---

## 3. Fix F&O-ban admission semantics

Replace boolean/null-only consumption with a structured admission result containing:

```ts
type FnoBanAdmissionResult = {
  status: "CURRENT" | "LAST_KNOWN_STALE" | "UNAVAILABLE";
  banned: boolean | null;
  canAuthorizeAdmission: boolean;
  asOf: string | null;
  reasonCode: string;
};
```

Only `CURRENT` with `canAuthorizeAdmission=true` may pass the F&O admission gate.

Prove through the actual production admission functions:

- `CURRENT` + not banned → this gate passes
- `CURRENT` + banned → blocked
- `LAST_KNOWN_STALE` → blocked regardless of cached membership
- `UNAVAILABLE` → blocked
- Malformed or unknown state → blocked
- `null` is never treated as `false`

Remove the statement that `BLOCKED_STALE_LIST` is a future feature. It must work now.

Inventory every production F&O admission caller and record its runtime-test result.

---

## 4. Correct Swing Cash behaviour

Do not hard-block a cash-equity swing order merely because the underlying appears on the NSE F&O ban list.

The NSE F&O ban restricts derivatives admission. It is not, by itself, a prohibition on cash delivery trading.

For Swing Cash:

- Preserve F&O-ban status only as informational risk metadata if useful
- Do not reject a cash delivery order solely because of the derivatives ban
- Retain all existing cash-market risk gates
- Retain provenance and freshness gates
- Retain liquidity and price-integrity gates
- Retain kill-switch and dry-run protections
- Do not change swing strategy thresholds, entries, stops or targets

Add runtime tests proving the separation between F&O derivative admission and Swing Cash admission.

---

## 5. Make NSE-reference persistence genuinely durable

PostgreSQL must be the authoritative last-good store. Instance-local disk may only be a non-authoritative L1 cache.

Required resolution policy:

1. Validated fresh in-memory snapshot
2. Freshest validated PostgreSQL snapshot
3. Local disk only when validated and not older than PostgreSQL
4. Fresh official HTTP refresh

Fix all of the following:

- Await PostgreSQL persistence; no fire-and-forget save
- Surface and alert on persistence failure
- Do not report a snapshot as durable before its database transaction commits
- Use a dedicated PostgreSQL client or a transaction-scoped advisory lock
- Acquire and release any session advisory lock on the same connection
- Compare `retrievedAt`, effective date, schema version and SHA-256 before selecting disk versus PostgreSQL
- Persist source URL, effective date, retrieval time, SHA-256, schema version, validation result, row count and normalized records
- Ensure schema creation/migration is additive, idempotent and non-destructive
- Preserve the previous validated snapshot when a refresh or persistence attempt fails

Test:

- Restart hydration
- Second-replica hydration
- Concurrent refresh attempts
- Advisory-lock acquisition and release
- Older disk snapshot versus newer PostgreSQL snapshot
- Newer valid disk snapshot versus older PostgreSQL snapshot
- PostgreSQL write failure
- Malformed response
- Empty response
- Timeout
- Successful last-good replacement
- Failed refresh preserving last-good

---

## 6. Correct stale-reference governance

Define an explicit currentness and expiry policy for every authoritative NSE reference.

Diagnostics must expose:

- Source URLs
- Effective date
- `retrievedAt`
- `ageHours`
- SHA-256
- Schema version
- Validation status
- `stale`
- `staleReason`
- `isLastGood`
- `canAuthorizeUniverse`

An expired, malformed, incomplete or unvalidated reference must never authorize new evaluation, ranking, signals, alerts, paper admission or broker action.

A failed reference refresh must preserve an existing valid rendered scanner generation with explicit stale/degraded provenance. It must not replace it with a fabricated zero-row generation.

Provide runtime proof showing:

- Generation ID before refresh failure
- Row count before refresh failure
- Forced refresh/reference failure
- Generation ID after failure remains unchanged
- Row count after failure remains unchanged
- Stale/degraded state is displayed
- No false zero, neutral, score, confidence, signal or action is created

Also prove restart behaviour when only a durable last-good snapshot exists.

---

## 7. Clean the complete production artifact tree

After clean Stock Scanner Pro production builds, recursively scan every emitted file for:

- `/debug/home-states`
- `HomeDebugPage`
- `STATE-A`
- `STATE-B`
- `STATE-C`
- `home-debug`
- `fixture-only`
- Test fixture payload markers
- Preview-bypass code
- Test-hook exports

Also prove zero debug routes in the production route registry.

Remove `project-codebase-summary.md` from the public scanner output.

Do not ship publicly accessible production source maps. If source maps are required for error monitoring, upload them privately to the monitoring service and exclude them from public deployment artifacts.

Do not treat legitimate production symbols such as `HINDCOPPER` as fixture leakage merely because their names appear in the production universe.

---

## 8. Re-run the closing battery

Run and report:

- Complete API-server test suite
- Complete scanner test suite
- All relevant package typechecks
- Stock Scanner Pro API production build
- Stock Scanner Pro scanner production build
- Recursive production-artifact scan
- Production route-registry scan
- `git diff --check`
- `.skip` / `.only` audit
- Secret sentinel
- Provider-import guard
- Broker-execution sentinel
- `artifacts/global` unchanged

Reconfirm from source and runtime import:

```text
FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED=false as boolean
SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED=false as boolean
FNO_PAPER_V2_RUNTIME_AUTHORIZED=false as boolean
SWING_PAPER_V2_RUNTIME_AUTHORIZED=false as boolean
```

Also prove:

- Broker execution remains disabled
- No real `placeOrder` call is reachable
- No canary retry occurred
- No warehouse population occurred
- No scanner evaluation was enabled
- No V2 cohort was activated
- No strategy or threshold was changed
- `artifacts/global` remains untouched

Return exact:

- Commands
- Exit codes
- Test counts
- Changed files
- Commit hash
- Evidence paths
- Remaining blockers, if any

Do not self-authorize deployment.

---

## Required verdict

If and only if every requirement above passes, return:

```text
PROMPT_33B_FINAL_CORRECTNESS_AND_PREDEPLOY_EVIDENCE_VERIFIED — OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED
```

If anything remains incomplete, return a precise `BLOCKED` verdict naming the failed condition. Do not substitute a test-count summary for production-contract evidence.

