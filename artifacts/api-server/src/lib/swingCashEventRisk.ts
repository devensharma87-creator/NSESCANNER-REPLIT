/**
 * Part H — Swing Cash Event / Result / Corporate-Action Risk Gate (pure).
 *
 * Blocks fresh live entries around earnings/result days and major corporate
 * actions. When event data is unavailable it does NOT assume "clear" — it
 * returns EVENT_DATA_UNAVAILABLE_REVIEW_REQUIRED so live mode needs manual
 * approval. No web scraping is treated as trade-grade.
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashEventRiskInput,
  SwingCashEventRiskConfig,
  SwingCashEventRiskResult,
  SwingCashEventClassification,
} from "./swingCashTypes";

export function evaluateSwingCashEventRisk(
  input: SwingCashEventRiskInput,
  config: SwingCashEventRiskConfig,
): SwingCashEventRiskResult {
  const reasons: string[] = [];

  const build = (
    classification: SwingCashEventClassification,
    clear: boolean,
    blocked: boolean,
    reviewRequired: boolean,
  ): SwingCashEventRiskResult => ({
    classification,
    clear,
    blocked,
    reviewRequired,
    reasons,
  });

  // 1. Event data unavailable → manual review (never fabricate "clear").
  if (!input.eventDataAvailable) {
    reasons.push("Event/result calendar unavailable — manual review required before live entry.");
    return build(
      "EVENT_DATA_UNAVAILABLE_REVIEW_REQUIRED",
      false,
      config.requireApprovalWhenUnavailable,
      true,
    );
  }

  // 2. Result day → block fresh entry.
  if (config.blockOnResultDay && input.isResultDay === true) {
    reasons.push("Result/earnings day — fresh live entry blocked.");
    return build("RESULT_DAY", false, true, false);
  }

  // 3. A provided-but-non-finite daysToResult is corrupt data, NEVER "no
  //    upcoming result" — the `>= 0` / `<= window` comparisons below would both
  //    be false for NaN and silently fall through to EVENT_CLEAR. Fail closed.
  if (input.daysToResult != null && !Number.isFinite(input.daysToResult)) {
    reasons.push("Result-date value is invalid (non-finite) — manual review required.");
    return build("RESULT_DATE_UNKNOWN_REVIEW_REQUIRED", false, false, true);
  }

  // 4. Result within N trading days → block/warn.
  if (
    input.daysToResult != null &&
    input.daysToResult >= 0 &&
    input.daysToResult <= config.resultWithinDaysBlock
  ) {
    reasons.push(
      `Result in ${input.daysToResult} day(s) (≤ ${config.resultWithinDaysBlock}) — event risk.`,
    );
    return build("RESULT_WITHIN_3_DAYS", false, true, false);
  }

  // 4. Major corporate-action status.
  if (config.blockOnCorporateAction) {
    if (input.corporateActionRisk === true) {
      reasons.push("Major corporate-action uncertainty — blocked.");
      return build("CORPORATE_ACTION_RISK", false, true, false);
    }
    // null = corporate-action status unavailable → never assume clear.
    if (input.corporateActionRisk == null) {
      reasons.push(
        "Corporate-action status unavailable — manual review required before live entry.",
      );
      return build("CORPORATE_ACTION_UNAVAILABLE_REVIEW_REQUIRED", false, false, true);
    }
  }

  // 5. News-risk feed unavailable → informational review (not a hard block here).
  if (!input.newsRiskAvailable) {
    reasons.push("News-risk feed unavailable — review recommended.");
    return build("NEWS_RISK_UNAVAILABLE", false, false, true);
  }

  // 6. Result schedule not explicitly confirmed → cannot prove the entry window
  //    is clear. A null/unknown daysToResult must NEVER be read as "no result".
  if (input.resultScheduleKnown !== true) {
    reasons.push(
      "Result schedule not confirmed for this symbol — cannot prove the entry window is clear; manual review required.",
    );
    return build("RESULT_DATE_UNKNOWN_REVIEW_REQUIRED", false, false, true);
  }

  reasons.push("No known event risk in window.");
  return build("EVENT_CLEAR", true, false, false);
}
