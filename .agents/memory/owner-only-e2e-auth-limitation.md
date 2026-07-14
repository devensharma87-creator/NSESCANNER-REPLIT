---
name: Owner-only pages can't get a full Playwright e2e login
description: This app's owner role is a single shared APP_ACCESS_PASSWORD secret, not a DB-backed user row — the standard "[DB] elevate to admin" testing-skill trick doesn't apply.
---

# Rule
Owner access in this app is granted by POSTing the single `APP_ACCESS_PASSWORD` secret to
`/api/auth/login`, which sets a signed session cookie — there is no per-user DB row to flip
`is_admin=true` on (subscriber accounts are separate and never get `role: "owner"`). Since the
agent must never read/display secret values, and the testing subagent has no channel to it either,
a full authenticated Playwright walkthrough of an `ownerOnly: true` route (see `access-guard.tsx`)
cannot be scripted end-to-end.

**Why:** Tried the standard testing-skill pattern (`[DB] UPDATE users SET is_admin=true`) for an
owner-gated page and it does not apply here — owner isn't a user row, it's a password-derived
cookie. Confirmed via `access-guard.tsx`/`userAuth.ts`: `Session = {role:"owner"} | {role:"subscriber", userId}`.

**How to apply:**
- For additive, read-only, owner-only UI (e.g. a new Infra Health section reusing an existing
  `SectionShell`/`useEndpoint` pattern), substitute: curl-verify the route's 401/403 gate
  unauthenticated, full unit/integration test coverage of the underlying pure logic, clean
  typecheck, and an HMR/dev-server reload check for console errors — then document the e2e gap
  explicitly in the handoff rather than silently skipping it or guessing a password.
- If a true browser walkthrough is required (e.g. testing an owner-only *write* action), ask the
  user to run it themselves, or ask them to grant a scoped way to authenticate for the test — do
  not attempt to discover or brute-force the password.
