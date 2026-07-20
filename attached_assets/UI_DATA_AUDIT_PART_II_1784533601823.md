# PART II — VISUAL & DATA AUDIT FROM 46 PRODUCTION SCREENSHOTS
**Method:** every capture opened and read panel-by-panel (full-page shots sliced into bands; 80 rendered views inspected). Findings are per-tab, each with severity, evidence seen on screen, and the fix. Severity: **S1** = shows a wrong/contradictory number to a trader · **S2** = misleading or unusable UX · **S3** = clutter/polish.

---

## A. GLOBAL / CROSS-TAB DEFECTS (highest leverage — one fix repairs many pages)

**A1 · S1 — The same instrument shows different prices on different tabs, at the same moment.**
Evidence: Home "INDIAN INDICES" card shows NIFTY **₹24,334.30 +0.00% (-0.00)** while the Home NIFTY 50 detail block directly beneath shows **+0.00%** but the top ticker shows **+1.09%**; OI Lab shows **24334.30 +1.09%**; Market Pulse post-market wrap shows **24,326.48 +1.05%**; Backtest/Deep Scan shows **24,334.30 +1.09% (+261.55)**. Four surfaces, three different change values, two different last prices.
Root cause: each tab computes its own "previous close"/change from a different source (Kite quote vs Yahoo daily vs scanner cache vs post-market snapshot).
Fix: **one server-computed `MarketSnapshot`** per instrument per refresh — `{snapshot_id, ltp, prev_close, change, change_pct, source, as_of, session_state, freshness}`. Every tab renders from it; no client-side derivation of change%. Cross-page test: same `snapshot_id` ⇒ identical numbers on Home, OI Lab, Option Chain, Deep Scan, Market Pulse.

**A2 · S1 — "0.00% (-0.00)" displayed as if it were a real move.** Home index cards for NIFTY, BANK NIFTY, SENSEX all render `+0.00% (-0.00)` while the same page's ticker and sector heatmap show +1.09%/+1.63%/+1.25%. A zero-change display on a +1% day is worse than showing nothing.
Fix: when `prev_close` is missing/mismatched, render `—` with an `UNAVAILABLE` chip. **Never render 0.00 as a computed value.**

**A3 · S2 — Provenance chips are inconsistent in vocabulary and placement.** Seen across pages: `INFO ONLY · Yahoo ~15m`, `INFO ONLY · Derived`, `INFO ONLY · Scanner cache`, `INFO ONLY · NSE EOD`, `KITE TRADE-GRADE`, `DELAYED · ANALYTICS ONLY`, `Mixed sources`, `KITE PARTIAL`, `KITE LIVE`, `KITE QUOTE UNAVAILABLE`, `UNRESOLVED SYMBOL`, `SYNTH FUTURE · MODELLED`, `MODELLED GEX`, `Reference only`, `EXPIRY THIS WEEK`. Fifteen+ variants, some as pills, some as inline text, some in headers, some in footers.
Fix: one chip component, **five states only** — `LIVE` / `EOD` / `DELAYED` / `MODELLED` / `UNAVAILABLE` — with an optional source token (`Kite`, `Yahoo`, `NSE`, `BS-model`) and a fixed position (top-right of every card). Everything else becomes a tooltip.

**A4 · S2 — Header/nav duplication inside long pages.** On the Portfolio Analyser (band 1) and F&O Diagnostics (band 3) the full site header re-renders **in the middle of the page content**, overlapping the table. This is a sticky-header/scroll-container bug, visible in two separate captures.
Fix: single sticky header at the app shell; page bodies must not mount their own nav.

**A5 · S2 — "Analysis mode — automation suspended" banner is permanently pinned** and consumes the top strip on every page along with the market-status pill. Correct for C0, but it must be dismissible-per-session and auto-hide when automation resumes, otherwise it becomes wallpaper and stops being read.

**A6 · S3 — Footer disclaimer block repeats verbatim on every page** (3 lines + links). Compress to one line + "Methodology" link.

---

## B. HOME PAGE

