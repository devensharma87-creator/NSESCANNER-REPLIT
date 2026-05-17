/**
 * F&O Signal Reasoning Logger (Priority P14 — 2026-05-15).
 *
 * **Diagnostics-only.** This module writes append-only rows to
 * `fno_signal_reasoning` describing every verdict the F&O paper-trade
 * decision pipeline emits. It does NOT alter any signal, gate, sizing,
 * execution, scheduler, or scanner decision.
 *
 * Safety contract:
 *
 *   1. Every public function is non-throwing. Any DB or shape error is
 *      caught, logged at WARN, and discarded. A reasoning-logger outage
 *      CANNOT block trading.
 *
 *   2. Callers should fire-and-forget. The intended idiom is:
 *
 *          void logFnoReasoning({...}); // sync call sites
 *          await logFnoReasoning({...}); // async call sites (still safe)
 *
 *      The function never rejects.
 *
 *   3. The writer does NOT validate that fields refer to real signals.
 *      That is intentional — the caller is the source of truth for the
 *      reasoning payload, and we'd rather record an imperfect row than
 *      drop a diagnostic event on a schema mismatch.
 *
 *   4. No secrets, tokens, API keys, or PII are accepted by the payload
 *      shape. The catch-all `snapshot` is opaque JSONB, but it is the
 *      caller's responsibility never to put credentials there. Reviewer
 *      check: search `fnoSignalReasoningLogger` call sites — none pass
 *      session/token/credential objects.
 *
 * The query helpers below back the owner-only diagnostic route in
 * `routes/paper.ts`. They are read-only.
 */

import { db, fnoSignalReasoningTable } from "@workspace/db";
import type {
  FnoSignalReasoningRow,
  NewFnoSignalReasoningRow,
} from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "./logger";

/* ──────────────────── P17a observability counters ────────────────────
 * In-memory counters so an owner-only health endpoint can answer
 * "is the reasoning logger actually writing?" without having to grep
 * server logs. These are process-local and reset on restart — that
 * is the desired semantic (we want to know what THIS process has
 * done since boot). No DB writes, no decision impact.
 */
interface ReasoningLoggerHealth {
  writesAttempted: number;
  writesSucceeded: number;
  writesFailed: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
  bootedAt: string;
}
const HEALTH: ReasoningLoggerHealth = {
  writesAttempted: 0,
  writesSucceeded: 0,
  writesFailed: 0,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
  bootedAt: new Date().toISOString(),
};
/** Snapshot of the reasoning-logger health counters. Read-only. */
export function getReasoningLoggerHealth(): Readonly<ReasoningLoggerHealth> {
  return { ...HEALTH };
}
/** Test-only reset. Not exported from the public barrel; use sparingly. */
export function __resetReasoningLoggerHealthForTests(): void {
  HEALTH.writesAttempted = 0;
  HEALTH.writesSucceeded = 0;
  HEALTH.writesFailed = 0;
  HEALTH.lastSuccessAt = null;
  HEALTH.lastErrorAt = null;
  HEALTH.lastErrorClass = null;
  HEALTH.lastErrorMessage = null;
}

/** Possible verdicts the paper-trade pipeline emits for a signal.
 *
 * Two families:
 *   - `EMITTED` / `PRE_EMISSION_REJECTED` are **upstream** events written
 *     by the signal-generation orchestrator (P14b). They answer "why did
 *     this signal appear?" and "why didn't this candidate appear?".
 *   - All others are **downstream** events written by the paper-trade
 *     decision boundary (P14). They answer what the trader did with the
 *     signal once it landed.
 *
 * Tier-demotion reasons (HTF_CONFLICT, RS_CONFLICT, LOW_WINRATE, ...) live
 * inside the EMITTED row's `snapshot.tags` rather than as a separate
 * decision value, so demoted signals are not double-counted in histograms.
 */
export type FnoReasoningDecision =
  | "EMITTED"
  | "PRE_EMISSION_REJECTED"
  | "OPENED"
  | "SKIPPED"
  | "MISSED_WINDOW"
  | "CLOSED_STOPPED"
  | "CLOSED_TARGET1"
  | "CLOSED_TARGET2"
  | "CLOSED_EXPIRED"
  | "CLOSED_MANUAL"
  | "CLOSED_TIME_EXIT_1520";

