---
name: Production verification pattern for owner-only endpoints
description: How to produce PROD_VERIFIED evidence when all meaningful endpoints require owner auth and Playwright can't log in as owner.
---

## The pattern

Owner-only endpoints (swing queue, Telegram preview, F&O readiness, TTL sweep) cannot be hit with production data by the agent because auth is a shared secret cookie.

**What counts as PROD_VERIFIED for such endpoints:**

1. Confirm the **production commit** matches the fix commit via `GET /api/build-info` (public).
2. Run `pnpm --filter @workspace/scripts run verify:release` — confirms checkpoint markers, no secrets, new bundle hash.
3. Hit each owner-only endpoint **anonymously** and confirm:
   - HTTP 401
   - Response body is clean JSON: `{"error":"unauthorized","code":"AUTH_REQUIRED"}`
   - Response does NOT contain raw SQL, table names, SQLSTATE, stack traces, or secrets.
4. For **Telegram dry-run payload**: run builders via `pnpm exec tsx <tmpfile.ts>` inside `artifacts/api-server/` (tsx is installed there as devDep). The `.ts` file imports directly from `./src/lib/`. This produces actual message text with no network access.
5. Run targeted regression (swing/paper/fno/daily/routes + scanner) on dev using `--pool=threads` in chunks to collect final test counts.

**Why:** Owner auth is a single shared HMAC-SHA256 cookie derived from `APP_ACCESS_PASSWORD` — there's no DB user row to elevate via executeSql. Playwright can't simulate this. The combination of (matching production commit + 401 confirms auth gate + dev test suite on same commit) is the maximum achievable evidence without real owner login.

**How to apply:** Use this pattern for every Phase 2B+ production verification cycle. Document 401 responses explicitly to prove no raw SQL escaped to anonymous callers.