**B1 · S1 — Sections disagree about the same day.** "OVERALL MARKET TREND" says *"Markets are choppy. Stay nimble and wait for a directional close"* with A/D 87/103 and score 0, while the sector heatmap on the same screen shows 14 of 19 sectors green and the index cards show all three benchmarks +1.0–1.6%. Two different stories, same viewport.
Fix: the trend/mood engine must consume the same snapshot as the heatmap; if breadth (198-stock universe) contradicts index moves, state that explicitly ("index-led, narrow breadth") rather than printing "choppy".

**B2 · S1 — Staleness is disclosed in the wrong register.** "Kite (live) updated **29h 28m ago** · index 15m candles · Kite · stale" is displayed inside a green-ish status pill. 29 hours is not "live".
Fix: any age > 1 session ⇒ red `UNAVAILABLE`/`STALE` chip and the dependent panel greys out.

**B3 · S1 — Market Mood Index composite is built from a null.** Panel shows `India VIX —` (missing) yet still prints a composite score **45 NEUTRAL** with `VOL (VIX) -50` as a component. A missing input is being scored as −50.
Fix: null input ⇒ excluded from the composite, denominator adjusted, and the card lists which inputs were used (same rule as PRE-10 in the briefing spec).

**B4 · S2 — Two competing "top ideas" blocks.** "TOP GAINERS/LOSERS — TODAY" (price movers) sits directly above "TOP BULLISH/BEARISH SETUPS" (scanner scores), with a warning between them that *"20 of these top picks are derived from delayed or non-live (Yahoo) / stale data"*. A trader cannot tell which list is actionable.
Fix: merge into one "Ideas" block with a source column and a hard filter: setups computed on non-trade-grade data are hidden by default behind a "show info-only" toggle.

**B5 · S2 — Index detail block duplicates the Markets tab wholesale.** Home renders full day-range/52w/EMA/market-profile/pivots for NIFTY, then the "Markets — Indices, Commodities, ADRs & FX" section repeats the identical layout for the same instruments a screen below.
Fix: Home keeps a compact 5-index strip; deep per-index detail lives only in Markets (one click).

**B6 · S1 — Pivots/CPR/EMAs on Home are Yahoo-derived and labelled "Reference only — not for signals/trade decisions", yet they are the most trade-like numbers on the page** (S1/S2/S3, R1/R2/R3, CPR). Meanwhile the F&O engine computes its own levels elsewhere. Two level systems, one labelled unusable.
Fix: compute levels once, server-side, from trade-grade candles; if unavailable, show the panel empty with a reason — do not print a second, unusable level set.

**B7 · S3 — MIDCAP proxy warning is buried in orange body text** ("proxy blocked: level scale mismatch (21.2% gap) — ^NSEMDCP50 ≠ NIFTY_MID_SELECT.NS"). Correct honesty, wrong placement — belongs in the card's chip, not a paragraph.

---

## C. OPTION CHAIN

**C1 · S1 — Every OI-change column reads `0` / `0.0%` across all strikes** (Δ OI = 0, V/O = 0.00) while Total OI shows 12.22Cr/19.76Cr and the page claims `Kite (live) updated 2m 50s ago`. The chain's most important analytic column is dead.
Cause: session-close snapshot diffing against itself (no prior snapshot on weekends) — same class as the OI Lab's `CALL OI Δ 0 · PUT OI Δ 0`.
Fix: when no valid prior snapshot exists, render `—` + `NO PRIOR SNAPSHOT` chip. Never print 0 for an unknown delta.

**C2 · S1 — Volume column is entirely `0`** for all strikes, and PCR(Vol) shows `0.00`, yet "Vol PCR 0.00" is presented alongside PCR(OI) 1.62 as if both were valid readings. On a closed session volume should be the session's total, not zero.
Fix: verify the volume field mapping from Kite; if genuinely unavailable post-close, mark `UNAVAILABLE`, and suppress any derived metric (PCR-Vol) rather than printing 0.00.

**C3 · S2 — Bid/ask ("B" column) is blank for every row** while the strategy pages elsewhere say "Quoted bid/ask shown when chain has them — otherwise theoretical mid is used". The chain never states which it is showing.
Fix: per-row `Q`/`T` (quoted/theoretical) marker.

