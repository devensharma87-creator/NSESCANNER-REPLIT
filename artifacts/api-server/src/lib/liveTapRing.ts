/**
 * LiveTapRing — the R1-tail recorder's in-memory ring buffer.
 *
 * A pure read-only tap on the live trading path. Every push is
 * wrapped by callers in try/catch so a buffer failure NEVER affects
 * the trading engine (per spec §12.2: "recorder failure must never
 * touch the trading path").
 *
 * Storage is process-local + capped by count-per-stream + wall-clock
 * age. When the owner hits `POST /api/replay/record`, this buffer is
 * drained to disk in the exact JSONL format the replay driver expects.
 *
 * Phase 0.5C: storage is a strictly bounded O(1) ring buffer. Appends
 * no longer shift or splice the retained history, so per-tick cost is
 * constant regardless of how many entries are retained.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §12.2
 */
import { RingBuffer } from "./ringBuffer";
import { logger } from "./logger";

// Hard caps — chosen to keep RAM comfortably under 512 MB with worst-
// case burst rates (a full trading day at ~250 ticks/sec = ~7M ticks;
// we cap far below that per the "last N minutes" contract). The
// recorder trims to `minutes` at drain time.
const CAP_TICKS = 400_000;
const CAP_CHAIN = 2_000;    // 2min × 60 min × N underlyings ~= 6k; wider cap for full-day capture
const CAP_BOARDS = 2_000;
const CAP_EVENTS = 5_000;
// Absolute-age drop threshold — anything older than this at push time
// is dropped even if under count cap. 4h covers a full session + prep.
const MAX_AGE_MS = 4 * 60 * 60_000;

/* ════════════════════════════════════════════════════════════════════
 * TYPED REPLAY SNAPSHOT CONTRACT
 *
 * WHAT THIS REPLACES, AND WHY.
 *
 * An earlier revision used a general "bounded copy" that copied what
 * JSON.stringify could observe and SHARED anything it could not rebuild
 * — class instances, objects carrying a custom toJSON, and containers
 * past a depth limit — while counting each occurrence. That was
 * rejected, correctly: a counter records that an entry MIGHT be
 * corruptible, it does not prevent the corruption. The acceptance
 * invariant is that consumer mutation cannot corrupt retained storage,
 * and "shared but counted" does not satisfy it.
 *
 * This module therefore has NO general-purpose clone. It has an
 * explicit, finite contract for the four replay entry types, and a
 * single shared value helper with exactly two outcomes:
 *
 *     supported value    -> independent copy
 *     unsupported value  -> explicit rejection, entry never stored
 *
 * There is deliberately no third "share and count" outcome. Every entry
 * that reaches the ring is a fully independent plain tree, so no
 * accepted entry can retain a caller reference.
 *
 * WHAT THE CONTRACT ACCEPTS.
 *
 *   null · undefined · boolean · number · string
 *   arrays of accepted values
 *   plain objects (Object.prototype or null prototype) of accepted values
 *
 * Everything else is REJECTED, not shared: functions, symbols, bigints,
 * accessor properties, Date, Map, Set, WeakMap, WeakSet, Promise, any
 * class instance, any object carrying a custom toJSON, reference cycles,
 * and anything nested deeper than MAX_REPLAY_DEPTH.
 *
 * WHY REJECTING Date/Map/Set IS SAFE HERE — verified, not assumed.
 * All four production push sites were inspected (Section A inventory):
 *   • tapPushTick        kiteFeed.ts  — raw: { ohlc, change_percent }
 *                        where ohlc is Kite's plain {open,high,low,close}
 *                        of numbers. Kite's Date-valued tick fields
 *                        (timestamp / last_trade_time) are NOT passed in.
 *   • tapPushChainSnapshot optionChainSnapshotIngestor.ts —
 *                        { rows: OcRow[], spot: number|null }; OcRow and
 *                        OcSide are plain literals of number / string /
 *                        boolean / null. The chain's own `generatedAt` is
 *                        already an ISO string, not a Date.
 *   • tapPushSystemEvent kiteFeed.ts, regimeClassifier.ts, systemMode.ts —
 *                        small string/boolean detail bags; `drivers` is
 *                        a string[].
 *   • tapPushBoardSnapshot — no production callers at all.
 * So the strict contract rejects nothing that production actually emits,
 * and requirement 13 (identical JSON-observable output for every
 * currently reachable valid payload) holds.
 *
 * DELIBERATE JSON-PARITY OMISSIONS. Symbol-keyed and non-enumerable own
 * properties are not carried across. JSON.stringify cannot express them
 * either, so recorder output is unchanged. This is a documented,
 * tested omission of *unreachable* data, not a shared reference.
 *
 * FAILURE IS LOUD, NOT SILENT. A rejection increments an owner-visible
 * counter (surfaced on GET /api/replay/record/stats) and logs a
 * throttled, payload-free reason. If a future provider change starts
 * emitting an unsupported shape, the recorder loses those entries — but
 * the counter makes that immediately visible rather than silently
 * shipping a corruptible buffer.
 * ════════════════════════════════════════════════════════════════════ */

