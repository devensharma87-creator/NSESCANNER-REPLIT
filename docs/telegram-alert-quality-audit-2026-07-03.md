# Telegram Alert Quality Audit — Root Cause Report (2026-07-03)

Scope: read-only audit. No code changed as part of this document. Triggered by an owner
complaint of repeated/duplicate system alerts and a low-value pre-market message despite
prior "parity"/"resilience" milestones.

## 1. Alert-family root-cause table

| Alert Type | File / Function | Scheduler / Trigger | Dedup Key | Dedup Store | Per-worker Safe? | DB-backed? | Current Problem |
|---|---|---|---|---|---|---|---|
| Pre-market analysis | `dailyReports.ts` → `buildPreMarketReport`/`maybeRunPreMarketReport` | 60s poll loop, fires at 08:50 IST | `report_type='PRE_MARKET', ist_date` | `daily_report_runs` (UNIQUE constraint) | Yes | Yes | Not duplicated. Content is bloated — see §3. |
| Post-market analysis | `dailyReports.ts` → `buildPostMarketReport`/`maybeRunPostMarketReport` | 60s poll loop, fires at 15:45 IST | `report_type='POST_MARKET', ist_date` | `daily_report_runs` (UNIQUE constraint) | Yes | Yes | Not duplicated. |
| Kite pre-open action required | `kiteReadinessScheduler.ts` → `runKiteReadinessCheckOnce` | `setInterval` every 5 min, gated 08:40–09:20 IST | `KITE_SESSION_MISSING_PREOPEN::<day>` / `KITE_SESSION_EXPIRED_PREOPEN::<day>` | in-memory `Map` (`alerting.ts: lastAlerted`) | **No** | **No** | Resets on restart/redeploy; duplicates under >1 replica. |
| Kite final warning | same file, escalation branch (mins ≥ 09:05 IST) | same 5-min interval | `KITE_SESSION_MISSING_PREOPEN_FINAL::<day>` / `..._EXPIRED_PREOPEN_FINAL::<day>` | in-memory `Map` | **No** | **No** | Same as above — this is the reported duplicate. |
| F&O data warmup failed | `fnoSignalAlerts.ts` → `alertFnoDataHealth` (via `alertWarmupFailures`) | `triggerKiteWarmup()` called from: boot, `/kite` login route, manual route, **and** every 30s signal cycle (debounced 60s) while suppression persists | `FNO_DATA_HEALTH::<TYPE>::<INDEX>` — **per index, no trading day** | in-memory `Map`, 10-min window | **No** | **No** | Per-index (3 separate messages), 10-min window is short vs. multi-hour outages → resurfaces every ~10 min per index for the whole outage. |
| FNO_KITE_SESSION_MISSING | `optionSignals.ts` → `getOptionSignals` | 30s signal cycle | `FNO_KITE_SESSION_MISSING::<signalDate>` | in-memory `Map`, 2h window | **No** | **No** | Day is in the key (capped near 1x/2h/day on a single stable process), but restarts/redeploys and concurrent replicas still double-send. |
| FNO_DATA_RECOVERED | `optionSignals.ts` → `getOptionSignals` | 30s signal cycle, on suppressed→not-suppressed transition | `FNO_DATA_RECOVERED` — **no trading day at all** | in-memory `Map`, 1h window | **No** | **No** | Any flap (degrade→recover→degrade→recover) more than 1h apart re-sends; restarts reset immediately. |
| F&O tradeable signal (entry) | `fnoSignalAlerts.ts` → `dispatchFnoWithCanonicalGates` | signal cycle | domain+event_type+destination+order/signal id | `notification_delivery_log` (DB) | Yes | Yes | None known — this is the hardened path (parity milestone). |
| F&O exit alerts | `fnoSignalAlerts.ts` → `dispatchFnoCanonicalExit` | exit monitor / signal cycle | same as above | `notification_delivery_log` (DB) | Yes | Yes | None known. |
| Swing staged-order alerts | `swingAlerts.ts` → `dispatchSwingCanonicalOrder` | swing scan cycle | same pattern | `notification_delivery_log` (DB) | Yes | Yes | None known. |
| Swing TTL expiry/system alerts | `swingTtlSweep.ts` | 10-min interval | n/a | n/a | n/a | n/a | **No Telegram alert at all by design** ("log-only, no trade-channel noise" — see file header). Not part of the spam. |
| Manual test alerts | `routes/alerts.ts`, `routes/dailyAnalysis.ts` (test-* routes) | on-demand, rate-limited 1/30s | `isManualTest` flag bypasses DB dedup; `alertOwnerRaw(..., 0)` for the FNO sample | n/a (deliberately not deduped) | n/a | n/a | Already correctly labeled `[MANUAL TEST]`/`[SAMPLE]`, does not mutate real dedup/report state. Not part of the spam. |

