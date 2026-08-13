/**
 * Phase 0.7A — an absent `preferExchange` must never silently prefer NSE.
 *
 * A bare symbol that lists on both NSE and BSE names two different order books
 * with two different prices. Choosing the NSE one "because it usually is"
 * invents an identity that everything downstream (quotes, candles, positions)
 * then treats as fact. The resolver must hand the choice back instead.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveInstrument,
  searchMaster,
  resetResolverCache,
  _forTesting_overrideCacheDir,
  type ResolveResult,
} from "./instrumentResolver";

const DISK_VERSION = 1;

/**
 * Fixture shapes, each exercising one identity hazard:
 *   DUALCO          — same tradingsymbol on both exchanges (exact-symbol path)
 *   ONLYNSE/ONLYBSE — unique listings (must still resolve unqualified)
 *   ARE&M           — alias target (AMARAJABAT → ARE&M), listed on both
 *   L&TFH / L-TFH / L_TFH — three punctuation variants sharing the alnum key
 *                     LTFH: two on NSE, one on BSE (alnum path, and two
 *                     same-exchange candidates under an explicit preference)
 *   DUPCODEA/B      — a malformed master repeating one BSE scrip code
 */
const NSE_FIXTURE = [
  { instrument_token: 2001, exchange_token: 2001, tradingsymbol: "DUALCO",  name: "DUAL LISTED CO LTD",   instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 2002, exchange_token: 2002, tradingsymbol: "ONLYNSE", name: "ONLY NSE LTD",         instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 2003, exchange_token: 2003, tradingsymbol: "ARE&M",   name: "AMARA RAJA E&M LTD",   instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 2101, exchange_token: 2101, tradingsymbol: "L&TFH",   name: "L AND T FINANCE A",    instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
  { instrument_token: 2102, exchange_token: 2102, tradingsymbol: "L-TFH",   name: "L AND T FINANCE B",    instrument_type: "EQ", segment: "NSE", exchange: "NSE" },
];

const BSE_FIXTURE = [
  { instrument_token: 8001, exchange_token: 500001, tradingsymbol: "DUALCO",   name: "DUAL LISTED CO LTD", instrument_type: "EQ", segment: "BSE", exchange: "BSE" },
  { instrument_token: 8002, exchange_token: 500002, tradingsymbol: "ONLYBSE",  name: "ONLY BSE LTD",       instrument_type: "EQ", segment: "BSE", exchange: "BSE" },
  { instrument_token: 8003, exchange_token: 500003, tradingsymbol: "ARE&M",    name: "AMARA RAJA E&M LTD", instrument_type: "EQ", segment: "BSE", exchange: "BSE" },
  { instrument_token: 8101, exchange_token: 500101, tradingsymbol: "L_TFH",    name: "L AND T FINANCE C",  instrument_type: "EQ", segment: "BSE", exchange: "BSE" },
  { instrument_token: 8201, exchange_token: 500999, tradingsymbol: "DUPCODEA", name: "DUP CODE A LTD",     instrument_type: "EQ", segment: "BSE", exchange: "BSE" },
  { instrument_token: 8202, exchange_token: 500999, tradingsymbol: "DUPCODEB", name: "DUP CODE B LTD",     instrument_type: "EQ", segment: "BSE", exchange: "BSE" },
];

function writeMaster(dir: string, nse: unknown[], bse: unknown[]): void {
  fs.writeFileSync(
    path.join(dir, "kite_instruments_NSE.json"),
    JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: nse }),
  );
  fs.writeFileSync(
    path.join(dir, "kite_instruments_BSE.json"),
    JSON.stringify({ version: DISK_VERSION, ts: Date.now(), payload: bse }),
  );
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-ambiguity-"));
  writeMaster(tmpDir, NSE_FIXTURE, BSE_FIXTURE);
  _forTesting_overrideCacheDir(tmpDir);
  resetResolverCache();
});

