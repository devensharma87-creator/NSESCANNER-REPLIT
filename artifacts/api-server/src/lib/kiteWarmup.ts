/**
 * Kite post-login warmup / retry (Task #131).
 *
 * The production symptom this fixes: the topbar shows "KITE LIVE" the instant a
 * session is established, but the F&O engine still reports "daily bars
 * unavailable" for a cycle or two because Kite's historical REST API warms up
 * slightly AFTER login and nothing primes it. This module fires a per-index
 * warmup sequence (index quote → daily bars → intraday bars → option chain) as
 * soon as the session becomes active, so the historical path is warm before the
 * next signal cycle reads it.
 *
 * HARD CONSTRAINTS (Task #131 scope):
 *   - READ-ONLY. No paper trades, no orders, no signal/gate/threshold changes.
 *     It is NOT gated on PAPER_TRADING_ENABLED — warmup only reads market data.
 *   - Per-index isolation: NIFTY / BANKNIFTY / SENSEX each run in their own
 *     try/catch so a SENSEX failure never blocks NIFTY or BANKNIFTY.
 *   - Per-step isolation: each of the four steps is independently guarded.
 *   - Central layer ONLY: imports the market-data layer (compat + barrel), never
 *     a raw provider (`./kiteIntraday`, `./kiteOptionChain`, …). This keeps the
 *     providerImportGuard burn-down test green.
 *   - Fail-closed on no session (returns SKIPPED_NO_SESSION — safe in dev).
 *   - Single-flight + debounce so rapid restarts / double logins can't stack
 *     concurrent warmups.
 */

import {
  centralActiveSession,
  centralIndexQuotes,
  centralIndexCandles,
  centralHasIndexCoverage,
  type ActiveSession,
} from "./marketData/compat";
import { getOptionChain } from "./marketData";
import { classifyDataFailure, type DataFailureCode } from "./fnoFailureDiagnosis";
import { OPTION_INDICES } from "./optionSignals";
import { alertWarmupFailures } from "./fnoSignalAlerts";
import { logger } from "./logger";

// ── Result shapes ──────────────────────────────────────────────────────────

export type WarmupTrigger = "login" | "boot" | "manual" | "scheduler";

export type WarmupOutcome =
  | "OK" // every index fully warmed
  | "PARTIAL" // at least one index/step failed, at least one succeeded
  | "FAILED" // every index failed
  | "SKIPPED_NO_SESSION" // no active Kite session (fail-closed; normal in dev)
  | "SKIPPED_IN_FLIGHT" // another warmup is already running
  | "SKIPPED_DEBOUNCED"; // an identical warmup ran very recently

export type WarmupStep = "quote" | "dailyBars" | "intradayBars" | "optionChain";

export interface WarmupStepResult {
  step: WarmupStep;
  ok: boolean;
  code: DataFailureCode | null;
  message: string | null;
  ms: number;
}

export interface IndexWarmupResult {
  index: string; // NIFTY | BANKNIFTY | SENSEX
  ok: boolean; // all four steps succeeded
  steps: WarmupStepResult[];
}

export interface WarmupRunResult {
  outcome: WarmupOutcome;
  trigger: WarmupTrigger;
  startedAt: string; // ISO
  finishedAt: string | null; // ISO, null for instant skips
  durationMs: number;
  sessionLoginTime: string | null;
  indices: IndexWarmupResult[];
  reason: string | null; // populated for SKIPPED_* outcomes
}

// ── Config ───────────────────────────────────────────────────────────────

/** Daily bars to prime (enough for EMA/regime warmth without a huge fetch). */
export const WARMUP_DAILY_DAYS = 60;
/** Intraday days to prime. */
export const WARMUP_INTRADAY_DAYS = 5;
/**
 * Debounce window: a non-manual/non-login warmup for the SAME session within
 * this window is skipped (rapid restarts / double scheduler ticks).
 */
export const WARMUP_DEBOUNCE_MS = 60_000;

// ── In-memory store + single-flight latch ──────────────────────────────────

let lastResult: WarmupRunResult | null = null;
let inFlight: Promise<WarmupRunResult> | null = null;
let lastRunAtMs = 0;
let lastRunLoginTime: string | null = null;

/** Latest warmup result (copy), or null if warmup has never run. */
export function getLastWarmupResult(): WarmupRunResult | null {
  return lastResult ? { ...lastResult, indices: lastResult.indices.map((i) => ({ ...i, steps: [...i.steps] })) } : null;
}

/** True while a warmup is executing. */
export function isWarmupInFlight(): boolean {
  return inFlight != null;
}

/** Reset all warmup state — tests only. */
export function resetWarmupState(): void {
  lastResult = null;
  inFlight = null;
  lastRunAtMs = 0;
  lastRunLoginTime = null;
}

// ── Public trigger ─────────────────────────────────────────────────────────

/**
 * Fire (or coalesce) a Kite warmup. Never throws. Returns the run result, or a
 * SKIPPED_* result when no session / already running / debounced.
 *
 * Fire-and-forget callers should use `void triggerKiteWarmup(...)`.
 */
