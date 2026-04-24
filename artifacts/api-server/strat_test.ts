import { buildStrategies } from "./src/lib/optionStrategies";
import { yearsToExpiry } from "./src/lib/blackScholes";

const yIso = yearsToExpiry("2026-04-30", new Date("2026-04-24T03:00:00Z"));
const yDmy = yearsToExpiry("30-Apr-2026", new Date("2026-04-24T03:00:00Z"));
console.log("yearsToExpiry parity (ISO vs DMY):", yIso.toFixed(6), "vs", yDmy.toFixed(6),
  Math.abs(yIso - yDmy) < 1e-9 ? "PASS" : "FAIL");

const spot = 24000, step = 50;
const rows: any[] = [];
for (let off = -6; off <= 6; off++) {
  const k = spot + off * step;
  const ceLtp = Math.max(1, 200 - off * 35);
  const peLtp = Math.max(1, 200 + off * 35);
  rows.push({
    strike: k,
    ce: { strike: k, ltp: ceLtp, iv: 15, bid: ceLtp*0.99, ask: ceLtp*1.01, oi: 1000, oiChange: 0, volume: 100, type: "CE" },
    pe: { strike: k, ltp: peLtp, iv: 15, bid: peLtp*0.99, ask: peLtp*1.01, oi: 1000, oiChange: 0, volume: 100, type: "PE" },
  });
}
const chain: any = { underlying: "NIFTY", source: "test", spot, expiry: "2026-04-30", expiries: ["2026-04-30"], atmStrike: spot, lotSize: 75, strikeStep: step, rows, aggregate: { totalCallOi: 13000, totalPutOi: 13000, callOiChange: 0, putOiChange: 0 }, timestamp: new Date().toISOString() };
const analytics: any = { pcrOi: 1, pcrVol: 1, maxPain: spot, atmIv: 15, ivPercentile: 50, supports: [], resistances: [], oiBuildups: [], bias: "NEUTRAL", interpretation: "test" };
const bundle = buildStrategies(chain, analytics);

console.log("\n" + "Kind".padEnd(20) + "| NetDebit  | MaxProfit/lot  | MaxLoss/lot   | Breakevens");
for (const s of bundle.strategies) {
  const mp = s.maxProfit == null ? "    UNBOUNDED" : ("Rs " + s.maxProfit.toFixed(0)).padStart(13);
  const ml = s.maxLoss   == null ? "    UNBOUNDED" : ("Rs " + s.maxLoss.toFixed(0)).padStart(13);
  console.log(s.kind.padEnd(20) + "| " + ("Rs " + s.netDebit.toFixed(2)).padStart(9) + " | " + mp + "  | " + ml + " | " + s.breakevens.map(b => b.toFixed(0)).join(" / "));
}
console.log("\nUnavailable:", bundle.unavailable.length);
