/**
 * Higher-level analytics computed off a fetched option chain:
 * PCR (OI + Volume), Max Pain, total OI, top OI clusters (support/resistance),
 * ATM IV (avg of nearest CE+PE IV), and a plain-English bias interpretation.
 */

import type { OcResponse } from "./optionChain";

export interface OiCluster { strike: number; oi: number }

/**
 * Max-Pain strike: the strike where the aggregate loss to all option WRITERS
 * is minimised, i.e. where most options would expire worthless. Iterate every
 * strike; for each candidate `target` sum (target − K)·CE_OI for K<target and
 * (K − target)·PE_OI for K>target. The candidate with the smallest sum wins.
 *
 * Extracted so both the chain finaliser (per-row `isMaxPain` flag + top-level
 * `maxPainStrike`) and the analytics endpoint use the same algorithm and can
 * never drift out of sync.
 */
export function computeMaxPainStrike(chain: OcResponse): number {
  let maxPain = chain.atmStrike;
  let minPain = Infinity;
  for (const target of chain.rows) {
    let pain = 0;
    for (const r of chain.rows) {
      if (r.strike < target.strike) pain += (target.strike - r.strike) * (r.ce?.oi ?? 0);
      else if (r.strike > target.strike) pain += (r.strike - target.strike) * (r.pe?.oi ?? 0);
    }
    if (pain < minPain) { minPain = pain; maxPain = target.strike; }
  }
  return maxPain;
}

export interface OptionAnalytics {
  underlying: string;
  spot: number;
  expiry: string;
  pcrOi: number;
  pcrVolume: number;
  maxPain: number;
  atmIv: number | null;
  ivPercentile: number | null;
  totalCallOi: number;
  totalPutOi: number;
  callOiAdded: number;
  putOiAdded: number;
  topResistance: OiCluster[];
  topSupport: OiCluster[];
  interpretation: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  generatedAt: string;
}

export function computeAnalytics(chain: OcResponse): OptionAnalytics {
  let totalCallOi = 0, totalPutOi = 0;
  let callVol = 0, putVol = 0;
  let callOiAdded = 0, putOiAdded = 0;
  const callByStrike: OiCluster[] = [];
  const putByStrike: OiCluster[] = [];

  for (const r of chain.rows) {
    if (r.ce) {
      totalCallOi += r.ce.oi ?? 0;
      callVol     += r.ce.volume ?? 0;
      callOiAdded += r.ce.chgOi ?? 0;
      callByStrike.push({ strike: r.strike, oi: r.ce.oi ?? 0 });
    }
    if (r.pe) {
      totalPutOi += r.pe.oi ?? 0;
      putVol     += r.pe.volume ?? 0;
      putOiAdded += r.pe.chgOi ?? 0;
      putByStrike.push({ strike: r.strike, oi: r.pe.oi ?? 0 });
    }
  }

  const pcrOi     = totalCallOi > 0 ? +(totalPutOi / totalCallOi).toFixed(3) : 0;
  const pcrVolume = callVol     > 0 ? +(putVol     / callVol).toFixed(3)     : 0;

  // Max-pain — same algorithm as the chain finaliser. If the chain already
  // carries it (set by `finalizeChain`) reuse it; otherwise compute. Both
  // surfaces always agree because they share `computeMaxPainStrike`.
  const maxPain = chain.maxPainStrike ?? computeMaxPainStrike(chain);

  // ATM IV — pick the row whose strike == atmStrike (or closest) and avg
  // CE & PE implied vols.
  const atmRow = chain.rows.find(r => r.strike === chain.atmStrike)
    ?? chain.rows.slice().sort((a, b) => Math.abs(a.strike - chain.spot) - Math.abs(b.strike - chain.spot))[0];
  let atmIv: number | null = null;
  if (atmRow) {
    const ce = atmRow.ce?.iv;
    const pe = atmRow.pe?.iv;
    if (ce && pe) atmIv = +((ce + pe) / 2).toFixed(2);
    else if (ce) atmIv = +ce.toFixed(2);
    else if (pe) atmIv = +pe.toFixed(2);
  }

  // Top OI clusters (calls = resistance, puts = support)
  const topResistance = callByStrike.sort((a, b) => b.oi - a.oi).slice(0, 5);
  const topSupport    = putByStrike.sort((a, b) => b.oi - a.oi).slice(0, 5);

  // Bias
  let bias: OptionAnalytics["bias"] = "NEUTRAL";
  if (pcrOi >= 1.3 && putOiAdded > callOiAdded) bias = "BULLISH";
  else if (pcrOi <= 0.7 && callOiAdded > putOiAdded) bias = "BEARISH";
  else if (chain.spot > maxPain * 1.005) bias = "BULLISH";
  else if (chain.spot < maxPain * 0.995) bias = "BEARISH";

  const interpretation = buildInterpretation({
    pcrOi, maxPain, spot: chain.spot,
    callOiAdded, putOiAdded,
    topResistance, topSupport,
    bias,
  });

  return {
    underlying: chain.underlying,
    spot: chain.spot,
    expiry: chain.expiry,
    pcrOi,
    pcrVolume,
    maxPain,
    atmIv,
    ivPercentile: null, // Filled in once we collect IV history
    totalCallOi,
    totalPutOi,
    callOiAdded,
    putOiAdded,
    topResistance,
    topSupport,
    interpretation,
    bias,
    generatedAt: new Date().toISOString(),
  };
}

function buildInterpretation(args: {
  pcrOi: number; maxPain: number; spot: number;
  callOiAdded: number; putOiAdded: number;
  topResistance: OiCluster[]; topSupport: OiCluster[];
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
}): string {
  const parts: string[] = [];
  if (args.pcrOi >= 1.3) parts.push(`PCR ${args.pcrOi.toFixed(2)} (heavy put writing — bullish undertone)`);
  else if (args.pcrOi <= 0.7) parts.push(`PCR ${args.pcrOi.toFixed(2)} (heavy call writing — bearish undertone)`);
  else parts.push(`PCR ${args.pcrOi.toFixed(2)} (balanced positioning)`);

  const mpDiff = ((args.spot - args.maxPain) / args.maxPain) * 100;
  parts.push(`Max-pain ${args.maxPain.toFixed(0)} (${mpDiff >= 0 ? "+" : ""}${mpDiff.toFixed(2)}% vs spot)`);

  if (args.topResistance[0]) parts.push(`Top resistance ${args.topResistance[0].strike}`);
  if (args.topSupport[0])    parts.push(`Top support ${args.topSupport[0].strike}`);

  if (args.callOiAdded > args.putOiAdded * 1.2) parts.push("Calls added > Puts → upside capped");
  else if (args.putOiAdded > args.callOiAdded * 1.2) parts.push("Puts added > Calls → downside cushioned");

  parts.push(`Bias: ${args.bias}`);
  return parts.join(" · ");
}
