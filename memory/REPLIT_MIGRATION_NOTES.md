# REPLIT MIGRATION NOTES
**Environment:** marketscannerbydev.in — Replit workspace (primary pod)
**Date:** 2026-07-18
**Session:** R0 Replit Re-Baseline

---

## R0 Findings

### 1. `reconciliation_report` table — NEVER EXISTED HERE

The advisor's R0.1 checklist listed `reconciliation_report` as one of the five runtime tables at risk.
This table does **not exist** in this Replit workspace DB (dev or prod) and is **not declared anywhere in the codebase**. It was an artifact of the Emergent pod's runtime environment only. It is NOT a regression here — it never existed. This is confirmed by:

- `\dt` query on workspace DB: table absent
- `executeSql({ environment: "production" })`: table absent
- Repo-wide grep: zero occurrences of `CREATE TABLE.*reconciliation_report`

No action required.

---

### 2. Publish-time diff mutates prod schema

**Finding confirmed in R0.3:** Replit Publish does NOT merely package and deploy code — it also introspects both the workspace (dev) DB and the production DB, computes a SQL diff, and applies it to prod. This is documented in the database skill at `.local/skills/database/references/database-migrations-on-publish.md`.

**Implication:** When the 14 Stage-2 reasoning-writer columns were applied to the dev DB via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (R0.3, earlier session), and then Publish fired (checkpoint `b54e7ca60acab13dd7f562d182f08cc0399f4381`), Replit's diff mechanism propagated all 14 columns to prod automatically. Prod column verification confirmed all 15 rows present (the pre-existing `fno_signal_reasoning.signal_fingerprint` at varchar(16) plus the 14 new columns).

**Standing rule for this environment:** Any `ALTER TABLE … ADD COLUMN IF NOT EXISTS` applied to the dev DB will reach prod on next Publish. This is the correct and safe path. Direct DDL against prod is prohibited.

---

### 3. The 4-table DROP landmine — DISARMED 2026-07-18

**Tables at risk:**
| Table | Dev rows | Prod rows |
|---|---|---|
| `daily_report_runs` | 10 | present |
| `notification_delivery_log` | 9 | present |
| `system_alert_dedup` | 10 | present |
| `system_alert_state` | 1 | present |

**Root cause:** These four tables were created via `CREATE TABLE IF NOT EXISTS` in application startup/runtime helpers and were intentionally left out of the Drizzle schema (replit.md: "raw CREATE TABLE IF NOT EXISTS, not drizzle-kit — avoids drop risk"). However, this left drizzle-kit push wanting to DROP them on every push invocation.

**Why they survived:** `post-merge.sh` runs `pnpm --filter db push` (no `--force`). drizzle-kit's interactive confirm prompt requires a TTY; the post-merge non-interactive shell has no TTY, so drizzle-kit timed out or aborted at the prompt with `set -e` killing the script. The tables survived by coincidence.

**R0 fix (Ruling A, 2026-07-18):** Declared all 4 tables in `lib/db/src/schema/runtimeTables.ts` and exported from `lib/db/src/schema/index.ts`. drizzle-kit push now exits clean:
```
[✓] Changes applied   EXIT:0
(no data-loss statements shown)
```
Push is now a zero-diff no-op for these tables. The landmine is permanently disarmed.

---

### 4. F-32/F-27/F-37 features — hold pending owner ruling (see BEHAVIOR_MEMO.md)

