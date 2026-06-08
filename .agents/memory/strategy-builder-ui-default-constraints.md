---
name: Strategy builder UI block defaults must satisfy server Zod constraints
description: Custom F&O strategy builder block-editor defaults must mirror the server's cross-field/range Zod invariants, or default selection yields a server-rejected payload.
---

The Strategy Control builder constructs each rule block from a `defaultBlock(type)` factory. Those defaults must independently satisfy every server-side Zod constraint in `customSpec.ts`, because the user can pick a block and submit immediately with no value edits.

**Why:** a `fib_zone` default shipped with `swingSpan: 20` while the schema caps `swingSpan` at `int().min(2).max(10)`, so merely selecting a Fib block produced a payload the server rejected with a 400. The mismatch is invisible to typecheck (both are `number`) and only surfaces at runtime.

**How to apply:** when adding/editing any block type in `defaultBlock`, cross-check the matching branch of the ruleBlock schema in `artifacts/api-server/src/lib/strategies/customSpec.ts` — including cross-field rules enforced in the `superRefine` (e.g. `ema_cross.fast !== slow`, `fib_zone.lo < hi`) and numeric ranges. The default must be valid on its own.