/**
 * Maximum nesting accepted for a replay payload.
 *
 * Depth 0 is the entry object itself. Deepest real production shape is
 * the chain snapshot at depth 4 (entry → snapshot → rows[] → row → ce).
 * 6 leaves headroom while keeping per-append work strictly bounded.
 * Anything deeper is REJECTED, never shared.
 */
export const MAX_REPLAY_DEPTH = 6;

export type ReplayEntryType =
  | "tick"
  | "chainSnapshot"
  | "boardSnapshot"
  | "systemEvent";

export type ReplayRejectionReason =
  | "FUNCTION_VALUE"
  | "SYMBOL_VALUE"
  | "BIGINT_VALUE"
  | "ACCESSOR_PROPERTY"
  | "DATE_VALUE"
  | "MAP_OR_SET_VALUE"
  | "WEAK_COLLECTION_VALUE"
  | "PROMISE_VALUE"
  | "CLASS_INSTANCE"
  | "CUSTOM_TO_JSON"
  | "CYCLIC_REFERENCE"
  | "MAX_DEPTH_EXCEEDED"
  | "INVALID_SCALAR_FIELD"
  | "INVALID_PAYLOAD_CONTAINER"
  /** An array index reachable only through a polluted Array.prototype. */
  | "INHERITED_INDEXED_PROPERTY"
  /** Defensive only: stored data failed re-copy on the drain path. */
  | "STORED_SHAPE_INVARIANT_VIOLATION";

/**
 * Owner-visible rejection diagnostics.
 *
 * These count entries REJECTED (and therefore never stored). They are
 * not a "shared reference" counter — no accepted entry shares anything.
 * `lastRejection.path` is a structural key path only; payload values are
 * never captured here or in the log line.
 */
export interface ReplayRejectionDiagnostics {
  total: number;
  byEntryType: Record<ReplayEntryType, number>;
  byReason: Partial<Record<ReplayRejectionReason, number>>;
  lastRejection: {
    entryType: ReplayEntryType;
    reason: ReplayRejectionReason;
    /** Structural key path, e.g. "raw.ohlc.close". Never a value. */
    path: string;
  } | null;
}

function emptyDiagnostics(): ReplayRejectionDiagnostics {
  return {
    total: 0,
    byEntryType: { tick: 0, chainSnapshot: 0, boardSnapshot: 0, systemEvent: 0 },
    byReason: {},
    lastRejection: null,
  };
}

const rejections: ReplayRejectionDiagnostics = emptyDiagnostics();

export function getReplayRejectionDiagnostics(): ReplayRejectionDiagnostics {
  return {
    total: rejections.total,
    byEntryType: { ...rejections.byEntryType },
    byReason: { ...rejections.byReason },
    lastRejection: rejections.lastRejection
      ? { ...rejections.lastRejection }
      : null,
  };
}

/** Test-only: reset the rejection counters. */
export function _resetReplayRejectionDiagnostics(): void {
  const fresh = emptyDiagnostics();
  rejections.total = fresh.total;
  rejections.byEntryType = fresh.byEntryType;
  rejections.byReason = fresh.byReason;
  rejections.lastRejection = null;
  lastLoggedAtByReason.clear();
}