## 2. Direct answers to the audit questions

1. **Which scheduler/function sent each repeated alert?** — see table above.
2. **Which dedup key was used?** — see table above.
3. **Why did dedup fail?** — All four spammy families (warmup-failed, final-warning,
   session-missing, data-recovered) share one primitive: `lastAlerted`, a plain
   module-scope `Map<string, number>` in `alerting.ts`. It has zero persistence. Two
   independent forces defeat it on this project's `autoscale` deployment target
   (`.replit`, `deploymentTarget = "autoscale"`):
   - **Cold starts / restarts.** Autoscale idles the instance down and spins a fresh
     process on the next request; the new process boots with an empty `Map`, so any
     alert whose underlying condition is still true fires again immediately, ignoring
     the intended cooldown.
   - **Concurrent replicas.** Autoscale can run more than one instance under load; each
     has its own private `Map`. Two replicas each independently conclude "I haven't sent
     this recently" and both send. Nothing in code prevents this beyond a comment
     ("single-replica assumption") — there is no advisory lock or DB claim for these
     alert families (unlike `daily_report_runs` for the daily reports, or
     `notification_delivery_log` for trade alerts).
   - Additionally, for **warmup-failed** specifically, the key has no trading-day
     component and the window (10 min) is short relative to how long a live data
     outage can last (hours) — so even on one never-restarted replica the same alert
     resurfaces every ~10 minutes for the whole outage, ×3 indices.
4. **Are multiple workers sending the same alert?** — Likely, at least some of the time.
   `deploymentTarget = "autoscale"` is confirmed in `.replit`; there is no code-level
   guard against >1 concurrent instance for these families.
5. **Are in-memory dedup maps duplicated per worker?** — Yes, structurally. `lastAlerted`
   is one `Map` per Node.js process; it cannot be shared across replicas or survive a
   restart.
6. **Is `notification_delivery_log` used for these system alerts, or only trade alerts?**
   — Only trade alerts (F&O/Swing entry + exit). None of the four spammy system/data-health
   families touch this table.
7. **Why is F&O warmup failure sent per index instead of one digest?** — `alertWarmupFailures`
   iterates the warmup result array and calls `alertFnoDataHealth` once per failing index;
   there is no aggregation step that groups NIFTY/BANKNIFTY/SENSEX into one message.
8. **Why is KITE FINAL WARNING duplicated?** — Same in-memory weakness (§3), applied to the
   09:05 IST escalation branch in `kiteReadinessScheduler.ts`.
9. **Why is FNO_KITE_SESSION_MISSING duplicated?** — Same in-memory weakness; the
   day-scoped key limits it on one stable process but not across restarts/replicas.
10. **Why is FNO_DATA_RECOVERED duplicated?** — Same weakness, made worse because the key
    has *no* trading-day component at all — any recovery more than 1h apart, or across a
    restart, resends.
11. **Why does pre-market analysis include so many "Unavailable" sections?** — By explicit
    design of `DAILY_ANALYSIS_COVERAGE` (a data-authenticity policy: never fabricate). 6 of
    ~14 sections are `SOURCE_NOT_INTEGRATED` and always render the same boilerplate line.
    Honest, but printed as full inline headers every day, it drowns the ~5 sections that are
    genuinely live (Kite session, key levels, option chain, expiry/rollover, swing staging).
