# H9 — B1 / B3 Live Shadow-Mode Planning Report (Design Only)

> **design-only / planning-only / no code / no schema / no DB writes / no live behavior change**
> No changes to swing scoring, recommendations, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, option snapshots, candle warehouse, scheduler, schema, workflows, route auth, `replit.md`, or memory/docs. No S4c / S4d / S4e / S4f activation.

## A. Accepted H8 summary (carry-in)
- **B1** (primary): `score − fundamental_score`. 1 component. No H3 dependency. Removes the score inversion (Pearson −0.211 → −0.011 on H8 sample). Smallest defensible move. Label: `candidate for future live shadow-mode planning only — not live scoring`.
- **B3** (secondary): `score − fundamental_score − extension_penalty − rs_weak_penalty`. 3 components. No H3 dependency. Flips monotonicity positive on the H8 sample (Pearson +0.034). Label: `secondary candidate for future live shadow-mode planning only — not live scoring`.
- **M6** rejected. **B4 / B5** (lagged sector overlay) deferred until H3 has ≥ 10 clean prior dates.
- Standing exposures: 0 BUY rows in evidence; 9-date mean-reverting sample; Healthcare/Logistics wrong-direction across all candidates; no held-out test split; forward-window depth 1-14 days only.

## B. B1 and B3 formulas in plain English
### B1 — Primary candidate
> *"Take the current live swing score and subtract the fundamental_score sub-component from it. The result is the B1 shadow score. Rank stocks on B1 within each scan date."*

Pseudo-formula: `shadow_b1 = score − fundamental_score`.

### B3 — Secondary candidate
> *"Take the B1 shadow score, subtract a small extension penalty (when RSI is high or the stock is right at its 52-week high or the scanner has already flagged it as extended), and subtract a fixed penalty when the scanner has already flagged relative-strength as weak."*

Pseudo-formula:
- `extension_penalty = (rsi14 > 70 ? 8 : 0) + (warnings ⊇ "extended" ? 6 : 0) + (warnings ⊇ "rsi_overext" ? 5 : 0) + (|pct_from_52w_high| ≤ 3 ? 3 : 0)`
- `rs_weak_penalty = (warnings ⊇ "rs_weak" ? 15 : 0)`
- `shadow_b3 = score − fundamental_score − extension_penalty − rs_weak_penalty`.

Constants are the same H5-derived round numbers used throughout H6 / H7 / H8 — deliberately **not re-tuned** for shadow mode, to keep the formulas inspectable and to avoid an implicit re-fitting step.

## C. Which fields are required
Per-row inputs to compute both shadow scores:

| Field | Used by B1 | Used by B3 | Used by ranking / promotion-demotion analytics |
|---|---|---|---|
| `score` | ✓ | ✓ | ✓ |
| `fundamental_score` | ✓ | ✓ |  |
| `rsi14` |  | ✓ |  |
| `pct_from_52w_high` |  | ✓ |  |
| `warnings` (must contain detectable codes for "extended", "rsi_overext", "rs_weak") |  | ✓ |  |
| `action` (live label) |  |  | ✓ (conflict/promotion analytics) |
| `sector`, `industry` |  |  | ✓ (per-sector breakdown) |
| `symbol`, `scan_date` |  |  | ✓ (PK for join + outcome match) |
| `rs_score`, `rs20`, `rs50`, `rs120` |  |  | ✓ (display only in diagnostic) |
| `close_price`, `entry`, `stop_loss`, `target1`, `target2`, `rr_to_t1` |  |  | ✓ (display only) |

## D. Which fields are already persisted
Verified in `lib/db/src/schema/swingScan.ts` (read-only inspection). All required fields are persisted on `swing_scan_result` (PK `symbol, scan_date`):

| Field | Column in `swing_scan_result` | Type | Nullable |
|---|---|---|---|
| score | `score` | numeric(6,2) | NOT NULL |
| fundamental_score | `fundamental_score` | numeric(6,2) | NOT NULL |
| rsi14 | `rsi14` | numeric(6,2) | nullable |
| pct_from_52w_high | `pct_from_52w_high` | numeric(8,2) | nullable |
| warnings (array) | `warnings` | jsonb | NOT NULL (default `[]`) |
| action | `action` | text | NOT NULL |
| sector / industry | `sector` / `industry` | text | nullable |
| symbol / scan_date | composite PK | varchar(32) / date | NOT NULL |
| rs_score, rs20, rs50, rs120 | `rs_score`, `rs20`, `rs50`, `rs120` | numeric | nullable |
| entry / stop_loss / target1 / target2 / rr_to_t1 | as named | numeric | mostly NOT NULL (rr_to_t1 nullable) |
| close_price, weekly_trend, market_structure, candle_signal | as named | numeric / text | NOT NULL (closePrice / text fields) |
| fundamental_status, technical_score, smc_score, volume_score, momentum_score, risk_score, context_score, adx14, atr14, atr_pct, vol_ratio, avg_value_lakhs, pct_from_52w_low | as named | numeric / text | mostly NOT NULL |
| reasons | `reasons` | jsonb (default `[]`) | NOT NULL |

