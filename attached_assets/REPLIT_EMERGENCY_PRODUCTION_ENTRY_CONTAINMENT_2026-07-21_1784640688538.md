# Emergency Production Containment — Pause New Automatic Entries Only

## Owner authorization

The owner authorizes a narrow production configuration change and one controlled production restart solely to pause new automatic paper-trade openings.

This authorization does **not** permit removal or disabling of analytical features, signal generation, portfolio visibility, exit safety, reports, charting, Telegram analysis, or any existing user-facing feature.

## Confirmed risk

Production currently runs a source tree that does not contain the remediation branch's C0/session protections. Read-only forensics reported 14 of 43 production positions as invalid-session entries.

The P0.2 fix exists only on the remediation branch and has not been deployed.

## Required outcome

Temporarily pause only new automatic paper-trade entry creation in production while preserving:

- scanners;
- Swing and F&O analysis;
- signals and reasoning;
- watchlist/staged/rejected candidate states;
- Portfolio and P&L visibility;
- manual and automated exit-only safety paths;
- force-close/orphan-close safety paths;
- reports and dashboards;
- Telegram analytical messages;
- charting and all UI tabs;
- historical rows and audit evidence.

No database row may be deleted, updated, closed, reconciled, backfilled, or reclassified during this task.

## Authorized production values

Preferred containment:

- `PAPER_TRADING_ENABLED=false`
- `LIVE_CASH_SWING_ORDER_ENABLED=false`

Confirm the exact existing broker-execution switch from source/configuration and ensure it remains disabled. Do not invent a new unused environment key.

Do not alter `REPLIT_DEPLOYMENT`.

## Stage 1 — Read-only preflight

Before changing production:

1. Capture the currently served deployment/build ID, Git SHA/tree, deployment type, and health state.
2. Capture the current remediation branch and HEAD.
3. Confirm the production deployment's current values/presence for:
   - `PAPER_TRADING_ENABLED`;
   - `LIVE_CASH_SWING_ORDER_ENABLED`;
   - the actual broker-execution switch.
4. Do not print any secret values unrelated to these boolean/mode switches.
5. Statically inspect the exact parsers and prove which string value disables each lane.
6. Prove that setting `PAPER_TRADING_ENABLED=false` blocks automatic equity and F&O openings.
7. Prove that exit-only paths do not depend on the automatic-entry flag.
8. Prove manual Close, forced exit, orphan close, and reconciliation paths that only close positions remain available.
9. Prove scanners, signals, reasoning, Portfolio, reports, UI, and analytical Telegram functions do not require automatic paper entry to be enabled.

Stop if the flag would disable exits, hide existing positions, or disable the analytical system. Do not guess.

## Stage 2 — Deployment mechanism safety check

Determine whether Replit can apply updated deployment secrets/configuration and restart the **same immutable currently served source build** without publishing the current remediation workspace.

Preferred path:

`UPDATE_DEPLOYMENT_CONFIGURATION_AND_RESTART_SAME_BUILD`

The following is forbidden:

- publishing the current remediation branch;
- publishing unreviewed P0.1/P0.2 changes;
- silently changing the served source SHA/tree;
- applying schema changes;
- copying development secrets into production;
- changing `DATABASE_URL`;
- adding test-database secrets to production;
- restarting more than once.

If Replit requires a fresh source publication from the current remediation branch to apply the setting, do not publish it. Report:

`SAME_BUILD_CONFIGURATION_RESTART_NOT_AVAILABLE`

Then stop before any production change. Do not improvise a branch merge or hotfix in this work order.

## Stage 3 — Apply narrow containment

Only if the same served source build can be retained:

1. Set production `PAPER_TRADING_ENABLED=false`.
2. Set/confirm production `LIVE_CASH_SWING_ORDER_ENABLED=false`.
3. Confirm the actual broker-execution switch remains disabled.
4. Change no other production variable.
5. Perform one controlled restart of the same build.
6. Record restart start/end time in UTC and IST.
7. Record previous and resulting build/tree identities and prove they match.

