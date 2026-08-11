/**
 * Phase 0.5A — the NSE/BSE collision must not reappear in browser state.
 *
 * The server now stores quotes under an exchange-qualified identity, but the
 * SSE consumer keeps its own map. If that map is keyed by `symbol`, the two
 * listings collapse back into one row on the client. These tests pin the
 * client-side invariant.
 */
import { describe, expect, it } from "vitest";

import { applySnapshot, applyTick, tickKey, type IdentifiedTick } from "./liveTickStream";

interface Tick extends IdentifiedTick {
  ltp: number;
}

const NSE_RELIANCE: Tick = {
  canonicalInstrumentId: "NSE:EQUITY:RELIANCE",
  exchange: "NSE",
  tradingSymbol: "RELIANCE",
  symbol: "RELIANCE",
  ltp: 1500.5,
  ts: 1_700_000_000_000,
};

const BSE_RELIANCE: Tick = {
  canonicalInstrumentId: "BSE:EQUITY:RELIANCE",
  exchange: "BSE",
  tradingSymbol: "RELIANCE",
  symbol: "RELIANCE", // identical legacy alias — this is the collision
  ltp: 1499.8,
  ts: 1_700_000_000_100,
};

describe("live tick stream — exchange-qualified client state", () => {
  it("keys state by canonicalInstrumentId, never by symbol", () => {
    expect(tickKey(NSE_RELIANCE)).toBe("NSE:EQUITY:RELIANCE");
    expect(tickKey(BSE_RELIANCE)).toBe("BSE:EQUITY:RELIANCE");
    expect(tickKey(NSE_RELIANCE)).not.toBe(tickKey(BSE_RELIANCE));
  });

  it("snapshot and tick reduce onto the SAME key", () => {
    // Snapshot arrives keyed by the legacy alias...
    const snap = applySnapshot<Tick>({ RELIANCE: NSE_RELIANCE });
    expect(Object.keys(snap)).toEqual(["NSE:EQUITY:RELIANCE"]);

    // ...and a later tick for the same instrument must land on that key.
    const updated = applyTick(snap, { ...NSE_RELIANCE, ltp: 1502, ts: 1_700_000_001_000 });
    expect(Object.keys(updated)).toEqual(["NSE:EQUITY:RELIANCE"]);
    expect(updated["NSE:EQUITY:RELIANCE"]!.ltp).toBe(1502);
  });

  it("a snapshot followed by a tick creates NO duplicate row", () => {
    // The regression: snapshot keyed by alias + tick keyed by identity would
    // leave both "RELIANCE" and "NSE:EQUITY:RELIANCE" in the map.
    const snap = applySnapshot<Tick>({ RELIANCE: NSE_RELIANCE });
    const after = applyTick(snap, { ...NSE_RELIANCE, ltp: 1503, ts: 1_700_000_002_000 });

    expect(Object.keys(after)).toHaveLength(1);
    expect(after).not.toHaveProperty("RELIANCE");
  });

  it("NSE and BSE listings of one symbol create TWO entries", () => {
    // The server surfaces an ambiguous symbol under its canonical key, so the
    // snapshot can contain either shape. Both must survive.
    const snap = applySnapshot<Tick>({
      "NSE:EQUITY:RELIANCE": NSE_RELIANCE,
      "BSE:EQUITY:RELIANCE": BSE_RELIANCE,
    });

    expect(Object.keys(snap).sort()).toEqual(["BSE:EQUITY:RELIANCE", "NSE:EQUITY:RELIANCE"]);
  });

  it("neither exchange overwrites the other, and each keeps its own price", () => {
    let state = applyTick<Tick>({}, NSE_RELIANCE);
    state = applyTick(state, BSE_RELIANCE);

    expect(Object.keys(state)).toHaveLength(2);
    expect(state["NSE:EQUITY:RELIANCE"]!.ltp).toBe(1500.5);
    expect(state["BSE:EQUITY:RELIANCE"]!.ltp).toBe(1499.8);

    // Updating one leaves the other untouched.
    state = applyTick(state, { ...NSE_RELIANCE, ltp: 1510, ts: 1_700_000_003_000 });
    expect(state["NSE:EQUITY:RELIANCE"]!.ltp).toBe(1510);
    expect(state["BSE:EQUITY:RELIANCE"]!.ltp).toBe(1499.8);
  });

  it("each entry displays its own exchange", () => {
    const state = applyTick(applyTick<Tick>({}, NSE_RELIANCE), BSE_RELIANCE);

    expect(state["NSE:EQUITY:RELIANCE"]!.exchange).toBe("NSE");
    expect(state["BSE:EQUITY:RELIANCE"]!.exchange).toBe("BSE");
    // Both still carry the shared display alias — which is exactly why it
    // cannot be the key.
    expect(state["NSE:EQUITY:RELIANCE"]!.symbol).toBe("RELIANCE");
    expect(state["BSE:EQUITY:RELIANCE"]!.symbol).toBe("RELIANCE");
  });

  it("several aliases of one index collapse to a single entry", () => {
    // ^CNXFIN and NIFTY_FIN_SERVICE.NS are the same instrument (one token).
    const idx: Tick = {
      canonicalInstrumentId: "NSE:INDEX:NIFTY FIN SERVICE",
      exchange: "NSE",
      tradingSymbol: "NIFTY FIN SERVICE",
      symbol: "^CNXFIN",
      ltp: 23000,
      ts: 1_700_000_000_000,
    };
    const snap = applySnapshot<Tick>({
      "^CNXFIN": idx,
      "NIFTY_FIN_SERVICE.NS": { ...idx, symbol: "NIFTY_FIN_SERVICE.NS" },
    });

    expect(Object.keys(snap)).toEqual(["NSE:INDEX:NIFTY FIN SERVICE"]);
  });

  it("a tick with no identity is dropped rather than falling back to symbol", () => {
    const orphan = { symbol: "RELIANCE", ltp: 1, ts: 1 } as unknown as Tick;

    expect(tickKey(orphan)).toBeNull();
    expect(applyTick<Tick>({}, orphan)).toEqual({});
    expect(applySnapshot<Tick>({ RELIANCE: orphan })).toEqual({});
  });

  it("a malformed snapshot payload yields an empty map instead of throwing", () => {
    expect(applySnapshot<Tick>(null)).toEqual({});
    expect(applySnapshot<Tick>(undefined)).toEqual({});
  });
});
