---
name: Autoscale long-request 502
description: Long synchronous compute inside an HTTP handler trips the autoscale gateway timeout (502); move it to a background task with a polled status row.
---

# Autoscale long-request 502

On this project's `autoscale` deployment (`.replit` `deploymentTarget="autoscale"`),
any HTTP handler that does heavy synchronous compute (~30s+) trips the autoscale
gateway request timeout and returns **502** in production, even though it works
fine in dev (no gateway in front). A related **500** for the same wide runs was a
separate issue (insert payload too large → fixed by batching inserts).

**Why:** the autoscale gateway caps request duration; the request returns before
the handler finishes. Wide Backtest Lab runs (Strategy Research COMPARE/ALL/2yr,
Directional/Official 2yr) were the trigger.

**How to apply:** for any endpoint whose work can exceed the gateway window,
do NOT compute inline. Insert a status row (`RUNNING`) and return `201`
immediately, run the work in a detached `void (async()=>{...})()` IIFE wrapped in
try/catch, and flip the row to `COMPLETE` (children in one tx) or `FAILED` (with
error text). The client polls `GET /:id` until terminal.
- Guard the COMPLETE write with CAS `WHERE id=? AND status='RUNNING'` so a
  stale-run watchdog (or a delete) that already closed the row can't be resurrected
  by a late-finishing worker, and children aren't written onto a terminal row.
- Make idempotency retry-able: delete a prior FAILED twin so an identical re-run
  recomputes instead of returning a permanently-cached failure.
- Live-DB regression tests must poll the run to a terminal state before asserting
  persisted children — the POST no longer completes the work synchronously.
