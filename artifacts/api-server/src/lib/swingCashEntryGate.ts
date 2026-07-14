/**
 * Part C — Swing Cash Entry Validity / Freshness Gate (pure).
 *
 * Classifies whether a swing plan can be entered RIGHT NOW without chasing,
 * without entering too close to target/stop, with acceptable remaining R:R,
 * and while the signal is still fresh. Does NOT recompute entry/stop/target —
 * those come immutable from the existing scanner.
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashEntryInput,
  SwingCashEntryConfig,
  SwingCashEntryResult,
  SwingCashEntryClassification,
} from "./swingCashTypes";

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

export function evaluateSwingCashEntry(
  input: SwingCashEntryInput,
  config: SwingCashEntryConfig,
): SwingCashEntryResult {
  const reasons: string[] = [];

  const build = (
    classification: SwingCashEntryClassification,
    metricsOverride?: Partial<SwingCashEntryResult["metrics"]>,
  ): SwingCashEntryResult => ({
    classification,
    validForStaging: classification === "ENTRY_VALID_NOW",
    watchOnly: classification === "ENTRY_WAITING_FOR_TRIGGER",
    reasons,
    metrics: {
      pctFromEntry: null,
      pctToTarget1: null,
      pctAboveStop: null,
      atrDistance: null,
      rrNow: null,
      signalAgeDays: input.signalAgeDays ?? null,
      ...metricsOverride,
    },
  });

  // Invalid numeric inputs → cannot classify.
  if (
    !finite(input.entry) ||
    !finite(input.stop) ||
    !finite(input.target1) ||
    !finite(input.ltp) ||
    input.entry <= 0 ||
    input.ltp <= 0 ||
    input.stop >= input.entry ||
    input.target1 <= input.entry
  ) {
    reasons.push(
      `Invalid entry plan: entry=${input.entry}, stop=${input.stop}, target1=${input.target1}, ltp=${input.ltp} (need stop<entry<target1, positive ltp).`,
    );
    return build("ENTRY_INVALID_DATA");
  }

  const { entry, stop, target1, ltp } = input;
  const pctFromEntry = ((ltp - entry) / entry) * 100;
  const pctToTarget1 = ((target1 - ltp) / target1) * 100;
  const pctAboveStop = ((ltp - stop) / stop) * 100;
  const atrDistance = finite(input.atr) && input.atr! > 0 ? (ltp - entry) / input.atr! : null;
  // Remaining reward:risk from the CURRENT ltp.
  const remainingRisk = ltp - stop;
  const rrNow = remainingRisk > 0 ? (target1 - ltp) / remainingRisk : null;

  const metrics = {
    pctFromEntry,
    pctToTarget1,
    pctAboveStop,
    atrDistance,
    rrNow,
    signalAgeDays: input.signalAgeDays ?? null,
  };

  // 1. Stale signal (by age or explicit validity expiry).
  const expired =
    finite(input.validityExpiryMs) &&
    finite(input.nowMs ?? null) &&
    (input.nowMs as number) > (input.validityExpiryMs as number);
  const tooOld =
    finite(input.signalAgeDays ?? null) &&
    (input.signalAgeDays as number) > config.maxSignalAgeDays;
  if (expired || tooOld) {
    reasons.push(
      expired
        ? "Signal validity window expired."
        : `Signal age ${input.signalAgeDays} d > ${config.maxSignalAgeDays} d max.`,
    );
    return build("ENTRY_STALE", metrics);
  }

  // 2. Already past / too close to target → no edge left.
  if (pctToTarget1 <= config.minDistToTargetPct) {
    reasons.push(
      `LTP ${ltp} is within ${pctToTarget1.toFixed(2)}% of target1 ${target1} (min ${config.minDistToTargetPct}%). No edge left.`,
    );
    return build("ENTRY_TOO_CLOSE_TO_TARGET", metrics);
  }

  // 3. Too close to (or below) stop.
  if (pctAboveStop <= config.minDistToStopPct) {
    reasons.push(
      `LTP ${ltp} is only ${pctAboveStop.toFixed(2)}% above stop ${stop} (min ${config.minDistToStopPct}%).`,
    );
    return build("ENTRY_TOO_CLOSE_TO_STOP", metrics);
  }

  // 4. Chased: price ran beyond entry by more than the allowed buffer.
  const chasedByAtr = atrDistance != null && atrDistance > config.maxChaseAtrMultiple;
  const chasedByPct = atrDistance == null && pctFromEntry > config.maxChasePctOfEntry;
  if (chasedByAtr || chasedByPct) {
    reasons.push(
      chasedByAtr
        ? `Price chased: ${atrDistance!.toFixed(2)}× ATR above entry (max ${config.maxChaseAtrMultiple}×).`
        : `Price chased: ${pctFromEntry.toFixed(2)}% above entry (max ${config.maxChasePctOfEntry}%).`,
    );
    return build("ENTRY_ALREADY_CHASED", metrics);
  }

  // 5. Remaining R:R deteriorated below minimum.
  if (rrNow != null && rrNow < config.minRR) {
    reasons.push(
      `Remaining R:R ${rrNow.toFixed(2)} < min ${config.minRR} from current LTP.`,
    );
    return build("ENTRY_RR_TOO_LOW", metrics);
  }

  // 6. Freshness must be PROVABLE. With neither a finite signal age nor an
  //    explicit validity window (+ now), we cannot confirm the signal is still
  //    fresh — fail closed to manual review rather than stage a possibly-stale
  //    plan. (Missing freshness must never be read as "fresh".)
  const freshnessKnown =
    finite(input.signalAgeDays ?? null) ||
    (finite(input.validityExpiryMs ?? null) && finite(input.nowMs ?? null));
  if (!freshnessKnown) {
    reasons.push(
      "Signal freshness cannot be verified (no signal age and no validity window) — manual review required.",
    );
    return build("ENTRY_REVIEW_REQUIRED", metrics);
  }

  // 7. Valid but not yet triggered → watch queue.
  if (input.triggered === false) {
    reasons.push("Plan valid but intraday trigger not yet hit — watch only.");
    return build("ENTRY_WAITING_FOR_TRIGGER", metrics);
  }

  // 8. Trigger state unknown (omitted) → cannot confirm an actionable entry.
  //    Fail closed to review rather than treating "unknown" as "triggered".
  if (input.triggered !== true) {
    reasons.push(
      "Trigger state unknown — cannot confirm the entry has triggered; manual review required.",
    );
    return build("ENTRY_REVIEW_REQUIRED", metrics);
  }

  // 9. Valid now (explicitly triggered, all gates passed).
  reasons.push("Entry valid now: triggered, not chased, RR intact, fresh, away from stop/target.");
  return build("ENTRY_VALID_NOW", metrics);
}
