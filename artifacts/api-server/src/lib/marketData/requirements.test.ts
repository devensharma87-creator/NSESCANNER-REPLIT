/**
 * Tests for the module data-requirement engine (Task #131).
 *
 * The core invariant: a TRADE_GRADE_REQUIRED consumer must REJECT Yahoo /
 * delayed / info / stale / unavailable data even when a Kite session is
 * nominally "active" — "Kite active" must never silently power a trade signal
 * with non-trade-grade data.
 */
import { describe, it, expect } from "vitest";
import {
  checkRequirement,
  MODULE_REQUIREMENTS,
  strictestLevel,
  type DataRequirement,
} from "./requirements";
import type { MarketDataPoint, SourceStatus, ProviderName, AssetType } from "./types";

function pt(overrides: Partial<MarketDataPoint<unknown>> = {}): MarketDataPoint<unknown> {
  const sourceStatus: SourceStatus = overrides.sourceStatus ?? "TRADE_GRADE";
  return {
    key: "quote:NIFTY",
    assetType: "index" as AssetType,
    symbol: "NIFTY",
    exchange: null,
    value: sourceStatus === "UNAVAILABLE" ? null : { ok: true },
    source: "kite" as ProviderName,
    sourceStatus,
    asOf: null,
    freshnessSec: null,
    canDriveSignals: sourceStatus === "TRADE_GRADE",
    canDriveTradeAlerts: sourceStatus === "TRADE_GRADE",
    fallbackUsed: false,
    errorCode: null,
    errorMessage: null,
    recoveryAction: null,
    ...overrides,
  };
}

const TG: DataRequirement = { dataType: "indexQuote", level: "TRADE_GRADE_REQUIRED", maxFreshnessSec: 120 };
const INFO: DataRequirement = { dataType: "benchmark", level: "INFO_ONLY_ACCEPTABLE", maxFreshnessSec: null };
const DISP: DataRequirement = { dataType: "candles", level: "DISPLAY_ONLY", maxFreshnessSec: null };

describe("checkRequirement — TRADE_GRADE_REQUIRED", () => {
  it("accepts a fresh, signal-eligible Kite trade-grade point", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE", freshnessSec: 10 }), TG);
    expect(r.status).toBe("READY");
    expect(r.met).toBe(true);
  });

  it("REJECTS Yahoo DELAYED data (never trade-grade)", () => {
    const r = checkRequirement(
      pt({ sourceStatus: "DELAYED", source: "yahoo", canDriveSignals: false }),
      TG,
    );
    expect(r.status).toBe("BLOCKED");
    expect(r.met).toBe(false);
    expect(r.reason).toMatch(/trade-grade/i);
  });

  it("REJECTS STALE data", () => {
    const r = checkRequirement(pt({ sourceStatus: "STALE", canDriveSignals: false }), TG);
    expect(r.met).toBe(false);
    expect(r.status).toBe("BLOCKED");
  });

  it("REJECTS INFO_ONLY data", () => {
    const r = checkRequirement(pt({ sourceStatus: "INFO_ONLY", canDriveSignals: false }), TG);
    expect(r.met).toBe(false);
  });

  it("REJECTS COMPUTED data", () => {
    const r = checkRequirement(pt({ sourceStatus: "COMPUTED", canDriveSignals: false }), TG);
    expect(r.met).toBe(false);
  });

  it("REJECTS a trade-grade point that is not signal-eligible (canDriveSignals=false)", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE", canDriveSignals: false }), TG);
    expect(r.met).toBe(false);
    expect(r.reason).toMatch(/canDriveSignals/i);
  });

  it("REJECTS a trade-grade point older than the freshness budget", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE", freshnessSec: 500 }), TG);
    expect(r.met).toBe(false);
    expect(r.reason).toMatch(/500s old/);
  });

  it("accepts a trade-grade point exactly at the freshness budget", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE", freshnessSec: 120 }), TG);
    expect(r.met).toBe(true);
  });

  it("accepts a trade-grade point with unknown freshness (no ceiling applied)", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE", freshnessSec: null }), TG);
    expect(r.status).toBe("READY");
  });

  it("BLOCKS UNAVAILABLE regardless of level and surfaces the recovery hint", () => {
    const r = checkRequirement(
      pt({ sourceStatus: "UNAVAILABLE", source: "none", errorMessage: "Kite session expired.", recoveryAction: "Reconnect Zerodha." }),
      TG,
    );
    expect(r.status).toBe("BLOCKED");
    expect(r.reason).toMatch(/Kite session expired/);
    expect(r.recoveryAction).toBe("Reconnect Zerodha.");
  });

  it("BLOCKS a present status whose value is null", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE", value: null }), TG);
    expect(r.met).toBe(false);
  });
});

describe("checkRequirement — INFO_ONLY_ACCEPTABLE", () => {
  it("returns READY on trade-grade data", () => {
    const r = checkRequirement(pt({ sourceStatus: "TRADE_GRADE" }), INFO);
    expect(r.status).toBe("READY");
    expect(r.met).toBe(true);
  });

  it("DEGRADES (but still met) on delayed data", () => {
    const r = checkRequirement(pt({ sourceStatus: "DELAYED", source: "yahoo", canDriveSignals: false }), INFO);
    expect(r.status).toBe("DEGRADED");
    expect(r.met).toBe(true);
  });

  it("BLOCKS on unavailable data", () => {
    const r = checkRequirement(pt({ sourceStatus: "UNAVAILABLE", source: "none" }), INFO);
    expect(r.met).toBe(false);
  });
});

describe("checkRequirement — DISPLAY_ONLY", () => {
  it("returns READY on any present datum (even delayed)", () => {
    const r = checkRequirement(pt({ sourceStatus: "DELAYED", source: "yahoo" }), DISP);
    expect(r.status).toBe("READY");
  });

  it("BLOCKS only on unavailable", () => {
    const r = checkRequirement(pt({ sourceStatus: "UNAVAILABLE", source: "none" }), DISP);
    expect(r.met).toBe(false);
  });
});

describe("strictestLevel + MODULE_REQUIREMENTS", () => {
  it("fno rolls up to TRADE_GRADE_REQUIRED", () => {
    expect(strictestLevel(MODULE_REQUIREMENTS.fno)).toBe("TRADE_GRADE_REQUIRED");
  });

  it("scanner rolls up to INFO_ONLY_ACCEPTABLE", () => {
    expect(strictestLevel(MODULE_REQUIREMENTS.scanner)).toBe("INFO_ONLY_ACCEPTABLE");
  });

  it("charting rolls up to DISPLAY_ONLY", () => {
    expect(strictestLevel(MODULE_REQUIREMENTS.charting)).toBe("DISPLAY_ONLY");
  });

  it("home tracks ONLY sourced data types — no globalCues (avoids a false BLOCKED)", () => {
    const dataTypes = MODULE_REQUIREMENTS.home.map((r) => r.dataType);
    expect(dataTypes).toContain("indexQuote");
    expect(dataTypes).not.toContain("globalCues");
  });

  it("declares every tracked consumer module", () => {
    expect(Object.keys(MODULE_REQUIREMENTS).sort()).toEqual(
      ["charting", "fno", "home", "optionChain", "portfolio", "prePost", "scanner", "swing", "watchlist"].sort(),
    );
  });
});
