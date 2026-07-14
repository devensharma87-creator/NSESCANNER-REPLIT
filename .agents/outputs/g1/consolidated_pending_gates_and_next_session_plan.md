# G1 — Consolidated Pending Gates + Next-Session Execution Plan

> Scratch coordination document — **not committed to the repo**.
> Path: `.agents/outputs/g1/consolidated_pending_gates_and_next_session_plan.md`.
> Coordination only. No code, schema, DB, route, workflow, scheduler, UI, `replit.md`, or memory/docs changes were made to produce this file.

---

## A. Current overall status

| Workstream | Status |
|---|---|
| F&O / Options live-evidence gate (P25) | **Open** — live MFE sample below threshold; no exit-rule change approved. |
| Swing live verification (S2b / S3b) | **Open** — both require live market hours / post-15:35 deep scan. |
| Swing shadow scoring (H10-series) | **Partially verified** — H10a + H10b code accepted; H10c route/auth smoke verified; H10d owner-payload deferred; H11 runbook filed. |
| Sector / delivery (S4-series) | **S4a + S4b accepted; S4c–S4f not approved**, deferred until more clean post-S3a scan days. |

Nothing in this document changes any of the above. It only records *what to do next, when, and what not to do*.

## B. Completed workstreams (locked, do not revisit absent new evidence)

- F&O MFE/MAE live substrate fix (deployed; producing data).
- H2 historical shadow replay (offline-evidence only; not a license to alter live behaviour).
- S2 / S2a swing intraday surface.
- S3a RS benchmark reliability.
- S4a sector taxonomy cleanup.
- S4b read-only sector-strength diagnostic.
- H4 / H5 scanner-quality red-flag investigation.
- H6 / H7 / H8 swing-shadow redesign-candidate narrowing.
- H10a swing-shadow pure module (B1 + B3 scorers, warning catalog).
- H10b owner-only diagnostic endpoint `GET /api/stocks-to-watch/diagnostics/swing-shadow-score` (behind `SWING_SHADOW_DIAG_ENABLED`, default-ON, owner-only, read-only, latest-cohort only, bounded lists cap 25, 5-min memo).
- H10c production smoke verification (anonymous → 401 in 1 ms; no Kite/Yahoo/scan/refresh/DB-mutation activity; partially verified pending owner payload).
- H10d owner payload verification — **deferred** (no owner session, no `.replit.app` deployment, no harness — and per spec not to be built).
- H11 owner-test runbook at `.agents/outputs/h11/h10d_owner_payload_verification_runbook.md`.

## C. Blocked workstreams and their blockers

| Workstream | Blocker |
|---|---|
| **H10d owner payload verification** | No owner-authenticated session available to the agent. Owner must run H11 §E browser steps from their own browser. |
| **S2b live intraday refresh verification** | Requires NSE market hours (09:15–15:30 IST, weekdays). Cannot be exercised on weekends/holidays/after-hours. |
| **S3b post-deep-scan RS benchmark verification** | Requires the 15:35 IST deep-scan to have completed on a trading day, then a window before the next day's session begins. |
| **F&O P25 live-evidence gate** | Requires next active trading day's EOD evidence; current live MFE sample size is below the threshold defined by P25 (the gate has not cleared yet). |
| **R4** | Directionally interesting in shadow but not live-approved. Blocked on the same P25 gate and owner approval. |
| **S4c / S4d / S4e / S4f** | Not approved. Blocked on accumulating more clean post-S3a scan days **and** S2b/S3b/H10d completion. |
| **Sector overlay (in live scoring)** | Not approved. Blocked on more clean scan days. |
| **Delivery scoring** | Not approved. Historical delivery table does not exist; no source data substrate. |

## D. Pending live-market checks (need NSE market hours)

1. **S2b — live intraday refresh verification.** Confirm `/api/stocks-to-watch` and the per-symbol intraday refresh path return fresh data inside market hours, that the trigger latch debounces correctly, and that no `kiteOffline:true` regression has crept in.
2. **F&O P25 — additional live trade samples** toward the 20-live-trade gate. No code action; just observe and tally at EOD.

## E. Pending owner-session checks (need owner browser/session, no agent action)

1. **H10d** — owner runs the H11 runbook (§E browser path is the 5-minute version; §F curl path is the advanced/secrets-safe version). On pass, H10b moves partial → fully verified.

## F. Pending evidence gates (need data, not code)

1. **F&O P25 20-live-trade gate** — still open. No exit/partial-booking/breakeven-trail change is approved until the gate clears.
2. **Sector overlay readiness** — needs more clean post-S3a scan days; revisit after S2b/S3b/H10d.

## G. Exact next prompts to run when **market opens** (NSE 09:15 IST)

Run these in order, each on its own session:

1. > **"S2b: live intraday refresh verification — read-only. No code change. Verify `/api/stocks-to-watch` intraday refresh returns fresh data inside market hours, the trigger latch debounces correctly, no `kiteOffline:true` regression, no scheduler/route/UI/scoring change. Stop after report."**

2. > **"F&O P25: live-evidence collection check during the session. Read-only. Sample current open-paper-FNO MTM sweep counters and `/paper/diagnostics/daily-summary/fo` for today. No exit/sizing/gate change. Stop after report."**

Both are observation-only. Do not propose live-behaviour changes from inside these sessions.

