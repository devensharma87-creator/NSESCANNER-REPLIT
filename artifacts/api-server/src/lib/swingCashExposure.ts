/**
 * Part G — Swing Cash Sector / Single-stock Exposure Gate (pure).
 *
 * Prevents sector over-concentration, single-stock stacking, duplicate
 * positions, and same-stock entries on consecutive days. Operates on the
 * PROPOSED position value plus the portfolio's current exposure snapshot.
 *
 * Pure function: no DB, no network, no side effects.
 */

import type {
  SwingCashExposureInput,
  SwingCashExposureConfig,
  SwingCashExposureResult,
} from "./swingCashTypes";

/** Returns YYYY-MM-DD string offset by `deltaDays` from the given IST date. */
function shiftIsoDate(isoDate: string, deltaDays: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  const shifted = new Date(ms + deltaDays * 86_400_000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function evaluateSwingCashExposure(
  input: SwingCashExposureInput,
  config: SwingCashExposureConfig,
): SwingCashExposureResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Fail-closed input/config validation. A non-finite (NaN/Infinity) or negative
  // exposure value would make the after-% NaN, and `NaN > cap` is false — so a
  // corrupt snapshot could otherwise leave `allowed` true while the caps were
  // never actually evaluated. Never treat uncomputable exposure as within-cap.
  const isNum = (n: number) => Number.isFinite(n);
  const inputInvalid =
    !isNum(input.proposedPositionValue) ||
    !isNum(input.totalSwingCapital) ||
    !isNum(input.currentSectorExposureValue) ||
    !isNum(input.currentSingleStockExposureValue) ||
    !isNum(input.sectorOpenCount) ||
    input.proposedPositionValue < 0 ||
    input.totalSwingCapital < 0 ||
    input.currentSectorExposureValue < 0 ||
    input.currentSingleStockExposureValue < 0 ||
    input.sectorOpenCount < 0 ||
    !isNum(config.maxSectorExposurePct) ||
    !isNum(config.maxSingleStockExposurePct) ||
    !isNum(config.sectorCrowdedWarnCount);
  if (inputInvalid) {
    return {
      allowed: false,
      inputInvalid: true,
      reasons: [
        "Exposure inputs/config invalid (non-finite or negative) — caps uncomputable; blocked.",
      ],
      warnings: [],
      metrics: {
        sectorExposureAfterPct: 0,
        singleStockExposureAfterPct: 0,
        duplicate: false,
        consecutiveDay: false,
      },
    };
  }

  const capital = input.totalSwingCapital > 0 ? input.totalSwingCapital : 0;

  const sectorAfterValue = input.currentSectorExposureValue + input.proposedPositionValue;
  const singleAfterValue = input.currentSingleStockExposureValue + input.proposedPositionValue;
  const sectorExposureAfterPct = capital > 0 ? (sectorAfterValue / capital) * 100 : 0;
  const singleStockExposureAfterPct = capital > 0 ? (singleAfterValue / capital) * 100 : 0;

  const duplicate = input.openPositionSymbols
    .map((s) => s.toUpperCase())
    .includes(input.symbol.toUpperCase());

  // Consecutive-day: an entry for this symbol opened today or yesterday (IST).
  let consecutiveDay = false;
  if (input.lastEntryDateForSymbolIst) {
    const yesterday = shiftIsoDate(input.todayIst, -1);
    consecutiveDay =
      input.lastEntryDateForSymbolIst === input.todayIst ||
      (yesterday != null && input.lastEntryDateForSymbolIst === yesterday);
  }

  const metrics = {
    sectorExposureAfterPct,
    singleStockExposureAfterPct,
    duplicate,
    consecutiveDay,
  };

  let allowed = true;

  if (config.blockDuplicate && duplicate) {
    reasons.push(`Duplicate position: ${input.symbol} is already open.`);
    allowed = false;
  }

  if (config.blockConsecutiveDaySameStock && consecutiveDay) {
    reasons.push(
      `Consecutive-day stacking: ${input.symbol} was entered on ${input.lastEntryDateForSymbolIst}.`,
    );
    allowed = false;
  }

  if (singleStockExposureAfterPct > config.maxSingleStockExposurePct) {
    reasons.push(
      `Single-stock exposure ${singleStockExposureAfterPct.toFixed(1)}% > max ${config.maxSingleStockExposurePct}%.`,
    );
    allowed = false;
  }

  if (input.sector && sectorExposureAfterPct > config.maxSectorExposurePct) {
    reasons.push(
      `Sector "${input.sector}" exposure ${sectorExposureAfterPct.toFixed(1)}% > max ${config.maxSectorExposurePct}%.`,
    );
    allowed = false;
  }

  if (input.sector == null) {
    warnings.push("Sector unknown — sector-exposure cap not enforced for this candidate.");
  }

  if (input.sectorOpenCount + 1 >= config.sectorCrowdedWarnCount) {
    warnings.push(
      `Sector "${input.sector ?? "?"}" would hold ${input.sectorOpenCount + 1} positions (crowded).`,
    );
  }

  if (allowed) reasons.push("Exposure within sector and single-stock caps.");

  return { allowed, inputInvalid: false, reasons, warnings, metrics };
}
