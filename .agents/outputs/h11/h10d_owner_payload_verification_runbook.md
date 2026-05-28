# H10d Owner Payload Verification — Operator Runbook

> Scratch document — **not committed to the repo** unless separately approved.
> Path: `.agents/outputs/h11/h10d_owner_payload_verification_runbook.md`.

This runbook tells the **owner** exactly how to complete H10d later from a real owner-authenticated browser/session, without exposing secrets and without asking the coder to bypass auth.

---

## A. Current status

- **H10b endpoint exists and passed route/auth smoke** (H10c, anonymous probe returned `401 AUTH_REQUIRED` in ~1 ms; route registered; no startup errors related to `swingShadowScore` or `swingShadowDiagnostic`).
- **H10d owner payload verification is deferred because no owner session was available** in the agent workspace and no `.replit.app` production deployment existed at the time (`REPLIT_DEPLOYMENT` was empty).
- **No defects found.** No code, schema, DB, scheduler, workflow, UI, `replit.md`, or memory/docs changes.

## B. What is already verified

| Check | Status |
|---|---|
| Route registered at the target path | ✅ (`artifacts/api-server/src/routes/stocksToWatch.ts`) |
| Anonymous request → `401 AUTH_REQUIRED` (no DB/Kite/Yahoo work) | ✅ (1 ms response, pre-DB) |
| Strict-owner auth gate matches sibling diagnostics | ✅ (covered by `diagnosticRouteAuth.test.ts` A/B/C/D matrix) |
| Feature flag default-ON behaviour | ✅ (unset → enabled) |
| Feature flag disabled-response shape | ✅ (route-level test) |
| Reads LATEST `scan_date` cohort only (1 probe + 1 cohort SELECT, no all-rows scan) | ✅ (route-level test) |
| 5-min memo (`cached:true` on second identical call within TTL) | ✅ (route-level test) |
| Bounded lists (cap = 25), deterministic ordering | ✅ (unit tests) |
| Per-row payload fields (`b1ShadowScore`, `b3ShadowScore`, `b1Delta`, `b3Delta`, `dataQuality`, …) | ✅ (route-level test) |
| Unknown warnings surfaced (`unrecognizedStrings`), never silently mapped | ✅ (unit tests + production prose-string audit across 10 scan dates) |
| No live scoring / action / entry / stop / target / RR / paper-equity / F&O / schema / scheduler / UI changes | ✅ |
| Full api-server suite | ✅ 652 / 652 pass |
| Code review | ✅ PASS (low risk) |

## C. What remains unverified

- **Owner-authenticated `200` payload from a live call** — has never been read end-to-end against a running server with an owner session present.
- Everything in §D below has only been verified via unit/route tests against a stubbed DB cohort.

## D. Preconditions needed for owner payload verification

To run H10d successfully, **one** of the following must be true:

1. **Workspace browser session** — an owner is signed in to this workspace's app preview (`https://$REPLIT_DEV_DOMAIN`) in their own browser and can open the endpoint URL in the same tab.
2. **Deployed `.replit.app`** — a production deployment exists and the owner is signed in to it in their own browser.
3. **Approved owner-call helper** — a separately-approved read-only helper script under `scripts/src/` that takes an owner cookie value from an env var at call-time (no secret stored, no log of cookie value, no state mutation). **Not yet approved.**

Do not bypass auth. Do not request the owner password. Do not store cookies anywhere.

## E. Browser-based verification steps (recommended path)

1. **Log in normally as owner** at the usual sign-in page in your own browser (workspace preview URL or the published `.replit.app` URL).
2. **Open the endpoint URL in the same tab**:

   ```text
   https://<YOUR_DOMAIN>/api/stocks-to-watch/diagnostics/swing-shadow-score
   ```

   - For the workspace preview, `<YOUR_DOMAIN>` is the `$REPLIT_DEV_DOMAIN` value (visible in the preview URL bar).
   - For the deployed app, `<YOUR_DOMAIN>` is one of the comma-separated `$REPLIT_DOMAINS` entries (typically the `.replit.app` host).
3. **Confirm HTTP 200.** The page should render the JSON response.
4. **Capture summary keys only** — copy the top-level keys and small subtree summaries, not the full payload. Specifically capture:
   - `latestScanDate`
   - `totalRows`
   - `featureFlagEnabled`, `flagEnvVar`
   - `listCap`, `highScoreThreshold`, `cached`
   - `warningVerification` → key counts only: how many B3 substrings observed, count of `knownNonB3` matches, count of `unrecognizedStrings`
   - `b1Summary` and `b3Summary` (these are already aggregate objects)
   - For each list (`topByLive`, `topByB1`, `topByB3`, `promotedByB1/B3`, `demotedByB1/B3`, `highScoreDemoted`, `avoidPromoted`): just the **length** and the **first 2–3 symbols** to spot-check ordering
   - `scoreDeltaDistribution` (a small histogram)
   - `dataQualitySummary` (a small histogram)
