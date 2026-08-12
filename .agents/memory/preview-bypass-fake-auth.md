---
name: Preview bypass makes dev look signed-in while every owner API 401s
description: VITE_PREVIEW_BYPASS renders the full app shell without a session cookie, so owner-gated pages show "sign-in required" / bare "unauthorized" — diagnose before blaming route auth.
---

`VITE_PREVIEW_BYPASS=true` (the screenshot/fixture harness switch) makes `LoginGate`
return `children` immediately and installs the fetch fixture interceptor. The app
shell renders complete with nav and ADMIN/INFRA badges — but no login ever happened,
so there is no session cookie. Every owner-gated endpoint the fixtures do not cover
answers 401.

Symptoms that look like a route-auth bug but are not:
- "Credential state unknown", "Owner sign-in required", "Feed state unavailable".
- A POST returning a bare `{"error":"unauthorized","code":"AUTH_REQUIRED"}`.
- Only *some* endpoints fail — the ones the fixture interceptor does not intercept.

**Why:** public mode was hard-disabled (`isPublicAccessEnabled()` returns false
unconditionally, C0 containment). Before that, dev GETs passed without a cookie, so
the bypass was harmless and the pages appeared to work. After it, dev needs a real
cookie that the bypass never obtains — hence "it used to work on both".

**How to apply:** when an owner-only page is broken in dev but fine in production,
check the bypass *before* reading route middleware. It has two independent sources
and the environment variable wins over the file:
1. the workspace **development** env var, and
2. `artifacts/scanner/.env.development.local` (git-ignored, so it never shows in a diff).

Clearing both and restarting the scanner workflow restores the real login gate.

**Diagnostic that settles it fast:** `curl /api/auth/status` — `authenticated:false`
while the UI shows a logged-in shell proves the bypass, not a route bug. Mixed 200/401
on the *same* endpoint in one deployment log means per-client auth state, not a
server-side regression; check timestamps before concluding the endpoint is broken.
