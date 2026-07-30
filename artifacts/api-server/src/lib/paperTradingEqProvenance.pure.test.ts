/**
 * Paper trading equity provenance — pure mapping tests (no DB required).
 *
 * PURE TEST FILE (.pure.test.ts)
 * ----------------------------------------
 * Tests the pure mapWriteSourceToProvenance function. No database queries.
 * These tests run in the normal non-DB suite via `pnpm run test:full`.
 *
 * Note: importing `./paperTradingEq` transitively imports `@workspace/db`
 * (the module uses the DB for its backfill operation). The Pool is lazy
 * (no TCP connection). DATABASE_URL must be present in the environment.
 *
 * Source: extracted from paperTradingEqProvenance.db.test.ts (P0.1B refactor).
 */

import { describe, expect, it } from "vitest";

// mapWriteSourceToProvenance is a pure synchronous mapping function. Its
// module (`./paperTradingEq`) transitively imports `@workspace/db`, so we
// defer the import to the `it()` callback to keep module-eval side-effects
// as late as possible.
const loadFn = () =>
  import("./paperTradingEq.js").then((m) => m.mapWriteSourceToProvenance);

describe("mapWriteSourceToProvenance (pure write-path mapping)", () => {
  it("maps MANUAL -> MANUAL_BUY", async () => {
    const fn = await loadFn();
    expect(fn("MANUAL")).toBe("MANUAL_BUY");
  });

  it("maps AUTO -> AUTO_STRONG_BUY", async () => {
    const fn = await loadFn();
    expect(fn("AUTO")).toBe("AUTO_STRONG_BUY");
  });

  it("maps undefined -> AUTO_STRONG_BUY (existing callers never pass MANUAL by omission)", async () => {
    const fn = await loadFn();
    expect(fn(undefined)).toBe("AUTO_STRONG_BUY");
  });

  it("never returns SWING_STAGED_APPROVAL — no live caller feeds that source yet", async () => {
    const fn = await loadFn();
    expect(fn("AUTO")).not.toBe("SWING_STAGED_APPROVAL");
    expect(fn("MANUAL")).not.toBe("SWING_STAGED_APPROVAL");
  });
});
