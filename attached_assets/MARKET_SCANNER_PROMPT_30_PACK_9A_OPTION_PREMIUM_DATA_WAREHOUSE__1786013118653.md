# MARKET SCANNER PROMPT 30 — PACK 9A OPTION-PREMIUM DATA WAREHOUSE AND CAPTURE RECOVERY

## 1. Mission

Pack 9 correctly returned `BLOCKED_PACK_9_DATA_FOUNDATION_INSUFFICIENT` because `option_chain_snapshot` contains zero rows and no ingestion runs. Repair the real option-premium capture, retention, archival and quality foundation required for professional F&O research.

This is not another strategy-design task. Do not rerun Pack 9 qualification until this pack proves that genuine, usable option-premium data is being captured and preserved.

Execute directly. Do not create another plan, approval task or speculative handoff.

## 2. Project boundary

Work only on Stock Scanner Pro:

- `artifacts/api-server/**`
- required `lib/db/**` schema/migrations;
- `artifacts/scanner/**` only for owner diagnostics if needed;
- `lib/api-zod/**` and `lib/api-client-react/**` only for diagnostics contracts;
- audit evidence.

`artifacts/global/**` is a frozen separate project and must remain untouched and excluded.

## 3. Narrow database authorization

Authorized:

- read-only forensic queries;
- non-destructive schema/migration preparation;
- append-only canary and production capture writes limited to the dedicated option-snapshot/manifest/archive infrastructure after all safety gates pass;
- cleanup of canary rows bearing a unique test-run marker, using transaction-safe exact-key deletion.

Not authorized:

