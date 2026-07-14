---
name: Lane 1 proxy level scale guard
description: MIDCAP proxy ^NSEMDCP50 (~17845) vs live NIFTY_MID_SELECT.NS (~14618) — 22% gap; scale guard pattern for future similar proxies
---

## Rule

When `cfg.yahooDaily !== cfg.yahoo`, capture `proxyPrevClose` from the daily series BEFORE the Kite live override, then compute `scaleGapPct = |proxyPrevClose − item.prevClose| / item.prevClose × 100`. If > 1%, null out all 13 absolute price-level fields and set `proxyLevelBlocked = true`.

**Why:** The two Midcap baskets have a permanent ~22% structural price-level divergence. Level analytics (EMAs, pivots, 52W) from the proxy basket are useless and misleading when anchored at the wrong price scale.

**How to apply:** If a new instrument config uses `yahooDaily` pointing to a proxy with a meaningfully different price level (check by comparing historical closes), this guard fires automatically — no config change needed. The 1% threshold is intentional (no false positives for co-moving proxies; catches all structural mismatches).

## What is intentionally preserved when blocked

- `change` / `changePercent` — derived from live ltp + live prevClose (Kite override)
- `prevClose` — live index previousClose from Kite
- `vwap` / volume profile — from live intraday bars
- Dimensionless indicators (IVR/IVP) — not in IndexBoardItem, not affected

## Files

- `indicesBoard.ts` → `buildItem()` — proxyPrevClose capture + scale guard block
- `IndexBoardItem` interface — `proxyLevelBlocked?: boolean` + `proxyLevelBlockReason?: string`
- OpenAPI `IndexBoardItem` schema — same two fields
- Test: `canonicalDataParity.test.ts` BUG-1 section (11 tests)
