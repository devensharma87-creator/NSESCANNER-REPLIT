---
name: Data-authenticity — omit, never fabricate
description: Honesty convention for Home/Market-Pulse + Portfolio data paths — never emit fake 0 / fake n/a; omit or label instead.
---

# Data-authenticity convention (Home/Market Pulse + Portfolio Analyser)

**Rule:** A data builder must NEVER fabricate a value to satisfy a required field. If a real value cannot be resolved, OMIT the whole entry (when the contract requires non-null numbers) or surface an explicit missing-reason + provenance. Never `?? 0`, never silent fallback, never fake "n/a" that hides a real number.

**Why:** Failed/empty upstream fetches (especially Yahoo, which frequently returns empty/zeroed data WITHOUT throwing) were rendering as fake `0.00 / +0.00%` prints in the Home global-cues strip — a real authenticity/trust bug on a money app. The owner is strict: Kite is authoritative for Indian prices; Yahoo is allowed ONLY as labelled secondary/delayed analytics where Kite has no source; no synthetic production data.

**How to apply:**
- When a quote/analytic requires a non-null numeric field (e.g. the `IndexQuote` contract requires `change`/`changePercent`) and you cannot compute it honestly, return null and let the caller omit the entry — same discipline already used for GIFT NIFTY in `globalIndices.ts`.
- Frontend must defensively skip non-positive/missing prices and render `—` for null percents rather than coercing to 0.
- For Indian instruments, missing CMP is a COVERAGE/instrument-mapping gap, not a reason to fall back to Yahoo for valuation. Show `valuation_status` + `missing_reason` + source provenance.
- Yahoo-derived analytics (52W/EMA/pivots/VWAP for indices with no Kite candle token) must be LABELLED delayed/secondary, and an "unavailable" state must state the reason, never leak a raw provider-failure string like "Daily chart unavailable from Yahoo".

**Remaining (sequenced) backlog** lives in repo-root `HOME_PORTFOLIO_DATA_AUDIT.md`: index analytics Kite-candle facade + honest labelling (`indicesBoard.ts buildItem`); portfolio ETF/MF coverage + per-holding status surfacing; optional diagnostics endpoints + frontend secondary/delayed/stale badges.