**C4 · S2 — Two truth banners contradict.** Header pill says `MARKET CLOSED` while the analytics chip says `Kite (live) · updated 2m 50s ago · refresh 15s`. Both are true in different senses (session closed, cache fresh) but read as a contradiction.
Fix: one status line: `Session: CLOSED · Data: Kite EOD snapshot · as of 15:30 IST`.

**C5 · S3 — The strike table's colour ramp is applied to OI magnitude only**, making the ATM row (the one that matters) visually indistinguishable from deep OTM rows. Add a persistent ATM band highlight and a "±5 strikes" default view.

---

## D. OI LAB (Overview / OI / PCR / Max Pain / Chain / Multi-OI / GEX)

**D1 · S1 — Overview shows `CALL OI Δ 0` and `PUT OI Δ 0` with "Total: 12.22 Cr / 19.76 Cr"** — same dead-delta defect as C1, now driving the headline "Intraday Flow +0.00" and feeding MARKET SENTIMENT "Mildly Bullish 43%".
Fix: sentiment must degrade to `INSUFFICIENT DATA` when its flow input is null, not score it as 0.

**D2 · S1 — Sentiment number is inconsistent across the same page's tabs.** Overview gauge: **Mildly Bullish 43%** (score +43). PCR tab: **BULLISH — "Strongly bullish — heavy put writing"**. Multi-OI snapshot row for NIFTY: **NEUTRAL**. Three verdicts for one instrument, one timestamp.
Fix: single `BiasResult` object (the canonical bias function already scoped in M5) rendered everywhere; tabs may show different *components* but never a different verdict.

**D3 · S1 — Put-Call Ratio chart is empty** (axis drawn, no series) while the cards above it show PCR 1.62 and the threshold lines (1.3 / 0.7) render. Same for **Max Pain chart** (axis + max-pain marker, zero bars) and **Gamma Exposure chart** (axis only, no bars) despite GEX cards showing 28.23T / -28.18T / net 45.15B.
Fix: chart data-binding bug — three charts in one tab group render axes without series. Add an empty-state ("no per-strike series for this snapshot") and fix the binding; a chart frame with no data reads as "flat market" to a trader.

**D4 · S1 — GEX magnitudes are implausible and unlabelled in unit.** "TOTAL CALL GEX 28.23T", "NET GEX 45.15B" for NIFTY. Trillions of what? Standard GEX is per-1%-move in ₹ or in shares/contracts.
Fix: state the unit and the formula (`GEX = Σ γ × OI × lot × spot² × 0.01`), and sanity-cap display; the `MODELLED GEX — not exchange provided` chip is good but insufficient without units.

**D5 · S2 — "Synthetic future 24332.75 · SYNTH FUTURE · MODELLED" sits beside "Future price 24345.00 KITE"** with no explanation of why a modelled value is shown when the real one exists.
Fix: show real future by default; synthetic only when real is unavailable (then labelled).

