---
name: Canonical Telegram formatter needs per-branch wording audit
description: formatTradeTelegramMessage has separate build* functions per (domain, direction); migrating one domain to canonical does not guarantee required compliance wording survives in every branch.
---

When a message formatter has parallel branches (e.g. `buildSwingEntry` / `buildFnoEntry` / `buildSwingExit` / `buildFnoExit`), each branch must be diffed line-by-line against the legacy formatter it replaces — required compliance wording (e.g. "Broker execution: DISABLED") can silently go missing in one branch while present in the others, because unit tests only catch it if that specific branch is exercised.

**Why:** during the F&O Exit Monitoring Reliability canonical-Telegram migration (2026-07-02), `buildFnoExit` shipped without the "Broker execution: DISABLED" line that `buildFnoEntry` and the legacy `buildFnoExitAlertText` both had — caught only by a pre-existing parity test (`tradeLifecycleParity.test.ts`), not by new code review. Additionally, `buildSwingExit` has the same gap today, but is currently NOT reachable in production (swingAlerts.ts's `dispatchCanonicalEntry` only wires ENTRY events through `formatTradeTelegramMessage`; swing EXIT events aren't on the canonical path yet) — so it's a latent bug, not a live one.

**How to apply:** before marking any canonical-formatter migration done, run the full existing test suite (not just new tests) and treat any failure touching the migrated file as a real regression to fix, not a stale test to loosen. When wiring a new domain/direction onto `formatTradeTelegramMessage`, first check whether its `build*` branch already has the required disclaimer lines — `buildSwingExit` does not, as of 2026-07-02.