afterAll(() => {
  _forTesting_overrideCacheDir(null);
  resetResolverCache();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("P0.7A — explicit exchange still resolves exactly as before", () => {
  it("explicit NSE selects the NSE listing of a dual-listed symbol", () => {
    const r = resolveInstrument("DUALCO", { preferExchange: "NSE" });
    expect(r.outcome).toBe("RESOLVED");
    expect(r.resolved).toBe(true);
    expect(r.instrument?.kite_key).toBe("NSE:DUALCO");
    expect(r.instrument?.instrument_token).toBe(2001);
    expect(r.candidates).toEqual([]);
  });

  it("explicit BSE selects the BSE listing of the same symbol", () => {
    const r = resolveInstrument("DUALCO", { preferExchange: "BSE" });
    expect(r.outcome).toBe("RESOLVED");
    expect(r.instrument?.kite_key).toBe("BSE:DUALCO");
    expect(r.instrument?.instrument_token).toBe(8001);
    expect(r.instrument?.bse_code).toBe("500001");
  });

  it("an explicit preference still resolves a symbol that lists only elsewhere", () => {
    // Unique across the master → the caller's preference cannot make it wrong.
    const r = resolveInstrument("ONLYBSE", { preferExchange: "NSE" });
    expect(r.outcome).toBe("RESOLVED");
    expect(r.instrument?.exchange).toBe("BSE");
  });

  it("an explicit preference picks deterministically among same-exchange alnum matches", () => {
    // L&TFH and L-TFH both live on NSE and share the alnum key LTFH.
    const r = resolveInstrument("LTFH", { preferExchange: "NSE" });
    expect(r.outcome).toBe("RESOLVED");
    expect(r.matched_via).toBe("alnum-normalized");
    expect(r.instrument?.exchange).toBe("NSE");
    expect(["L&TFH", "L-TFH"]).toContain(r.instrument?.canonical_symbol);
    // Repeated calls agree; the cross-file-order case is asserted below.
    expect(resolveInstrument("LTFH", { preferExchange: "NSE" }).instrument?.instrument_token)
      .toBe(r.instrument?.instrument_token);
  });

  it("an explicit preference resolves an alias target that lists on both exchanges", () => {
    const r = resolveInstrument("AMARAJABAT", { preferExchange: "BSE" });
    expect(r.outcome).toBe("RESOLVED");
    expect(r.instrument?.kite_key).toBe("BSE:ARE&M");
    expect(r.matched_via).toBe("alias:AMARAJABAT→ARE&M");
  });
});

describe("P0.7A — unqualified symbols", () => {
  it("a unique unqualified symbol resolves without a preference", () => {
    const nse = resolveInstrument("ONLYNSE");
    expect(nse.outcome).toBe("RESOLVED");
    expect(nse.instrument?.kite_key).toBe("NSE:ONLYNSE");

    const bse = resolveInstrument("ONLYBSE");
    expect(bse.outcome).toBe("RESOLVED");
    expect(bse.instrument?.kite_key).toBe("BSE:ONLYBSE");
  });

  it("a dual-listed unqualified symbol is AMBIGUOUS, never first-result", () => {
    const r = resolveInstrument("DUALCO");
    expect(r.outcome).toBe("AMBIGUOUS");
    expect(r.resolved).toBe(false);
    expect(r.instrument).toBeNull();
    expect(r.matched_via).toBeNull();
    // Both identities are offered, each fully exchange-qualified.
    expect(r.candidates.map(c => c.kite_key).sort()).toEqual(["BSE:DUALCO", "NSE:DUALCO"]);
    for (const c of r.candidates) {
      expect(["NSE", "BSE"]).toContain(c.exchange);
      expect(c.instrument_token).toBeGreaterThan(0);
    }
    expect(r.reason).toMatch(/preferExchange/);
    expect(r.attempts.some(a => a.startsWith("ambiguous:"))).toBe(true);
  });

  it("the alnum path reports ambiguity instead of picking the NSE punctuation variant", () => {
    // "LTFH" matches no tradingsymbol exactly; it alnum-matches two NSE rows
    // and one BSE row, so there is no single identity to return.
    const r = resolveInstrument("LTFH");
    expect(r.outcome).toBe("AMBIGUOUS");
    expect(r.attempts).toContain("alnum-normalized");
    expect(r.attempts.some(a => a === "ambiguous:alnum-normalized")).toBe(true);
    expect(r.candidates.map(c => c.kite_key).sort()).toEqual([
      "BSE:L_TFH", "NSE:L&TFH", "NSE:L-TFH",
    ]);
  });

  it("an unqualified alias target that lists on both exchanges is AMBIGUOUS", () => {
    const r = resolveInstrument("AMARAJABAT");
    expect(r.outcome).toBe("AMBIGUOUS");
    expect(r.instrument).toBeNull();
    expect(r.candidates.map(c => c.kite_key).sort()).toEqual(["BSE:ARE&M", "NSE:ARE&M"]);
    expect(r.attempts.some(a => a.startsWith("ambiguous:alias:"))).toBe(true);
  });

  it("a BSE scrip code names one listing, so it resolves without a preference", () => {
    const r = resolveInstrument("500002");
    expect(r.outcome).toBe("RESOLVED");
    expect(r.matched_via).toBe("bse-code");
    expect(r.instrument?.kite_key).toBe("BSE:ONLYBSE");
  });
});

describe("P0.7A — invalid and unknown inputs fail closed", () => {
  it("an invalid exchange is rejected instead of falling back to NSE", () => {
    const r = resolveInstrument("DUALCO", { preferExchange: "MCX" as never });
    expect(r.outcome).toBe("UNRESOLVED");
    expect(r.resolved).toBe(false);
    expect(r.instrument).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/Invalid preferExchange/);
    // It must not have silently resolved the NSE listing.
    expect(r.matched_via).toBeNull();
  });

  it("an empty-string exchange is invalid, not 'no preference'", () => {
    const r = resolveInstrument("ONLYNSE", { preferExchange: "" as never });
    expect(r.outcome).toBe("UNRESOLVED");
    expect(r.reason).toMatch(/Invalid preferExchange/);
  });

  it("an unknown symbol stays UNRESOLVED with an explicit reason", () => {
    const r = resolveInstrument("ZZZ_NOT_LISTED_ANYWHERE_123");
    expect(r.outcome).toBe("UNRESOLVED");
    expect(r.resolved).toBe(false);
    expect(r.candidates).toEqual([]);
    expect(r.reason).toBeTruthy();
  });

  it("an unknown BSE scrip code fails rather than falling through to a symbol guess", () => {
    const r = resolveInstrument("999999");
    expect(r.outcome).toBe("UNRESOLVED");
    expect(r.instrument).toBeNull();
    expect(r.reason).toMatch(/scrip code/);
  });
});

describe("P0.7A — results do not depend on master-file order", () => {
  const snapshot = (r: ResolveResult) => ({
    outcome: r.outcome,
    key: r.instrument?.kite_key ?? null,
    token: r.instrument?.instrument_token ?? null,
    matchedVia: r.matched_via,
    candidates: r.candidates.map(c => c.kite_key),
  });

  it("reversed master rows produce identical resolutions on every path", () => {
    const inOrder = {
      exactAmbiguous: snapshot(resolveInstrument("DUALCO")),
      exactPreferred: snapshot(resolveInstrument("DUALCO", { preferExchange: "NSE" })),
      alnumAmbiguous: snapshot(resolveInstrument("LTFH")),
      alnumPreferred: snapshot(resolveInstrument("LTFH", { preferExchange: "NSE" })),
      aliasAmbiguous: snapshot(resolveInstrument("AMARAJABAT")),
      aliasPreferred: snapshot(resolveInstrument("AMARAJABAT", { preferExchange: "NSE" })),
      bseCode: snapshot(resolveInstrument("500002")),
      duplicateBseCode: snapshot(resolveInstrument("500999")),
      unique: snapshot(resolveInstrument("ONLYBSE")),
    };
    const searchInOrder = searchMaster("ONLY", 10).map(h => `${h.exchange}:${h.symbol}`);

    const shuffledDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-ambiguity-rev-"));
    try {
      writeMaster(shuffledDir, [...NSE_FIXTURE].reverse(), [...BSE_FIXTURE].reverse());
      _forTesting_overrideCacheDir(shuffledDir);
      resetResolverCache();

      expect(snapshot(resolveInstrument("DUALCO"))).toEqual(inOrder.exactAmbiguous);
      expect(snapshot(resolveInstrument("DUALCO", { preferExchange: "NSE" }))).toEqual(inOrder.exactPreferred);
      expect(snapshot(resolveInstrument("LTFH"))).toEqual(inOrder.alnumAmbiguous);
      // The same-exchange punctuation variants must not swap places.
      expect(snapshot(resolveInstrument("LTFH", { preferExchange: "NSE" }))).toEqual(inOrder.alnumPreferred);
      expect(snapshot(resolveInstrument("AMARAJABAT"))).toEqual(inOrder.aliasAmbiguous);
      expect(snapshot(resolveInstrument("AMARAJABAT", { preferExchange: "NSE" }))).toEqual(inOrder.aliasPreferred);
      expect(snapshot(resolveInstrument("500002"))).toEqual(inOrder.bseCode);
      // A malformed master repeating one scrip code still answers identically.
      expect(snapshot(resolveInstrument("500999"))).toEqual(inOrder.duplicateBseCode);
      expect(snapshot(resolveInstrument("ONLYBSE"))).toEqual(inOrder.unique);
      expect(searchMaster("ONLY", 10).map(h => `${h.exchange}:${h.symbol}`)).toEqual(searchInOrder);
      // Candidate order itself is stable, not merely set-equal.
      expect(resolveInstrument("DUALCO").candidates.map(c => c.kite_key)).toEqual(["NSE:DUALCO", "BSE:DUALCO"]);
    } finally {
      _forTesting_overrideCacheDir(tmpDir);
      resetResolverCache();
      try { fs.rmSync(shuffledDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