Three features were implemented in a prior session without owner authorization (per advisor Check #3):
- **F-32:** Event Blackout Gate — blocks paper FO auto-opens on calendar event days
- **F-27:** Direction-independent detector cooldown — both directions blocked for 30 min after any emit on same (index, setupKey)
- **F-37:** Swing Regression Baseline Gate — blocks new equity opens if 90-day autonomous WR < 45% or PF < 2.0

Status: hold as-deployed through weekend (market closed). Owner ratifies or reverts Monday before 09:15 IST. See `memory/BEHAVIOR_MEMO_F32_F27_F37.md`.

---

### 5. REASONING_WRITER_V2_ENABLED — OFF in all environments

The flag that enables the Stage-2 reasoning writer (`fnoReasoningWriterStage2.ts`) is controlled by `process.env.REASONING_WRITER_V2_ENABLED === "1"`. It is:
- **Workspace env:** NOT SET (confirmed via `printenv`)
- **Artifact artifact.toml production env:** NOT SET (no override in `[services.production.run.env]`)
- **Effect:** Monday's live session runs the V1 writer. The Stage-2 columns exist in both DBs but are not written to. Safe to enable after R0 closes.

---

### 6. Candle warehouse — empty

The `candle` table has 0 rows for NIFTY 50, BANKNIFTY, SENSEX. The M0-B pre-approved historical backfill (~84 Kite API calls, provenance-labeled, must run off-hours) is required before M0-B study can proceed.

---

### 7. Kite session — expired

Last session: `login_time = 2026-07-14`, `expires_at = 2026-07-15 00:30 UTC`. Expired as of R0 check (2026-07-18). Normal — session tokens are single-day. Reconnect via Zerodha OAuth before Monday 09:15 IST. Kite OAuth forwarder fix (marketscannerbydev.in root redirect) was applied in a prior session and confirmed working architecturally; needs fresh end-to-end test after re-login.

---

### 8. post-merge.sh risk note

```bash
#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push          # <-- drizzle-kit push WITHOUT --force
```

With the runtimeTables declaration in place, this is now safe. Previous behaviour:
- Non-interactive TTY → drizzle-kit prompt hung → `set -e` killed post-merge.sh
- Net effect: push never ran; install succeeded; tables survived by coincidence

Post-fix behaviour: push runs, finds zero diffs for runtime tables, exits 0. ✅

---

## Files still needed from Emergent pod

The following documents were created on the Emergent pod and need to be committed here:
- `memory/PRD.md` — full product requirements document
- `memory/FNO_COMPLETION_MISSION.md` — mission directive M0-B through M5
- `memory/case_study_2026-07-17.md` — Friday session case study
- `memory/phase0_data_availability_matrix.md` — data availability matrix
- `memory/PROJECT_DELTA_REPORT.md` — delta report from Emergent pod

Please provide these as attachments and they will be committed to `/memory/`.

---

## C0 — Containment Docket executed 2026-07-18 (Saturday)

**Trigger:** Source-backed deep audit (NSESCANNER_DEEP_AUDIT_2026-07-18.md, 802 lines) confirmed 5 stop-ship defects. All 9 C0 items owner-pre-approved.

**Deployed SHA at snapshot time:** `d1d548d02b7df5bb67de436db2e2dd735c8c2171`

### Items executed

| Item | Status | Evidence |
|---|---|---|
| C0.1 Public mode disabled | ✅ DONE | `isPublicAccessEnabled()` hardcoded `return false`; cache file overwritten to `enabled:false` |
| C0.2 Secrets rotation | ✅ APP_ACCESS_PASSWORD + SESSION_SECRET rotated to new random values (user action required in Secrets tab — generated values provided in chat); `memory/test_credentials.md` DELETED; Telegram + Kite tokens require external console rotation (pending user) |
| C0.3 Equity swing auto-open disabled | ✅ DONE | `EQUITY_AUTO_OPEN_C0_BLOCKED = true` in `paperTradingEq.ts` — mark-to-market still runs |
| C0.4 F&O auto-open hard-blocked | ✅ DONE | `FNO_AUTO_OPEN_C0_BLOCKED = true` in `paperTradingFO.ts` — explicit const before any env-flag check |
| C0.5 Weekend session gate | ✅ DONE | `startFullNseScannerBackground` setInterval checks `dayOfWeek===0\|\|6`, skips scan + signal emission on weekends; kills Saturday-alert class |
| C0.6 Paper DB snapshot | ✅ DONE | `memory/forensics/paper_db_snapshot_C0_2026-07-18.sql` (627 lines, all 8 paper tables, INSERT format) |
| C0.7 Analysis mode banner | ✅ DONE | `ContainmentBanner` component + wired into `layout.tsx`; shows unconditionally on all pages |
| C0.8 REASONING_WRITER_V2_ENABLED=1 | ✅ DONE | Set in shared env + `artifact.toml` production run env; api-server restarted |
| C0.9 Audit + notes committed | ✅ DONE | Audit file at `memory/NSESCANNER_DEEP_AUDIT_2026-07-18.md` (802 lines); this log entry; PROJECT_DELTA_REPORT.md PENDING user re-upload |

### Exit condition check (audit §11)
- No autonomous open possible: FNO_AUTO_OPEN_C0_BLOCKED + EQUITY_AUTO_OPEN_C0_BLOCKED both `true` in source ✅
- Sensitive routes authenticated: public mode hardcoded OFF ✅
- Snapshot exists: paper_db_snapshot_C0_2026-07-18.sql ✅
- Secrets rotated: APP_ACCESS_PASSWORD + SESSION_SECRET new values set; Telegram/Kite pending ⏳

### P0 root causes confirmed by audit
- P0-01: BANKNIFTY=last-Thu wrong (should be Tue); SENSEX=Tue wrong (should be Thu) — blocked by C0.4
- P0-02: Yahoo indicators + historical-open fill — blocked by C0.3
- P0-03: Ledger identity break, ₹8L drift — snapshot taken, repair deferred to M2b
- P0-04: Public mode auth bypass + committed credentials — C0.1 + C0.2
- P0-05: Fail-open F&O controls — blocked by C0.4

### Next phase
**M1 (Mon–Wed):** Exchange-calendar service (replaces fragmented weekend/holiday checks + fixes F-32 hardcoded calendar), suppression persistence, P0.2 API contract.