/**
 * Shape accepted by `logFnoReasoning`. Every field except `decision`,
 * `signalDate`, and `indexSymbol` is optional — the writer fills in
 * what the caller knows at the decision point and leaves the rest NULL.
 *
 * `snapshot` is the forward-compat catch-all. Put gate-by-gate flags,
 * EMA stack, VWAP/VP relation, OI confluence inputs, etc. there
 * without requiring a schema migration to capture them.
 */
export interface FnoReasoningPayload {
  decision: FnoReasoningDecision;
  signalDate: string;
  indexSymbol: string;

  capturedAt?: Date;
  indexName?: string | null;
  setupKey?: string | null;
  direction?: "BULLISH" | "BEARISH" | string | null;
  optionType?: "CE" | "PE" | string | null;

  tier?: string | null;
  reasonCode?: string | null;

  /**
   * P15b — deterministic correlation ID. Operator-supplied is optional;
   * when omitted `buildReasoningRow` auto-derives it from the 6-tuple
   * (signalDate, indexSymbol, setupKey, direction, optionType,
   * selectedStrike) via `computeSignalFingerprint`. Stays null when any
   * of those six fields are missing (e.g. PRE_EMISSION_REJECTED rows
   * without a leg). NEVER carries any token, secret, session value, or
   * user-supplied free text.
   */
  signalFingerprint?: string | null;

  confidence?: number | null;
  confluenceScore?: number | null;
  regime?: string | null;
  vix?: number | null;
  ivr?: number | null;
  ivp?: number | null;

  spot?: number | null;
  spotEntry?: number | null;
  spotStop?: number | null;
  spotTarget1?: number | null;
  spotTarget2?: number | null;

  selectedStrike?: number | null;
  optionEntry?: number | null;
  optionStop?: number | null;
  optionTarget1?: number | null;
  optionTarget2?: number | null;
  optionSpreadPct?: number | null;
  optionOi?: number | null;
  optionLtp?: number | null;
  optionExit?: number | null;
  realizedPnl?: number | null;

  lifecycleStatus?: string | null;
  exitReason?: string | null;
  dataQuality?: string | null;

  maxLossPct?: number | null;
  lots?: number | null;
  lotSize?: number | null;

  snapshot?: Record<string, unknown> | null;
  note?: string | null;
}

/** Numeric -> drizzle string with NaN/Inf guarding. */
function numOrNull(n: number | null | undefined, scale = 4): string | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  return n.toFixed(scale);
}

/** Integer-or-null with NaN/Inf guarding. */
function intOrNull(n: number | null | undefined): number | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/* ─── snapshot sanitiser ────────────────────────────────────────────────
 * Defence-in-depth for the JSONB catch-all. Current call sites pass NO
 * snapshot, so this is purely preventive: if a future caller ever
 * forwards a header/cookie/session object by mistake, the sanitiser
 * drops anything whose key matches a credential pattern AND caps the
 * total serialised payload so a runaway object cannot bloat the table.
 * Both rules are conservative — we'd rather drop a legitimate field
 * than persist a leaked secret. */
const SECRET_KEY_RE =
  /(token|secret|password|passwd|cookie|session|auth|bearer|api[_-]?key|access[_-]?key)/i;
const MAX_SNAPSHOT_BYTES = 16 * 1024; // 16 KB serialised — generous for gate/feature flags

function sanitiseSnapshot(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SECRET_KEY_RE.test(k)) continue; // drop credential-shaped keys
    out[k] = v;
  }
  // Cap serialised size — Postgres jsonb can hold much more but we don't
  // want diagnostics to grow without bound. Stringify failures (e.g.
  // circular refs) collapse the whole snapshot to null rather than throw.
  try {
    const s = JSON.stringify(out);
    if (s.length > MAX_SNAPSHOT_BYTES) {
      return { __truncated: true, __bytes: s.length };
    }
  } catch {
    return null;
  }
  return out;
}