export async function triggerKiteWarmup(
  trigger: WarmupTrigger = "manual",
): Promise<WarmupRunResult> {
  if (inFlight) {
    return skipResult("SKIPPED_IN_FLIGHT", trigger, "A warmup is already in progress.");
  }

  // Claim the single-flight latch SYNCHRONOUSLY — the IIFE below runs up to its
  // first `await` before control returns here, and `inFlight` is assigned with
  // no intervening `await`, so two near-simultaneous triggers (e.g. the login
  // callback + a manual POST) can never both pass the guard above and run
  // concurrent warmups. The session read + debounce check live INSIDE the latch
  // so even those transient reads are coalesced.
  const run = (async (): Promise<WarmupRunResult> => {
    let session: ActiveSession | null = null;
    try {
      session = await centralActiveSession();
    } catch (err) {
      // Fail-closed: treat an unreadable session as "no session".
      logger.warn({ err: (err as Error)?.message }, "kiteWarmup: session read failed (treated as no session)");
      session = null;
    }
    if (!session) {
      const r = skipResult("SKIPPED_NO_SESSION", trigger, "No active Kite session.");
      lastResult = r; // record so diagnostics can show "skipped: no session"
      return r;
    }

    const loginTime = session.loginTime instanceof Date ? session.loginTime.toISOString() : null;
    const nowMs = Date.now();
    if (
      trigger !== "manual" &&
      trigger !== "login" &&
      loginTime != null &&
      lastRunLoginTime === loginTime &&
      nowMs - lastRunAtMs < WARMUP_DEBOUNCE_MS
    ) {
      return skipResult("SKIPPED_DEBOUNCED", trigger, "An identical warmup ran within the debounce window.");
    }

    const r = await runWarmup(trigger, loginTime);
    lastResult = r;
    lastRunAtMs = Date.now();
    lastRunLoginTime = loginTime;
    return r;
  })();

  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = null;
  }
}

// ── Core run (per-index, per-step isolation) ───────────────────────────────

async function runWarmup(trigger: WarmupTrigger, loginTime: string | null): Promise<WarmupRunResult> {
  const startedAt = new Date();

  // Step 1 — index quotes are a single batch call for all indices. A batch
  // failure is recorded per-index as a failed quote step; it never aborts the
  // remaining candle/option-chain steps.
  let quoteMap: Map<string, unknown> | null = null;
  let quoteErr: unknown = null;
  try {
    quoteMap = (await centralIndexQuotes()) as Map<string, unknown> | null;
  } catch (err) {
    quoteErr = err;
  }

  const indices: IndexWarmupResult[] = [];
  // Sequential per index AND per step — Kite's historical API is rate-limited
  // (~3 req/s) and warmup fires exactly as the ticker is (re)starting.
  for (const cfg of OPTION_INDICES) {
    const steps: WarmupStepResult[] = [];

    // quote
    steps.push(
      await timedStep("quote", async () => {
        if (quoteErr) throw quoteErr instanceof Error ? quoteErr : new Error(String(quoteErr));
        if (!quoteMap || !quoteMap.has(cfg.yahoo)) {
          throw new Error(`no_live_kite_intraday (no quote for ${cfg.symbol})`);
        }
      }),
    );

    // dailyBars
    steps.push(
      await timedStep("dailyBars", async () => {
        if (!centralHasIndexCoverage(cfg.yahoo)) {
          throw new Error(`EXCHANGE_UNSUPPORTED (no Kite index coverage for ${cfg.symbol})`);
        }
        const daily = await centralIndexCandles(cfg.yahoo, "day", WARMUP_DAILY_DAYS);
        if (!daily) throw new Error("daily_history_unavailable_kite");
      }),
    );

    // intradayBars
    steps.push(
      await timedStep("intradayBars", async () => {
        const intra = await centralIndexCandles(cfg.yahoo, "15minute", WARMUP_INTRADAY_DAYS);
        if (!intra) throw new Error("no_live_kite_intraday");
      }),
    );

    // optionChain (DISPLAY mode — priming only, does not feed any trade decision)
    steps.push(
      await timedStep("optionChain", async () => {
        const res = await getOptionChain(cfg.symbol);
        if (!res.ok || !res.data) throw new Error(res.reason ?? "option chain unavailable");
      }),
    );

    indices.push({ index: cfg.symbol, ok: steps.every((s) => s.ok), steps });
  }

  const finishedAt = new Date();
  const okCount = indices.filter((i) => i.ok).length;
  const outcome: WarmupOutcome =
    okCount === indices.length ? "OK" : okCount === 0 ? "FAILED" : "PARTIAL";

  const result: WarmupRunResult = {
    outcome,
    trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    sessionLoginTime: loginTime,
    indices,
    reason: null,
  };

  logger.info(
    { trigger, outcome, okCount, total: indices.length, durationMs: result.durationMs },
    "kiteWarmup complete",
  );

  // Best-effort owner notification on genuine post-login data failures.
  // Safe-fail internally — never blocks or throws out of warmup.
  alertWarmupFailures(result);

  return result;
}

/** Run a single warmup step, timing it and classifying any failure. */
async function timedStep(step: WarmupStep, fn: () => Promise<void>): Promise<WarmupStepResult> {
  const t0 = Date.now();
  try {
    await fn();
    return { step, ok: true, code: null, message: null, ms: Date.now() - t0 };
  } catch (err) {
    // Warmup only runs AFTER the fail-closed active-session check, so the
    // session is known valid here — pass that so the classifier never emits a
    // false SESSION_MISSING for ambiguous reasons like `no_live_kite_intraday`.
    const diag = classifyDataFailure(err, { sessionValid: true });
    return { step, ok: false, code: diag.code, message: diag.message, ms: Date.now() - t0 };
  }
}

function skipResult(
  outcome: Extract<WarmupOutcome, "SKIPPED_NO_SESSION" | "SKIPPED_IN_FLIGHT" | "SKIPPED_DEBOUNCED">,
  trigger: WarmupTrigger,
  reason: string,
): WarmupRunResult {
  const now = new Date();
  return {
    outcome,
    trigger,
    startedAt: now.toISOString(),
    finishedAt: null,
    durationMs: 0,
    sessionLoginTime: null,
    indices: [],
    reason,
  };
}