- modification/deletion of paper trades, positions, P&L, ledgers, signals, swing data, sessions or unrelated operational records;
- destructive table replacement;
- deleting unarchived option snapshots;
- blanket SQL or unbounded cleanup;
- operational migration execution without preflight, backup/rollback instructions and exact affected-object inventory.

Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` unchanged. Existing DB-test safety policy remains in force.

## 4. Frozen behavior

Do not change:

- existing F&O or swing strategies;
- signals, entries, exits, stops, targets, confidence, vetoes, sizing or risk;
- current paper cohorts or history;
- provider roles: Kite canonical, Upstox shadow-only, IndianAPI fundamentals-only, Yahoo delayed retained domains;
- broker hard blocks;
- Pack 9 frozen protocol or hashes.

Do not activate `FNO_PAPER_V2` or `SWING_PAPER_V2`.

## 5. Gate 1 — Forensic root-cause analysis

Trace the complete intended option-snapshot lifecycle:

- schema and migrations;
- every writer and call site;
- scheduler/boot registration;
- market-hours and holiday gates;
- environment/config switches;
- provider/session prerequisites;
- instrument-master and expiry selection;
- rate-limit/concurrency controls;
- cache/deduplication;
- retention/sweep/archive jobs;
- health state and alerts;
- last successful/failed run evidence;
- deployment/runtime registration.

Prove why the table is empty. Classify the root cause from executable/runtime evidence, for example:

- ingestion never registered;
- disabled configuration;
- Kite session unavailable;
- writer failing;
- schema mismatch;
- all rows deleted by retention;
- archive-before-delete absent;
- provider/contract mapping failure;
- unknown with exact remaining evidence gap.

Do not assume the previous “30-day retention” explanation is the root cause when there are zero ingestion runs.

## 6. Gate 2 — Data contract for research-grade snapshots

Define one versioned canonical snapshot contract preserving at minimum:

- immutable snapshot/run ID;
- index identity and canonical instrument/token;
- spot value, source and `asOf`;
- option contract token/trading symbol;
- expiry;
- strike;
- CE/PE type;
- date-effective lot size;
- LTP;
- bid/ask and quantities where available;
- OI, OI change, volume, IV and Greeks where genuinely available;
- provider timestamp and capture timestamp;
- freshness/staleness/future classification;
- market/session state;
- data-quality flags;
- schema/version identifier;
- ingestion source and run provenance.

Never store missing data as zero. Never calculate a missing field and present it as provider-observed without a distinct modelled provenance flag. Never store credentials/raw authorization headers.

Define deterministic uniqueness/deduplication keys without overwriting distinct valid observations.

## 7. Gate 3 — Capture policy and coverage

Implement a bounded, rate-limit-safe canonical capture service for:

- NIFTY;
- BANKNIFTY;
- SENSEX.

For every active configured expiry/strike window, document:

- selection policy;
- target sampling interval;
- expected contracts/snapshot;
- expected requests/minute;
- provider entitlement/rate-limit budget;
- expected rows/session;
- expiry-roll behavior;
- strike-window expansion/contraction;
- behavior when Kite/session/instrument master is unavailable.

The policy must preserve sufficient strikes for the candidate strategies in the frozen Pack 9 protocol, including synchronized multi-leg research, without collecting unbounded irrelevant contracts.

Capture must fail closed and report a machine-readable reason. It must not substitute Yahoo, Upstox shadow or IndianAPI for trade-grade option premiums.

## 8. Gate 4 — Scheduler and operational reliability

Wire the capture service exactly once into the authoritative scheduler/bootstrap path.

Requirements:

- NSE/BSE trading-calendar aware;
- bounded start/stop times in IST;
- no duplicate intervals after restart/hot reload;
- distributed/single-owner execution protection where multiple instances are possible;
- idempotent run claims;
- bounded timeout and concurrency;
- retry only for retryable failures with jitter/backoff;
- no retry storm;
- graceful session-expiry behavior;
- restart recovery;
- run-level counters and timings;
- health/diagnostic snapshot;
- deduplicated owner alerts for capture failure and recovery.

Do not generate repetitive Telegram noise for every failed tick.

## 9. Gate 5 — Retention and archive-before-delete

Calculate observed row size and project storage for:

- one trading day;
- 30 days;
- 90 days;
- 6 months;
- 12 months;
- 24 months.

Include indexes, metadata and safety margin. Do not guess storage without measuring representative encoded rows or schema widths.

Design and implement a safe two-tier policy based on measured capacity:

- operational hot storage for recent research/monitoring;
- append-only long-term archive sufficient for professional multi-regime research, targeting at least 24 months where operationally feasible.

Archive requirements:

- partitioned by stable date/index/version identity;
- manifest containing row count, min/max timestamp, indices, expiries and schema version;
- SHA-256 or equivalent integrity hash;
- write-then-verify before source deletion;
- deletion blocked if archive/verification fails;
- deterministic restore/import tooling;
- duplicate-safe reprocessing;
- audit trail and owner-visible status.

If the required archive provider/storage is not configured, implement and test the repository-side interface, keep deletion fail-closed, and return the exact owner infrastructure requirement. Do not silently continue destructive retention.

## 10. Gate 6 — Historical backfill feasibility

Using only officially documented and currently entitled Kite, Upstox, exchange or other already-approved sources, determine whether genuine historical expired-option data can be backfilled.

Verify separately:

- expired contract discovery;
- historical candle/premium availability;
- bid/ask availability;
- OI/volume/IV/Greeks history;
- maximum lookback;
- interval coverage;
- rate limits and costs;
- legal/provider terms;
- all three indices.

Do not claim backfill based on documentation alone—perform bounded redacted capability probes where authorized.

Classify every field/domain:

- `BACKFILL_VERIFIED`;
- `BACKFILL_PARTIAL`;
- `FUTURE_CAPTURE_ONLY`;
- `NOT_ENTITLED`;
- `UNAVAILABLE`.

Never reconstruct option premiums from index movement and call them historical premiums. Modelled directional proxies remain excluded.

## 11. Gate 7 — Append-only canary capture

After Gates 1–6 and schema safety pass, run a narrowly scoped canary during market hours:

- all three indices;
- verified canonical contracts;
- at least 30 continuous minutes;
- unique run ID;
- no unrelated-table writes;
- capture interval and strike policy exactly as designed.

Prove:

- rows are actually inserted;
- each index/expiry/CE/PE is represented as expected;
- timestamps ordered and not future;
- no duplicate uniqueness violations;
- missing fields remain null/unavailable;
- spot and option identities correct;
- lot sizes date-correct;
- synchronized legs can be selected under the frozen policy;
- restart/idempotency behavior;
- health/alert recovery;
- zero impact on live signals, paper trades or broker paths.

Do not delete valid canary market data if it meets the production snapshot contract. Delete only explicitly synthetic/test-marker rows, if any, by exact keys.

If market is closed, complete all code/tests and return `LIVE_CANARY_PENDING_MARKET_WINDOW` with no fabricated proof.

## 12. Gate 8 — Data-quality monitoring and owner diagnostics

Expose an owner-only diagnostics surface containing:

- scheduler/configuration state;
- last attempted/successful capture;
- rows/contracts by index and expiry;
- expected versus actual rows;
- gaps and duplicate counts;
- stale/future/out-of-session counts;
- null availability by field;
- storage and retention age;
- archive manifests and verification status;
- last typed failure and recovery;
- research-readiness status;
- explicit `NO SIGNAL OR PAPER-TRADING IMPACT` statement.

No credentials or raw provider secrets may appear in APIs, UI, logs or bundles. Owner-only auth must be executable-tested.

## 13. Gate 9 — Load-bearing tests

Add executable tests covering at least:

1. root-cause reproduction;
2. scheduler registration exactly once;
3. market-calendar/session gating;
4. canonical contract identity;
5. strike/expiry selection;
6. date-effective lot size;
7. null versus genuine zero;
8. future/stale/out-of-session rejection;
9. uniqueness and idempotency;
10. multi-leg synchronization;
11. rate-limit/request budget;
12. retries and circuit behavior;
13. restart recovery;
14. archive-before-delete;
15. manifest hashes/counts;
16. deletion blocked on archive failure;
17. restore/deduplication;
18. storage projections;
19. backfill classifications;
20. canary isolation;
21. owner-only diagnostics;
22. zero signal/paper/broker impact;
23. zero secret leakage;
24. Global-project exclusion.

Deterministic tests use injected transports and isolated repositories. They must not contact live providers or mutate operational DB data.

## 14. Gate 10 — Verification battery

Run and record:

- API-server non-DB floor: 6,043 tests;
- scanner floor: 1,250 tests;
- typechecks: api-server, scanner, api-zod, api-client-react;
- API-server and scanner production builds;
- `git diff --check`;
- `.skip`, `.only`, retry, sleep and assertion-weakening audit;
- deterministic zero-live-call/zero-operational-write proof;
- bundle credential sentinel scan;
- confirmation existing strategy output baselines remain unchanged;
- confirmation DB lock, broker blocks and Global remain unchanged.

If a production canary is run, report the exact authorized tables, run ID, row counts and proof of zero unrelated writes.

## 15. Evidence and final verdict

Write:

`artifacts/audit-evidence/PACK_9A_OPTION_PREMIUM_DATA_WAREHOUSE_AND_CAPTURE_RECOVERY.md`

Include:

- forensic root cause;
- data contract and schema changes;
- sampling/rate-limit model;
- storage projections;
- retention/archive design;
- backfill capability matrix;
- scheduler and canary evidence;
- diagnostics screenshots at 390×844, 768×1024 and 1440×900;
- tests/builds;
- exact owner infrastructure/cost/actions;
- earliest date professional Pack 9 qualification can be rerun;
- confirmation strategies, cohorts, history, broker behavior and Global were untouched.

Final nonblank line:

`END_PACK_9A_OPTION_PREMIUM_DATA_WAREHOUSE_AND_CAPTURE_RECOVERY`

Return exactly one:

- `ACCEPT_PACK_9A_OPTION_PREMIUM_CAPTURE_AND_ARCHIVE_OPERATIONAL`;
- `PARTIAL_PACK_9A — IMPLEMENTED_CAPTURE_PENDING_ARCHIVE_INFRASTRUCTURE`;
- `PARTIAL_PACK_9A — LIVE_CANARY_PENDING_MARKET_WINDOW`;
- `BLOCKED_PACK_9A — <exact safety, provider, storage or migration blocker>`.

Do not rerun strategy qualification or activate either V2 cohort in this task. After capture is operational, SWING_PAPER_V2 may proceed through its independent activation gate while FNO_PAPER_V2 waits for sufficient real option-premium history.