/* ─── P15b — deterministic signal fingerprint ───────────────────────────
 *
 * Why: P15 analytics could only proxy a "T1→stop reversal" because rows
 * carried no correlation key. P15b adds a SHA-256(hex)[:16] over the
 * 6 fields that uniquely identify a trade lifecycle so EMITTED → OPENED
 * → CLOSED_* rows for the same signal/trade share an exact key.
 *
 * Inputs are deliberately RESTRICTED to fields already persisted on the
 * row itself (signal_date / index_symbol / setup_key / direction /
 * option_type / selected_strike). NO timestamp, NO token, NO secret,
 * NO session, NO premium, NO PII — the hash input set is whitelisted
 * here in source and asserted in tests.
 *
 * Diagnostics-only: NEVER consumed by signal generation, gates, sizing,
 * execution, scheduler, scanner, swing, paper-equity, Kite, combo, or
 * any ingestion path. */
const FINGERPRINT_PARTS = [
  "signalDate", "indexSymbol", "setupKey", "direction", "optionType", "selectedStrike",
] as const;

export interface FingerprintParts {
  signalDate?: string | null;
  indexSymbol?: string | null;
  setupKey?: string | null;
  direction?: string | null;
  optionType?: string | null;
  selectedStrike?: number | null;
}

export function computeSignalFingerprint(p: FingerprintParts): string | null {
  if (!p.signalDate || !p.indexSymbol) return null;
  if (!p.setupKey || !p.direction || !p.optionType) return null;
  if (p.selectedStrike == null || !Number.isFinite(p.selectedStrike)) return null;
  // Normalise: lowercase identity-ish fields, fixed-decimal strike, pipe-delimited
  // canonical key. Pipe is the separator because no field is allowed to contain it
  // (all six are bounded varchars or a number).
  const key = [
    String(p.signalDate).trim(),
    String(p.indexSymbol).trim().toUpperCase(),
    String(p.setupKey).trim().toUpperCase(),
    String(p.direction).trim().toUpperCase(),
    String(p.optionType).trim().toUpperCase(),
    Number(p.selectedStrike).toFixed(2),
  ].join("|");
  // Lazy crypto import to keep this module side-effect-free at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Test-visible whitelist of allowed fingerprint parts. */
export const FINGERPRINT_INPUT_FIELDS: ReadonlyArray<string> = FINGERPRINT_PARTS;

/** String trim/cap helper (avoid blowing varchar limits silently). */
function strOrNull(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Pure helper exposed for tests — converts the public payload to the
 * exact row shape we hand to drizzle. No DB I/O.
 */
export function buildReasoningRow(p: FnoReasoningPayload): NewFnoSignalReasoningRow {
  return {
    capturedAt: p.capturedAt ?? new Date(),
    signalDate: p.signalDate,
    indexSymbol: strOrNull(p.indexSymbol, 32) ?? p.indexSymbol,
    indexName: strOrNull(p.indexName, 64),
    setupKey: strOrNull(p.setupKey, 64),
    direction: strOrNull(p.direction ?? null, 16),
    optionType: strOrNull(p.optionType ?? null, 4),
    tier: strOrNull(p.tier, 16),
    decision: strOrNull(p.decision, 32) ?? p.decision,
    reasonCode: strOrNull(p.reasonCode, 64),
    // P15b: trust operator-supplied value if shape-valid; otherwise auto-derive
    // from the 6-tuple in scope. Stays null when fields are missing (e.g.
    // PRE_EMISSION_REJECTED / SKIPPED rows without a leg → proxy fallback).
    signalFingerprint:
      (typeof p.signalFingerprint === "string" && /^[0-9a-f]{16}$/.test(p.signalFingerprint)
        ? p.signalFingerprint
        : computeSignalFingerprint({
            signalDate: p.signalDate,
            indexSymbol: p.indexSymbol,
            setupKey: p.setupKey ?? null,
            direction: p.direction ?? null,
            optionType: p.optionType ?? null,
            selectedStrike: p.selectedStrike ?? null,
          })),
    confidence: intOrNull(p.confidence),
    confluenceScore: numOrNull(p.confluenceScore, 2),
    regime: strOrNull(p.regime, 24),
    vix: numOrNull(p.vix, 2),
    ivr: numOrNull(p.ivr, 2),
    ivp: numOrNull(p.ivp, 2),
    spot: numOrNull(p.spot, 2),
    spotEntry: numOrNull(p.spotEntry, 2),
    spotStop: numOrNull(p.spotStop, 2),
    spotTarget1: numOrNull(p.spotTarget1, 2),
    spotTarget2: numOrNull(p.spotTarget2, 2),
    selectedStrike: numOrNull(p.selectedStrike, 2),
    optionEntry: numOrNull(p.optionEntry, 4),
    optionStop: numOrNull(p.optionStop, 4),
    optionTarget1: numOrNull(p.optionTarget1, 4),
    optionTarget2: numOrNull(p.optionTarget2, 4),
    optionSpreadPct: numOrNull(p.optionSpreadPct, 4),
    optionOi: intOrNull(p.optionOi),
    optionLtp: numOrNull(p.optionLtp, 4),
    optionExit: numOrNull(p.optionExit, 4),
    realizedPnl: numOrNull(p.realizedPnl, 2),
    lifecycleStatus: strOrNull(p.lifecycleStatus, 24),
    exitReason: strOrNull(p.exitReason, 32),
    dataQuality: strOrNull(p.dataQuality, 32),
    maxLossPct: numOrNull(p.maxLossPct, 4),
    lots: intOrNull(p.lots),
    lotSize: intOrNull(p.lotSize),
    snapshot: sanitiseSnapshot(p.snapshot ?? null),
    note: p.note ?? null,
  };
}

/**
 * Append one reasoning row. **Never throws.** Safe to call from any
 * decision point in the F&O pipeline — including inside transactions
 * (this opens its own connection via the singleton `db`), inside
 * setInterval ticks, and inside synchronous helpers (via `void`).
 *
 * On failure, emits one `logger.warn` so the operator sees substrate
 * outages explicitly without spamming the request log.
 */
export async function logFnoReasoning(payload: FnoReasoningPayload): Promise<void> {
  HEALTH.writesAttempted += 1;
  try {
    const row = buildReasoningRow(payload);
    await db.insert(fnoSignalReasoningTable).values(row);
    HEALTH.writesSucceeded += 1;
    HEALTH.lastSuccessAt = new Date().toISOString();
  } catch (err) {
    // Swallowed — diagnostics MUST NOT influence trading. One WARN per
    // failure keeps the issue visible in logs without crashing the
    // pipeline. We intentionally do NOT re-throw, retry, or back off.
    HEALTH.writesFailed += 1;
    HEALTH.lastErrorAt = new Date().toISOString();
    // Robust extraction — non-Error throwables (strings, plain objects)
    // must not crash this catch arm. Compute message ONCE and reuse.
    const errIsError = err instanceof Error;
    const errMessage = errIsError ? err.message : String(err);
    HEALTH.lastErrorClass = errIsError ? err.constructor.name : typeof err;
    // Truncate message defensively — never persist secrets/tokens; also
    // bound the visible length surfaced by the health endpoint.
    HEALTH.lastErrorMessage = errMessage.slice(0, 200);
    logger.warn(
      {
        err: errMessage,
        decision: payload.decision,
        indexSymbol: payload.indexSymbol,
        setupKey: payload.setupKey,
      },
      "fno_signal_reasoning write failed (diagnostics-only; trading unaffected)",
    );
  }
}

/* ─────────────────── Upstream emission helpers (P14b) ───────────────────
 *
 * The orchestrator (`getOptionSignals`) calls these AT THE VERY END of a
 * cycle to record:
 *
 *   - one `EMITTED` row per signal that survived every gate, with the
 *     full driver/tag/regime/IVR/IVP/EMA/VWAP context lifted out of the
 *     OptionSignal verbatim, and demotion tags surfaced in `snapshot.tags`.
 *
 *   - one `PRE_EMISSION_REJECTED` row per `{index, reason}` pair from the
 *     orchestrator's `suppressed` diagnostic. Best-effort parses the
 *     leading `setup_name:` prefix off the reason string so histograms by
 *     setup work for both emitted and rejected populations.
 *
 * Both helpers are PURE (no I/O) and the public `logUpstreamReasoningBatch`
 * is non-throwing — a logger outage cannot disturb the signal pipeline.
 *
 * No live signal field is mutated and no decision the engine has already
 * taken is re-derived here. The orchestrator's `suppressed` array, which
 * was already populated for the UI banner, is the sole source of truth
 * for rejection reasons.
 */

/** Loose shape we accept for upstream emission — kept narrow on purpose so
 *  a stray `OptionSignal` field rename doesn't break the build. We only
 *  touch documented public fields. */
export interface UpstreamSignalShape {
  index: string;
  indexName?: string;
  setupKey?: string;
  setupName?: string;
  bias: string;
  tier?: string;
  confidence: number;
  confluenceScore?: number;
  regime?: string;
  spot?: number;
  vwap?: number;
  ema9?: number;
  ema20?: number;
  ema21?: number;
  ema50?: number;
  dailyEma50?: number;
  htfBias?: string;
  htfConflict?: boolean;
  ivRank?: number;
  ivPercentile?: number;
  dataQuality?: string;
  tags?: string[];
  drivers?: Array<{ label?: string; weight?: number; detail?: string; bullish?: boolean }>;
  leg?: { type?: string; strike?: number; entry?: number; stopLoss?: number; target1?: number; target2?: number };
}

/** Loose shape for the orchestrator's per-index suppression bundle. */
export interface UpstreamSuppressed {
  index: string;
  reasons: string[];
}

/**
 * Parse `"trend_continuation: confidence 58 < HC emission floor 65 — demoted"`
 * into `{ setupKey: "TREND_CONTINUATION", reason: "confidence 58 < ..." }`.
 *
 * The orchestrator emits suppression strings with two shapes:
 *   - `"<detector_name>: <reason>"` from inside `buildSignalsForIndex`
 *   - `"<SETUP_KEY>: <reason>"`     from the bundle-level drop aggregators
 *
 * Both encode the setup in the leading chunk, so a single split works.
 */
export function parseSuppressionReason(raw: string): {
  setupKey: string | null;
  reason: string;
} {
  if (typeof raw !== "string") return { setupKey: null, reason: "" };
  const t = raw.trim();
  if (!t) return { setupKey: null, reason: "" };
  const i = t.indexOf(":");
  if (i <= 0) return { setupKey: null, reason: t };
  const lead = t.slice(0, i).trim();
  const rest = t.slice(i + 1).trim();
  if (!lead) return { setupKey: null, reason: rest };
  return { setupKey: lead.toUpperCase().replace(/\s+/g, "_"), reason: rest };
}

/** Map a free-text suppression reason to a stable `reason_code` enum for
 *  histograms. Unknown reasons collapse to `OTHER` so the bucket cardinality
 *  stays manageable across cycles. */
export function classifySuppressionReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("market_closed") || r.includes("market closed")) return "MARKET_CLOSED";
  if (r.includes("partial_indicators") || r.includes("partial indicators")) return "PARTIAL_INDICATORS";
  if (r.includes("opening-noise") || r.includes("opening_noise")) return "OPENING_NOISE";
  if (r.includes("late-session vwap-reclaim") || r.includes("vwap-reclaim gate")) return "VWAP_RECLAIM_LATE";
  if (r.includes("late-session entry") || r.includes("late_session_entry")) return "LATE_SESSION_ENTRY";
  // OI buckets must be checked BEFORE the generic "hc emission floor" rule —
  // the orchestrator's OI-post-floor message literally reads
  // "post-OI confidence X < HC emission floor Y — demoted (OI conflict ...)"
  // and the semantic root cause is the OI conflict, not the floor itself.
  if (r.includes("oi hard-veto") || r.includes("oi hard veto")) return "OI_VETO";
  if (r.includes("post-oi confidence") || r.includes("oi conflict")) return "OI_CONFLICT";
  if (r.includes("hc emission floor")) return "HC_FLOOR";
  if (r.includes("post-clamp rr")) return "POST_CLAMP_RR";
  if (r.includes("conditions not met")) return "CONDITIONS_NOT_MET";
  if (r.includes("circuit-breaker") || r.includes("circuit breaker")) return "CIRCUIT_BREAKER";
  if (r.includes("vol_regime") || r.includes("vol regime")) return "VOL_REGIME";
  if (r.includes("flip") || r.includes("bias-flip") || r.includes("bias flip")) return "BIAS_FLIP";
  if (r.includes("correlation") || r.includes("redundant")) return "CORRELATION_CAP";
  if (r.includes("global suppression")) return "GLOBAL_SUPPRESSION";
  if (r.includes("no_bars") || r.includes("no bars")) return "NO_BARS";
  if (r === "error" || r.startsWith("error")) return "DETECTOR_ERROR";
  return "OTHER";
}