## E. Which fields are missing
**None for B1.** **None for B3** — provided the warning-codes in the persisted `warnings` jsonb array match the labels the formula reads.

**One verification item before activation (not implementation here)**: confirm the exact string codes the scanner writes into `warnings` for "extended" / "rsi_overext" / "rs_weak". The B3 formula must consume the *same* string keys the scanner emits — a label drift would silently disable the penalties. This is a one-line `SELECT DISTINCT jsonb_array_elements_text(warnings) FROM swing_scan_result` read-only check at the moment of design lock-in. **Not part of H9 — flagged for the implementation-planning step.**

**Exclusion**: forward outcomes (return_1d/3d/5d/10d/20d, MFE, MAE) are **not** persisted today. They are computed in H4 from Yahoo daily bars. For shadow-mode evidence collection, forward outcomes need somewhere to live — see §H and §K for the no-schema and minimal-schema options.

## F. Whether shadow mode can be no-schema
**For the shadow score itself: YES — fully no-schema.** B1 and B3 are pure functions of columns that already exist on `swing_scan_result`. They can be computed on-demand at request time inside an owner-only diagnostic endpoint without persisting anything new.

**For the forward-outcome evidence side: depends on cadence.**
- **No-schema option**: re-derive outcomes on demand by fetching Yahoo daily bars at request time (same path H4 used). Slow on first request, cacheable in-process. Zero schema cost.
- **Minimal-schema option (NOT proposed for H9)**: a tiny `swing_shadow_outcome` table keyed `(symbol, scan_date)` with forward returns / MFE / MAE / shadow_b1 / shadow_b3 snapshots filled by a nightly job. Would persist evidence across restarts. **H9 does not propose this — design remains no-schema for the first iteration.**

**H9 design choice: no-schema first iteration.** If a later approval step decides on-demand outcome computation is too slow for the diagnostic endpoint, the minimal-schema option is the smallest possible follow-up — a single new table, no FK, no migration of existing rows.

## G. Computation siting decision
**Recommended: owner-only diagnostic endpoint, computed on-demand per request, no background job, no persistence.**

| Option | Verdict | Rationale |
|---|---|---|
| Inside deep scan pipeline | **No** | Couples shadow-mode to the production scoring path. Even read-only inclusion risks future regressions where a shadow column accidentally gets surfaced in a live UI. Violates "shadow must not affect live decisions" by proximity. |
| Inside separate read-only post-scan diagnostic job | **No (for first iteration)** | Adds a scheduler entry (must not change scheduler per H9 guardrails) and a persistence target. Premature until the diagnostic endpoint has proven the read pattern. |
| **Owner-only diagnostic endpoint, computed on-demand** | **Yes (recommended)** | Zero scheduler changes, zero schema changes, zero risk to production scoring. Pure read of `swing_scan_result` + pure transformation. Fail-OPEN on the diagnostic side has no live consequences. |
| Scratch / offline job | No (for live shadow-mode) | Already what H4-H8 were. The point of shadow-mode is being on the live data substrate, not on H4 snapshots. |

## H. Proposed future diagnostic endpoint response shape
**`GET /api/stocks-to-watch/diagnostics/swing-shadow-score`** — owner-only (same auth as existing `/api/stocks-to-watch/diagnostics/sector-coverage`).

**Inputs (query params, all optional)**:
- `scan_date` (default: latest available)
- `topN` (default: 20; max 100)
- `actionFilter` (one of BUY / WATCHLIST / WAIT / AVOID; default: none)
- `includeOutcomes` (default: false) — when true, fetch forward returns for `scan_date` rows that have ≥ 5 trading days of forward bars available.

