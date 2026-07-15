/**
 * UnifiedGradeChip — pure resolver contract test.
 *
 * Guards the invariant that an inline caller (Option Chain PCR / Max Pain /
 * Greeks / IV Surface / Futures cards) resolves to the SAME six-value
 * canonical vocabulary as the Home registry path — Kite live → KITE_TRADE_GRADE,
 * Kite fallback → INFO_ONLY (never trade-grade), computed → INFO_ONLY,
 * missing data → UNAVAILABLE, unwired feed → PROVIDER_NOT_CONFIGURED.
 */
import { describe, it, expect } from "vitest";
import { resolveInlineSource } from "./unified-grade-chip";

describe("UnifiedGradeChip.resolveInlineSource", () => {
  it("Kite + live data → KITE_TRADE_GRADE", () => {
    expect(
      resolveInlineSource({
        source: "kite",
        runtime: { hasData: true, asOf: "2026-07-15T10:00:00Z" },
      }),
    ).toEqual({ sourceStatus: "TRADE_GRADE", grade: "KITE_TRADE_GRADE" });
  });

  it("Kite + fallbackUsed → DELAYED → INFO_ONLY (never trade-grade)", () => {
    expect(
      resolveInlineSource({
        source: "kite",
        runtime: { hasData: true, fallbackUsed: true },
      }),
    ).toEqual({ sourceStatus: "DELAYED", grade: "INFO_ONLY" });
  });

  it("Kite + isStale → STALE → INFO_ONLY", () => {
    expect(
      resolveInlineSource({
        source: "kite",
        runtime: { hasData: true, isStale: true },
      }),
    ).toEqual({ sourceStatus: "STALE", grade: "INFO_ONLY" });
  });

  it("nse_archive live → INFO_ONLY (T+1-ish label handled at boundary)", () => {
    // With hasData=true, nse_archive maps to INFO_ONLY (not DELAYED_T_PLUS_1;
    // that variant is reserved for the case where the caller explicitly
    // resolves a stale bhavcopy state). This is intentional — inline callers
    // should not synthesise DELAYED_T_PLUS_1 from mere presence.
    expect(
      resolveInlineSource({
        source: "nse_archive",
        runtime: { hasData: true },
      }),
    ).toEqual({ sourceStatus: "INFO_ONLY", grade: "INFO_ONLY" });
  });

  it("computed derived → INFO_ONLY (Greeks path)", () => {
    expect(
      resolveInlineSource({
        source: "computed",
        runtime: { hasData: true },
      }),
    ).toEqual({ sourceStatus: "COMPUTED", grade: "INFO_ONLY" });
  });

  it("no data → UNAVAILABLE", () => {
    expect(
      resolveInlineSource({
        source: "kite",
        runtime: { hasData: false },
      }),
    ).toEqual({ sourceStatus: "UNAVAILABLE", grade: "UNAVAILABLE" });
  });

  it("no data + SOURCE_NOT_INTEGRATED baseline → PROVIDER_NOT_CONFIGURED", () => {
    expect(
      resolveInlineSource({
        source: "missing",
        baselineStatus: "SOURCE_NOT_INTEGRATED",
        runtime: { hasData: false },
      }),
    ).toEqual({
      sourceStatus: "SOURCE_NOT_INTEGRATED",
      grade: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("yahoo live → DELAYED → INFO_ONLY", () => {
    expect(
      resolveInlineSource({
        source: "yahoo",
        runtime: { hasData: true },
      }),
    ).toEqual({ sourceStatus: "DELAYED", grade: "INFO_ONLY" });
  });
});
