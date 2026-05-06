/**
 * Higher-level analytics computed off a fetched option chain:
 * PCR (OI + Volume), Max Pain, total OI, top OI clusters (support/resistance),
 * ATM IV (avg of nearest CE+PE IV), confidence-scored market read, and
 * structured reasons array for the Option Chain "Market Read" card.
 */

import type { OcResponse } from "./optionChain";
import { computeMarketStatus } from "./marketEvents";

export interface OiCluster {
  strike: number;
  oi: number;
  chgOi: number | null;
  volume?: number;
  strength?: "STRONG" | "MEDIUM" | "WEAK";
}

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

export interface MarketReadReason {
  signal: string;
  detail: string;
  impact: "BULLISH" | "BEARISH" | "NEUTRAL";
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
  ivRank: number | null;
  totalCallOi: number;
  totalPutOi: number;
  callOiAdded: number;
  putOiAdded: number;
  topResistance: OiCluster[];
  topSupport: OiCluster[];
  interpretation: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidenceScore: number;
  marketReadReasons: MarketReadReason[];
  invalidation: string;
  marketStatus: "open" | "closed" | "pre_open";
  generatedAt: string;
}

function computeStrength(
  cluster: { oi: number; chgOi: number | null; volume?: number },
  maxOi: number,
  spot: number,
  strike: number,
): "STRONG" | "MEDIUM" | "WEAK" {
  let score = 0;
  if (maxOi > 0) {
    const oiPct = cluster.oi / maxOi;
    if (oiPct >= 0.8) score += 3;
    else if (oiPct >= 0.5) score += 2;
    else score += 1;
  }
  if (cluster.chgOi != null && cluster.chgOi > 0) score += 2;
  else if (cluster.chgOi != null && cluster.chgOi < 0) score -= 1;

  if (cluster.volume && cluster.volume > 0) {
    const volOi = cluster.oi > 0 ? cluster.volume / cluster.oi : 0;
    if (volOi >= 0.5) score += 1;
  }
  const proximity = Math.abs((strike - spot) / spot) * 100;
  if (proximity <= 2) score += 2;
  else if (proximity <= 5) score += 1;

  if (score >= 6) return "STRONG";
  if (score >= 3) return "MEDIUM";
  return "WEAK";
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
      callByStrike.push({ strike: r.strike, oi: r.ce.oi ?? 0, chgOi: r.ce.chgOi ?? null, volume: r.ce.volume ?? 0 });
    }
    if (r.pe) {
      totalPutOi += r.pe.oi ?? 0;
      putVol     += r.pe.volume ?? 0;
      putOiAdded += r.pe.chgOi ?? 0;
      putByStrike.push({ strike: r.strike, oi: r.pe.oi ?? 0, chgOi: r.pe.chgOi ?? null, volume: r.pe.volume ?? 0 });
    }
  }

  const pcrOi     = totalCallOi > 0 ? +(totalPutOi / totalCallOi).toFixed(3) : 0;
  const pcrVolume = callVol     > 0 ? +(putVol     / callVol).toFixed(3)     : 0;

  const maxPain = chain.maxPainStrike ?? computeMaxPainStrike(chain);

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

  // Side-correct R/S: a CE wall only counts as resistance if its strike is
  // AT or ABOVE spot (an ITM call has high OI for hedging reasons but is not
  // a price ceiling). Symmetric for PE / support. Without this filter the
  // top-OI strike on the wrong side of spot bubbled up as the "wall" — e.g.
  // BANKNIFTY snapshot showed R=S=60000 with spot 54729 because the deep-ITM
  // 60000 PE was the highest PE OI in the loaded window. The filter discards
  // wrong-side OI from the R/S calc only; aggregates (totalCallOi/totalPutOi
  // / PCR / max-pain) are unaffected.
  const sortDesc = (a: OiCluster, b: OiCluster): number => b.oi - a.oi;
  const resistanceCandidates = callByStrike.filter(c => c.strike >= chain.spot);
  const supportCandidates    = putByStrike.filter(c => c.strike <= chain.spot);
  // Defensive fallback: if spot sits beyond every loaded strike on one side
  // (very rare; would only happen with a truncated chain) fall back to the
  // unfiltered list so the column still renders SOMETHING rather than "—".
  const topResistanceSorted = (resistanceCandidates.length > 0 ? resistanceCandidates : callByStrike)
    .slice().sort(sortDesc).slice(0, 5);
  const topSupportSorted    = (supportCandidates.length > 0 ? supportCandidates : putByStrike)
    .slice().sort(sortDesc).slice(0, 5);

  const maxCallOi = topResistanceSorted[0]?.oi ?? 0;
  const maxPutOi  = topSupportSorted[0]?.oi ?? 0;

  const topResistance: OiCluster[] = topResistanceSorted.map(c => ({
    ...c,
    strength: computeStrength(c, maxCallOi, chain.spot, c.strike),
  }));
  const topSupport: OiCluster[] = topSupportSorted.map(c => ({
    ...c,
    strength: computeStrength(c, maxPutOi, chain.spot, c.strike),
  }));

  let bias: OptionAnalytics["bias"] = "NEUTRAL";
  if (pcrOi >= 1.3 && putOiAdded > callOiAdded) bias = "BULLISH";
  else if (pcrOi <= 0.7 && callOiAdded > putOiAdded) bias = "BEARISH";
  else if (chain.spot > maxPain * 1.005) bias = "BULLISH";
  else if (chain.spot < maxPain * 0.995) bias = "BEARISH";

  const { reasons, confidence, invalidation } = buildMarketRead({
    pcrOi, pcrVolume, maxPain, spot: chain.spot,
    callOiAdded, putOiAdded,
    totalCallOi, totalPutOi,
    topResistance, topSupport,
    bias, atmIv,
  });

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
    ivPercentile: null,
    ivRank: null,
    totalCallOi,
    totalPutOi,
    callOiAdded,
    putOiAdded,
    topResistance,
    topSupport,
    interpretation,
    bias,
    confidenceScore: confidence,
    marketReadReasons: reasons,
    invalidation,
    marketStatus: computeMarketStatus(new Date()),
    generatedAt: new Date().toISOString(),
  };
}