**Response shape (proposed; do not implement)**:
```
{
  "scan_date": "YYYY-MM-DD",
  "computed_at": "ISO-8601 UTC",
  "total_rows": <int>,
  "feature_coverage": {
    "rsi14_non_null_pct": <0..1>,
    "pct_from_52w_high_non_null_pct": <0..1>,
    "warning_codes_seen": ["extended","rsi_overext","rs_weak", ...]
  },
  "score_delta_distribution": {
    "b1_minus_live": { "p10": ..., "p25": ..., "p50": ..., "p75": ..., "p90": ..., "min": ..., "max": ... },
    "b3_minus_live": { ... }
  },
  "top_candidates": {
    "live": [{ symbol, score, action, sector, rsi14, warnings, entry, stop_loss, target1, rr_to_t1 }, ... topN],
    "b1":   [{ symbol, shadow_b1, live_score, live_action, sector, rank_b1, rank_live, rank_change }, ... topN],
    "b3":   [{ symbol, shadow_b3, live_score, live_action, sector, rank_b3, rank_live, rank_change }, ... topN]
  },
  "promotion_demotion": {
    "promoted_by_b1": [{ symbol, live_rank, b1_rank, live_action, score, shadow_b1, sector, reason }, ...],
    "demoted_by_b1":  [{ symbol, live_rank, b1_rank, live_action, score, shadow_b1, sector, reason }, ...],
    "promoted_by_b3": [...],
    "demoted_by_b3":  [...]
  },
  "conflict_rows": {
    "live_high_score_but_b3_demoted":   [{ symbol, score, shadow_b3, live_action, b3_rank_quintile }, ...],
    "live_avoid_but_b3_promoted":       [{ symbol, score, shadow_b3, live_action, b3_rank_quintile }, ...],
    "live_top20_excluded_by_b3":        [{ symbol, score, shadow_b3, live_rank, b3_rank }, ...],
    "live_outside_top20_recovered_by_b3":[{ symbol, score, shadow_b3, live_rank, b3_rank }, ...]
  },
  "outcome_evidence": null | {  // present iff includeOutcomes=true AND ≥5 forward TDs available
    "n_with_r5": <int>,
    "live_top20_avg_5d_return": ..., "b1_top20_avg_5d_return": ..., "b3_top20_avg_5d_return": ...,
    "live_top20_avg_mfe_5d": ...,  "b1_top20_avg_mfe_5d": ...,  "b3_top20_avg_mfe_5d": ...,
    "live_top20_avg_mae_5d": ...,  "b1_top20_avg_mae_5d": ...,  "b3_top20_avg_mae_5d": ...,
    "overlap_b1_live_top20": <0..1>, "overlap_b3_live_top20": <0..1>,
    "promoted_b1_avg_5d_return": ..., "demoted_b1_avg_5d_return": ...,
    "promoted_b3_avg_5d_return": ..., "demoted_b3_avg_5d_return": ...,
    "buy_class_rows": <int>,
    "buy_class_b1_vs_live_delta_5d": ..., "buy_class_b3_vs_live_delta_5d": ...
  }
}
```

Failure modes: fail-OPEN with `{ error: "...", computed_at: "..." }`. No retries, no caching beyond a 5-min in-process memo. **No DB writes ever**, even for the in-process memo. Diagnostic-endpoint downtime has zero live consequence.

## I. Proposed future daily evidence metrics (no scheduler change here)
These metrics are produced **on-demand** by the diagnostic endpoint above (when `includeOutcomes=true`). They are *not* persisted, and *no* new daily job is proposed. Owner inspects via the endpoint; evidence accumulates outside the system (in operator-collected snapshots) until accumulated evidence justifies a planning revisit.

Per scan_date, when ≥ 5 trading days of forward bars exist:
- Live top-20 / B1 top-20 / B3 top-20: avg 5D return, avg 5D MFE, avg 5D MAE.
- Live WATCHLIST/BUY rows: avg 5D return + n.
- B1-promoted / B1-demoted rows: avg 5D return + n.
- B3-promoted / B3-demoted rows: avg 5D return + n.
- Overlap rate (top-20-live ∩ top-20-B1) / |top-20-live| ; same for B3.
- Promotion quality: avg 5D return of promoted rows vs avg 5D return of demoted rows (target: promoted > demoted).
- Demotion quality: of rows live-classified WATCHLIST/BUY but B3-demoted, what % had 5D return < −2 %.
- BUY-class regression test: avg 5D return of live-BUY rows vs avg 5D return of B1/B3-promoted BUY rows (target: shadow ≥ live).
- Per-sector tilt: ΔQ5−Q1 by sector with n ≥ 15 rows in the date window.

No persistence. No new scheduler entry. No new background job.

## J. Proposed activation gates (design only — do not interpret as approval)
**None of these gates are met today.** They are listed so that a future approval discussion has a yardstick.