Do not send Telegram messages manually.

Do not call broker APIs manually.

Do not modify source files or Git.

## Stage 4 — Post-restart verification

Using deployment logs and read-only application/database evidence:

1. Confirm the application becomes healthy.
2. Confirm all UI/API health endpoints normally used by the deployment return successfully.
3. Confirm scanners and analytical schedulers initialize.
4. Confirm automatic equity entry lane reports disabled/blocked.
5. Confirm automatic F&O entry lane reports disabled/blocked.
6. Confirm live cash execution remains disabled.
7. Confirm broker order execution remains disabled.
8. Confirm existing positions remain visible.
9. Confirm exit-only schedulers/functions initialize or remain statically callable.
10. Confirm signal/reasoning generation remains available.
11. Check for restart-triggered Telegram sends or duplicate daily reports; report them without sending or deleting anything.

Operational database verification must be read-only:

- prove `transaction_read_only=on`;
- use `SELECT` only;
- use a finite statement timeout;
- import no application modules;
- print no connection strings;
- close the transaction after evidence collection.

Establish the containment timestamp and prove:

- zero new equity paper-trade rows opened after containment;
- zero new F&O paper-trade rows opened after containment;
- zero broker-order rows created after containment;
- zero capital-event or account-adjustment rows created by this task.

Do not interpret continued signal/reasoning/audit rows as failed containment. Those analytical features are intentionally preserved.

## Stage 5 — Feature-preservation table

Return a concise status for:

- website availability;
- all UI tabs;
- scanner refresh;
- Swing analysis;
- F&O analysis;
- signal generation;
- decision/reasoning history;
- Watchlist/staged candidates;
- Portfolio visibility;
- P&L display;
- manual Close;
- automatic exit-only safety;
- force-close safety;
- Telegram analytical service;
- pre/post reports;
- charting;
- backtesting UI;
- new AUTO equity entries;
- new AUTO F&O entries;
- live broker execution.

Expected:

- all analytical, display, reporting, and exit features remain available;
- only new automatic entry creation is paused;
- live broker execution remains disabled.

## Final report

Return one concise report containing:

1. Previous and resulting production configuration states for the three relevant switches.
2. Previous/resulting deployment build and tree identities.
3. Restart timestamp and result.
4. Feature-preservation table.
5. Read-only zero-new-entry evidence.
6. Any restart-triggered notification or monitoring side effect.
7. Confirmation no source, schema, row, or historical trade was modified.
8. Confirmation the P0.2 remediation branch remains unmerged/undeployed.

Final labels:

- `SAME_BUILD_RESTART`
- `PAPER_AUTO_ENTRY`
- `LIVE_CASH_ENTRY`
- `BROKER_EXECUTION`
- `ANALYTICAL_FEATURES`
- `EXIT_ONLY_FEATURES`
- `EXISTING_POSITIONS`
- `PRODUCTION_SOURCE_CHANGED`
- `PRODUCTION_SCHEMA_CHANGED`
- `PRODUCTION_ROWS_MUTATED_BY_TASK`
- `NEW_EQUITY_ENTRIES_AFTER_CONTAINMENT`
- `NEW_FNO_ENTRIES_AFTER_CONTAINMENT`
- `WORKFLOW_RESTART_COUNT`
- `CONTAINMENT_STATUS`

Expected final status:

`CONTAINMENT_ACTIVE_NEW_ENTRIES_PAUSED_FEATURES_PRESERVED`

## Stop conditions

Stop before production mutation if:

- the same deployed source build cannot be retained;
- applying configuration requires publishing the remediation branch;
- the flag disables exits or analytical features;
- the exact broker switch cannot be identified;
- unrelated production secrets would be changed;
- production database/schema changes are requested;
- credentials would appear in output.

Stop after the report. Do not deploy P0.2 or re-enable entries in this task.