// Rejection on the tick path could fire ~250x/sec if a provider shape
// changes, so the log line is throttled per reason. The COUNTER is
// always exact; only the logging is rate-limited.
const LOG_THROTTLE_MS = 60_000;
const lastLoggedAtByReason = new Map<string, number>();

/**
 * Thrown internally by `copyPlainReplayValue` and caught by the four
 * normalizers. Never escapes this module.
 */
class ReplayRejection extends Error {
  constructor(
    readonly reason: ReplayRejectionReason,
    readonly path: string,
  ) {
    super(`replay value rejected: ${reason} at ${path || "<root>"}`);
    this.name = "ReplayRejection";
  }
}

function recordRejection(
  entryType: ReplayEntryType,
  reason: ReplayRejectionReason,
  path: string,
): null {
  rejections.total++;
  rejections.byEntryType[entryType]++;
  rejections.byReason[reason] = (rejections.byReason[reason] ?? 0) + 1;
  rejections.lastRejection = { entryType, reason, path };

  const key = `${entryType}:${reason}`;
  const now = Date.now();
  const last = lastLoggedAtByReason.get(key) ?? 0;
  if (now - last >= LOG_THROTTLE_MS) {
    lastLoggedAtByReason.set(key, now);
    // Structural only: entry type, reason code, key path. No values.
    logger.warn(
      { entryType, reason, path: path || "<root>", total: rejections.total },
      "replay tap: entry rejected (not stored) — unsupported payload shape",
    );
  }
  return null;
}

function joinPath(path: string[]): string {
  return path.join(".");
}

/**
 * Classify why a non-plain object cannot be accepted. Ordered so the
 * most specific, most actionable reason wins.
 *
 * Every test here is an `instanceof` brand check. Nothing reads a
 * PROPERTY off the value — duck-typing `.then` to spot a thenable would
 * execute a getter on a hostile object, which is exactly what this
 * contract promises never to do.
 */
function classifyExotic(value: object): ReplayRejectionReason {
  if (value instanceof Date) return "DATE_VALUE";
  if (value instanceof Map || value instanceof Set) return "MAP_OR_SET_VALUE";
  if (value instanceof WeakMap || value instanceof WeakSet) {
    return "WEAK_COLLECTION_VALUE";
  }
  if (value instanceof Promise) return "PROMISE_VALUE";
  return "CLASS_INSTANCE";
}

/**
 * CONTRACT BOUNDARY — what "no caller code is invoked" does and does
 * not cover.
 *
 * COVERED: ordinary JavaScript values. No getter or setter defined on a
 * caller-supplied object is ever invoked, because every field on every
 * container — including array `length` — is read through
 * getOwnPropertyDescriptor rather than plain member access.
 *
 * NOT COVERED: Proxy exotic objects. `Object.getPrototypeOf`,
 * `getOwnPropertyDescriptor`, `Object.keys` and the `in` operator all
 * fire proxy traps, and a proxy cannot be identified without firing
 * one. A hostile proxy can therefore still run code, and a throwing
 * trap surfaces as a non-ReplayRejection that `rejectionOf` rethrows.
 *
 * Why that is the right boundary rather than a gap:
 *   • No push site can emit a proxy. Ticks come from the Kite client's
 *     JSON parse, chain rows from our own literals, system-event details
 *     are inline literals. This is a hostile-input concern, not a
 *     reachable one.
 *   • The invariant that actually matters still holds unconditionally:
 *     a throwing trap aborts normalization BEFORE anything is stored, so
 *     the ring cannot be corrupted or made to hold a live reference. A
 *     proxy costs an entry, never integrity.
 *   • Every tapPush* call site already wraps the call in try/catch, so
 *     a rethrow cannot reach the trading path.
 * Both properties are pinned by regression tests.
 */

/**
 * Read one own property WITHOUT invoking an accessor.
 *
 * Returns undefined when the key is absent. Throws ReplayRejection when
 * the property is an accessor, so a throwing getter is refused rather
 * than executed. Every field read in this module goes through here or
 * through an explicit descriptor lookup — `obj.field` is never used on
 * caller-supplied data.
 */
