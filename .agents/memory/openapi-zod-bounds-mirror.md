---
name: OpenAPI scalar bounds must mirror server Zod
description: Why generated-client numeric bounds must match the server's Zod validator, and how divergence slips through.
---

When a route validates its body with a Zod schema AND the OpenAPI spec describes
the same body (for codegen of the typed client + client-side zod), every scalar
`minimum`/`maximum` in OpenAPI MUST mirror the server Zod `.min()/.max()`.

**Why:** a too-permissive OpenAPI range lets a typed client construct a value the
server will reject at runtime — the type system lies. Code review treats this as a
real finding. It is easy to miss because the two definitions live in different
files (`lib/api-spec/openapi.yaml` vs the server's `*Spec.ts` Zod) and nothing
cross-checks them automatically.

**How to apply:** when you touch either side, audit ALL numeric fields on both,
not just the one you changed (grep the Zod `.min(/.max(` list and diff against the
OpenAPI `minimum/maximum` lines). Regenerate (`pnpm --filter @workspace/api-spec
run codegen`) and confirm the generated zod constant resolves to the new value.
Real example caught in re-review: `dailyCap` was Zod 1-50 but OpenAPI max 100.
