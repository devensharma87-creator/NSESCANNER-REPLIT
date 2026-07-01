/**
 * F&O high-quality tradeable signal Telegram alerts.
 *
 * Sends a Telegram alert ONLY when the F&O engine has opened an actual paper
 * trade — meaning EVERY gate passed (tradeability assertion, Kite-trusted
 * premium, confidence floor, drawdown caps, heat cap, risk guards). The alert
 * fires from the paper-trade open path, not from the raw signal emitter.
 *
 * Eligibility gate: the row must be fresh (openedAt within
 * FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS) so process restarts on an already-open
 * trade do NOT fire a stale re-alert.
 *
 * Dedup: 30 minutes per (signalDate, indexSymbol, direction, setupKey) via
 * alertOwnerRaw's in-memory dedup. Same signal cannot spam every 30-second cycle.
 *
 * NEVER fires for:
 *   – info-only / baseline / watchlist-only signals (those never open a trade)
 *   – suppressed / blocked / vetoed signals (same — they don't reach openPaperTrade)
 *   – stale or untrusted data (premiumTrusted gate in openPaperTrade guards this)
 *   – missing option-chain (entryPremium ≤ 0 guard below)
 *   – duplicate within the 30-minute dedup window
 *
 * Alert failure MUST NOT crash the F&O cycle — alertFnoTradeableSignal never throws.
 *
 * ABSOLUTE RULES (enforced here):
 *   – No F&O signal logic changes.
 *   – No threshold changes.
 *   – No broker execution.
 *   – No real orders.
 */

import { alertOwnerRaw } from "./alerting";
import { logger } from "./logger";

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * New-open freshness window. An `openedAt` older than this means the row is
 * an existing trade (idempotency path) — skip the alert.
 */
export const FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS = 5 * 60 * 1000; // 5 minutes

/** Dedup window per distinct signal. */
export const FNO_SIGNAL_DEDUP_MS = 30 * 60 * 1000; // 30 minutes

// ── Input type ────────────────────────────────────────────────────────────────

/**
 * Data required to build and gate a tradeable F&O signal alert.
 * Typed explicitly so the alert is decoupled from the paper-trade row schema.
 */
export interface FnoTradeAlertInput {
  /** "NIFTY" | "BANKNIFTY" | "SENSEX" */
  indexSymbol:   string;
  direction:     "BULLISH" | "BEARISH";
  setupKey:      string;
  /** "YYYY-MM-DD" IST-anchored signal date. */
  signalDate:    string;
  /** Rounded integer confidence score (0–100). */
  confidence:    number;
  /** Entry option premium ₹ per share. */
  entryPremium:  number;
  /** Stop-loss option premium ₹ per share, or null if unavailable. */
  stopPremium:   number | null;
  /** Target-1 option premium ₹ per share, or null if unavailable. */
  target1Premium: number | null;
  /** Target-2 option premium ₹ per share, or null if unavailable. */
  target2Premium: number | null;
  /** Number of lots opened. */
  lots:    number;
  /** Lot size (shares per lot). */
  lotSize: number;
  /** Option strike price (numeric), or null. */
  strike:     number | null;
  /** Option expiry date string (YYYY-MM-DD or exchange format), or null. */
  expiry:     string | null;
  /** "CE" | "PE", or null if unknown. */
  optionType: "CE" | "PE" | null;
  /** Timestamp the paper trade row was opened — used for freshness check. */
  openedAt: Date;
}

// ── Alert status record ───────────────────────────────────────────────────────

export interface FnoSignalAlertRecord {
  dedupKey:    string;
  indexSymbol: string;
  direction:   "BULLISH" | "BEARISH";
  confidence:  number;
  at:          number;
}

let lastFnoSignalAlertRecord: FnoSignalAlertRecord | null = null;

/** Returns a copy of the most recent F&O signal alert record, or null. */
export function getLastFnoSignalAlertRecord(): FnoSignalAlertRecord | null {
  return lastFnoSignalAlertRecord ? { ...lastFnoSignalAlertRecord } : null;
}

