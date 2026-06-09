import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSource } from "./marketData/providerImportGuard";

/**
 * Task #125 acceptance: the Watchlist consumers must obtain market data ONLY
 * through the central trusted layer — never via a direct provider import (no
 * `./yahoo`, no `./kite*`, no `yahoo-finance2`). This is enforced repo-wide by
 * providerImportGuard.test.ts, but pinned here as a focused, named guarantee
 * for the two watchlist modules so a regression is obvious at the watchlist
 * level.
 */
const WATCHLIST_CONSUMERS = ["watchlist.ts", "watchlistBasket.ts"];

describe("watchlist consumers — no direct provider imports", () => {
  for (const file of WATCHLIST_CONSUMERS) {
    it(`${file} has zero direct provider/Yahoo runtime imports`, () => {
      const src = readFileSync(join(__dirname, file), "utf8");
      const violations = scanSource(src);
      expect(violations).toEqual([]);
    });
  }
});
