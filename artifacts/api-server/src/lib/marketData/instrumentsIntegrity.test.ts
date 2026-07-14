import { describe, expect, it } from "vitest";
import { diffBaselines } from "./instrumentsIntegrity";

const prev = {
  asOfDate: "2026-07-13",
  rows: {
    "NFO:NIFTY26JUL24000CE": { lot: 75, tick: 0.05, name: "NIFTY" },
    "NFO:BANKNIFTY26JUL52000CE": { lot: 35, tick: 0.05, name: "BANKNIFTY" },
    "BFO:SENSEX26JUL81000CE": { lot: 20, tick: 0.05, name: "SENSEX" },
    "NFO:NIFTY26JUNEXPIRED": { lot: 75, tick: 0.05, name: "NIFTY" },
  },
};

describe("diffBaselines (BUG-35)", () => {
  it("no changes → empty", () => {
    expect(diffBaselines(prev, { ...prev.rows })).toEqual([]);
  });

  it("lot_size change is flagged", () => {
    const cur = { ...prev.rows, "NFO:NIFTY26JUL24000CE": { lot: 50, tick: 0.05, name: "NIFTY" } };
    const changes = diffBaselines(prev, cur);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("lot_size 75 → 50");
  });

  it("tick_size change is flagged", () => {
    const cur = { ...prev.rows, "BFO:SENSEX26JUL81000CE": { lot: 20, tick: 0.1, name: "SENSEX" } };
    const changes = diffBaselines(prev, cur);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("tick_size 0.05 → 0.1");
  });

  it("expired/delisted contracts (missing in current) are NOT flagged", () => {
    const cur = { ...prev.rows } as Record<string, { lot: number; tick: number; name: string }>;
    delete cur["NFO:NIFTY26JUNEXPIRED"];
    expect(diffBaselines(prev, cur)).toEqual([]);
  });

  it("brand-new contracts (weekly expiry churn) are NOT flagged", () => {
    const cur = { ...prev.rows, "NFO:NIFTY26AUG24000CE": { lot: 75, tick: 0.05, name: "NIFTY" } };
    expect(diffBaselines(prev, cur)).toEqual([]);
  });
});