**D6 · S2 — Multi-OI "Bias" column disagrees with the Overview tab** for the same three indices (NIFTY NEUTRAL here vs Mildly Bullish there; SENSEX NEUTRAL here vs the Market Pulse card's read). Same fix as D2.

**D7 · S3 — Underlying picker lists ~200 stock chips in a wall of tags** (360ONE, ABB, ABCAPITAL…) with no grouping or search-first UX. Replace with a search-first control + "recent" + index quick-picks.

**D8 · S3 — Tab strip has 7 tabs, three of which (PCR, Max Pain, Gamma) are single-chart pages.** Consolidate into one "Analytics" tab with a chart selector; keeps information, removes navigation cost.

---

## E. TRADING DESK / INTRADAY F&O

**E1 · S1 — "TRADINGVIEW ALERTS 4/4 shown · STALE" with "latest received 24 Apr 2026, 02:10 pm".** Three months stale, still rendered as a live panel with filters.
Fix: >24h ⇒ collapse to a single line "TradingView webhook inactive since 24 Apr — configure" and hide the alert list.

**E2 · S1 — Suppression counter is opaque.** `SUPPRESSED BY: MARKET CLOSED · 3` with no timestamps, no per-index breakdown, no link to reasons. (This is the same counter that produced the Saturday 16:21 alert — proof it is not persisted.)
Fix: the M1 suppression-persistence rider must back this panel:每 event timestamped, per index, with canonical reason, clickable to the funnel row.

**E3 · S2 — "3 live setups across 3 indices · updated 3 minutes ago" printed directly above "Weekend — next session resumes Monday"** and an empty setups area. The counter counts stale objects.
Fix: counters reflect session state; on closed sessions show "last session's setups (read-only)".

**E4 · S2 — The "HOW TO READ THIS" paragraph is longer than the panel it explains** and repeats on every load. Move to a collapsible "?" popover.

---

## F. PAPER TRADING / P&L REPORTS

**F1 · S1 — Gross is displayed 3× larger than net, and net is labelled "shadow only".** Equity tab: `TOTAL REALIZED P&L (GROSS, PRE-COST) +₹67,024.86` in 32px green; `ESTIMATED NET P&L +₹63,109.27` in 14px with "shadow only — not used for DD/heat/risk gates". The number a trader must not trust is the visually dominant one.
Fix: **NET is the headline**, gross demoted to a secondary line. Remove "estimated" once the versioned cost model lands (M2c).

**F2 · S1 — F&O tab claims 7 trades / 42.9% win / +₹6,508 while the Journal tab for the same filter shows 7 closed trades with "EXPIRED 4 (57.1%)"** — i.e. 4 of 7 "trades" never actually exited on a rule; and P25 Evidence panel states **"OFFICIAL ELIGIBLE (P25): 0 · RAW ROWS 7 · EXCLUDED / NOT MFE-AVAILABLE: 7"**. So: 0 of 7 trades have valid evidence, yet win-rate/expectancy/profit-factor are printed as if statistically meaningful.
Fix: when eligible-sample = 0, the stats block renders `INSUFFICIENT EVIDENCE` and hides win rate/PF/expectancy. (This is the audit's ledger-truth item made visible.)

**F3 · S1 — Time-of-day panel prints "100%" win rate off a single trade** (12:00 → 1 trade, 100%) beside "15:00 → 2 trades, 0%". Sample sizes of 1–2 rendered as percentages.
Fix: suppress percentages below n=5; show counts only.

**F4 · S2 — "Intraday equity — coming next"** placeholder tab shipped in production navigation. Either hide the tab until Phase 3 lands or mark it `PREVIEW` in the tab itself.

**F5 · S2 — Combos lane warns it is isolated from the F&O auto-trader ("does not share heat budget, DD caps, or 15:20 force-exit")** yet lists 5 closed combos with P&L +₹0 and one +₹4. Isolated risk lanes with real P&L are exactly how ledger drift happens.
Fix: fold combos into the same journal/ledger identity (M2c) or clearly quarantine them out of all P&L headlines.

**F6 · S3 — Month grid shows 12 cells, 9 of them "no trades"** for a book with 12 trades total. Collapse empty months.

---

## G. BACKTEST LAB

**G1 · S1 — "Session validity audit · 19 of 133 trades have an entry/exit OUTSIDE 09:15–15:30 IST"** with rows showing `27 Apr, 04:42 pm IST` entries — after-close fills in a backtest. The panel flags it honestly but the run's headline stats (Net P&L −₹20,538, PF 0.65, Win 20%) still include them.
Fix: invalid-session trades are **excluded from headline stats** and reported separately; a backtest that silently includes 4:42pm fills is unusable for the M4 decision.

**G2 · S1 — 108 of 133 signals "expired or went stale with no captured option exit — excluded from P&L"**, so headline stats derive from 25 trades while the trade table lists 133 rows with `n/a` P&L. Two denominators on one screen.
Fix: one denominator, stated: "25 decided of 133 taken (108 excluded — no captured exit)".

**G3 · S1 — "Option-chain snapshot coverage: No option-chain snapshots captured yet"** while the mode selector shows "Real Premium Replay — every ₹ traceable to a snapshot row" as an available run type. The mode cannot be honest with zero snapshots.
Fix: disable/grey the mode with the reason; do not offer a run type whose data does not exist.

**G4 · S2 — Result chips are unlabelled** (`Real ALL -₹20,538 18 Jul 26`, `Dir NIFTY +₹537 07 Jul 26`) mixing engines, instruments, and dates in one row of pills with no legend.
Fix: table with columns (engine, instrument, window, net, PF, sample) — this is research output, not a chip cloud.

**G5 · S3 — Equity curve renders as a flat line with no y-axis scaling to the actual drawdown** (₹0–₹10,00,000 axis for a ₹20k loss). Auto-scale to data.

---

## H. PORTFOLIO ANALYSER

**H1 · S1 — Day P&L and Total P&L contradict per row.** e.g. `BEL: Day +₹1,292 / Total −₹15,356 / Return −6.38%` is fine, but `HINDZINC: Day −1,159 / Total +₹15,575 / +10.29%` and `NMDC: Day −1,720 / Total +₹3,440` — while the header shows `DAY P&L +₹3,415 (+0.14%)` and `TOTAL P&L −₹24,503 (−0.98%)`. On a day when all three indices closed +1%+, a 41-holding portfolio showing day P&L of +0.14% with most rows red suggests the day-change basis is mixed (some rows using stale prev-close).
Fix: day P&L must be computed from one snapshot's `prev_close`; rows lacking it show `—`.

**H2 · S1 — "XIRR unavailable · 41 holding(s) lack dates" and "Cost Basis: UNDATED ₹25,09,310 · 41 holdings"** — i.e. the entire portfolio has no purchase dates, so LT/ST classification shows ₹0/₹0.
Fix: prompt for dates on import (or per row) — otherwise the tab silently cannot do half its job.

**H3 · S1 — Benchmark panel says "Benchmark comparison (vs Nifty 500 sector weights) is unavailable — no benchmark feed is wired in this version"** while a separate Benchmark card shows "Source: Kite authoritative · 271 closes · Window from 2025-06-12 (full available range — purchase dates missing) · Portfolio return −0.98%". Two benchmark statements, one says unwired, other shows a computed comparison.
Fix: single benchmark component; if weights are unavailable, say so once.

**H4 · S2 — Rows with unresolved symbols (`MAM150ETF · KITE QUOTE UNAVAILABLE`, `NASDAQ100 · UNRESOLVED SYMBOL`) still occupy full rows with n/a across 8 columns.** Group them into a collapsed "2 holdings not priced" strip (the header already says this).

**H5 · S2 — "Correlation clustering is not shown — clean per-holding daily-return series isn't wired in this build, so it would be fabricated."** Excellent honesty; wrong placement (inside a metrics card). Move all such notices to a single "What this build cannot compute yet" panel.

**H6 · S3 — Action View column mixes verdicts with asset labels** (`Mixed / Watch`, `Hold with Review`, `Exit Review`, `Strong Structure`, `Gold ETF`, `Index ETF`, `US tech index`). Two different taxonomies in one column.

---

## I. FULL SCANNER

**I1 · S1 — Every indicator column is empty (`—`) for all rows** — VWAP, EMA20/50/100/200, RSI, 52W H/L, VOL× — while SCORE shows `+54` and SIGNAL shows `NEUTRAL` for every visible row. A score computed from nothing.
Banner explains: `KITE PARTIAL — Kite price overlay active for 194 of 198 rows. Scanner indicators still use Yahoo daily candles — info-only until Kite candle warehouse is active (Phase B)`.
Fix: if indicators are unavailable, **do not print a score**. Show `SCORE —` + reason. Uniform +54/NEUTRAL across hundreds of rows is a null-scoring artifact, and it is the same "score with no inputs" defect as B3.

**I2 · S1 — Universe counters disagree in one header block:** `Universe 8,864 · live feed 4,336 · no feed this cycle 4,528 · 0 rested` then `4,340 of 8,864 stocks scanned` then footer `~280 stocks` on Home's link ("Browse the full scanner with all ~280 stocks").
Fix: one coverage object (`universe`, `eligible`, `scanned`, `priced`, `skipped+reason`) rendered identically everywhere.

**I3 · S1 — Sector column reads `NSE EQ` for every row** — confirming source-level P1-05; the sector filter dropdown is therefore inert.
Fix: authoritative sector mapping (M-post-mission, but the dropdown must be disabled with a reason until then).

**I4 · S2 — Top rows are all illiquid SM/ST/BE series** (KEL-SM, AFCONS, ACETEC-SM, AISL-SM, ANLON-ST, SANWARIA-BZ at ₹0.21) sorted by %change, presented as scanner output. A pro tool must not surface ₹0.21 BZ-series stocks as top ideas.
Fix: liquidity/series eligibility filter by default (turnover ≥ threshold, exclude BZ/SM/ST unless opted in) — the audit's universe-eligibility item, surfaced here concretely.

**I5 · S3 — 20 columns at default with no column chooser**; horizontal scroll needed on a 3000px screen.

---

## J. SECTOR ROTATION

**J1 · S1 — Sector cards disagree with Home's heatmap.** Sectors page: Aviation **−0.32% with AVG SCORE +28 "BULLISH"**, Pharma **−1.40% score +4 "BULLISH" (DIVISLAB)**, Insurance **−1.77% score −19**. Home heatmap shows the same % but different colour semantics. Meanwhile Capital Goods shows `−2.52%` with best match `BHEL BULLISH`.
Fix: define and label the two axes explicitly — "today's sector return" vs "average technical score of constituents" — and never colour the card by one while the badge says the other.

**J2 · S2 — "BREADTH 1/0", "0/1", "6/1" on cards with 1–2 constituents.** Sector conclusions from single-stock samples.
Fix: minimum constituent count (e.g. ≥5) to publish a sector verdict; otherwise `INSUFFICIENT COVERAGE`.

**J3 · S2 — `ROLLUP GRADE: INFO ONLY · Scanner cache` + `Mixed sources`** — the rotation page inherits the scanner's null-indicator problem (I1). Same fix.

---

## K. MARKET PULSE / PRO MARKET ANALYSER

**K1 · S1 — GIFT NIFTY is displayed as a live driver (`GIFT NIFTY 24,349.00 +1.05%`, "indicates a gap-up opening")** although the platform's own Phase-0 data matrix classified GIFT as **GATED — not in Kite, no external source wired**.
Fix: verify the actual source of this number immediately; if it is derived/placeholder, remove it from the composite and the narrative until a real feed is approved. **This is a fabrication risk on the most-read summary panel.**

**K2 · S1 — Composite bias mixes stale and live inputs without stating ages.** "SIGNAL BREAKDOWN" bars weight GIFT NIFTY ×1, FII cash ×1.5, DII cash ×1.5, FII futures OI ×2, Option PCR ×1, India VIX ×1, Macro ×1 — with the chip `Mixed sources · updated just now · INFO ONLY · Scanner cache · as of 08:49 PM`. FII/DII are EOD (1 day old per the 5-day table), VIX 13.15 here vs 18.77 on Home's ticker (**two different VIX values on two pages**).
Fix: per-input age + source in the breakdown; and A1's single-snapshot rule extends to VIX.

**K3 · S1 — India VIX 13.15 (Market Pulse) vs 18.77 (Home ticker) vs "India VIX —" (Home mood panel).** Three values, one instrument, one moment.
Fix: single VIX source (live Kite quote, 5–60 sanity band) — this is the same defect family as the corrupted `vix` column already queued for M3.

**K4 · S2 — Post-Market Wrap prose contains contradictory claims:** "Composite overnight setup for the next session is **strong bearish**" immediately after "+0.3 **Neutral** — Range-bound / neutral — signals are mixed" and "GIFT NIFTY +1.05% — indicates a **gap-up** opening".
Fix: narrative generated from the composite object, not independently templated.

**K5 · S2 — "Setup for Tomorrow · 15 PTS" side panel duplicates Home's key-levels and the OI Lab's walls** (pivots, CPR, max pain, PCR, VIX, FII/DII) — a third copy of the same level system.
Fix: this panel becomes the single canonical "Tomorrow's plan" card, and Home/OI Lab link to it.

**K6 · S3 — Daily Report Bot panel shows "None since start" for both pre and post** while Telegram screenshots prove messages were sent tonight (manual test). Counter not wired to actual deliveries.

---

## L. F&O DIAGNOSTICS

**L1 · S1 — Data Health says `OK` while every row shows Spot `n/a`, Spot age `n/a`, Spot source `Unavailable`.** Section B directly below correctly says `BLOCKED · SPOT_UNAVAILABLE` for all three indices.
Fix: health verdict must be the **weakest** component (the audit's canonical-health item) — an OK badge over three unavailable spots is exactly the class of lie this platform exists to prevent.

**L2 · Positive — Skip-reason panel is genuinely excellent** (durable counts: `EMA_PULLBACK · CONDITIONS_NOT_MET 212`, `TREND_CONTINUATION · CONDITIONS_NOT_MET 156`, `UNKNOWN · NO_LIVE_KITE_INTRADAY 156`, `POST_CLAMP_RR 135/66/63`, `HC_FLOOR 66/53`…). **Keep as-is** — this is the funnel evidence M6 will consume. Only change: link each row to the filtered trade/journal view.

**L3 · S1 — Setup Performance shows `TREND_CONTINUATION emitted 172, opened 0` and `BASELINE emitted 323, opened 0`** — confirming at UI level that the tradeable lane never opens. Also `UNKNOWN`, `MARKET_CLOSED`, `VOL_REGIME`, `CORRELATED-EXPOSURE_CAP` appear as *setups* (they are gates/reasons).
Fix: separate "setups" from "gate outcomes" in this table — mixing them makes the emitted/opened ratio unreadable.

**L4 · S2 — Blocked/Demoted list shows the identical `HTF_CONFLICT + INFO_ONLY` pair on hundreds of rows** with no aggregation.
Fix: group by (index, setup, reason, day) with counts; expand on click.

---

## M. OPTION STRATEGIES

**M1 · S1 — Every one of the 13 strategies is tagged `POOR LIQUIDITY`** while simultaneously recommending them ("SUGGESTED"), and Long Straddle shows `MAX PROFIT Unbounded` for a **long straddle** (correct) but Short Straddle shows `MAX LOSS Unbounded` (correct) — yet **Long Put shows "MAX PROFIT Unbounded"**, which is mathematically wrong: a long put's max profit is strike − premium (bounded).
Fix: per-strategy payoff bounds from a verified table (this is audit P1-08); and if every leg is `POOR LIQUIDITY`, suppress "SUGGESTED".

**M2 · S1 — "Market closed — recommendation reflects last available data; entry deferred to next session open"** is repeated inside all 13 cards (~3 lines each), while the same disclaimer already appears in the page header.
Fix: one page-level state banner; remove per-card repetition (this alone removes ~40 lines of duplicated text).

**M3 · S2 — Expected-value figures presented to the rupee from a 10k-path Monte Carlo** (`EXPECTED VALUE +₹6`, `-₹35`, `-₹277`) with `RETURN ON CAP. 0.03%`. False precision.
Fix: round EV to nearest ₹50 and show a confidence band, or hide EV until sample/model is validated.

**M4 · S3 — Each card repeats the same 4 model-assumption bullets** already stated in the page header disclosure block.

---

## N. DEEP SCAN (per-symbol)

**N1 · S1 — Price/volume charts render empty axes** (6M NIFTY chart shows legend values EMA200 24,397.54 / Price 24,334.30 but no plotted series; Volume panel empty).
Fix: same chart-binding defect as D3 — one root cause likely; fix once, verify across all chart components.

**N2 · S2 — `DELAYED · ANALYTICS ONLY` on a page whose header says `Live Kite price quote`.** Mixed within one card.

**N3 · S2 — Period returns show `6 MONTHS -5.96%` and `1 YEAR -4.66%` while `3Y +29.05%`/`5Y +54.62%`** with no annualisation label. State whether absolute or CAGR.

---

## O. WHAT TO DELETE / MERGE (tab-cleanup decisions from the visual pass)

| Action | Items | Rationale |
|---|---|---|
| **Merge** | OI Lab tabs `PCR`, `Max Pain`, `Gamma Exposure` → single **Analytics** tab with selector | 3 single-chart pages; all currently render empty charts |
| **Merge** | Home index-detail block → **Markets** tab | verbatim duplication (B5) |
| **Merge** | Home `Top Gainers/Losers` + `Top Setups` → one **Ideas** panel with source filter | B4 |
| **Merge** | Market Pulse `Setup for Tomorrow` + Home key levels + OI Lab walls → one canonical **Levels** card | K5 |
| **Hide until built** | P&L Reports → `Intraday` tab (placeholder) | F4 |
| **Collapse** | TradingView alerts panel when stale >24h | E1 |
| **Collapse** | Unpriced portfolio rows; empty months in P&L grid | H4, F6 |
| **Keep exactly as-is** | F&O Diagnostics skip-reason panel; Backtest "Data quality & honesty" block; Portfolio "correlation not shown" notice; Option Strategies model-assumptions header | These are the platform's differentiators — the honest bits |

**Nothing gets deleted outright.** Every merged surface keeps its content in the destination page, and retired routes 301-redirect (per your #10/#11/#16).

---

## P. UI SYSTEM UPGRADE (concrete, not vague)

1. **Density & hierarchy:** current pages use uniform 13–14px mono for everything. Adopt 3 levels: headline number (24–32px), supporting metric (14px), meta/provenance (11px muted). Applies first to P&L headline (F1) and index cards (A2).
2. **One chip system** (A3), fixed top-right, five states, colour-blind-safe (not red/green only — add icon).
3. **Empty/degraded states are first-class:** every panel needs 3 designed states — data, unavailable-with-reason, insufficient-sample. Currently panels render zeros instead (C1, D1, I1).
4. **Card grid rhythm:** 8px base, max 4 metric tiles per row (currently 6–7 cramped tiles on OI Lab overview).
5. **Number formatting:** one formatter — ₹ with Indian grouping, OI in Cr/L consistently (currently mixes `1.05Cr`, `86.81L`, `10510K`, `12.22Cr`), % to 2dp, points to 2dp.
6. **Tables:** sticky header + column chooser + default column set per persona (I5); ATM row pinned in chain (C5).
7. **Charts:** shared component with auto-scaled axes (G5), empty-state, and unit label (D4).
8. **Mobile/narrow:** none of the 46 captures show a responsive breakpoint; at 3000px the layouts are fine, but the option chain and scanner will be unusable under 1400px. Define a breakpoint plan.

---

## Q. HOW THIS FOLDS INTO THE MISSION

Nothing above changes the phase order — but three items are **promoted into earlier phases** because they are truth defects, not polish:

- **Into M1 (this week):** A1/A2 snapshot contract + zero-as-value ban; L1 canonical health (weakest-component); K1 GIFT source verification; K3 single VIX.
- **Into M2c (ledger):** F1 net-first, F2 insufficient-evidence gating, F5 combos identity, G1/G2 backtest denominators.
- **Into M5 acceptance:** D2/D6 single bias verdict across all surfaces (already the canonical-bias deliverable — now with a UI cross-page test).
- **Track C (presentation, parallel to M6):** everything else, in this order: chip system → empty states → chart component → tab merges → density/typography → tables → responsive.

**Bottom line from the visual pass:** the platform's *honesty machinery* is real and often excellent (skip-reason panel, backtest exclusions, "we won't fabricate correlation"), but the **display layer keeps printing 0 where it means "unknown"** — dead OI deltas, zero volumes, 0.00% index changes, scores from missing indicators, OK health over unavailable spots. That single pattern accounts for the majority of S1 findings, and one disciplined fix (typed nullable metrics + designed empty states + one snapshot contract) removes them all at once.