| Gate | Required value | Currently |
|---|---|---|
| Clean post-S3a deep scan dates | ≥ 20 | 8 (H8 sample) |
| Clean post-S3a RS days (sector-leader stable) | ≥ 10 | 2 (5-19, 5-26) |
| Forward outcome depth | ≥ 60 trading days | 1-14 days |
| Out-of-sample monotonicity test (B1 vs B0; B3 vs B0) | B1/B3 Pearson(shadow, return_5d) ≥ 0 on a 70 / 30 date split | not yet runnable (need ≥ 30 distinct dates) |
| BUY-class regression test | B1 ≥ live AND B3 ≥ live on avg 5D return for live-BUY rows | 0 BUY rows in current evidence — gate **cannot be evaluated** |
| Sector-specific failure check | no sector with n ≥ 30 shows ΔPearson < −0.10 for the candidate vs B0 | Healthcare (n=27) and Logistics (n=26) currently negative but below 30-row threshold |
| Trending-regime re-evaluation | ≥ 1 trending-tape week in the evidence (regime classifier confirms TRENDING) | sample is mean-reverting only |
| Owner approval | required, explicit, written | not yet sought |

Compound gate: **all of the above must hold simultaneously** before even shadow-mode activation is considered. The activation gate for live scoring change is a separate, stricter step that is **not** part of this design.

## K. Proposed rollback / safety posture
Because the proposed siting is "owner-only diagnostic endpoint, computed on-demand, no persistence", the rollback surface is trivial:

| Trigger | Action | Live impact |
|---|---|---|
| Diagnostic endpoint returns errors | Endpoint already fail-OPEN | none |
| Diagnostic endpoint computes wrong numbers | Disable the endpoint route (single feature-flag env var, e.g. `SWING_SHADOW_DIAG_ENABLED=false`, default true) | none |
| Operator wants to remove the feature entirely | Delete the route handler + the pure module | none |
| Live scoring drift suspected | Inspect — but production scoring path **does not read** the shadow module, so it cannot drift live behavior | none |
| Forward-outcome fetch slow / Yahoo rate-limited | `includeOutcomes=true` returns `outcome_evidence: null` and a 503-style note in the body; rest of response unaffected | none |

**Guaranteed isolation properties** (must be enforced by code review at implementation time, not assumed):
- The shadow module must be importable only from the new diagnostic route — no other route, no `swingScannerStore`, no `swingScanner.ts`, no paper-equity code, no F&O code.
- The shadow module must perform read-only SELECTs against `swing_scan_result` — no UPDATE, no INSERT, no DELETE.
- No mutation of any imported row object.
- No write to the in-process scanner cache.
- No call to `fetchOptionChain`, no call to Kite/Yahoo writers, no scheduler interaction.
- No effect on action labels, recommendations, entries, stops, targets, RR, trigger latch, intraday refresh, or paper-equity execution.

## L. Recommended implementation phases (if and only if later approved)
Order is chosen so each phase is independently rollback-able and so the cheapest evidence-collection step ships first.

### Phase 1 — Pure module + warning-code verification
- Add `artifacts/api-server/src/lib/swingShadowScore.ts` exporting `computeShadowB1(row)`, `computeShadowB3(row)`, and a `summariseShadowSlice(rows, opts)` aggregator. Pure functions only — no DB, no fetch.
- Add unit tests (`vitest`) for the four-piece extension_penalty + the rs_weak_penalty + the headline B1/B3 formulas. ~10-15 tests.
- One-shot read-only verification: `SELECT DISTINCT jsonb_array_elements_text(warnings) FROM swing_scan_result WHERE scan_date > now() − interval '30 days'` to lock the exact warning-code strings the formulas must consume.
- No new route, no new schema, no scheduler change. **No live behavior change.**

### Phase 2 — Owner-only diagnostic endpoint (no outcomes)
- Wire `GET /api/stocks-to-watch/diagnostics/swing-shadow-score` to the pure module + an existing read-only Drizzle query against `swing_scan_result`.
- `includeOutcomes` ignored / always false in this phase.
- 5-min in-process memo, no DB write.
- Owner-only auth (same gate as the other `/diagnostics/*` routes).
- Feature flag `SWING_SHADOW_DIAG_ENABLED` (default true). **No live behavior change.**

### Phase 3 — Read-only UI surface on `/infra-health`
- New section "Swing Shadow Score (B1 / B3)" alongside existing infra-health sections. Read-only, owner-only.
- Renders the Phase 2 endpoint output. No interactivity beyond `scan_date` / `topN` / `actionFilter`. **No live behavior change.**

### Phase 4 — Outcome evidence (on-demand, no schema)
- Add `includeOutcomes=true` support to the Phase 2 endpoint. Outcomes computed on-demand from Yahoo daily bars (same path H4 used). Cached for the duration of the in-process memo only.
- Fail-OPEN with `outcome_evidence: null` on Yahoo issues.
- **No live behavior change.**