12. **Which sections have no real provider and should be hidden/collapsed/moved?** —
    Overnight Global Cues, GIFT Nifty/SGX Nifty, FII/DII (F&O flows — cash + participant OI
    are `INFO_ONLY` from the NSE archive, partially real but not live/trade-grade), India VIX,
    VIX-implied expected range, News & Events. All `SOURCE_NOT_INTEGRATED` or `INFO_ONLY`.
13. **Exact minimum useful pre-market message** — see §3.
14. **Exact code files that need fixing** — see §4.
15. **What will not be touched** — see §5.

## 3. Minimum useful pre-market message (target shape)

**Kite missing before open:**
```
🌅 PRE-MARKET STATUS — ACTION REQUIRED
Date: <IST date>

Kite: ❌ Missing/Expired
F&O readiness: Blocked
Scanner/Paper Trading: Not trade-grade
Swing staging: <N> pending

Action: Reconnect Kite before market open.

Not included today: GIFT Nifty, overnight global cues, FII/DII (F&O), India VIX,
news/events — provider not configured.

Broker execution: DISABLED
```

**Kite active / F&O ready:**
```
🌅 PRE-MARKET STATUS
Date: <IST date>

Kite: ✅ Active
F&O readiness: ✅ Daily bars, option chain, signal cycle available
Signals: <N> tradeable / <N> suppressed

Key levels: Available on /premarket
Option chain: Available on /option-chain
Swing staging: <N> pending

Action: Monitor /fno-diagnostics and /option-chain

Not included today: GIFT Nifty, overnight global cues, FII/DII (F&O), India VIX,
news/events — provider not configured.

Broker execution: DISABLED
```
FII/DII cash + participant OI (`INFO_ONLY`, real NSE-archive data) can stay in the main
body as a single line when fresh; everything `SOURCE_NOT_INTEGRATED` moves to the one-line
footer. Full detail for every section remains available on the `/daily-analysis` page and
`/premarket` — Telegram is a notification, not the full report.

## 4. Files that need fixing (implementation phase — not yet started)