function readOwn(obj: object, key: string, path: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (d === undefined) return undefined;
  if (d.get !== undefined || d.set !== undefined) {
    throw new ReplayRejection("ACCESSOR_PROPERTY", path);
  }
  return d.value;
}

/**
 * Refuse any value whose serialisation is driven by its own `toJSON`.
 *
 * Checked via descriptor rather than `value.toJSON` for two reasons: a
 * `toJSON` accessor must not be invoked, and a NON-ENUMERABLE `toJSON`
 * still drives JSON.stringify while never appearing in Object.keys.
 * Applies to arrays as well as plain objects.
 */
function rejectIfCustomToJSON(value: object, path: string): void {
  const d = Object.getOwnPropertyDescriptor(value, "toJSON");
  if (d === undefined) return;
  if (d.get !== undefined || d.set !== undefined) {
    throw new ReplayRejection("ACCESSOR_PROPERTY", path);
  }
  if (typeof d.value === "function") {
    throw new ReplayRejection("CUSTOM_TO_JSON", path);
  }
}

/**
 * The single shared value helper. Two outcomes only:
 *   supported   -> a fully independent copy
 *   unsupported -> throws ReplayRejection
 *
 * `ancestors` carries the live path for cycle detection; `path` carries
 * structural keys for the diagnostic. Both are mutated as a stack and
 * unwound, so no allocation happens per level beyond the copies.
 */
