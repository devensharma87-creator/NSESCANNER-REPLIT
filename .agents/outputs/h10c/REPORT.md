# H10c — Production Smoke Verification: B1/B3 Shadow Diagnostic Endpoint

**Verdict: H10b partially verified — owner response not captured**

Reason: no owner session/cookie is available in this environment, so the owner-200 payload could not be exercised live. All other smoke checks pass.

Also: `REPLIT_DEPLOYMENT` is empty in this workspace, i.e. there is **no separate production deployment** to smoke-test against. The "deployed build" being verified is the workspace `artifacts/api-server: API Server` workflow (built via `pnpm run build && pnpm run start`, the same `dist/index.mjs` path production would use). The latest published deployment logs surfaced via the deployment-logs tool were also recent enough to inspect for shadow-endpoint activity.

---

## A. Deployment / build confirmation

- `artifacts/api-server: API Server` workflow running, started cleanly.
- Esbuild bundle produced `dist/index.mjs` (5.3 MB) — same artifact production deployment would serve.
- No startup errors related to `swingShadowScore`, `swingShadowDiagnostic`, or `SWING_SHADOW_DIAG_ENABLED` in workflow startup logs.
- `REPLIT_DEPLOYMENT=""` → no separate `.replit.app` production deployment exists; verification is against the workspace build of the same code path.

## B. Endpoint availability

- Route registered at `artifacts/api-server/src/routes/stocksToWatch.ts:199` for path `/stocks-to-watch/diagnostics/swing-shadow-score`.
- Anonymous probe: `GET http://localhost:80/api/stocks-to-watch/diagnostics/swing-shadow-score` → **HTTP 401** with body `{"error":"unauthorized","code":"AUTH_REQUIRED"}`.
- Workflow logs corroborate: `req {id:114, method:"GET", url:"/api/stocks-to-watch/diagnostics/swing-shadow-score"} → statusCode 401, responseTime 1ms`.
- 1 ms response time is sub-DB / sub-network — confirms the gate fires before any work.

## C. Auth behavior

| Caller | Expected | Observed |
|---|---|---|
| Anonymous (no cookie) | 401 `AUTH_REQUIRED` | ✅ 401 `AUTH_REQUIRED` (1 ms) |
| Public-mode reader | 403 `OWNER_ONLY_DIAGNOSTIC` | Not exercised live — covered by `diagnosticRouteAuth.test.ts` matrix (case C) |
| Non-owner subscriber | 401/403 per gate | Not exercised live — covered by test matrix |
| Owner cookie | 200 with payload | **Not captured** (no owner session available) |

## D. Feature flag state

- `SWING_SHADOW_DIAG_ENABLED` is **unset** in this environment → default-ON path active. Endpoint is enabled.
- Disabled-flag behaviour covered by `diagnosticRouteAuth.test.ts > "feature-flag disabled → 200 with featureFlagEnabled:false and no computation"` (route returns early, zero DB calls).

## E. Owner response captured?

**Not captured** — no owner session/cookie is available, and per H10c rules I do not request secrets.

