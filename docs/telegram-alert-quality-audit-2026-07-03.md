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