function copyPlainReplayValue(
  value: unknown,
  depth: number,
  ancestors: object[],
  path: string[],
): unknown {
  if (value === null) return null;

  const t = typeof value;
  if (
    t === "undefined" ||
    t === "boolean" ||
    t === "number" ||
    t === "string"
  ) {
    return value;
  }
  if (t === "function") {
    throw new ReplayRejection("FUNCTION_VALUE", joinPath(path));
  }
  if (t === "symbol") {
    throw new ReplayRejection("SYMBOL_VALUE", joinPath(path));
  }
  if (t === "bigint") {
    throw new ReplayRejection("BIGINT_VALUE", joinPath(path));
  }

  const obj = value as object;

  // Cycle before depth: a cyclic graph shorter than the depth limit must
  // report CYCLIC_REFERENCE deterministically rather than bottoming out.
  for (let i = 0; i < ancestors.length; i++) {
    if (ancestors[i] === obj) {
      throw new ReplayRejection("CYCLIC_REFERENCE", joinPath(path));
    }
  }
  if (depth >= MAX_REPLAY_DEPTH) {
    throw new ReplayRejection("MAX_DEPTH_EXCEEDED", joinPath(path));
  }

  if (Array.isArray(obj)) {
    // An Array SUBCLASS is a class instance wearing an array's brand;
    // Array.isArray cannot tell them apart, the prototype can.
    if (Object.getPrototypeOf(obj) !== Array.prototype) {
      throw new ReplayRejection("CLASS_INSTANCE", joinPath(path));
    }
    // Arrays can carry their own toJSON too, and it drives stringify
    // exactly as it would on an object.
    rejectIfCustomToJSON(obj, joinPath(path));

    const src = obj as unknown[];
    // Even `length` is read by descriptor, so the array branch contains
    // no plain member access on caller-supplied data.
    const lenDesc = Object.getOwnPropertyDescriptor(src, "length");
    const n = typeof lenDesc?.value === "number" ? lenDesc.value : 0;
    const out = new Array<unknown>(n);
    ancestors.push(obj);
    for (let i = 0; i < n; i++) {
      const d = Object.getOwnPropertyDescriptor(src, i);
      if (d === undefined) {
        // No OWN property at this index. Either a genuine hole, which is
        // preserved as a hole, or an index visible only through a
        // polluted Array.prototype — that one is refused, because
        // copying it would silently bake a foreign value into storage.
        if (i in src) {
          path.push(String(i));
          throw new ReplayRejection(
            "INHERITED_INDEXED_PROPERTY",
            joinPath(path),
          );
        }
        continue;
      }
      path.push(String(i));
      if (d.get !== undefined || d.set !== undefined) {
        throw new ReplayRejection("ACCESSOR_PROPERTY", joinPath(path));
      }
      out[i] = copyPlainReplayValue(d.value, depth + 1, ancestors, path);
      path.pop();
    }
    ancestors.pop();
    return out;
  }

  const proto = Object.getPrototypeOf(obj) as object | null;
  if (proto !== Object.prototype && proto !== null) {
    throw new ReplayRejection(classifyExotic(obj), joinPath(path));
  }
  // A plain object carrying its own toJSON serialises through code this
  // contract cannot reproduce, so it is rejected rather than shared.
  rejectIfCustomToJSON(obj, joinPath(path));

  const src = obj as Record<string, unknown>;
  // Preserve a null prototype rather than promoting to an ordinary object.
  const out = (proto === null ? Object.create(null) : {}) as Record<
    string,
    unknown
  >;

  ancestors.push(obj);
  // Object.keys = own enumerable string keys, exactly JSON's view.
  for (const k of Object.keys(src)) {
    const d = Object.getOwnPropertyDescriptor(src, k)!;
    path.push(k);
    if (d.get !== undefined || d.set !== undefined) {
      throw new ReplayRejection("ACCESSOR_PROPERTY", joinPath(path));
    }
    const copied = copyPlainReplayValue(d.value, depth + 1, ancestors, path);
    path.pop();
    if (k === "__proto__") {
      // Never `out[k] = ...`: that invokes the inherited __proto__ setter,
      // dropping the key and mutating the copy's prototype. JSON.parse can
      // produce an own __proto__ key and chain snapshots come from parsed
      // HTTP JSON, so this path is reachable.
      Object.defineProperty(out, k, {
        value: copied,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      out[k] = copied;
    }
  }
  ancestors.pop();
  return out;
}

/** Accepted payload container: a plain object, never an array or exotic. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export interface TapTick {
  receivedAtMs: number;
  instrumentToken: number;
  symbol: string | undefined;
  ltp: number;
  ltq: number | null;
  volume: number | null;
  oi: number | null;
  /** Original Kite payload (kept for R2 engine compatibility). */
  raw: Record<string, unknown>;
}

export interface TapChainSnapshot {
  capturedAtMs: number;
  underlying: string;
  expiry: string;         // "YYYY-MM-DD"
  source: "kite" | "nse" | string;
  /** Raw snapshot payload — full chain per spec §7. */
  snapshot: Record<string, unknown>;
}

export interface TapBoardSnapshot {
  capturedAtMs: number;
  /** Serialised board rows (indices ticker widget rollup). */
  rows: Array<Record<string, unknown>>;
}

export interface TapSystemEvent {
  emittedAtMs: number;
  kind:
    | "SYSTEM_MODE_TRANSITION"
    | "REGIME_CHANGE"
    | "KITE_SESSION_EDGE"
    | "OTHER";
  detail: Record<string, unknown>;
}

const SYSTEM_EVENT_KINDS: ReadonlySet<string> = new Set([
  "SYSTEM_MODE_TRANSITION",
  "REGIME_CHANGE",
  "KITE_SESSION_EDGE",
  "OTHER",
]);

/**
 * Copy one accepted payload container. Returns the copy, or null after
 * recording the rejection. Numeric/string scalars are validated by the
 * per-type normalizers before this is reached.
 */
/**
 * Single funnel from a thrown ReplayRejection to a counted, logged,
 * null-returning refusal.
 *
 * Anything that is NOT a ReplayRejection is rethrown deliberately: a
 * genuine bug in this module must not be laundered into a silent tick
 * drop. Callers already wrap tapPush* in try/catch, so it cannot reach
 * the trading path either way.
 */
function rejectionOf(entryType: ReplayEntryType, err: unknown): null {
  if (err instanceof ReplayRejection) {
    return recordRejection(entryType, err.reason, err.path);
  }
  throw err;
}

// ── Typed normalizers — one per entry type, no universal clone ──────
//
// Each returns a brand-new entry built field by field from validated
// input, or null when the entry must be rejected. Caller input is only
// ever read: never mutated, never frozen, never retained.

function normalizeTapTick(t: TapTick): TapTick | null {
  try {
    if (!isPlainObject(t)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "<root>");
    }
    rejectIfCustomToJSON(t, "<root>");

    // Every field is read by DESCRIPTOR. A hostile or accidental accessor
    // on a top-level field is refused without being invoked, exactly as
    // it is inside the payload.
    const receivedAtMs = readOwn(t, "receivedAtMs", "receivedAtMs");
    if (!isFiniteNumber(receivedAtMs)) {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "receivedAtMs");
    }
    const instrumentToken = readOwn(t, "instrumentToken", "instrumentToken");
    if (!isFiniteNumber(instrumentToken)) {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "instrumentToken");
    }
    const symbol = readOwn(t, "symbol", "symbol");
    if (symbol !== undefined && typeof symbol !== "string") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "symbol");
    }
    // Value fields accept any number (including NaN/Infinity, which JSON
    // already emits as null) so the recorder keeps byte-parity with the
    // pre-0.5C output instead of silently dropping a degenerate tick.
    const ltp = readOwn(t, "ltp", "ltp");
    if (typeof ltp !== "number") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "ltp");
    }
    const ltq = readOwn(t, "ltq", "ltq");
    if (ltq !== null && typeof ltq !== "number") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "ltq");
    }
    const volume = readOwn(t, "volume", "volume");
    if (volume !== null && typeof volume !== "number") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "volume");
    }
    const oi = readOwn(t, "oi", "oi");
    if (oi !== null && typeof oi !== "number") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "oi");
    }
    const rawField = readOwn(t, "raw", "raw");
    if (!isPlainObject(rawField)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "raw");
    }
    const raw = copyPlainReplayValue(rawField, 1, [], ["raw"]);

    return {
      receivedAtMs,
      instrumentToken,
      symbol,
      ltp,
      ltq,
      volume,
      oi,
      raw: raw as Record<string, unknown>,
    };
  } catch (err) {
    return rejectionOf("tick", err);
  }
}

