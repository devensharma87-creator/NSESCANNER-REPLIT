---
name: No provider-free boot mode in api-server
description: Why a "clean boot with zero provider calls" proof cannot be run in this repo today, and what would have to exist first.
---

The api-server has **no supported mechanism to boot without contacting external
providers**. Any directive demanding a "controlled provider-free boot" is
blocked until one is authorized and built.

What actually happens on import, before anything can be gated:

- The route index runs provider bootstrap at module-import time (Kite session
  bootstrap plus readiness/scan/ingestor schedulers), so providers start before
  the entry point regains control.
- The staggered boot scheduler fires further one-shot jobs seconds later
  (global data pump on Binance/Yahoo — credential-free, so absent API keys do
  not prevent network egress).
- Production config validation checks only session/CORS, so a boot succeeds
  with no provider credentials and still reaches out.

The only existing switches are two ingestor env flags and a config-validation
early-exit that never initializes the app at all — none of which isolate
providers from a real boot.

**Why:** discovered while trying to prove boot-time registry restoration with
zero provider or subscription side effects. Unsetting credentials, editing
startup files temporarily, or racing a short-lived process are workarounds, not
isolation, and they mislead the evidence.

**How to apply:** if a phase requires a provider-free boot, stop *before*
starting the process and report the blocker. Unblocking it means an authorized,
default-off boot mode that gates provider bootstrap and the staggered jobs at a
single documented seam — a change with its own blast radius, not a side effect
of another phase.
