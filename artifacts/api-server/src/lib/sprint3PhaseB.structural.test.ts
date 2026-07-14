/**
 * Sprint 3 Phase B — Structural tests for DTO expansion.
 *
 * Verify that kiteOptionChain.ts and optionChain.ts:
 *   1. Populate new OcSide fields (open/high/low/ltpChange) from Kite
 *   2. Carry futurePrice / syntheticFuture on OcResponse
 *   3. Carry source provenance for all new fields
 *   4. Do NOT introduce Yahoo for any new field
 *   5. Label syntheticFuture as "modelled"
 *   6. GEX module exists and exports expected functions
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const readSrc = (name: string) =>
  readFileSync(resolve(__dirname, name), "utf-8");

describe("Sprint 3 Phase B — kiteOptionChain.ts structural", () => {
  const src = readSrc("kiteOptionChain.ts");

  it("populates open/high/low from Kite OHLC", () => {
    expect(src).toContain("open: Number.isFinite(q.ohlc?.open)");
    expect(src).toContain("high: Number.isFinite(q.ohlc?.high)");
    expect(src).toContain("low:  Number.isFinite(q.ohlc?.low)");
  });

  it("populates ltpChange from Kite prev-close", () => {
    expect(src).toContain("side.ltpChange");
  });

  it("looks up nearest-month FUT LTP", () => {
    expect(src).toContain("i.instrument_type === \"FUT\"");
    expect(src).toContain("futurePrice");
    expect(src).toContain("futureSource");
    expect(src).toContain("futureExpiry");
  });

  it("computes syntheticFuture from put-call parity", () => {
    expect(src).toContain("syntheticFuture");
    expect(src).toContain("atmStrike + ceLtp - peLtp");
  });

  it("marks syntheticFuture as modelled", () => {
    expect(src).toContain("syntheticFutureModelled: true");
  });

  it("does NOT introduce Yahoo for future price", () => {
    // No Yahoo import added
    expect(src).not.toContain('from "./yahoo"');
    expect(src).not.toContain("fetchChart");
    expect(src).not.toContain("yahoo-finance2");
  });

  it("futureSource is kite or unavailable only", () => {
    expect(src).toContain('"kite" | "unavailable"');
  });
});

describe("Sprint 3 Phase B — optionChain.ts type contract", () => {
  const src = readSrc("optionChain.ts");

  it("OcSide interface has new Sprint 3 fields", () => {
    expect(src).toContain("ltpChange?: number | null;");
    expect(src).toContain("open?: number | null;");
    expect(src).toContain("high?: number | null;");
    expect(src).toContain("low?: number | null;");
  });

  it("OcResponse has futurePrice field", () => {
    expect(src).toContain("futurePrice?: number | null;");
    expect(src).toContain("futureSource?: OcFutureSource;");
    expect(src).toContain("futureExpiry?: string | null;");
  });

  it("OcResponse has syntheticFuture field", () => {
    expect(src).toContain("syntheticFuture?: number | null;");
    expect(src).toContain("syntheticFutureModelled?: true;");
  });

  it("OcFutureSource type exists and excludes yahoo", () => {
    expect(src).toContain('export type OcFutureSource = "kite" | "unavailable"');
    expect(src).not.toContain('OcFutureSource = "yahoo"');
  });

  it("syntheticFuture docstring says MODELLED", () => {
    expect(src).toContain("MODELLED VALUE");
    expect(src).toContain("SYNTH FUTURE");
  });

  it("futurePrice docstring says NOT used for signal/trade/sizing", () => {
    expect(src).toContain("NOT used for: paper-trade gate");
    expect(src).toContain("NOT approved: weekly mini-futures");
  });
});

describe("Sprint 3 Phase B — gex.ts structural", () => {
  const src = readSrc("gex.ts");

  it("exports normalizeOiToQuantity", () => {
    expect(src).toContain("export function normalizeOiToQuantity");
  });

  it("exports computeGexPerStrike", () => {
    expect(src).toContain("export function computeGexPerStrike");
  });

  it("exports computeGexFlipPoint", () => {
    expect(src).toContain("export function computeGexFlipPoint");
  });

  it("exports computeChainGex", () => {
    expect(src).toContain("export function computeChainGex");
  });

  it("exports OpenInterestUnit type", () => {
    expect(src).toContain("export type OpenInterestUnit");
  });

  it("documents Kite/NSE OI as CONTRACTS (lots), not underlying quantity", () => {
    expect(src).toContain("number of CONTRACTS (lots)");
    // Must NOT say OI is in quantity/shares from Kite/NSE
    expect(src).not.toContain("Kite's `q.oi` and NSE's `openInterest` both return OI in QUANTITY");
  });

  it("GEX formula correctly multiplies by lotSize for contracts mode", () => {
    // The formula step: effectiveQty = rawOI × lotSize
    expect(src).toContain("rawOI_contracts × lotSize");
    expect(src).toContain("effectiveUnderlyingQuantity = rawOI_contracts × lotSize");
  });

  it("documents the oiLab.ts notional proof", () => {
    expect(src).toContain("notional = ltp * q.oi * lot_size");
  });

  it("normalizeOiToQuantity returns null when lotSize missing in contracts mode", () => {
    expect(src).toContain("if (lotSize == null");
  });

  it("sign convention: call positive, put negative", () => {
    expect(src).toContain("Call GEX: positive");
    expect(src).toContain("Put GEX: negative");
  });

  it("labels GEX as modelled everywhere", () => {
    expect(src).toContain("MODELLED GEX");
    expect(src).toContain("not exchange-verified");
    expect(src).toContain("modelled: true");
  });

  it("does NOT use Yahoo for any GEX computation", () => {
    expect(src).not.toContain("yahoo");
    expect(src).not.toContain("Yahoo");
  });

  it("returns null (not fake zero) when data is missing", () => {
    expect(src).toContain("if (!Number.isFinite(spot) || spot <= 0) return null");
    expect(src).toContain("if (!hasAnyGamma) return null");
  });

  it("computeChainGex defaults to contracts mode", () => {
    expect(src).toContain('computeGexPerStrike(chain.rows, chain.spot, chain.lotSize, "contracts")');
  });
});