5. **Confirm no trading action occurred** — no broker order, no paper trade, no scan re-trigger, no intraday-refresh trigger. (The endpoint is read-only, but eyeball the `/paper-trading` page and recent `paper_trade_*` rows just to be sure nothing moved.)
6. **Memoization check** — refresh the same URL within 5 minutes. The page should return immediately and the body should include `"cached": true`. The payload itself should be identical.

## F. Curl-based verification steps (advanced; secrets-safe)

Use this only if the owner chooses to export their session cookie **manually** from their own browser. The coder/agent must never be asked to generate, recover, or print this cookie.

**Cookie export (owner does this manually in their own browser):**
- DevTools → Application → Cookies → `<YOUR_DOMAIN>` → copy the value of the session cookie (commonly named `scanner_session`; confirm the exact name from the cookie list — do not guess).
- Paste it into a local shell variable in a private terminal (not into chat, not into a logged file):

  ```bash
  read -s OWNER_COOKIE
  # paste the cookie value, press Enter (input is hidden)
  ```

**Bounded call (prints only summary keys, never the cookie):**

```bash
curl -sS \
  -H "Cookie: scanner_session=<OWNER_COOKIE_REDACTED>" \
  "https://<DEPLOYED_DOMAIN>/api/stocks-to-watch/diagnostics/swing-shadow-score" \
  | jq '{latestScanDate, totalRows, featureFlagEnabled, flagEnvVar,
         cached, listCap,
         warningVerification: {
           b3SubstringsObservedCount: (.warningVerification.b3SubstringsObserved | length),
           knownNonB3MatchedCount:    (.warningVerification.knownNonB3Matched    | length),
           unrecognizedStringsCount:  (.warningVerification.unrecognizedStrings  | length)
         },
         b1Summary, b3Summary,
         topByLiveCount:   (.topByLive   | length),
         topByB1Count:     (.topByB1     | length),
         topByB3Count:     (.topByB3     | length),
         promotedByB1Count:(.promotedByB1| length),
         demotedByB1Count: (.demotedByB1 | length),
         promotedByB3Count:(.promotedByB3| length),
         demotedByB3Count: (.demotedByB3 | length),
         highScoreDemotedCount:(.highScoreDemoted | length),
         avoidPromotedCount:   (.avoidPromoted    | length),
         scoreDeltaDistribution,
         dataQualitySummary}'
```

**Real invocation** (replace placeholders inline; do **not** echo `$OWNER_COOKIE`):

```bash
curl -sS \
  -H "Cookie: scanner_session=${OWNER_COOKIE}" \
  "https://<DEPLOYED_DOMAIN>/api/stocks-to-watch/diagnostics/swing-shadow-score" \
  | jq '<bounded jq filter above>'
```

**Memoization check** (run twice within 5 min, confirm second call has `"cached": true`):

```bash
for i in 1 2; do
  curl -sS \
    -H "Cookie: scanner_session=${OWNER_COOKIE}" \
    "https://<DEPLOYED_DOMAIN>/api/stocks-to-watch/diagnostics/swing-shadow-score" \
    | jq '{call: '"$i"', latestScanDate, totalRows, cached}'
  sleep 5
done
```

**When done, clear the cookie variable:**

```bash
unset OWNER_COOKIE
history -d $(history 1)   # optional, if your shell records history
```

Never write the cookie to a file, never paste it into chat, never include it in a report.

## G. Expected success response shape (owner, flag-enabled)

The response is JSON. The top-level shape is:

```jsonc
{
  "featureFlagEnabled": true,
  "flagEnvVar": "SWING_SHADOW_DIAG_ENABLED",
  "scanDate": "YYYY-MM-DD",   // a.k.a. latestScanDate
  "totalRows": <number>,
  "listCap": 25,
  "highScoreThreshold": 60,
  "cached": false,            // true on a second identical call within 5 min

  "warningVerification": {
    "b3SubstringsObserved": [ /* substrings */ ],
    "allSubstringsObserved": true,
    "knownNonB3Matched":    [ /* substrings */ ],
    "unrecognizedStrings":  [ /* strings NOT in B3 catalog AND NOT in known-non-B3 catalog */ ]
  },

  "b1Summary": { /* aggregate counters: avgDelta, demotedCount, promotedCount, sameCount, … */ },
  "b3Summary": { /* aggregate counters */ },

  "topByLive":      [ { "symbol", "sector", "industry",
                        "liveScore", "liveAction",
                        "b1ShadowScore", "b3ShadowScore",
                        "b1Delta", "b3Delta",
                        "b1Reasons":[…], "b3Reasons":[…],
                        "dataQuality", "missingFields":[…] }, … ],   // length ≤ 25
  "topByB1":        [ … ],   // length ≤ 25
  "topByB3":        [ … ],   // length ≤ 25
  "promotedByB1":   [ … ],   // length ≤ 25
  "demotedByB1":    [ … ],   // length ≤ 25
  "promotedByB3":   [ … ],   // length ≤ 25
  "demotedByB3":    [ … ],   // length ≤ 25
  "highScoreDemoted":[ … ],  // length ≤ 25
  "avoidPromoted":  [ … ],   // length ≤ 25

  "scoreDeltaDistribution": { /* histogram bins */ },
  "dataQualitySummary":     { /* counts by quality bucket */ }
}
```