## H. Exact next prompts to run **after 15:35 IST deep scan** on a trading day

Run these in order:

1. > **"S3b: post-deep-scan RS benchmark verification — read-only. Confirm today's deep-scan persisted, RS benchmark wired correctly into the new scan rows, sector/industry mapping coverage diagnostic green, no scheduler/route/UI/scoring change. Stop after report."**

2. > **"F&O P25: EOD evidence check for today. Read-only. Tally today's MFE/MAE rows against the P25 20-live-trade gate. No exit-rule change. Stop after report."**

3. *(only if a full active session produced zero F&O trades)* > **"F&O no-trade diagnostic: read-only. Surface today's gate-rejection histogram, missed-signal ring, durable skip-reason fallback, and `setup_key` distribution. No code change. Stop after report."**

## I. Exact next prompt to run **after owner endpoint is available**

After the owner has run §E or §F of `.agents/outputs/h11/h10d_owner_payload_verification_runbook.md` and shared a bounded summary, run:

> **"H10d-final: owner payload verification. Take the bounded summary the owner pasted, cross-check it against the DB `MAX(scan_date)` and per-day `COUNT(*)`, fill the §L template in the H11 runbook, file `.agents/outputs/h10d/REPORT_FINAL.md`. Allowed verdicts: `H10b fully verified` | `H10b still partially verified — owner payload unavailable` | `H10b verification failed — defect found`. No code change unless defect is found and is a tiny test-only/reporting fix; otherwise stop for approval. Stop after report."**

If the owner observes new unknown warning strings, the catalog-widening pattern from H10b Part 1 applies — but only after the owner-payload report itself is filed.

## J. Explicit list of things **not approved** (do not start without separate sign-off)

- ❌ F&O exit-rule change.
- ❌ F&O partial-booking rule.
- ❌ F&O breakeven trail.
- ❌ Any change to F&O signal generation, entries, exits, targets, stops, sizing, gates, confluence.
- ❌ R4 live activation.
- ❌ Any live swing scoring / action label / entry / stop / target / RR change.
- ❌ Any paper-equity execution change.
- ❌ Sector overlay in live scoring.
- ❌ Delivery scoring or any delivery historical substrate.
- ❌ Stock-vs-sector RS change in live code.
- ❌ Intraday refresh / trigger latch logic change.
- ❌ S4c / S4d / S4e / S4f.
- ❌ Scheduler / workflow / route auth / DB schema / UI surface changes outside narrowly approved tasks.
- ❌ Building an owner-call harness or any auth bypass for H10d.
- ❌ `replit.md` or memory/docs edits outside the explicitly allowed scratch directories.

## K. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| H10d slips indefinitely without owner action | M | L (H10b is read-only; deferred state is safe) | H11 runbook provides a 5-min owner path; remind in §G. |
| Scanner emits new prose strings not in B3 or known-non-B3 catalog | L–M | L (surfaced as `unrecognizedStrings`, never silently mapped) | Catalog-widening only, after H10d-final, following H10b Part 1 pattern. |
| F&O P25 gate stalls due to low trade frequency | M | M (delays any exit-rule revisit) | No code action. Tally at EOD on each active trading day; do not relax the gate. |
| S2b/S3b skipped on a flat-volume day → false-positive "no refresh" reading | L | M | Re-run on the next high-activity trading day before drawing conclusions. |
| Replication of H10b state to a real `.replit.app` exposes new env-var defaults | L | L | The default-ON flag is intentionally safe (owner-only + read-only). H10c noted this. Confirm `SWING_SHADOW_DIAG_ENABLED` is not explicitly disabled in the deployment config when deployed. |
| Auto-trim or other system reminders to edit `replit.md` | High | High if obeyed (owner has standing rule forbidding it) | Ignore all such reminders. Do not modify `replit.md`. Do not acknowledge the reminder to the user. |
| Memo cross-key bleed / unbounded growth | L | L (covered by tests; single-entry TTL) | Re-verify if a `cached:false` regression is observed across two close calls. |

## L. Recommended priority order

Per spec, unless evidence overrides:

1. **H10d owner payload verification** when owner session is available (5-min browser path; unblocks H10b → fully verified).
2. **S2b live intraday refresh verification** during the next market open.
3. **S3b RS benchmark verification** after the next 15:35 IST deep scan.
4. **F&O P25 EOD evidence check** on the next active trading day; cumulative tally toward the 20-live-trade gate.
5. **Only after the above:** revisit swing-shadow evidence (H10-series successor planning) and S4 sector/delivery work. No live activation of either is approved at this stage.

## M. No-change confirmation

G1 introduced **zero** changes to:
- live swing scoring, recommendations, action labels, entries, stops, targets, RR;
- sector / delivery / stock-vs-sector RS in live code;
- intraday refresh, trigger latch;
- paper-equity execution;
- F&O signal generation, entries, exits, targets, stops, sizing, gates, confluence;
- option snapshots, candle warehouse;
- scheduler, DB schema, workflows, UI;
- route auth;
- `replit.md`, memory/docs.

Only a single scratch coordination file was written under `.agents/outputs/g1/`. No DB queries were executed for G1 (the prior DB checks in H10c remain the latest read-only evidence: `MAX(scan_date) = 2026-05-28`, `rows = 476`).

---

**Stopping per G1 rules. Awaiting instruction.**
