---
name: Pack 4 hardening closure
description: Fast-Track Pack 4 final hardening — 6 test files (Gates A/C/D/E/F/G-J/M/N/O), baseline/count evolution, and key test-writing patterns discovered.
---

## Final state
- api-server: 5,117 tests / 233 files (up from 4,999)
- scanner: 947 / 44 (unchanged)
- 5-package TSC: all clean
- Evidence: `artifacts/audit-evidence/FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS.md`
- Runbook: `artifacts/audit-evidence/MARKET_SCANNER_OWNER_RELEASE_AND_ROLLBACK_RUNBOOK.md`

## Key patterns discovered during Pack 4 test authoring

**Cookie format for owner sessions (critical):**
- Value is literally `"owner"` (or `"ok"`) — not a JSON payload.
- Subscriber: `"u:<userId>"` (e.g. `"u:42"`).
- Signing: `createHmac("sha256", SESSION_SECRET).update(value).digest("base64").replace(/=+$/, "")`.
- Wire format: `scanner_session=${encodeURIComponent("s:" + value + "." + sig)}`.
- `encodeURIComponent` is fine — `cookie-parser` URL-decodes values before signature verification.
- See `kiteStatusAuth.test.ts` lines 89–95 for the canonical helper.

**Why:**  getSession() in lib/userAuth.ts reads the signed cookie value directly — no DB lookup for owner sessions. Subscriber sessions are also cookie-only; DB is only consulted for tab-entitlement checks in requireSubscriberOrOwner with tabs.

**How to apply:** Any test that mounts `requireOwner`/`requireOwnerStrict` must use this exact cookie format. Tests with `requireSubscriberOrOwner(someTab)` will 500 if DB mock returns empty rows (tab check fails); either omit tabs or mock the DB entitlement query.

**Source-proof test root path:**
- Test files at `artifacts/api-server/src/lib/`.
- `path.resolve(__dirname, "../..")` = `artifacts/api-server/` (api-server root).
- `path.join(root, "../scanner/src")` = `artifacts/scanner/src`.
- `path.join(root, "../../lib/api-zod/src")` = `lib/api-zod/src` (workspace root).
- `__dirname` is the source file path in vitest (not compiled output).

**Why:** `../../..` goes 3 levels up to `artifacts/` not the api-server root. This broke all source-text proofs until the root was corrected.

**requireOwner behavior in public mode:**
- GET/HEAD: bypass (call next() without checking cookie).
- POST/PATCH/DELETE: returns 403 `PUBLIC_MODE_READ_ONLY` for anonymous (not 401).
- requireOwnerStrict: never bypasses regardless of method or public mode.
- requireSubscriberOrOwner: ALSO bypasses GET in public mode (same policy as requireOwner).

**express-rate-limit v6+ uses `limit:` not `max:`:**
- Source uses `limit: 300` not `max: 300`.
- Regex for extracting the limit: `/apiLimiter\s*=\s*rateLimit\(\s*\{[^}]*(?:limit|max):\s*(\d+)/s`.

**freshness module path:**
- File is `src/lib/marketData/freshness.ts` (not `computeFreshness.ts`).
- Contains `CLOCK_SKEW_TOLERANCE_SEC = 5` and `isFutureTimestamp`.

**executionSnapshot() in swingStaging.ts:**
- Delegates to `getSwingExecutionStatus()` from `swingLiveExecutionConfig`.
- Interface: `{ mode, liveCashSwingOrderEnabled, brokerExecutionEnabled, brokerStatus: "DISABLED", summary }`.
- Tests must mock `getSwingExecutionStatus` (not `getSwingExecutionSummary`).

**Express 404 handler needed before error handler:**
- Without a catch-all `app.use((_req, res) => res.status(404).json(...))`, undefined routes return Express's default HTML 404 page.
- Add BEFORE the 4-param error handler.

**Error handler must pass 4xx status through:**
- `express.json` errors (413 PayloadTooLarge, 400 SyntaxError) carry `err.status`.
- Error handler must check `err.status >= 400 && err.status < 500` and return that status, not blindly 500.