**Sanity rules to eyeball:**
- `scanDate` equals the DB `MAX(scan_date)`.
- `totalRows` equals the DB cohort count for that `scan_date`.
- Every list length is ≤ `listCap` (25).
- Within each list, rows are sorted **deterministically** (desc by the metric, with `symbol` ascending as tiebreaker).
- `b3ShadowScore` is `b1ShadowScore` minus accepted-penalty deductions; both are clamped 0–100.
- `liveScore` and `liveAction` are the unmodified values from the row — the endpoint must **not** alter them.

## H. Expected denied response (anonymous)

```bash
curl -sS -o /tmp/anon.json -w "HTTP=%{http_code}\n" \
  "https://<YOUR_DOMAIN>/api/stocks-to-watch/diagnostics/swing-shadow-score"
# → HTTP=401
cat /tmp/anon.json
# → {"error":"unauthorized","code":"AUTH_REQUIRED"}
```

In public-mode, expect `403 OWNER_ONLY_DIAGNOSTIC` instead of `401 AUTH_REQUIRED`.

## I. Read-only DB sanity queries

```sql
-- Latest scan date present in the swing scan cohort
SELECT MAX(scan_date) AS latest_scan_date
FROM swing_scan_result;
```

```sql
-- Row count for that latest scan date
SELECT scan_date, COUNT(*) AS rows
FROM swing_scan_result
WHERE scan_date = (SELECT MAX(scan_date) FROM swing_scan_result)
GROUP BY scan_date;
```

Run both as read-only SELECTs only. Confirm:
- Endpoint `scanDate` (a.k.a. `latestScanDate`) matches the query result.
- Endpoint `totalRows` matches the row count or, if it differs, the diff is explainable as intentional filtering (currently there is none — totals should match exactly).

## J. What logs to check

Workflow logs to scan around the time of the owner call (`artifacts/api-server: API Server`):

- ✅ One request-completed line for `GET /api/stocks-to-watch/diagnostics/swing-shadow-score` with `statusCode 200`.
- ❌ No error/stack-trace lines mentioning `swingShadowScore`, `swingShadowDiagnostic`, or `SWING_SHADOW_DIAG_ENABLED`.
- ❌ No Kite/Yahoo HTTP calls newly initiated by this endpoint.
- ❌ No `swing scan complete` / deep-scan / intraday-refresh / trigger-latch log lines coincident with the endpoint hit.
- ❌ No `INSERT`/`UPDATE`/`DELETE` log lines tied to the endpoint.
- ❌ No "unhandled unknown warning" or pattern-mapping crash.

Use the existing log-fetch path. Do not introduce new log instrumentation.

## K. What must not be done

- ❌ Do not bypass the auth gate.
- ❌ Do not request the owner password.
- ❌ Do not create test owner credentials.
- ❌ Do not store the owner cookie anywhere (file, repo, log, chat).
- ❌ Do not paste full payloads into reports — bounded summaries only.
- ❌ Do not modify production code, routes, DB, schema, workflows, UI, `replit.md`, or memory/docs.
- ❌ Do not change live swing scoring, action labels, entries, stops, targets, RR, intraday refresh, trigger latch, paper-equity, F&O signal generation/entries/exits/targets/stops/sizing/gates/confluence, sector scoring, delivery scoring, stock-vs-sector RS, snapshots, candle warehouse, or the scheduler.
- ❌ Do not add an owner-call harness unless separately approved.

## L. Exact report template for H10d-final

Fill in and file as `.agents/outputs/h10d/REPORT_FINAL.md` once verification is complete.