/**
 * Build one EMITTED row from a live OptionSignal. Pure — no I/O. Captures
 * every field the upstream reasoning spec asks for; missing-data fields
 * (e.g. IVR null at emission time) are flagged in `snapshot.missing`.
 */
export function buildEmittedRow(
  s: UpstreamSignalShape,
  signalDate: string,
  vix: number | null,
): FnoReasoningPayload {
  const tags = Array.isArray(s.tags) ? s.tags : [];
  const drivers = Array.isArray(s.drivers)
    ? s.drivers.slice(0, 24).map(d => ({
        label: d.label,
        weight: d.weight,
        detail: d.detail,
        bullish: d.bullish,
      }))
    : [];
  const missing: string[] = [];
  if (s.ivRank == null) missing.push("ivRank");
  if (s.ivPercentile == null) missing.push("ivPercentile");
  if (vix == null) missing.push("vix");
  if (s.vwap == null) missing.push("vwap");
  if (s.ema50 == null) missing.push("ema50");
  // Tag-derived demotion reasons (HTF/RS/LOW_WINRATE/OPENING_NOISE/etc.) —
  // surfaced as a separate snapshot field so a downstream query can ask
  // "how many EMITTED rows carried at least one demotion tag?" without
  // splitting tag strings.
  const DEMOTION_TAGS = new Set([
    "HTF_CONFLICT", "HTF1H_CONFLICT", "RS_CONFLICT", "LOW_WINRATE",
    "OPENING_NOISE", "CLOSING_NOISE", "EXPIRY_DAY", "OI_ATM_CONFLICT",
    "VOL_CLAMPED_STOP", "COUNTER_TREND", "RR_LOW",
  ]);
  const demotionTags = tags.filter(t => DEMOTION_TAGS.has(t));
  const emaStack = {
    ema9: s.ema9 ?? null,
    ema20: s.ema20 ?? null,
    ema21: s.ema21 ?? null,
    ema50: s.ema50 ?? null,
    dailyEma50: s.dailyEma50 ?? null,
  };
  const vwapRel = s.vwap != null && s.spot != null
    ? (s.spot > s.vwap ? "ABOVE" : s.spot < s.vwap ? "BELOW" : "AT")
    : null;

  return {
    decision: "EMITTED",
    signalDate,
    indexSymbol: s.index,
    indexName: s.indexName ?? null,
    setupKey: s.setupKey ?? null,
    direction: s.bias ?? null,
    optionType: s.leg?.type === "CALL" ? "CE" : s.leg?.type === "PUT" ? "PE" : null,
    tier: s.tier ?? null,
    reasonCode: demotionTags.length > 0 ? "DEMOTED" : "EMITTED",
    confidence: s.confidence ?? null,
    confluenceScore: s.confluenceScore ?? null,
    regime: s.regime ?? null,
    vix,
    ivr: s.ivRank ?? null,
    ivp: s.ivPercentile ?? null,
    spot: s.spot ?? null,
    spotEntry: s.leg?.entry ?? null,
    spotStop: s.leg?.stopLoss ?? null,
    spotTarget1: s.leg?.target1 ?? null,
    spotTarget2: s.leg?.target2 ?? null,
    selectedStrike: s.leg?.strike ?? null,
    dataQuality: s.dataQuality ?? null,
    snapshot: {
      setupName: s.setupName ?? null,
      tags,
      demotionTags,
      drivers,
      emaStack,
      vwapRel,
      htfBias: s.htfBias ?? null,
      htfConflict: s.htfConflict ?? null,
      missing,
    },
  };
}