/** Reset alert record — for tests only. */
export function resetFnoSignalAlertState(): void {
  lastFnoSignalAlertRecord = null;
}

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Returns true only if this paper trade open should trigger a Telegram alert.
 *
 * Pure function — no side-effects, testable in isolation.
 *
 * Fails (returns false) when any of:
 * – openedAt is more than FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS ago (existing trade,
 *   not a fresh open — prevents re-alerting on process restart)
 * – entryPremium is ≤ 0 or non-finite (missing/corrupt option-chain data)
 * – lots or lotSize is ≤ 0 or non-finite (sizing error)
 * – confidence is ≤ 0 or non-finite
 */
export function shouldSendFnoTradeAlert(
  input: FnoTradeAlertInput,
  nowMs: number = Date.now(),
): boolean {
  const openedAgo = nowMs - input.openedAt.getTime();
  if (openedAgo > FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS) return false;
  if (!Number.isFinite(input.entryPremium) || input.entryPremium <= 0) return false;
  if (!Number.isFinite(input.lots)    || input.lots    <= 0) return false;
  if (!Number.isFinite(input.lotSize) || input.lotSize <= 0) return false;
  if (!Number.isFinite(input.confidence) || input.confidence <= 0) return false;
  return true;
}

// ── Message formatting ────────────────────────────────────────────────────────

function formatIstTime(d: Date): string {
  try {
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return d.toISOString();
  }
}

function rrLabel(entry: number, stop: number | null, target: number | null): string {
  if (stop === null || target === null || !Number.isFinite(stop) || !Number.isFinite(target)) {
    return "n/a";
  }
  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return "n/a";
  return (reward / risk).toFixed(2);
}

/**
 * Builds the Telegram message text for a tradeable F&O signal alert.
 *
 * Pure function — no side-effects, safe to call in tests.
 *
 * Required wording (never change):
 *   "Broker execution: DISABLED — no order placed"
 *   "Manual review required. This is not auto-executed."
 *   "Action: Review in F&O paper trades before trading."
 *
 * Forbidden wording: guaranteed profit / sure shot / buy now /
 *   auto order placed / risk-free / blindly enter
 */
export function buildFnoSignalAlertText(
  input: FnoTradeAlertInput,
  nowMs: number = Date.now(),
): string {
  const arrow   = input.direction === "BULLISH" ? "📈" : "📉";
  const side    = input.direction === "BULLISH" ? "CALL (CE)" : "PUT (PE)";

  const strikePart  = input.strike !== null ? ` ${input.strike}` : "";
  const optTypePart = input.optionType ?? "";
  const expiryPart  = input.expiry ? ` exp ${input.expiry}` : "";
  const instrument  = `${input.indexSymbol}${strikePart} ${optTypePart}${expiryPart}`.trim();

  const rr      = rrLabel(input.entryPremium, input.stopPremium, input.target1Premium);
  const perLotRisk = Number.isFinite(input.stopPremium)
    ? Math.abs(input.entryPremium - (input.stopPremium ?? input.entryPremium)) * input.lotSize
    : 0;
  const maxRisk = (input.lots * perLotRisk).toFixed(0);

  const alertedAt = formatIstTime(new Date(nowMs));

  const lines: string[] = [
    `${arrow} F&O TRADEABLE SIGNAL`,
    "",
    `Index:      ${input.indexSymbol}`,
    `Direction:  ${side}`,
    `Instrument: ${instrument}`,
    `Signal:     TRADEABLE_SIGNAL (all gates passed)`,
    `Confidence: ${input.confidence}`,
    "",
    `Entry:    ₹${input.entryPremium.toFixed(2)}`,
    input.stopPremium    !== null ? `Stop:     ₹${input.stopPremium.toFixed(2)}`    : "Stop:     n/a",
    input.target1Premium !== null ? `Target 1: ₹${input.target1Premium.toFixed(2)}` : "Target 1: n/a",
    input.target2Premium !== null ? `Target 2: ₹${input.target2Premium.toFixed(2)}` : "Target 2: n/a",
    `R:R:      ${rr}`,
    "",
    `Lots:     ${input.lots} × ${input.lotSize} shares`,
    `Max risk: ₹${maxRisk}`,
    "",
    `Price source:   Paper trade snapshot (at open time)`,
    `Premium source: Kite trusted option-chain`,
    `Note:           Entry premium is the snapshot at open — current price may differ`,
    `Alerted at:     ${alertedAt} IST`,
    `Setup:          ${input.setupKey}`,
    "",
    `Guard status: All gates passed ✓`,
    `Broker execution: DISABLED — no order placed`,
    "",
    `⚠ Manual review required. This is not auto-executed.`,
    `Action: Review in F&O paper trades before trading.`,
  ];

  return lines.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire a Telegram alert for a freshly opened F&O paper trade.
 *
 * Safe-fail — never throws. Best-effort background delivery via alertOwnerRaw.
 * Silently skips when:
 *   – shouldSendFnoTradeAlert() returns false (stale open, bad fields)
 *   – dedup window active (same signal alerted < FNO_SIGNAL_DEDUP_MS ago)
 *   – Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)
 *
 * Does NOT:
 *   – Block the F&O cycle
 *   – Create paper trades
 *   – Place real orders
 *   – Change signal logic or thresholds
 *   – Enable broker execution
 */