```markdown
# H10d (final) — Owner Payload Verification

**Verdict: <one of: H10b fully verified | H10b still partially verified — owner payload unavailable | H10b verification failed — defect found>**

## A. Environment tested
- Domain: <workspace-preview | deployed .replit.app | other>
- Build: <commit SHA or date>
- Owner access: <browser session | manual cookie export>; secrets never logged.

## B. Owner access method used
<browser tab | curl with manually exported cookie>. No coder-side cookie handling.

## C. Endpoint status
HTTP <200/…>, response time ~<n> ms, no crash.

## D. Response shape summary
- latestScanDate: <YYYY-MM-DD>
- totalRows: <n>
- featureFlagEnabled: <true|false>; flagEnvVar: SWING_SHADOW_DIAG_ENABLED
- listCap: 25; highScoreThreshold: 60; cached: <true|false>
- warningVerification: b3SubstringsObserved=<n>, knownNonB3Matched=<n>, unrecognizedStrings=<n>
- b1Summary / b3Summary present: <yes>
- Top/Promoted/Demoted/HighScoreDemoted/AvoidPromoted list lengths: <…>
- scoreDeltaDistribution / dataQualitySummary present: <yes>

## E. Latest scan / row-count match
- DB MAX(scan_date) = <…>; endpoint latestScanDate = <…>; match: <yes|no, explain>.
- DB count for that date = <…>; endpoint totalRows = <…>; match: <yes|no, explain>.

## F. Warning verification summary
- All 3 B3 substrings observed: <yes|no>.
- Known non-B3 strings matched: <n>.
- Unknown strings surfaced: <n>; truly novel? <yes|no — describe>.

## G. B1 sample sanity (3–5 rows)
For each: symbol, liveScore, liveAction, b1ShadowScore, b1Delta, b1Reasons.
Confirm: liveScore/liveAction unchanged; b1Delta == -fundamentalScore (or 0 if null and reason says "fail-open").

## H. B3 sample sanity (3–5 rows, covering: overextended / RSI-overextended / RS-weak / no-B3-warning / null-field)
For each: symbol, liveScore, liveAction, b3ShadowScore, b3Delta, b3Reasons.
Confirm: penalties only from confirmed catalog substrings; unknown strings NOT mapped; score clamped 0–100; live fields unchanged.

## I. Bounded response check
All list lengths ≤ 25: <yes|no>.
Sort determinism eyeballed on top lists: <yes|no>.

## J. Memoization sanity
Two identical calls within 5 min: second call cached=<true|false>; payload identical: <yes|no>.

## K. Logs reviewed
No endpoint errors / no Kite/Yahoo / no scan trigger / no intraday-refresh / no DB mutation / no unknown-warning crash: <confirmed | observations>.

## L. Defects found
<none | describe minimally>.

## M. H10b verification status
<fully verified | still partially verified | failed>.

## N. No-change confirmation
No code, schema, DB-write, scheduler, workflow, UI, replit.md, or memory/docs changes. Owner verification only.
```

## M. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `HTTP 401 AUTH_REQUIRED` from a logged-in browser tab | Wrong domain (cookie scoped to a different host) or session expired | Re-sign-in on the exact `<YOUR_DOMAIN>` you are hitting; confirm the session cookie is present in DevTools for that host. |
| `HTTP 403 OWNER_ONLY_DIAGNOSTIC` | App is in public-mode and the request came from a non-owner | Sign in as the owner first; public-mode readers are intentionally blocked from diagnostics. |
| `HTTP 200` but `featureFlagEnabled: false` | `SWING_SHADOW_DIAG_ENABLED` is explicitly set to `"0"`, `"false"`, `"no"`, or `"off"` | Either re-run with the flag unset / set to a truthy value, or accept the disabled-state payload as verification of the disable branch and re-run after flipping the flag. |
| `totalRows = 0`, `scanDate = null` | No `swing_scan_result` rows yet (e.g. fresh environment, or scan never ran) | Wait for the next 15:35 IST deep-scan to populate the table; confirm by re-running the DB `MAX(scan_date)` query. |
| `cached: false` on the second consecutive call | The `(scanDate, totalRows)` key changed between calls, or the 5-min TTL elapsed, or the process restarted | Confirm both calls fell within 5 min and that `scanDate`/`totalRows` matched between them; if so, capture both responses and report — this is a memo regression and a defect. |
| Unknown warning strings appearing in `unrecognizedStrings` | Scanner emitted new prose not present in either the B3 catalog or the known-non-B3 catalog | Note the exact strings in the report; the agent can later widen `KNOWN_NON_B3_WARNING_SUBSTRINGS` (catalog-widening only, no scoring change) following the H10b Part 1 pattern. |
| Sustained `5xx` from the endpoint | Bug or DB outage | Capture the full error log line (no payload), file as a defect under verdict `H10b verification failed — defect found`, do not patch automatically if route logic is affected. |
| Cannot find `$REPLIT_DEV_DOMAIN` / `$REPLIT_DOMAINS` | Running outside the Replit shell | Read the domain from the preview pane URL or the deployment dashboard. |

---

**End of runbook.** When verification is complete, file the result using template §L at `.agents/outputs/h10d/REPORT_FINAL.md`.