function normalizeTapChainSnapshot(
  s: TapChainSnapshot,
): TapChainSnapshot | null {
  try {
    if (!isPlainObject(s)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "<root>");
    }
    rejectIfCustomToJSON(s, "<root>");

    const capturedAtMs = readOwn(s, "capturedAtMs", "capturedAtMs");
    if (!isFiniteNumber(capturedAtMs)) {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "capturedAtMs");
    }
    const underlying = readOwn(s, "underlying", "underlying");
    if (typeof underlying !== "string") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "underlying");
    }
    const expiry = readOwn(s, "expiry", "expiry");
    if (typeof expiry !== "string") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "expiry");
    }
    const source = readOwn(s, "source", "source");
    if (typeof source !== "string") {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "source");
    }
    const snapshotField = readOwn(s, "snapshot", "snapshot");
    if (!isPlainObject(snapshotField)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "snapshot");
    }
    const snapshot = copyPlainReplayValue(snapshotField, 1, [], ["snapshot"]);

    return {
      capturedAtMs,
      underlying,
      expiry,
      source,
      snapshot: snapshot as Record<string, unknown>,
    };
  } catch (err) {
    return rejectionOf("chainSnapshot", err);
  }
}

function normalizeTapBoardSnapshot(
  b: TapBoardSnapshot,
): TapBoardSnapshot | null {
  try {
    if (!isPlainObject(b)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "<root>");
    }
    rejectIfCustomToJSON(b, "<root>");

    const capturedAtMs = readOwn(b, "capturedAtMs", "capturedAtMs");
    if (!isFiniteNumber(capturedAtMs)) {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "capturedAtMs");
    }
    const rowsField = readOwn(b, "rows", "rows");
    if (!Array.isArray(rowsField)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "rows");
    }
    const rows = copyPlainReplayValue(rowsField, 1, [], ["rows"]) as unknown[];

    // Per-row shape is validated on the COPY, never on the caller's
    // array: probing rows[i] on the original could invoke an accessor.
    // By this point every element is inert plain data.
    for (let i = 0; i < rows.length; i++) {
      if (!isPlainObject(rows[i])) {
        throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", `rows.${i}`);
      }
    }

    return {
      capturedAtMs,
      rows: rows as Array<Record<string, unknown>>,
    };
  } catch (err) {
    return rejectionOf("boardSnapshot", err);
  }
}

