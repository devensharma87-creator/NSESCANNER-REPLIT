---
name: Drizzle wraps pg errors under .cause
description: SQLSTATE codes (e.g. 23505 unique-violation) live on err.cause, not err.code, when a query throws through drizzle-orm
---

When a query throws through drizzle-orm (this repo's `@workspace/db`), the thrown
error is a wrapper `Error` whose message is `Failed query: ...`; the real pg
error (carrying `.code`, e.g. `23505` for a unique violation) is on `err.cause`,
NOT on the top-level `err.code`.

**Why:** A unique-violation handler that only checks `err.code === "23505"`
silently fails — the duplicate insert surfaces as a generic 500 instead of the
intended 409. This bit the portfolio routes' `isUniqueViolation`.

**How to apply:** Any helper that classifies a DB error by SQLSTATE must walk
the `.cause` chain (a few levels deep), not just inspect the top-level error.
Direct (non-drizzle) pg driver calls may put `.code` on the top level, so check
both. Verify with a live-DB test that forces the constraint, since the wrapping
is only observable at runtime.