### Phase 5 (deferred indefinitely) — Persistent shadow evidence
- *Only* if Phase 4 proves on-demand Yahoo fetch too slow or too noisy across operator inspections.
- Minimal-schema option: new table `swing_shadow_outcome (symbol, scan_date, computed_at, shadow_b1, shadow_b3, return_5d, mfe_5d, mae_5d)`, no FK, no migration of existing rows.
- Filled by a *new* job — would require approval to touch the scheduler, which is currently disallowed.
- **NOT recommended for the first iteration. Listed only for completeness.**

## M. What should not be implemented yet
- Any live scoring change.
- Any live action label change.
- Any change to entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity execution, F&O signals/entries/exits/sizing/gates/confluence, option snapshots, candle warehouse, scheduler, schema, workflows, route auth, `replit.md`, memory/docs.
- Phase 5 (persistent shadow evidence + new scheduler job).
- The B4 / B5 lagged sector-leader overlay (H8 deferred until ≥ 10 H3 clean prior dates).
- Any sector overlay on live scoring (deferred indefinitely).
- Re-tuning of the H5 constants for shadow mode (would be an implicit re-fitting step).
- Any change of warning-code strings emitted by the scanner — codes must remain stable for the shadow formulas to keep consuming them.
- S4c / S4d / S4e / S4f.

## N. What still requires live verification (carry-forward)
- **S2b** live intraday refresh verification — pending, unchanged.
- **S3b** post-deep-scan RS benchmark verification — pending, unchanged. Resolution of S3b is a **prerequisite** for B4/B5 ever becoming candidates.
- **F&O P25** live evidence collection (3 / 20) — pending, unchanged, unrelated to swing redesign.
- **≥ 20 clean scan dates** of post-S3a data before any out-of-sample test split is meaningful.
- **≥ 60 trading days** of forward outcome depth before monotonicity claims can be generalised.
- **Trending-regime sample** — current evidence is mean-reverting only; B1's fundamentals-subtraction direction may invert in trending tape.
- **Material BUY-class coverage** — current evidence has 0 BUY rows; H8 verdict for BUY behavior is "untested".
- **Healthcare / Logistics direction** — both currently wrong-direction across all candidates; needs n ≥ 30 to be decision-grade either way.
- **Warning-code stability audit** — Phase 1 prerequisite (lock exact `warnings` array codes before the B3 formula consumes them).
- **Yahoo / Kite source reconciliation** for outcome bars — accepted as noise contributor in H4 / H7, would re-surface in Phase 4.

## O. Confirmation that no code / schema / trading behavior changed
- No DB writes (read-only inspection of `lib/db/src/schema/swingScan.ts` only).
- No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
- No changes to swing scoring, recommendations, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O signal generation, F&O entries / exits / targets / stops / sizing / gates / confluence, option snapshots, candle warehouse.
- Outputs scratch-only under `.agents/outputs/h9/`: this report (single markdown file). **No CSV produced** — H9 is design-only with no numerical slices to tabulate beyond what H8 already produced.
- No git commit of the output (per spec).
- All running workflows (`api-server`, `global`, `mockup-sandbox`, `scanner`) remain unchanged. Test suite + workspace typecheck unchanged from checkpoint `b6e2019415f`.

## Standing labels applied
`design-only` · `planning-only` · `no code / no schema / no DB writes / no live behavior change` · `owner-only diagnostic` · `fail-OPEN` · `no scheduler change` · `no persistence` · `not implementation approval`

## Verdict
- **Conclusion**: `ready for future shadow-mode implementation planning`.
- **B1**: shadow-mode formula is fully no-schema, no-scheduler-change, computable from already-persisted columns on `swing_scan_result`. Implementation planning may proceed when the eight Phase-1 prerequisites in §J are met (currently none are).
- **B3**: same as B1 plus a one-shot warning-code-string verification at Phase 1 lock-in.
- **M6 / B4 / B5**: not part of this plan. M6 rejected. B4 / B5 deferred until ≥ 10 H3 clean prior dates exist.
- **No live scoring / action-label / entry / stop / target / RR / paper-equity changes approved.** **No S4c / S4d / S4e / S4f approved.**
- **Activation of shadow mode is NOT approved by H9.** This document only establishes that *if* approved, the implementation path is small, isolated, no-schema, no-scheduler-change, and fully rollback-able.

**S2b / S3b / F&O P25 still pending. S4c / S4d / S4e / S4f not approved. Stopping per spec. Awaiting next instruction.**