function normalizeTapSystemEvent(e: TapSystemEvent): TapSystemEvent | null {
  try {
    if (!isPlainObject(e)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "<root>");
    }
    rejectIfCustomToJSON(e, "<root>");

    const emittedAtMs = readOwn(e, "emittedAtMs", "emittedAtMs");
    if (!isFiniteNumber(emittedAtMs)) {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "emittedAtMs");
    }
    const kind = readOwn(e, "kind", "kind");
    if (typeof kind !== "string" || !SYSTEM_EVENT_KINDS.has(kind)) {
      throw new ReplayRejection("INVALID_SCALAR_FIELD", "kind");
    }
    const detailField = readOwn(e, "detail", "detail");
    if (!isPlainObject(detailField)) {
      throw new ReplayRejection("INVALID_PAYLOAD_CONTAINER", "detail");
    }
    const detail = copyPlainReplayValue(detailField, 1, [], ["detail"]);

    return {
      emittedAtMs,
      kind: kind as TapSystemEvent["kind"],
      detail: detail as Record<string, unknown>,
    };
  } catch (err) {
    return rejectionOf("systemEvent", err);
  }
}

const ticks = new RingBuffer<TapTick>(CAP_TICKS);
const chains = new RingBuffer<TapChainSnapshot>(CAP_CHAIN);
const boards = new RingBuffer<TapBoardSnapshot>(CAP_BOARDS);
const events = new RingBuffer<TapSystemEvent>(CAP_EVENTS);

/**
 * Age-based eviction. The count cap is enforced by the ring itself —
 * `push` overwrites exactly the oldest entry once capacity is reached,
 * in O(1), so no linear trim runs on the tick path any more.
 *
 * This is a HEAD SCAN, matching the original semantics exactly: it stops
 * at the first entry that is not expired. An out-of-order old entry
 * sitting behind a fresh one is therefore not evicted here, just as
 * before. Each eviction is O(1), so the loop costs O(k) for k expired
 * entries rather than the previous O(k*n).
 */
function trimByAge<T>(ring: RingBuffer<T>, ageOf: (row: T) => number): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (;;) {
    const oldest = ring.peekOldest();
    if (oldest === undefined || ageOf(oldest) >= cutoff) break;
    ring.dropOldest();
  }
}

// ── Push API — every entry point wrapped by caller in try/catch ────
//
// Every push stores a freshly normalized entry. The caller's object is
// never retained, never frozen and never mutated — callers may keep
// reusing and mutating one scratch object across pushes without
// corrupting earlier entries. A rejected entry NEVER enters the ring.

export function tapPushTick(t: TapTick): void {
  const entry = normalizeTapTick(t);
  if (entry === null) return;
  ticks.push(entry);
  trimByAge(ticks, (x) => x.receivedAtMs);
}

export function tapPushChainSnapshot(s: TapChainSnapshot): void {
  const entry = normalizeTapChainSnapshot(s);
  if (entry === null) return;
  chains.push(entry);
  trimByAge(chains, (x) => x.capturedAtMs);
}

export function tapPushBoardSnapshot(b: TapBoardSnapshot): void {
  const entry = normalizeTapBoardSnapshot(b);
  if (entry === null) return;
  boards.push(entry);
  trimByAge(boards, (x) => x.capturedAtMs);
}

export function tapPushSystemEvent(e: TapSystemEvent): void {
  const entry = normalizeTapSystemEvent(e);
  if (entry === null) return;
  events.push(entry);
  trimByAge(events, (x) => x.emittedAtMs);
}

// ── Drain API — used by the recorder endpoint ──────────────────────

export interface DrainWindow {
  /** Inclusive lower bound (epoch ms). Rows older than this are dropped. */
  sinceMs: number;
}

export interface DrainedFixture {
  ticks: TapTick[];
  chainSnapshots: TapChainSnapshot[];
  boardSnapshots: TapBoardSnapshot[];
  systemEvents: TapSystemEvent[];
  /** Actual observed span (min/max of tick timestamps within window). */
  observedRangeMs: { min: number; max: number } | null;
}

