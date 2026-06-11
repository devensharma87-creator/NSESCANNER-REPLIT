---
name: Prod read-replica lag on fresh writes
description: Production executeSql reads a replica that lags fresh row writes by minutes; don't conclude a write failed without re-querying + checking deploy logs.
---

Production `executeSql({environment:"production"})` hits a READ-ONLY REPLICA. DDL/schema (tables, columns applied at publish time) shows up promptly, but freshly-INSERTED rows can be invisible on the replica for **minutes** after the write commits on the primary.

**Why:** Replica replication lag. A verification query run seconds after a user's live action can legitimately return zero rows while the primary already has them.

**How to apply:** Before concluding "the write never happened":
1. Cross-check `fetch_deployment_logs` — a `POST ... 200` plus the app's own success marker (e.g. "Manual paper top-up (ADD_CAPITAL) ... newBalance=") proves the primary committed.
2. Re-query the replica after a longer wait (minutes, not 4s). The rows typically appear.
3. Watch for net-zero traps: an add+withdraw of the same amount leaves `balance` at baseline, so an unchanged balance does NOT mean nothing happened — confirm via the ledger rows + logs, not the balance.