Owner-payload shape and per-row sanity are indirectly verified by:
- `swingShadowDiagnostic.test.ts` (32 tests, payload shape and bounded lists)
- `diagnosticRouteAuth.test.ts > "feature-flag enabled, populated DB → 200 with payload; reads LATEST scan_date only"` (verifies the route's actual end-to-end response shape against a stubbed DB cohort, including `b1ShadowScore`, `b3ShadowScore`, `b1Delta`, `b3Delta`, `dataQuality`).

## F. Response shape summary

Not captured live (see E). Schema verified via tests:
- `scanDate`, `totalRows`, `featureFlagEnabled`, `flagEnvVar`, `listCap`, `highScoreThreshold`, `cached`.
- `warningVerification` (B3 substrings observed, known non-B3, unknown).
- `b1Summary`, `b3Summary`.
- `topByLive`, `topByB1`, `topByB3`, `promotedByB1`, `promotedByB3`, `demotedByB1`, `demotedByB3`, `highScoreDemoted`, `avoidPromoted`.
- `scoreDeltaDistribution`, `dataQualitySummary`.

## G. Latest-scan / row-count match

- DB probe:
  - `SELECT MAX(scan_date) FROM swing_scan_result` → **2026-05-28**.
  - `COUNT(*)` for that date → **476**.
- Endpoint's `latestScanDate` could not be read live (owner-only), but the route's SQL (`stocksToWatch.ts`) calls the same `MAX(scan_date)` probe + `WHERE scan_date = $1::date` cohort SELECT.
- Route-level test `"reads LATEST scan_date only (no all-rows scan)"` confirms the route runs **exactly 2** DB calls (latest probe + cohort SELECT) — no all-rows scan, no joins.

## H. Warning verification

- Pre-H10c production prose-string audit (H10b Part 1) across 10 scan dates / ~4,765 rows: all 3 B3 substrings observed every date; two non-B3 strings (`Large opening gap`, `Upper-wick rejection`) catalogued.
- No silent guessing: unknown strings flow into `warningVerification.unrecognizedStrings`; isolation-test enforces `unrecognizedStrings` field surfaced.
- DB still serving the same cohort schema (`warnings` jsonb column present, latest scan date 2026-05-28 within audit window).

## I. B1/B3 row sanity samples

Not captured live (owner-only). Sample coverage verified by tests:
- High-fundamental-score row: `swingShadowScore.test.ts > "B1 adds fundamental adjustment"`.
- Overextended-warning row: `swingShadowScore.test.ts > "B3 deducts for RSI overextended substring"`.
- RS-weak warning row: `swingShadowScore.test.ts > "B3 deducts for stretched / 52w-high warnings"`.
- No-B3-warnings row: `swingShadowScore.test.ts > "B3 ≡ B1 when no penalised warnings"`.
- Missing/null-field row: `swingShadowScore.test.ts > "fail-open on null fundamentalScore / rsi14 / pctFrom52wHigh"`.

## J. Memoization sanity

Not exercised live (owner-only). Verified by `diagnosticRouteAuth.test.ts > "memo: second identical request within TTL returns cached:true and skips the DB"` — second identical call within 5-min TTL skips cohort SELECT and returns `cached:true`.

## K. Logs reviewed

- 1505 lines of `artifacts/api-server: API Server` workflow log inspected — single shadow-endpoint entry (`req 114`, 401, 1 ms). No errors, warnings, or stack traces related to `swingShadowScore` / `swingShadowDiagnostic`.
- Recent deployment-logs surface (last ~5 min) contains the standard Yahoo-chart errors and `scanAll` timeouts that pre-date H10b — none reference the shadow endpoint or the shadow modules.
- No Kite / Yahoo / outcomes / scan-trigger / intraday-refresh calls coincide with the shadow-endpoint hit.
- No DB mutation log entries (INSERT / UPDATE / DELETE) tied to the shadow endpoint.

## L. Defects found

**None.**

## M. Production-verified?

**H10b partially verified — owner response not captured.**

Everything testable without owner credentials is green:
- Route deployed, registered, responding.
- Auth gate correct (anonymous → 401 immediately, no work performed).
- No errors, no side-effect leakage in logs.
- DB latest-scan + row-count sane.
- Feature flag in default-ON state.

The only check that cannot be completed in this environment is reading an owner-authenticated `200` payload back, because no owner session/cookie is available here.

## N. No-change confirmation

H10c introduced **zero** code, schema, DB write, scheduler, workflow, UI, `replit.md`, or memory/docs changes. Verification was read-only:
- 1 HTTP GET (anonymous) → expected 401.
- 2 read-only `psql` SELECTs against `swing_scan_result`.
- Log inspection only.

Live swing scoring, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, sector scoring, delivery scoring, stock-vs-sector RS, snapshots, candle warehouse — all unchanged and untouched.

## O. Recommended next phase

**Do not start.** Choices, in the order most likely to unblock H10b full sign-off and clear the standing backlog (stopping here per H10c rules):

1. **H10c-followup (recommended)** — re-run the owner-side smoke against the actual `.replit.app` production deployment once one exists, capturing the live owner-200 payload and confirming `latestScanDate` + `totalRows` match the DB probe (matched here = `2026-05-28` / `476`). Pure verification, no code.
2. **S2b** — live intraday-refresh verification (still pending).
3. **S3b** — post-deep-scan RS benchmark verification (still pending).
4. **F&O P25** — live evidence collection (still pending).

S4c / S4d / S4e / S4f remain not approved.

---

### Evidence pointers

- Anonymous probe response: `{"error":"unauthorized","code":"AUTH_REQUIRED"}` at HTTP 401.
- Workflow log entry: `[12:46:44.142] INFO (273): request completed req:{id:114, method:"GET", url:"/api/stocks-to-watch/diagnostics/swing-shadow-score"} res:{statusCode:401} responseTime:1`.
- DB: `latest_scan_date = 2026-05-28`, `rows = 476`.
- Route source: `artifacts/api-server/src/routes/stocksToWatch.ts:199`.
- Aggregator source: `artifacts/api-server/src/lib/swingShadowDiagnostic.ts`.
- Pure scorer source: `artifacts/api-server/src/lib/swingShadowScore.ts`.
- Tests: `swingShadowDiagnostic.test.ts` (32), `diagnosticRouteAuth.test.ts` (70 incl. 4 H10b route-level), `swingShadowScore.test.ts` (40).
- Full api-server suite at H10b acceptance: **652 / 652 pass**.