/**
 * Re-copy a STORED entry for handing to a consumer.
 *
 * Stored entries are already normalized plain trees, so this cannot
 * reject in practice. The guard is defensive: if it ever fires, storage
 * violated its own invariant, which is a bug worth surfacing rather
 * than papering over — so it is counted under a distinct reason and the
 * entry is omitted rather than handed out shared.
 */
function copyStoredEntry<T>(entryType: ReplayEntryType, entry: T): T | null {
  try {
    return copyPlainReplayValue(entry, 0, [], []) as T;
  } catch (err) {
    if (err instanceof ReplayRejection) {
      recordRejection(
        entryType,
        "STORED_SHAPE_INVARIANT_VIOLATION",
        err.path,
      );
      return null;
    }
    throw err;
  }
}

function drainStream<T>(
  ring: RingBuffer<T>,
  entryType: ReplayEntryType,
  keep: (row: T) => boolean,
): T[] {
  const out: T[] = [];
  for (const row of ring.filterToArray(keep)) {
    const copy = copyStoredEntry(entryType, row);
    if (copy !== null) out.push(copy);
  }
  return out;
}

export function drainSince(window: DrainWindow): DrainedFixture {
  // Single-pass filtered reads. O(n) in retained entries, which is
  // unavoidable when materialising a window, but it runs ONLY here —
  // on owner demand — never on the tick path. Reads never mutate the
  // rings, and every returned array is freshly allocated.
  //
  // Each returned ENTRY is an independent snapshot, so a consumer may
  // mutate the drained fixture freely without reaching retained storage,
  // and two successive drains are independent of one another.
  const t = drainStream(
    ticks,
    "tick",
    (x) => x.receivedAtMs >= window.sinceMs,
  );
  const c = drainStream(
    chains,
    "chainSnapshot",
    (x) => x.capturedAtMs >= window.sinceMs,
  );
  const b = drainStream(
    boards,
    "boardSnapshot",
    (x) => x.capturedAtMs >= window.sinceMs,
  );
  const e = drainStream(
    events,
    "systemEvent",
    (x) => x.emittedAtMs >= window.sinceMs,
  );
  const range = t.length > 0
    ? { min: t[0]!.receivedAtMs, max: t[t.length - 1]!.receivedAtMs }
    : null;
  return {
    ticks: t,
    chainSnapshots: c,
    boardSnapshots: b,
    systemEvents: e,
    observedRangeMs: range,
  };
}

/** Compact stats for /api/replay/record dry-run / health-check. */
export interface TapStats {
  tickCount: number;
  chainCount: number;
  boardCount: number;
  eventCount: number;
  oldestTickMs: number | null;
  newestTickMs: number | null;
  /**
   * Entries REJECTED by the typed snapshot contract and therefore never
   * stored. Expected to stay at zero for every currently reachable
   * production payload; a non-zero value means a provider shape changed
   * and the recorder is losing those entries.
   */
  rejections: ReplayRejectionDiagnostics;
}

export function tapStats(): TapStats {
  // Head/tail reads, O(1). Deliberately NOT a min/max scan — this
  // preserves the pre-existing observable contract exactly.
  return {
    tickCount: ticks.size,
    chainCount: chains.size,
    boardCount: boards.size,
    eventCount: events.size,
    oldestTickMs: ticks.peekOldest()?.receivedAtMs ?? null,
    newestTickMs: ticks.peekNewest()?.receivedAtMs ?? null,
    rejections: getReplayRejectionDiagnostics(),
  };
}

/** Test-only capacity introspection. Read-only; no behavioural effect. */
export function _tapCapacities(): {
  ticks: number;
  chains: number;
  boards: number;
  events: number;
} {
  return {
    ticks: CAP_TICKS,
    chains: CAP_CHAIN,
    boards: CAP_BOARDS,
    events: CAP_EVENTS,
  };
}

/** Test-only reset. Not part of the barrel export. */
export function _resetLiveTapRing(): void {
  ticks.clear();
  chains.clear();
  boards.clear();
  events.clear();
  // Reset the rejection counters too, so a full reset really is a full
  // reset and counter state cannot leak between tests.
  _resetReplayRejectionDiagnostics();
}
