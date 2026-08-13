# Phase 0.8T — Reserved VM singleton topology runbook

**Status:** prepared in development. Nothing published, nothing deployed, no billing action taken.
**Date:** 2026-08-13.

Every claim below is labelled with its evidence class:
`OBSERVED_CONFIG` (read from this repository), `OBSERVED_PLATFORM` (read from the running
workspace), `OFFICIAL_DOCUMENTATION` (docs.replit.com), `INFERRED`, `NOT_YET_VERIFIED`.

---

## 1. Why this phase exists

A live Kite feed is not like an HTTP handler. The provider counts WebSocket connections **per API
key**, and a second process holding the same key does not queue behind the first — it competes with
it, and the resulting subscription state is silently wrong. So the feed can only be activated by a
deployment topology in which a second instance of this process **cannot exist**, not one in which a
second instance is merely unlikely or is talked out of running by a lock.

Phase 0.8A established that no application-level mechanism can supply that guarantee
(`REJECTED_OWNERSHIP_MECHANISMS`: process-local lock, Postgres advisory lock, DB lease row, leader
election). Each of them is a claim made *inside* one process about what other processes are doing.
The guarantee has to come from the platform. That is the whole content of this phase.

## 2. Current topology (OBSERVED_CONFIG)

| Property | Value | Source |
| --- | --- | --- |
| Deployment target (before) | `autoscale` | `.replit` `[deployment]` |
| Router | `application` | `.replit` `[deployment]` |
| Post-build | `pnpm store prune` (CI=true) | `.replit` `[deployment.postBuild]` |
| API build | `pnpm --filter @workspace/api-server run build` (NODE_ENV=production) | `artifacts/api-server/.replit-artifact/artifact.toml` |
| API run | `node --enable-source-maps artifacts/api-server/dist/index.mjs` | same |
| Port | `PORT=8080`, `localPort = 8080`, path prefix `/api` | same |
| Health check | `/api/healthz` (startup) | same |
| Other artifacts | `scanner` (21235), `global` (20474) — static builds | respective `artifact.toml` |

Autoscale is disqualifying for a feed owner on two independent counts (OFFICIAL_DOCUMENTATION):
it may run **more than one instance concurrently**, and it **scales to zero** when idle. Either one
alone makes "exactly one always-connected process" impossible.

## 3. Target topology (OFFICIAL_DOCUMENTATION)

Reserved VM is a dedicated virtual machine that runs continuously, does not autoscale, and does not
sleep. It is the documented choice for always-on APIs, bots and long-lived connections — i.e. exactly the
"one process, always connected" shape a market feed needs. "Max machines" is an Autoscale-only
setting and does not apply.

One caveat that matters more here than anywhere else (OFFICIAL_DOCUMENTATION): on **republish**,
traffic moves from the old instance to the new one and the old instance is sent `SIGTERM` to shut
down gracefully. So a Reserved VM guarantees one *steady-state* process, not one process at every
instant — there is a bounded overlap window during cutover. That window is why the graceful-shutdown
boundary in this phase exists, and why the old process must release the feed before the new one may
claim it (Phase 0.8B).

## 4. The minimum configuration change

Exactly one functional line changed, in `.replit`:

```diff
 [deployment]
 router = "application"
-deploymentTarget = "autoscale"
+deploymentTarget = "vm"
```

`deploymentTarget` is a documented `.replit` key, and `"vm"` is the documented value for Reserved VM
(OFFICIAL_DOCUMENTATION). No other field was added, renamed or invented; build command, run command,
port, path prefix and health check are untouched, so the deployment contract is otherwise identical.

**This change is inert until someone publishes.** The currently running production deployment keeps
its existing Autoscale configuration; `.replit` is read at publish time, not by the running service.

### What cannot be set from a file (OFFICIAL_DOCUMENTATION)

Machine size (vCPU/RAM) is chosen in the Publishing UI, not in `.replit`. The owner must therefore
complete the selection by hand:

1. Open the **Publishing** / Deployments pane in the workspace.
2. Choose **Reserved VM** as the deployment type (it should already be pre-selected from `.replit`;
   if it is not, select it explicitly and treat the mismatch as a finding).
3. Open **Adjust settings** → machine power, and pick the size from the table in §5.
4. Confirm the run command shown matches
   `node --enable-source-maps artifacts/api-server/dist/index.mjs` and the health path `/api/healthz`.
5. Publish. **Not part of this phase** — publishing requires explicit owner authorization.

## 5. Cost (OFFICIAL_DOCUMENTATION — `docs.replit.com/billing/aug-cloud-billing-updates`, prices effective 2026-08-01)

Monthly figures are hourly × 24 × 30 = 720 h, rounded to the cent; taxes excluded ("prices subject
to tax depending on your location").

| Machine | Hourly | ≈ Monthly (720 h) |
| --- | --- | --- |
| 0.5 vCPU / 2 GiB | $0.0208 | $14.98 |
| **1 vCPU / 4 GiB (dedicated)** | **$0.0486** | **$34.99** |
| 2 vCPU / 8 GiB | $0.0694 | $49.97 |
| 4 vCPU / 16 GiB | $0.1806 | $130.03 |
| 8 vCPU / 32 GiB | $0.3611 | $259.99 |
| 16 vCPU / 64 GiB | $0.7222 | $519.98 |

Recommended starting size: **1 vCPU / 4 GiB ≈ $34.99/month** (INFERRED from the workload: one Node
process serving a low-traffic owner-facing API plus, later, a small number of WebSocket
connections). It can be resized later from the same UI.

Autoscale, for comparison (OFFICIAL_DOCUMENTATION): $1/month base + $0.60 per million compute units
+ $0.40 per million requests + $0.05/GiB outbound. Monthly plan credits are $25 (Core) / $40 (Teams)
and **do not roll over**.

**NOT_YET_VERIFIED:** the account's actual current Autoscale spend, and therefore the exact net delta
of the switch. The agent cannot read account billing. The owner can read it at
**Settings → Account → Account usage**. A Reserved VM is a *fixed* monthly charge that accrues
whether or not the service is used — that is the point (it never sleeps), and it is the cost
trade-off being accepted.

## 6. Rollback

| Step | Action | Blast radius |
| --- | --- | --- |
| Revert configuration | Set `deploymentTarget = "autoscale"` in `.replit` | None until republish |
| Revert running service | Republish | Returns to Autoscale billing and topology |
| Revert code | The Phase 0.8T modules are additive and unreferenced at boot; deleting them changes no running behaviour | None |

There is no data migration, no schema change and no provider state involved, so rollback is a
configuration edit plus a republish. Note that while running on Reserved VM the fixed charge accrues
until the republish completes.

## 7. What is still unproven (and why ownership stays refused)

Three of the ownership requirements are statements about a *running deployment*, and no amount of
configuration can stand in for them:

- restart **replaces** rather than overlaps (only observable across an actual republish);
- a deployment identity is available to the runtime (no such variable is exposed in the workspace —
  `REPLIT_DEPLOYMENT` itself is absent here, OBSERVED_PLATFORM);
- health checks and platform restarts cannot produce two concurrent owners.

Accordingly `evaluatePhase08tOwnership` refuses with
`RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED`, and `ownershipAdmitted` is a literal `false` in the
type system. After an actual Reserved VM publish, the owner-only endpoint
`GET /api/data-health/topology` reports what the running process can actually observe — that is the
evidence this phase is waiting for, and it cannot be produced in development.