/** Build PRE_EMISSION_REJECTED rows from the orchestrator `suppressed` array. */
export function buildPreEmissionRejectedRows(
  suppressed: ReadonlyArray<UpstreamSuppressed>,
  signalDate: string,
): FnoReasoningPayload[] {
  const out: FnoReasoningPayload[] = [];
  for (const bucket of suppressed) {
    if (!bucket || typeof bucket.index !== "string") continue;
    const reasons = Array.isArray(bucket.reasons) ? bucket.reasons : [];
    for (const raw of reasons) {
      const { setupKey, reason } = parseSuppressionReason(String(raw));
      out.push({
        decision: "PRE_EMISSION_REJECTED",
        signalDate,
        indexSymbol: bucket.index,
        setupKey,
        reasonCode: classifySuppressionReason(reason),
        note: reason.slice(0, 240),
        snapshot: { rawReason: String(raw).slice(0, 480) },
      });
    }
  }
  return out;
}

/**
 * Build the full set of upstream rows for one `getOptionSignals` cycle.
 * Pure; tests call this directly. Empty inputs produce an empty array.
 */
export function buildUpstreamReasoningRows(args: {
  signals: ReadonlyArray<UpstreamSignalShape>;
  suppressed: ReadonlyArray<UpstreamSuppressed>;
  signalDate: string;
  vix?: number | null;
}): FnoReasoningPayload[] {
  const vix = args.vix ?? null;
  const rows: FnoReasoningPayload[] = [];
  for (const s of args.signals) {
    try {
      rows.push(buildEmittedRow(s, args.signalDate, vix));
    } catch {
      // Skip individual signal whose shape blew up; never throw upward.
    }
  }
  rows.push(...buildPreEmissionRejectedRows(args.suppressed, args.signalDate));
  return rows;
}

