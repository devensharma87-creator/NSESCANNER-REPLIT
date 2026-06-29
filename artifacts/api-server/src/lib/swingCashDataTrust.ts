/**
 * Part B — Swing Cash Data Trust Gate (pure).
 *
 * Classifies a candidate's market data into a trade-grade tier. ONLY fresh,
 * complete Kite (or an explicitly approved licensed source) is trade-grade.
 * Yahoo is information-only. Stale, missing, or unknown-source data is never
 * tradeable. Missing benchmark/sector data does not fabricate — it flags
 * REVIEW_REQUIRED so live action needs manual approval.
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashDataInput,
  SwingCashDataTrustConfig,
  SwingCashDataTrustResult,
  SwingCashDataClassification,
} from "./swingCashTypes";

function ageSec(asOfMs: number | null, nowMs: number): number | null {
  if (asOfMs == null || !Number.isFinite(asOfMs)) return null;
  return Math.max(0, Math.round((nowMs - asOfMs) / 1000));
}

function ohlcComplete(
  ohlc: SwingCashDataInput["ohlc"],
): boolean {
  if (!ohlc) return false;
  return (
    Number.isFinite(ohlc.open) &&
    Number.isFinite(ohlc.high) &&
    Number.isFinite(ohlc.low) &&
    Number.isFinite(ohlc.close) &&
    ohlc.high > 0 &&
    ohlc.low > 0
  );
}

export function evaluateSwingCashDataTrust(
  input: SwingCashDataInput,
  config: SwingCashDataTrustConfig,
): SwingCashDataTrustResult {
  const reasons: string[] = [];
  const missingFields: string[] = [];

  const fallbackUsed = Boolean(input.fallbackUsed);

  // Identify missing core price fields.
  if (input.ltp == null || !Number.isFinite(input.ltp) || input.ltp <= 0) {
    missingFields.push("ltp");
  }
  if (!ohlcComplete(input.ohlc)) missingFields.push("ohlc");
  // Non-finite timestamps (NaN/Infinity) are as untrustworthy as missing ones.
  if (!Number.isFinite(input.dailyCandleAsOfMs)) missingFields.push("dailyCandleAsOf");
  if (!Number.isFinite(input.ltpAsOfMs)) missingFields.push("ltpAsOf");
  // A non-finite clock means freshness/staleness cannot be computed at all, so
  // every age below would silently evaluate to "not stale" — fail closed.
  if (!Number.isFinite(input.nowMs)) missingFields.push("nowMs");

  const dailyAgeSec = ageSec(input.dailyCandleAsOfMs, input.nowMs);
  const ltpAgeSec = ageSec(input.ltpAsOfMs, input.nowMs);
  const dailyStale =
    dailyAgeSec != null && dailyAgeSec * 1000 > config.dailyMaxAgeMs;
  const ltpStale = ltpAgeSec != null && ltpAgeSec * 1000 > config.ltpMaxAgeMs;

  const metrics = { dailyAgeSec, ltpAgeSec, dailyStale, ltpStale };

  const finish = (
    classification: SwingCashDataClassification,
    trustedForTrade: boolean,
    reviewRequired: boolean,
  ): SwingCashDataTrustResult => ({
    classification,
    trustedForTrade,
    reviewRequired,
    stale: classification === "STALE",
    fallbackUsed,
    missingFields,
    reasons,
    metrics,
  });

  // 1. Core price data unavailable → UNAVAILABLE (never tradeable).
  // A missing LTP timestamp means freshness cannot be verified, so it is core:
  // a stamp-less quote must never be promoted to trade-grade.
  const corePriceMissing =
    input.ltp == null ||
    !Number.isFinite(input.ltp) ||
    input.ltp <= 0 ||
    !ohlcComplete(input.ohlc) ||
    !Number.isFinite(input.dailyCandleAsOfMs) ||
    !Number.isFinite(input.ltpAsOfMs) ||
    !Number.isFinite(input.nowMs);
  if (corePriceMissing) {
    reasons.push(
      `Core price data unavailable (missing: ${missingFields.join(", ") || "unknown"}). Not tradeable.`,
    );
    return finish("UNAVAILABLE", false, true);
  }

  const src = String(input.dataSource ?? "unknown").toLowerCase();

  // 2. Yahoo → information only, never trade-grade.
  if (src === "yahoo") {
    reasons.push("Source is Yahoo (delayed/secondary) — information only, not trade-grade.");
    return finish("INFO_ONLY_YAHOO", false, true);
  }

  // 3. Source not in trade-grade allow-list → UNTRUSTED.
  const tradeGrade = config.tradeGradeSources.map((s) => s.toLowerCase());
  if (!tradeGrade.includes(src)) {
    reasons.push(`Source "${src}" is not a trade-grade source. Not tradeable.`);
    return finish("UNTRUSTED", false, true);
  }

  // 4. Trade-grade source but stale → STALE (never tradeable).
  if (dailyStale || ltpStale) {
    if (dailyStale && dailyAgeSec != null) {
      reasons.push(`Daily candle stale: ${dailyAgeSec}s old (budget ${Math.round(config.dailyMaxAgeMs / 1000)}s).`);
    }
    if (ltpStale && ltpAgeSec != null) {
      reasons.push(`LTP stale: ${ltpAgeSec}s old (budget ${Math.round(config.ltpMaxAgeMs / 1000)}s).`);
    }
    return finish("STALE", false, true);
  }

  // 5. Fresh + complete trade-grade. Benchmark/sector gaps → review (not fabricated).
  // Fail-closed: only an EXPLICIT `true` counts as available. Omitted/undefined
  // availability must never be silently treated as present.
  let reviewRequired = false;
  if (config.requireBenchmark && input.benchmarkAvailable !== true) {
    missingFields.push("benchmark");
    reasons.push("Benchmark data unavailable — manual review required before live action.");
    reviewRequired = true;
  }
  if (config.requireSector && input.sectorAvailable !== true) {
    missingFields.push("sector");
    reasons.push("Sector classification unavailable — manual review required before live action.");
    reviewRequired = true;
  }

  const classification: SwingCashDataClassification =
    src === "licensed" ? "TRADE_GRADE_LICENSED" : "TRADE_GRADE_KITE";

  if (reasons.length === 0) reasons.push(`Trade-grade data from ${src}, fresh and complete.`);

  return finish(classification, true, reviewRequired);
}