function buildMarketRead(args: {
  pcrOi: number; pcrVolume: number; maxPain: number; spot: number;
  callOiAdded: number; putOiAdded: number;
  totalCallOi: number; totalPutOi: number;
  topResistance: OiCluster[]; topSupport: OiCluster[];
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  atmIv: number | null;
}): { reasons: MarketReadReason[]; confidence: number; invalidation: string } {
  const reasons: MarketReadReason[] = [];
  let confidencePoints = 0;
  const maxPoints = 5;

  if (args.pcrOi >= 1.3) {
    reasons.push({ signal: "PCR", detail: `PCR ${args.pcrOi.toFixed(2)} — heavy put writing indicates bullish undertone`, impact: "BULLISH" });
    confidencePoints += args.bias === "BULLISH" ? 1 : 0.5;
  } else if (args.pcrOi <= 0.7) {
    reasons.push({ signal: "PCR", detail: `PCR ${args.pcrOi.toFixed(2)} — heavy call writing indicates bearish pressure`, impact: "BEARISH" });
    confidencePoints += args.bias === "BEARISH" ? 1 : 0.5;
  } else {
    reasons.push({ signal: "PCR", detail: `PCR ${args.pcrOi.toFixed(2)} — balanced positioning, no clear directional bias`, impact: "NEUTRAL" });
    confidencePoints += args.bias === "NEUTRAL" ? 0.5 : 0;
  }

  const mpDiff = ((args.spot - args.maxPain) / args.maxPain) * 100;
  if (Math.abs(mpDiff) > 1) {
    const above = mpDiff > 0;
    reasons.push({
      signal: "Max Pain",
      detail: `Spot ${above ? "above" : "below"} max-pain by ${Math.abs(mpDiff).toFixed(1)}% — ${above ? "pullback towards max-pain likely" : "magnet effect may lift price"}`,
      impact: above ? "BEARISH" : "BULLISH",
    });
    confidencePoints += 0.5;
  } else {
    reasons.push({ signal: "Max Pain", detail: `Spot near max-pain (${mpDiff >= 0 ? "+" : ""}${mpDiff.toFixed(1)}%) — range-bound tendency`, impact: "NEUTRAL" });
    confidencePoints += 0.3;
  }

  if (args.putOiAdded > args.callOiAdded * 1.2) {
    reasons.push({ signal: "OI Flow", detail: `Put writers adding faster than calls (${fmtKLServer(args.putOiAdded)} vs ${fmtKLServer(args.callOiAdded)}) — downside cushion building`, impact: "BULLISH" });
    confidencePoints += args.bias === "BULLISH" ? 1 : 0.5;
  } else if (args.callOiAdded > args.putOiAdded * 1.2) {
    reasons.push({ signal: "OI Flow", detail: `Call writers adding faster than puts (${fmtKLServer(args.callOiAdded)} vs ${fmtKLServer(args.putOiAdded)}) — upside capped`, impact: "BEARISH" });
    confidencePoints += args.bias === "BEARISH" ? 1 : 0.5;
  } else {
    reasons.push({ signal: "OI Flow", detail: "Call and put OI additions roughly balanced", impact: "NEUTRAL" });
  }

  const r1 = args.topResistance[0];
  const s1 = args.topSupport[0];
  if (r1 && s1) {
    const range = r1.strike - s1.strike;
    const spotInRange = args.spot >= s1.strike && args.spot <= r1.strike;
    if (spotInRange && range > 0) {
      const posInRange = ((args.spot - s1.strike) / range) * 100;
      reasons.push({
        signal: "Key Levels",
        detail: `Trading in ${s1.strike}–${r1.strike} range, ${posInRange.toFixed(0)}% from support — ${posInRange > 70 ? "near resistance ceiling" : posInRange < 30 ? "near support floor" : "mid-range"}`,
        impact: posInRange > 70 ? "BEARISH" : posInRange < 30 ? "BULLISH" : "NEUTRAL",
      });
      confidencePoints += 0.7;
    } else if (!spotInRange) {
      reasons.push({
        signal: "Key Levels",
        detail: `Spot ${args.spot > r1.strike ? "above R1" : "below S1"} — ${args.spot > r1.strike ? "breakout territory, call writers under pressure" : "breakdown zone, put writers tested"}`,
        impact: args.spot > r1.strike ? "BULLISH" : "BEARISH",
      });
      confidencePoints += 0.5;
    }
  }

  if (args.pcrVolume > 0) {
    const volPcrAligned = (args.pcrVolume >= 1.2 && args.pcrOi >= 1.2) || (args.pcrVolume <= 0.8 && args.pcrOi <= 0.8);
    if (volPcrAligned) {
      reasons.push({ signal: "Volume", detail: `Volume PCR (${args.pcrVolume.toFixed(2)}) confirms OI PCR direction — higher conviction`, impact: args.pcrVolume >= 1.2 ? "BULLISH" : "BEARISH" });
      confidencePoints += 1;
    }
  }

  const confidence = Math.min(100, Math.round((confidencePoints / maxPoints) * 100));

  let invalidation: string;
  if (args.bias === "BULLISH") {
    const support = s1 ? s1.strike : args.maxPain;
    invalidation = `Bullish view invalidated if spot breaks below ${support} with rising call OI`;
  } else if (args.bias === "BEARISH") {
    const resist = r1 ? r1.strike : args.maxPain;
    invalidation = `Bearish view invalidated if spot breaks above ${resist} with rising put OI`;
  } else {
    invalidation = `Range breaks above ${r1?.strike ?? "R1"} or below ${s1?.strike ?? "S1"} would shift bias`;
  }

  return { reasons, confidence, invalidation };
}

function fmtKLServer(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
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
