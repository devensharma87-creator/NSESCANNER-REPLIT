# Replit Coder — Phase-0 Safety Patch and Remediation Brief

Use this prompt with the complete MarketScannerByDev repository and attach the path-preserving patch ZIP.

---

You are implementing a source-backed trading-system safety remediation for an Indian market analytical platform. Preserve all existing analytical features. Do not delete a feature merely to make a test pass. Do not enable broker execution, do not place any order, and do not modify production cash/history automatically.

## Inputs

1. Complete Git repository, including root package manifest, lockfile, TypeScript/Vitest configs and migrations.
2. `NSESCANNER_PHASE0_TRUTH_SAFETY_PATCH_2026-07-18.zip`, extracted at repository root so its paths overlay matching files.
3. `NSESCANNER_FINAL_AUDIT_AND_BUILD_HANDOFF_2026-07-18.md`.

## Mandatory safety state

- Broker/live execution stays disabled before, during and after deployment.
- Paper F&O and equity **new opens** must fail closed on ledger-reconciliation failure.
- Existing positions must remain closable.
- Yahoo/fallback/unknown/stale data must never create a Swing or F&O paper/live position or trade-channel alert.
- Never silently change a contract to the “nearest” expiry for execution.
- Never reset the paper balance or rewrite historical trades to hide drift.
- Do not lower confidence, liquidity, drawdown, heat, time or cost gates to increase signal count.

## Work order

### 1. Establish reproducibility

- Create a new branch from the exact deployed commit.
- Record branch, base SHA and deployment SHA.
- Back up the database before migrations.
- Install strictly from the lockfile.
- Run existing lint, typecheck, unit, integration and build commands before applying changes; save baseline failures.

### 2. Apply and review the patch

- Extract the attached ZIP at repository root.
- Review every changed file; preserve the paths.
- Resolve type/API/schema differences against the complete repo without weakening gates.
- Confirm no source/memory/credential file from the audit evidence is copied into public artifacts.

### 3. Database prerequisites

Verify or add idempotent migrations for:

- `paper_capital_event` with append-only semantics;
- durable F&O/equity charge columns and model versions;
- indexes needed by account reconciliation;
- any runtime reconciliation table that is queried or written;
- constraints preventing negative capital-event amounts and duplicate mutation IDs.

Do not backfill a guessed capital event. Export and reconcile first.

### 4. Ledger incident procedure

For FNO and EQUITY produce:

```text
seed_capital
+ total ADD_CAPITAL
- total WITHDRAW_CAPITAL
- deployed capital on all OPEN trades
+ lifetime ledger-net P&L on CLOSED trades
= expected balance
actual paper_account.balance
drift
```

Export the ordered event/trade timeline around the first divergence. Explain the exact cause of the approximately +₹7,99,772.78 F&O drift. Propose an adjustment event only after owner approval. The application must show `LEDGER_RECONCILIATION_FAILED` and reject new opens until drift is resolved.

### 5. Required functional invariants

- NIFTY: Tuesday weekly expiry.
- BANKNIFTY: last-Tuesday monthly expiry.
- SENSEX: Thursday weekly expiry.
- Executable F&O contract requires exact master match, positive instrument token and trade-grade status.
- NSE options described as European exercise.
- F&O cost model effective 2026-04-01: 0.15% sell-premium STT, NSE 0.03503%, BSE 0.0325%; SENSEX uses BSE.
- Swing entry uses trigger-time LTP/fill policy; ATR/structure use Kite daily bars; Yahoo is research-only.
- Scanner filters BE/BZ/SM/ST and other configured special series from regular Swing equities.
- OI Lab displays LIVE only during an open exchange session with fresh data; otherwise SNAPSHOT/MARKET CLOSED.
- ΔOI=0 produces no writer-flow narrative.
- P&L period cards do not mix lifetime and selected-month metrics.
- Event blackout controls contain only confirmed dates, not tentative/approx dates.
- UI skip reason maps remain synchronized with server reasons.

### 6. Verification

Run the repository's real commands, not an ad-hoc parser only:

- lockfile install;
- schema/migration validation on a database clone;
- TypeScript typecheck;
- lint/format checks;
- unit and integration tests;
- production build;
- owner-only browser smoke tests for every route;
- Telegram test into a test chat with broker execution disabled.

Add tests where the complete repository exposes gaps:

- exact expiry/master fixtures;
- fail-closed contract/premium/chain/DB/ledger gates;
- both F&O and equity ledger gates block opens but not closes;
- source-grade parity across scanner, chart, portfolio, OI and alerts;
- market-state copy at pre-open/open/closed/weekend/special session;
- cost fixtures for NSE and BSE;
- no frontend/backend skip-reason drift;
- no coverage/percentage metric above 100%.

### 7. Runtime smoke proof

Provide authenticated endpoint samples with redacted secrets for:

- system mode and broker-disabled state;
- Kite/DB/provider health;
- F&O and equity reconciliation snapshots;
- one scanner row with provenance;
- one exact F&O contract fact;
- one OI response while market closed;
- one Swing research rejection on Yahoo fallback;
- one F&O rejection on untrusted premium;
- Telegram send receipt from the test chat.

## Required reply format

Do not reply “done” without evidence. Return:

1. Base SHA, final SHA and branch.
2. Complete changed-file list.
3. Migration list and database backup identifier.
4. Exact commands and pass/fail counts.
5. Before/after ledger identity and explanation of drift; if unresolved, say so and keep opens blocked.
6. Endpoint/sample evidence with timestamps and snapshot IDs.
7. Screenshots for every tab at desktop and mobile widths.
8. Remaining risks and the next safe phase.
9. Explicit statement: `Broker execution remains DISABLED`.

Stop and ask the owner before any historical balance correction, credential rotation that could interrupt production, destructive migration, public-mode change, or broker enablement.
