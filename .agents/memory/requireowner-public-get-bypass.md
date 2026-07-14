---
name: requireOwner bypasses GET in public mode
description: Owner-only READ surfaces that expose secret/token metadata must NOT use requireOwner — it lets anonymous GET through when public-access mode is on.
---

`requireOwner` (api-server `lib/userAuth.ts`) intentionally lets anonymous `GET`/`HEAD`
through when public-access mode is enabled, so visitors can browse owner-only data
tabs read-only on a shared link. Only writes (POST/PUT/PATCH/DELETE) require a real
owner cookie in that mode.

**Why:** This is fine for "look but don't touch" data tabs, but it silently leaks
any owner-only READ response on a publicly-shared URL. A status endpoint that returns
secret/token metadata (presence, source, expiry, who-set-it) would be exposed to
anonymous visitors even though the value itself is hidden.

**How to apply:** For any owner-only surface whose READ output must never appear on a
public link (secret/token status, security internals), gate it with `requireOwnerStrict`
(never bypasses GET) — not `requireOwner`. Router-level `requireOwner` + a per-route
`requireOwnerStrict` compose correctly: the strict one runs after and enforces the owner
cookie for every method.