export function alertFnoTradeableSignal(input: FnoTradeAlertInput): void {
  try {
    const nowMs = Date.now();
    if (!shouldSendFnoTradeAlert(input, nowMs)) return;

    const dedupKey = [
      "FNO_TRADEABLE_SIGNAL",
      input.signalDate,
      input.indexSymbol,
      input.direction,
      input.setupKey,
    ].join("::");

    const logMsg = `F&O tradeable signal: ${input.indexSymbol} ${input.direction} conf=${input.confidence} lots=${input.lots}`;
    const text   = buildFnoSignalAlertText(input, nowMs);

    alertOwnerRaw(dedupKey, logMsg, text, FNO_SIGNAL_DEDUP_MS);

    lastFnoSignalAlertRecord = {
      dedupKey,
      indexSymbol: input.indexSymbol,
      direction:   input.direction,
      confidence:  input.confidence,
      at:          nowMs,
    };
  } catch (err) {
    // Never throw — alert failure must not crash the F&O cycle.
    logger.warn(
      { err: (err as Error)?.message },
      "alertFnoTradeableSignal: unexpected error (safe-fail — F&O cycle unaffected)",
    );
  }
}

// ── Sample alert builder (for test endpoint only) ─────────────────────────────

/**
 * Build a clearly-labeled [SAMPLE] F&O format-test message.
 * Used exclusively by the owner-only test endpoint.
 *
 * RULES (enforced here — do not relax):
 *   – Does NOT call buildFnoSignalAlertText() (which carries "Kite trusted" source label).
 *   – Does NOT say "Data source: Kite" or "trusted option-chain".
 *   – Does NOT say "F&O TRADEABLE SIGNAL" (this is a format test, not a signal).
 *   – Prices are fixed dummy values — no Kite API is called.
 *   – No paper trade is created. No real order is placed.
 */
export function buildFnoSampleAlertText(nowMs: number = Date.now()): string {
  const alertedAt = (() => {
    try {
      return new Date(nowMs).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return new Date(nowMs).toISOString();
    }
  })();

  const lines: string[] = [
    "[SAMPLE — NOT A REAL TRADE]",
    "",
    "⚠ F&O TRADE ALERT FORMAT TEST",
    "",
    "Index:      NIFTY  (sample)",
    "Direction:  CALL (CE)  (sample)",
    "Instrument: NIFTY 24500 CE  (sample strike / sample expiry)",
    "Signal:     FORMAT_TEST_ONLY — not an engine-generated signal",
    "Confidence: 72  (sample value)",
    "",
    "Entry:    ₹125.00  (sample — not a live Kite premium)",
    "Stop:     ₹80.00   (sample)",
    "Target 1: ₹200.00  (sample)",
    "Target 2: ₹280.00  (sample)",
    "R:R:      1.88  (sample)",
    "",
    "Lots:     10 × 75 shares  (sample)",
    "Max risk: ₹3,375  (sample)",
    "",
    "Price source:   SAMPLE DATA — not Kite, not live market price",
    "Market data:    NOT QUERIED — no Kite API call made",
    "Alerted at:     " + alertedAt + " IST",
    "",
    "Paper trade created: NO",
    "Real order placed:   NO",
    "Broker execution:    DISABLED — no order placed",
    "",
    "⚠ Sample prices only. Do NOT act on this message.",
    "Action: Verify format only — not a real tradeable signal.",
    "",
    "[SAMPLE — no paper trade created, no real order, broker execution disabled]",
  ];

  return lines.join("\n");
}
