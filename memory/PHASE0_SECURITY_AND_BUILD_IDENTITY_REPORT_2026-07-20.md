# Phase 0 Security and Build Identity Report — 2026-07-20

**Authority:** Superseding Phase 0 prompt §6.14, P0-E, P0-F  
**Status:** STATIC ANALYSIS — no credential rotation, no external calls made

---

## Build Identity

| Dimension | Value | Label |
|-----------|-------|-------|
| Repository HEAD SHA | `28ea04682f27b263311aa12fbcdee91ac6ea393d` | PROVED |
| HEAD message | "Update instructions for reviewing patch files and provisioning a test database" | PROVED |
| Deployed (published) SHA | `dafc941d00fcd63b9a64758ad1dc8b1e82eedb6e` | LIKELY (prior session) |
| Workspace preview SHA | Same as HEAD (auto-checkpoint) | LIKELY |
| Published production SHA | UNCONFIRMED — anonymous endpoint unreachable in this session | UNPROVED |
| Build info endpoint | `/api/build-info` or similar — existence unverified this session | UNPROVED |
| Environment | `REPLIT_DEPLOYMENT === "1"` in prod; workspace/dev otherwise | LIKELY |

**Gap:** Published production origin was not queried anonymously this session.  
The requirement to "query build identity anonymously from each actual public origin"  
(§3 of superseding prompt) was not fulfilled. Owner must provide the published domain URL  
for anonymous verification.

---

## P0-F: Kite Session Export Security Analysis

### `GET /api/kite/export-session` (kite.ts:155–183)

**Authentication mechanism:**  
The route bypasses the standard `requireOwner` middleware (lines 28–33 in kite.ts). Instead,  
it uses a standalone `X-App-Password` header check with `safeStrEq()`.

**Security concerns:**

| Concern | Severity | Label |
|---------|----------|-------|
| Route bypasses session cookie auth | HIGH | PROVED (lines 33, 155) |
| Returns `apiKey` and `accessToken` in JSON plaintext | HIGH | PROVED (lines 172–180) |
| Auth depends on a single shared secret (APP_ACCESS_PASSWORD) | MEDIUM | PROVED |
| No rate limiting on export endpoint | MEDIUM | LIKELY (no rate-limit middleware visible in route) |
| No audit log of successful export with token preview | MEDIUM | LIKELY |
| CORS: export endpoint reachable cross-origin (if CORS permissive) | MEDIUM | UNPROVED — requires CORS config inspection |
| Log at INFO level on success with `userId` and `requestIp` | POSITIVE | PROVED (line 181) |
| Rejects missing/wrong password with 401 | POSITIVE | PROVED (lines 162–165) |

**Current security model rationale (from code comment lines 151–154):**  
"the access_token grants full Kite REST + WebSocket access for the rest of the trading day.  
APP_ACCESS_PASSWORD is the same secret that protects the entire app login, so anyone who can  
read this can already log in and use the live data anyway."

**P0-F recommendation (Phase 1 action, NOT implemented this session):**  
- Add `requireOwnerStrict` to the export-session path, OR change to POST with owner cookie  
- Add rate limiting (e.g., 2 requests per 10 minutes from any IP)  
- Return only a redacted token (last 4 chars) in the response body; provide full token  
  only to a verified peer in an mTLS/peer-auth context  
- Add negative authorization test (anonymous GET → 401)

**Credential rotation:** NOT performed this session. Owner must determine if the Kite  
access token has been exposed via this endpoint and rotate the API key if necessary.

---

## Additional Security Items Identified (from §6.14)

| Item | Status |
|------|--------|
| CORS configuration | UNVERIFIED — requires reading app.ts/cors middleware |
| Auth bypasses for debug/admin routes | UNVERIFIED — requires full route audit |
| Build-info endpoint secret exposure | UNVERIFIED — build-info endpoint not fully inspected |
| Rate limiting on sensitive routes | UNVERIFIED |
| Public access mode + GET bypass (`requireOwner` vs `requireOwnerStrict`) | Known gap per `requireowner-public-get-bypass` memory entry |

---

## `requireOwner` vs `requireOwnerStrict` Gap (Known)

Per existing memory entry `requireowner-public-get-bypass.md`:  
- `requireOwner` bypasses GET/HEAD in public-access mode (anonymous gets through)  
- Owner-only READ surfaces exposing secret/token metadata must use `requireOwnerStrict`

The `/api/kite/status` route already uses `requireOwnerStrict` (kite.ts line visible from context).  
The export-session route bypasses BOTH (uses password header instead). This is a known gap.

---

## No Credentials Changed

**CONFIRMED:** No Kite API key, access token, APP_ACCESS_PASSWORD, session secret,  
Telegram token, or any other secret was rotated, modified, or exposed in this session.  
All secrets remain in Replit environment variable storage.