/**
 * Non-throwing batch writer used by the orchestrator hook. Each row is
 * dispatched via `logFnoReasoning` (already non-throwing) so a single
 * bad row never poisons the batch and a DB outage emits a single WARN
 * per row without disturbing the caller.
 *
 * Caller idiom: `void logUpstreamReasoningBatch({...})` — fire-and-forget.
 */
export async function logUpstreamReasoningBatch(args: {
  signals: ReadonlyArray<UpstreamSignalShape>;
  suppressed: ReadonlyArray<UpstreamSuppressed>;
  signalDate: string;
  vix?: number | null;
}): Promise<void> {
  let rows: FnoReasoningPayload[];
  try {
    rows = buildUpstreamReasoningRows(args);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "fno_signal_reasoning upstream batch build failed (diagnostics-only)",
    );
    return;
  }
  // Sequential await — count is small (signals + suppressed ≈ <50/cycle),
  // and we'd rather not flood the connection pool from a diagnostic path.
  for (const r of rows) {
    await logFnoReasoning(r);
  }
}

/* ─────────────────────── Query side (route helpers) ────────────────────── */

export interface ReasoningQueryFilters {
  indexSymbol?: string;
  setupKey?: string;
  direction?: string;
  tier?: string;
  decision?: string;
  reasonCode?: string;
  from?: string; // YYYY-MM-DD inclusive (signal_date)
  to?: string;   // YYYY-MM-DD inclusive
  limit?: number;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/** Trims, caps, and validates the public filter shape. */
export function normaliseFilters(raw: Record<string, unknown>): ReasoningQueryFilters {
  const isValidDate = (s: unknown): s is string => {
    if (typeof s !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    if (Number.isNaN(t)) return false;
    return new Date(t).toISOString().slice(0, 10) === s;
  };
  const pickStr = (k: string, max: number): string | undefined => {
    const v = raw[k];
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    if (!t) return undefined;
    return t.length > max ? t.slice(0, max) : t;
  };
  const limitRaw = raw.limit;
  let limit = DEFAULT_LIMIT;
  if (typeof limitRaw === "string" || typeof limitRaw === "number") {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
  }
  return {
    indexSymbol: pickStr("index", 32) ?? pickStr("indexSymbol", 32),
    setupKey: pickStr("setup", 64) ?? pickStr("setupKey", 64),
    direction: pickStr("direction", 16) ?? pickStr("side", 16),
    tier: pickStr("tier", 16),
    decision: pickStr("decision", 32) ?? pickStr("status", 32),
    reasonCode: pickStr("reason", 64) ?? pickStr("reasonCode", 64),
    from: isValidDate(raw.from) ? raw.from : undefined,
    to: isValidDate(raw.to) ? raw.to : undefined,
    limit,
  };
}

function whereFromFilters(f: ReasoningQueryFilters) {
  const conds = [] as ReturnType<typeof eq>[];
  if (f.indexSymbol) conds.push(eq(fnoSignalReasoningTable.indexSymbol, f.indexSymbol));
  if (f.setupKey) conds.push(eq(fnoSignalReasoningTable.setupKey, f.setupKey));
  if (f.direction) conds.push(eq(fnoSignalReasoningTable.direction, f.direction));
  if (f.tier) conds.push(eq(fnoSignalReasoningTable.tier, f.tier));
  if (f.decision) conds.push(eq(fnoSignalReasoningTable.decision, f.decision));
  if (f.reasonCode) conds.push(eq(fnoSignalReasoningTable.reasonCode, f.reasonCode));
  if (f.from) conds.push(gte(fnoSignalReasoningTable.signalDate, f.from));
  if (f.to) conds.push(lte(fnoSignalReasoningTable.signalDate, f.to));
  return conds.length === 0 ? undefined : and(...conds);
}

export interface ReasoningHistogram {
  byDecision: Array<{ key: string; count: number }>;
  byReason: Array<{ key: string; count: number }>;
  byIndex: Array<{ key: string; count: number }>;
  bySetup: Array<{ key: string; count: number }>;
  byTier: Array<{ key: string; count: number }>;
  byStopReason: Array<{ key: string; count: number }>; // setup-by-setup count of CLOSED_STOPPED rows
  total: number;
}

export interface ReasoningQueryResult {
  rows: FnoSignalReasoningRow[];
  histogram: ReasoningHistogram;
  filters: ReasoningQueryFilters;
}

/**
 * Returns the most-recent matching reasoning rows plus histograms.
 * Histograms are computed over the same filter set (NOT the whole table)
 * so the owner sees breakdowns that match what they're looking at.
 *
 * Caps at `limit` rows (default 100, max 500) to keep the response cheap.
 */
export async function queryReasoning(
  filters: ReasoningQueryFilters,
): Promise<ReasoningQueryResult> {
  const where = whereFromFilters(filters);
  const limit = filters.limit ?? DEFAULT_LIMIT;

  const rowsQ = db
    .select()
    .from(fnoSignalReasoningTable)
    .orderBy(desc(fnoSignalReasoningTable.capturedAt))
    .limit(limit);
  const rows = where ? await rowsQ.where(where) : await rowsQ;

  // Histograms via SQL count(*) GROUP BY — runs independently of the
  // limited `rows` fetch so the buckets reflect ALL matching rows, not
  // just the 100 we surface.
  const groupBy = async (col: ReturnType<typeof sql>): Promise<Array<{ key: string; count: number }>> => {
    const q = db
      .select({ key: col, count: sql<number>`count(*)::int` })
      .from(fnoSignalReasoningTable);
    const rows = where
      ? await q.where(where).groupBy(col).orderBy(desc(sql<number>`count(*)`))
      : await q.groupBy(col).orderBy(desc(sql<number>`count(*)`));
    return rows.map(r => ({ key: r.key == null ? "UNKNOWN" : String(r.key), count: Number(r.count) }));
  };

  // For "stop reason by setup" we filter to CLOSED_STOPPED and group by
  // setup_key. Combined with the standard filters via AND.
  const stopReasonWhere = (() => {
    const stopCond = eq(fnoSignalReasoningTable.decision, "CLOSED_STOPPED");
    return where ? and(where, stopCond) : stopCond;
  })();
  const stopQ = db
    .select({
      key: sql<string>`coalesce(${fnoSignalReasoningTable.setupKey}, 'UNKNOWN')`,
      count: sql<number>`count(*)::int`,
    })
    .from(fnoSignalReasoningTable)
    .where(stopReasonWhere)
    .groupBy(fnoSignalReasoningTable.setupKey)
    .orderBy(desc(sql<number>`count(*)`));
  const stopRows = await stopQ;

  const totalQ = db
    .select({ n: sql<number>`count(*)::int` })
    .from(fnoSignalReasoningTable);
  const totalRow = where ? await totalQ.where(where) : await totalQ;
  const total = Number(totalRow[0]?.n ?? 0);

  const [byDecision, byReason, byIndex, bySetup, byTier] = await Promise.all([
    groupBy(sql`${fnoSignalReasoningTable.decision}`),
    groupBy(sql`${fnoSignalReasoningTable.reasonCode}`),
    groupBy(sql`${fnoSignalReasoningTable.indexSymbol}`),
    groupBy(sql`${fnoSignalReasoningTable.setupKey}`),
    groupBy(sql`${fnoSignalReasoningTable.tier}`),
  ]);

  return {
    rows,
    histogram: {
      byDecision,
      byReason,
      byIndex,
      bySetup,
      byTier,
      byStopReason: stopRows.map(r => ({ key: String(r.key), count: Number(r.count) })),
      total,
    },
    filters,
  };
}

/* keep ascending exported for possible future "oldest-first" route option */
export { asc };
