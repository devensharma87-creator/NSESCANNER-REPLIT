---
name: Prompt 25A V2 closure
description: Production truth and cross-tab reconciliation — 6 confirmed defects fixed, 64 new tests (18 Gate G categories), scanner 1176, api-server 5603.
---

## What Was Done

**6 confirmed defects fixed; 6 classified VALID_DIFFERENT_SCOPE:**

| Gate | Finding | Fix |
|------|---------|-----|
| A1 | NET_VS_SEED hint didn't disclose it's account reconciliation (not trade P&L) | Hint updated to say "not strategy P&L" + directs to Analytics tab |
| A2 | winPct denominator used total trades instead of decided trades (wins+losses); all-scratch case showed 0% instead of — | Both local TodaysClosedTrades components now use `wins+losses===0 ? null : wins/(wins+losses)` |
| A4 | largestWin/largestLoss/bestTrade/worstTrade rendered ₹0.00 when no winning/losing trades | Guard: `wins===0 ? "—" : inrDec(...)` |
| B2 | ^VIX in global-cues-strip.tsx labeled "VIX" — ambiguous with India VIX | Label changed to "US VIX" |
| B3 | Monthly FII Buy/Sell showed ₹0 for net-only (niftytrader) months | Guard: `m.fiiBuy || m.fiiSell ? fmtCr(m.fiiBuy) : "—"` |
| C1 | First OI Lab "Market Sentiment" card missing "(based on OI)" scope qualifier | Added `<span>(based on OI)</span>` to match second card |

**VALID_DIFFERENT_SCOPE:** B1 (GIFT NIFTY separate), B4 (single IST shift), C2 (PCR full-chain vs windowed labels correct), C3 (Bull Call Spread formula correct), A3 (low-sample threshold=20 already applied), E3 (marketStatus.marketOpen gate accepted in B0).

## Floors After This Task

- Scanner: **1,176** / 1,176 (50 files) — was 1,112; +64 new tests
- API server: **5,603** / 5,603 (257 files) — unchanged
- 4× TSC: CLEAN

## Key Patterns Established

- **winPct denominator must be decided trades only** (`wins + losses`), never total trades. Scratches (realizedPnl=0) and expired-open trades are never in the win-rate denominator.
- **Report extremes (largest win/loss, best/worst trade)** must guard against false-zero using `hasTradesOfKind ? value : "—"`, not `value !== 0 ? value : "—"` (genuine zero is possible).
- **Monthly FII gross buy/sell guard:** `fiiBuy || fiiSell ? fmtCr(fiiBuy) : "—"` — because niftytrader (net-only) rows always have fiiBuy=0, fiiSell=0.
- **Sentiment scope labels** must uniquely identify the model: "(based on OI)", "Composite bias score", "Index Options bias" — never a bare "Market Sentiment" without a qualifier.

**Why:** False-zero in performance metrics misleads the owner into believing 0% win rate or ₹0 largest win is a valid trading result. The hint on NET_VS_SEED is critical because a deposit of ₹8L dwarfs trading P&L of ₹5,716 and the metric cannot serve as a strategy-performance proxy.