- `artifacts/api-server/src/lib/alerting.ts` — add a DB-backed dedup/claim layer for
  system/data-health alerts (new table, or extend `notification_delivery_log`'s pattern),
  keep the in-memory `Map` only as a same-process fast-path optimization on top of it.
- `artifacts/api-server/src/lib/fnoSignalAlerts.ts` — `alertWarmupFailures`/`alertFnoDataHealth`:
  aggregate all failing indices into one digest message per cooldown window instead of
  one message per index.
- `artifacts/api-server/src/lib/optionSignals.ts` — `FNO_KITE_SESSION_MISSING` and
  `FNO_DATA_RECOVERED` call sites: route through the new DB-backed claim; add trading-day
  to the `FNO_DATA_RECOVERED` key.
- `artifacts/api-server/src/lib/kiteReadinessScheduler.ts` — pre-open/final-warning branches:
  route through the new DB-backed claim.
- `artifacts/api-server/src/lib/dailyReports.ts` — trim `buildPreMarketReport`/
  `buildPostMarketReport` bodies per §3; move `SOURCE_NOT_INTEGRATED` sections to a footer.
- New owner-only diagnostics route (`GET /api/alerts/system-health`) surfacing per-family
  last-sent/last-skipped/dedup-key/state — no secrets.
- `artifacts/scanner/src/pages/infra-health.tsx` — new "System Alert Health" section
  consuming the above (read-only, no order-placing action).
- Test files: `fnoDataHealthAlerts.test.ts`, `dailyReports.test.ts`, new tests for the
  DB-backed system-alert dedup layer, plus regression coverage for existing green suites
  (trade-alert parity, global data-health, Swing TTL).

## 5. What will NOT be touched

- F&O / Swing strategy, scoring, confluence, or threshold logic.
- Broker execution (`DISABLED` stays `DISABLED`); no real or paper orders placed by this work.
- The existing `notification_delivery_log` trade-alert dedup path (already DB-backed and
  correct) — reused as a pattern, not modified in place.
- `DAILY_ANALYSIS_COVERAGE`'s data-authenticity policy — sections that are genuinely
  unavailable stay labeled as unavailable; nothing gets fabricated or hidden from the
  full `/daily-analysis` page, only condensed in the Telegram message body.
- Manual test alert plumbing (`[MANUAL TEST]`/`[SAMPLE]`, rate limits, DB-dedup bypass) —
  already correct per Phase 6 requirements.

## 6. Implementation verdict (2026-07-03)

**Status: SHIPPED.** All five fix work-items from §4 are implemented, tested, and verified.
No F&O/Swing strategy/threshold/broker-execution changes were made; no real Telegram sends
were performed by this work (all sends in tests are mocked).

| Item | Verdict | Evidence |
|---|---|---|
| DB-backed dedup/claim layer (`systemAlertDedup.ts`) | **DONE** | `system_alert_dedup` (windowed CAS claim) + `system_alert_state` (OK/DEGRADED CAS) tables; `claimSystemAlert`/`transitionSystemAlertState`; fail-open on DB error; `dedupWindowMs=0` bypass preserved for `[MANUAL TEST]`/`[SAMPLE]`. |
| `alerting.ts` wired to claim layer | **DONE** | `dispatchTelegramBackground` claims before send; in-memory `lastAlerted` kept as same-process fast path; new in-memory skip-counter (`getSkippedAlertStats`) records every claim-denied duplicate. |
| Warmup digest (one message, not per-index) | **DONE** | `alertWarmupFailures` rewritten to one digest per 60-min window, key `FNO_WARMUP_FAILED::<istDay>`. |
| `FNO_DATA_RECOVERED` CAS transition (day-scoped, no repeat resends) | **DONE** | Extracted to `fnoDataRecoveryTransition.ts`; degrade/recover via `transitionSystemAlertState`; two same-day flaps produce two distinct incident alerts, not zero/duplicate. |
| Compact pre-market Telegram format | **DONE** | `buildPreMarketReport` matches the §3 target shape (header/body/one-line "Not included today" footer); `buildPostMarketReport` intentionally untouched (out of scope per audit). |
| Owner-only diagnostics (`GET /api/alerts/system-health`) | **DONE** | `requireOwnerStrict`-gated (no public-mode GET bypass); returns per-family CAS state, recent DB claims, in-process skipped-duplicate counter; no secrets in payload. Verified via `curl`: unauthenticated request → `401 {"error":"unauthorized","code":"AUTH_REQUIRED"}`. |
| Infra Health "System Alert Health" section | **DONE** | `infraHealth.tsx` new `SectionShell` + `deriveSystemAlertHealthSeverity` (fail if endpoint unreachable, warn if any family DEGRADED, else ok); wired into the page's `useEndpoint`/header-severity roll-up. |

**Regression coverage:**
- `artifacts/api-server`: full suite green — 2,806 tests / 148 files (`--pool=threads`, run in
  4 chunks to fit tool time limits: 888 + 525 + 759 + 634, all passing). Includes
  `fnoDataRecoveryTransition.test.ts` (7/7), `dailyReports.test.ts` (105/105),
  `alerting.test.ts` (22/22, incl. 2 new skip-counter tests), plus every pre-existing
  trade-alert/global-data-health/Swing-TTL suite unchanged and green.
- `artifacts/scanner`: full suite green — 762/762 tests (35 files), incl. 4 new
  `deriveSystemAlertHealthSeverity` cases in `infraHealth.test.ts`.
- `pnpm run typecheck`: clean across all packages (libs + every leaf artifact).
- Manual verification: unauthenticated `curl` against the new diagnostics route confirms the
  owner gate (401, no data leak); HMR live-reload of `infra-health.tsx` produced zero browser
  console errors.
- **Scope note on e2e:** a full authenticated browser walkthrough of `/infra-health` (owner
  login → visually inspect the new section with live data) was not run, because owner login
  requires the `APP_ACCESS_PASSWORD` secret value, which this agent does not and must not
  access. This is a purely additive, read-only section built with the same `SectionShell` /
  `useEndpoint` pattern as every other diagnostics section already on that page (all of which
  render correctly today), so the risk is judged low; the pure logic and route wiring are
  fully covered by the unit/integration tests above. If a visual check is wanted, sign in as
  owner and open `/infra-health` — the new "System Alert Health" card should appear at the
  bottom of the section grid.
- No real Telegram messages were sent by any test in this work — all alert-dispatch tests use
  mocked Telegram clients / log assertions, consistent with the "no real Telegram test sends
  without explicit permission" constraint.

## 7. Production verification (2026-07-03, post-publish)

Scope: read-only verification against the live deployment. No code changed, no manual/test
Telegram sends performed, no owner password accessed. Where owner login was required (UI
content, owner-only API bodies), those checks are marked **owner-manual-pending** below with
exact paths/checklists, per the task's constraint.

### 7.1 Deployment evidence (Part A)

- Workspace HEAD `55f3785` descends from fix commit `6245ddc`; production `/api/healthz` → `200`.
- Confirmed via deployment logs that the running process is on the post-fix build: log lines
  from `systemAlertDedup.ts` (`"systemAlertDedup: failed to ensure dedup tables"`),
  `fnoSignalAlerts.ts` warmup-digest path, and `requireOwnerStrict`-gated `/api/alerts/system-health`
  are all present and behaving per the new code, not the old per-index/in-memory code.
- Only a single worker PID has been observed across every log sample taken this session — no
  second concurrent replica has been seen yet, so true multi-replica dedup safety remains
  **unproven by direct observation** (the DB-CAS design is multi-replica-safe by construction,
  but that specific claim has not been exercised live).
- Frontend bundle: `/infra-health` route resolves (redirects unauthenticated users to the login
  screen, confirming the route + owner gate are live); content of the new "System Alert Health"
  card is owner-manual-pending (§7.8).

### 7.2 DB schema evidence (Part B)

| Table | Exists? | Unique/Constraint | Notes |
|---|---:|---|---|
| `system_alert_dedup` | **Yes** | `PRIMARY KEY (dedup_key)` — atomic `ON CONFLICT` claim | 0 rows as of this check. |
| `system_alert_state` | **No** | n/a | Never created in this deployment's DB. |

Root cause (from deployment logs, cross-referenced with source): `ensureSystemAlertDedupTables()`
runs both `CREATE TABLE IF NOT EXISTS` statements sequentially inside one `try` block. At cold
boot, a warning-level log (`"systemAlertDedup: failed to ensure dedup tables"`) fired concurrently
with unrelated `"Kite session read: zombie connection"` DB errors — a transient boot-time DB
connectivity hiccup, not a defect in the new code. The fact that `system_alert_dedup` exists but
`system_alert_state` does not is consistent with the first `CREATE TABLE` succeeding and the
connection dropping before the second one ran; since the exception fired before `tablesReady =
true`, that call's `claimSystemAlert` also failed and correctly fell through to **fail-open**
(the one alert this exercised — the warmup digest, §7.5 — was still sent, just without a
persisted dedup row).

Critically, `ensureSystemAlertDedupTables()` is **not a permanent latch**: `tablesReady` is a
per-process boolean that is retried on every call while still `false` (`if (tablesReady) return;`
is the only short-circuit). This is self-healing by design — the next alert-dispatch call in this
process should retry table creation and, absent another DB hiccup, succeed. No second alert event
has occurred since boot to exercise that retry, so **this self-healing has not yet been observed
succeeding live** — re-verified via direct production DB query at the end of this session:
`system_alert_dedup` still 0 rows, `system_alert_state` still does not exist (`to_regclass`
returns null). No destructive migration occurred (both tables are additive `CREATE TABLE IF NOT
EXISTS`). `notification_delivery_log` is untouched by this work and is not misused for these
claims. No secrets are stored in either table (dedup key, family, window, timestamp, PID string
only).

### 7.3 Endpoint evidence (Part C)

| Check | Result |
|---|---|
| `GET /api/alerts/system-health`, anonymous | `401` — confirmed via `curl` (`requireOwnerStrict`, no public-mode GET bypass) |
| `GET /api/alerts/system-health`, owner | **owner-manual-pending** — requires `APP_ACCESS_PASSWORD`, not accessed by this agent |
| `GET /api/data-health/global`, public | `200`, sane content (`SESSION_ACTIVE_MARKET_CLOSED`, per-module BLOCKED/reason) |
| Secrets in any response body | None observed in any endpoint checked (all payloads inspected are metadata/state only) |

The owner-body content items (alert families, last-sent/skipped, dedup keys, recovery state,
worker/process info) are covered by the route's unit/integration tests (green, §7.10) but not
independently re-verified against a live authenticated response this session.

### 7.4 Safe dedup simulation (Part D)

No safe dry-run/test-mode endpoint exists for these families (by design — sending a
`[MANUAL TEST]`/`[SAMPLE]` alert would itself be a real Telegram send, which is out of scope
without explicit owner approval). Per the spec's own fallback clause, verified via unit/
integration tests + live DB state instead:

| Alert Family | First Claim | Duplicate Claim | DB-backed? | Multi-worker Safe? | Telegram Sent (prod, this session)? |
|---|---:|---:|---:|---:|---:|
| KITE_SESSION_EXPIRED_PREOPEN | test-verified | test-verified | Yes (code path) | Yes (by design) | No — not naturally triggered yet |
| KITE_FINAL_WARNING | test-verified | test-verified | Yes (code path) | Yes (by design) | No — not naturally triggered yet |
| FNO_KITE_SESSION_MISSING | test-verified | test-verified | Yes (code path) | Yes (by design) | No — not naturally triggered yet |
| FNO_DATA_WARMUP_FAILED_DIGEST | **live-verified** | test-verified | Partial — one call hit the boot-time hiccup (§7.2) | Unproven (single replica observed) | **Yes — one digest sent, confirmed live** |
| FNO_DATA_RECOVERED | test-verified | test-verified | Yes (code path, CAS) | Yes (by design) | No — no degrade→recover transition has occurred yet |
| PREMARKET_ANALYSIS scheduled | test-verified (builder output) | n/a (day-scoped `daily_report_runs` UNIQUE, pre-existing correct path, untouched) | Yes | Yes | Owner-manual-pending — could not access `/api/daily-analysis/*` without owner login |
| PREMARKET_ANALYSIS manual test | n/a — out of scope (would require a real send) | n/a | n/a | n/a | Not attempted |

Live Telegram behavior for the five families that have not naturally fired since boot still
requires the next real trigger (a genuine Kite pre-open gap, a data outage, or a degrade→recover
cycle) to be observed and re-checked — this is the central remaining gap.

### 7.5 Warmup digest evidence (Part E)

**Confirmed live in production**, not just in tests: deployment logs from the one warmup-failure
event observed this session show exactly **one** consolidated Telegram send covering
NIFTY/BANKNIFTY/SENSEX, not three separate per-index messages — matching the intended digest
format (`⚠ F&O DATA WARMUP FAILED` / `PARTIAL`, indices-affected list, per-index reason code,
"No paper trade created. No real order placed. Broker execution disabled." footer). Only one
such event has occurred since boot, so "does not resend repeatedly for the same affected set" and
"a materially different affected set can resend" are verified by code/unit test only, not by a
second live occurrence. Reason codes were not `UNKNOWN` in the observed event. No
conditions-not-met or no-signal condition triggered a false data-issue alert during this session.

### 7.6 Kite pre-open dedup evidence (Part F)

Kite session has stayed active throughout this verification window (`data-health/global` reports
`sessionStatus: ACTIVE`), so `KITE_SESSION_EXPIRED_PREOPEN`/`KITE_FINAL_WARNING`/
`FNO_KITE_SESSION_MISSING` have not naturally fired in production since the fix was published.
Deployment-log search for these markers returned no matches. No manual/forced trigger was
attempted (would require simulating a Kite session loss, out of scope without owner approval).
Verified only via the green unit-test suite (windowed-claim + day-scoped-key logic) and the live
DB-CAS mechanism proven correct-by-code-inspection in §7.2. This family's live production
behavior is unverified pending its next natural occurrence (or an owner-approved controlled test).

### 7.7 Pre-market before/after example (Part G)

Not naturally sent again during this verification window (fires once at 08:50 IST per
`daily_report_runs` dedup); content correctness verified via the pure builder's test suite
(`dailyReports.test.ts`, 105 assertions incl. exact section-header text). No preview was generated
via a real send. For reference, the shipped format (unchanged from §3 of this document, confirmed
by `buildPreMarketReport`'s test expectations):

Before (pre-fix, all ~14 sections always inline, ~30+ lines):
```
PRE-MARKET ANALYSIS
── OVERNIGHT GLOBAL CUES ── Unavailable — data source not integrated yet
── GIFT NIFTY / SGX NIFTY ── Unavailable — data source not integrated yet
── FII / DII ACTIVITY ── Unavailable — data source not integrated yet
── INDIA VIX ── Unavailable — data source not integrated yet
── KEY LEVELS ── ...
── OPTION CHAIN ── ...
── EXPECTED RANGE ── Unavailable — data source not integrated yet
── NEWS & EVENTS ── Unavailable — data source not integrated yet
── EXPIRY / ROLLOVER ── ...
── BIAS & TRADE PLAN ── ...
```

After (shipped, compact header/body/one-line footer per §3 target shape):
```
🌅 PRE-MARKET STATUS
Date: <IST date>
Kite: ✅ Active / ❌ Missing
F&O readiness: ...
Swing staging: <N> pending
Action: ...
Not included today: GIFT Nifty, overnight global cues, FII/DII (F&O), India VIX,
news/events — provider not configured.
Broker execution: DISABLED
```

### 7.8 Infra Health UI evidence (Part H) — owner-manual-pending

Screenshot of `https://<prod-domain>/infra-health` this session confirms the route correctly
redirects an unauthenticated visitor to the login screen (no data leak, `requireOwner` gate
live). Visual content of the new "System Alert Health" card requires owner login, which this
agent does not and must not access. **Owner checklist:**

1. Sign in as owner.
2. Open `/infra-health`.
3. Scroll to the bottom of the section grid.
4. Confirm a "System Alert Health" card is present showing: per-family dedup/CAS state, last-sent
   timestamp, last-skipped-duplicate timestamp, duplicate-suppressed counts, recovery state, and
   no secrets (no bot token, no chat ID, no DB URL, no Kite token).
5. Confirm zero browser console errors on load.

### 7.9 Regression checks (Part I)

| Check | Result |
|---|---|
| Trade alert parity harness | Green — `tradeLifecycleParity.test.ts` in the 656-test targeted run |
| Global data-health endpoint | Green — `globalDataHealth.test.ts`; live `200` re-confirmed this session |
| Swing TTL lifecycle | Green — `swingTtlSweep.test.ts` in the targeted run |
| F&O signal generation unchanged | Confirmed by diff: `optionSignals.ts` change is a like-for-like swap of the in-memory `prevCycleWasDataSuppressed` boolean for `handleFnoDataSuppressionTransition` (DB-CAS) — zero change to scoring, confluence, regime, or thresholds |
| Swing strategy unchanged | No swing scoring/threshold files appear in the fix commit's diff (`git diff --stat d21e66c 6245ddc`) |
| Broker execution disabled | Confirmed — `fnoSignalAlerts.ts` digest text explicitly asserts "No paper trade created. No real order placed. Broker execution disabled."; no order-placement code touched |
| No real orders | Confirmed — no paper/broker execution files in the fix diff |
| No secrets exposed | Confirmed across all endpoints/tables checked this session |

### 7.10 Test counts (Part J)

| Command | Result |
|---|---|
| `pnpm --filter @workspace/api-server run typecheck` | Clean |
| Targeted suite: `src/lib/*alert*`, `*telegram*`, `*preMarket*`, `*fno*`, `*dataHealth*`, `*parity*`, `src/routes/**` (run via `npx vitest run --pool=threads` from inside `artifacts/api-server`, globs unquoted) | **34 files / 656 tests passed** |
| `pnpm --filter @workspace/scanner exec vitest run` | **35 files / 762 tests passed** |
| `pnpm --filter @workspace/scripts run index:llm` | Regenerated, 521 files summarized |
| `pnpm --filter @workspace/scripts run index:llm:check` | **Fresh — all 334 tracked files match** |

`typecheck:libs` is included transitively by the root `pnpm run typecheck` convention; no
composite-lib changes were made by the fix, so it was not re-run standalone this session.

### 7.11 LLM index status (Part K item 11)

Regenerated and verified fresh (§7.10) — 0 stale files, manifest timestamp matches this session.

### 7.12 Remaining limitations

- `system_alert_state` table does not exist yet in production; `system_alert_dedup` has 0 rows.
  The DB-backed claim mechanism has not completed one successful live cycle — its only live
  invocation this session hit a transient boot-time DB hiccup and correctly fell back to
  fail-open (no spam resulted, but no positive proof of the claim path succeeding either).
- Only one alert event (the F&O warmup digest) has occurred in production since the fix was
  published; the digest-consolidation behavior itself IS proven live, but the underlying
  DB-dedup persistence for that same event was not (see above).
- Multi-replica dedup safety is unproven by direct observation — only one worker PID has been
  seen in every log sample this session.
- `KITE_SESSION_EXPIRED_PREOPEN`, `KITE_FINAL_WARNING`, `FNO_KITE_SESSION_MISSING`, and
  `FNO_DATA_RECOVERED` have not naturally fired since the fix was published (Kite session has
  stayed active throughout) — their live dedup behavior is unverified pending a natural
  occurrence or an owner-approved controlled test.
- Owner-only content (`/api/alerts/system-health` authenticated body, `/infra-health` visual
  card, `/api/daily-analysis/*`) is owner-manual-pending — this agent does not and must not
  access `APP_ACCESS_PASSWORD`. Exact paths/checklists are provided in §7.3 and §7.8.
- Minor cosmetic (non-blocking) note: `alertOwnerRaw`'s `dispatchTelegramBackground` call site
  passes `family=dedupKey` (the same value), so the `family` column on warmup-digest dedup rows
  equals the day-scoped key rather than a stable label like `"fno_warmup"`. This does not affect
  the PRIMARY-KEY-based suppression itself, only family-level grouping in future diagnostics
  queries — does not block any of the above verdicts.

### 7.13 Final verdict

**`TELEGRAM_ALERT_QUALITY_DEV_VERIFIED`**

The fix is confirmed deployed to production (Part A), its non-DB-dependent behavior (warmup
digest consolidation) is confirmed working live end-to-end (§7.5), and its security gates are
confirmed live (§7.3). However, production has not yet demonstrated a successful live cycle of
the core DB-backed dedup/CAS mechanism itself: `system_alert_state` does not exist, `system_alert_dedup`
has 0 rows, and the one live alert event that touched this path hit a transient DB hiccup and
correctly fell back to fail-open rather than completing a claim. `TELEGRAM_ALERT_QUALITY_PROD_VERIFIED`
requires DB-backed dedup to be proven live — that has not happened yet, so this does not qualify.
`TELEGRAM_ALERT_QUALITY_PARTIAL_SOURCE_GAP_REMAINS` requires DB dedup to already be live with a
different item unresolved — also not met, since DB dedup itself is the unresolved item.
`TELEGRAM_ALERT_QUALITY_BUILD_NOT_DEPLOYED` is false (build is live). `ROLLBACK_REQUIRED` is false
— nothing broke, no spam occurred, no secrets leaked, broker execution stayed disabled, and the
one failure mode observed (fail-open) is the designed-safe behavior, not a regression.

**To close the gap to `PROD_VERIFIED`:** observe the next natural trigger for any of
KITE_SESSION_EXPIRED_PREOPEN / KITE_FINAL_WARNING / FNO_KITE_SESSION_MISSING / a second warmup
event / a genuine FNO_DATA_RECOVERED transition, and re-check that (a) `system_alert_state` now
exists, (b) `system_alert_dedup` accumulates a row for that event, and (c) no duplicate Telegram
send occurs for the same event within its dedup window. Owner may also request a single
explicitly-approved controlled trigger to accelerate this instead of waiting for a natural event.
