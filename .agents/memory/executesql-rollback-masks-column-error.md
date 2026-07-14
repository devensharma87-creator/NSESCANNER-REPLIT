---
name: executeSql "START TRANSACTION\nROLLBACK" masks a real SQL error
description: When executeSql (production/read-only mode) returns success:true with output "START TRANSACTION\nROLLBACK\n" and no rows, the query itself errored (e.g. referencing a non-existent column) — it is NOT a transient tool/connectivity flakiness.
---

Symptom: a read-only query against production via the database skill's `executeSql` returns
`{"success":true,"output":"START TRANSACTION\nROLLBACK\n", ...}` with no actual row data,
even though `success` is `true` and no exception surfaces in the tool response.

Root cause observed: the query referenced a column that does not exist on the target table
(e.g. `created_at` on a table that actually has `opened_at`). The wrapper transaction rolls
back on the underlying Postgres error, but the tool does not surface the error text — it just
shows the transaction control statements, which looks superficially like a tool glitch.

**Why:** easy to misdiagnose as "the SQL tool is flaky" and burn a retry loop, especially when
adjacent queries against the same table (that happen not to reference the bad column) succeed
fine in the same session — making it look nondeterministic rather than a straightforward
"wrong column name" error.

**How to apply:** before retrying an `executeSql` call that produced only
`START TRANSACTION\nROLLBACK`, re-verify every column name in the query against the actual
Drizzle schema (`lib/db/src/schema/*.ts`) rather than assuming transient failure. Only treat it
as flakiness if a byte-for-byte identical, schema-correct query fails intermittently.
