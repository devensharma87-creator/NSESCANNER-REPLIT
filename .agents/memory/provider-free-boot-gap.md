---
name: Provider-free boot mode (DATA_FOUNDATION_BOOT_PROOF)
description: How the api-server achieves a development-only boot with zero provider/scheduler side effects, and the traps that make a "clean boot" claim false.
---

# Provider-free boot mode

A single central capability contract decides which start-up side effects a boot may
perform. One env var enables it, development only, refused under production before
the app module is imported. Capabilities are enumerated (provider network, sockets,
subscriptions, schedulers, ingestors, outbound notifications, registry restore, HTTP
listener) rather than a blanket "disable everything" switch.

**Why:** providers, sockets and schedulers in this server start as *import-time* side
effects of the route/app modules, so nothing about boot-time behaviour could be
observed in isolation. Credential-unsetting, DNS failure, monkey-patching or an
alternate entry point all produce evidence about a different program than the one
that runs in production.

**How to apply:**
- Gate at the single seam each class of side effect passes through: the staggered
  boot-job scheduler covers nearly every subsystem in one place; the remaining
  direct calls live in the route index and a handful of module-scope timers.
- Suppression must return *nothing*, never a pre-created-then-cleared timer. A timer
  allocated and thrown away makes "zero timers created" false, and a reviewer will
  (correctly) call it out.
- Production must be excluded twice: the assertion that terminates start-up, and the
  mode predicate itself returning false in production, so no suppression branch can
  ever be taken there even if the assertion is skipped.

## The traps that a real boot catches and static reading does not

- `if (process.env['NODE_ENV'] !== 'test') { ... }` at module scope is the house
  pattern for "warm this up". Every one of those blocks is an unconditional side
  effect on every non-test boot. Two of them were still reaching the network / running
  `CREATE TABLE` after the gates looked complete — a symbol-alias warm-up that pulls
  the NSE bhavcopy, and a notification-log DDL self-init. Enumerate all such blocks
  and gate each one.
- Verify with `lsof -p <pid> -a -i`, not with logs. Logs show what the code chose to
  say; open sockets show what it actually did. Expect exactly the database connection
  and the listener.
- Running the real entry point under `tsx` fails where the esbuild bundle succeeds
  (`__dirname` is undefined in ESM, and a stray test-harness import reaches the graph).
  Build the normal development bundle to a *separate* output directory so the running
  dev workflow's `dist/` is not clobbered, then run that.
