/**
 * Canonical instrument resolver — the single source of truth for turning an
 * arbitrary user-supplied symbol (NSE/BSE equity, ETF, BSE numeric code, old
 * alias, special-character ticker like `ARE&M`) into ONE canonical instrument.
 *
 * Why this exists
 * ---------------
 * Historically each surface resolved symbols differently:
 *   - the curated `UNIVERSE` (~280 NSE names) powered Scanner + Charting search,
 *   - Portfolio rolled its own enrichment cascade over that same curated list,
 * so any real instrument OUTSIDE the curated list (TRIDENT, BDL, CDSL, ARE&M,
 * BLS, INDHOTEL, NSDL/544467, …) resolved to "No instrument match" in Portfolio
 * even though it is present in the full Kite master that Deep Scan/Full-NSE uses.
 *
 * This module reads the SAME session-independent Kite instrument dump that the
 * rest of the app warm-starts from (`.cache/kite_instruments_{NSE,BSE}.json`,
 * written by kiteAuth) and builds an in-memory index keyed by:
 *   - (exchange, tradingsymbol)            exact match, NSE preferred
 *   - tradingsymbol (any exchange)         e.g. NSDL only exists on BSE
 *   - alphanumeric-stripped symbol         ARE&M ↔ AREM ↔ "ARE M"
 *   - BSE exchange_token (numeric code)    e.g. 544467 → NSDL
 *   - a small curated alias map            well-established renames only
 *
 * It NEVER fabricates: a symbol with no real match returns UNRESOLVED with an
 * explicit reason. It performs NO network I/O — purely the on-disk master —
 * and is therefore cheap to unit-test and safe to import from any route.
 */
import fs from "node:fs";
import path from "node:path";
import { loadBlob } from "../diskCache";

const CACHE_DIR = path.resolve(process.cwd(), ".cache");
const DISK_PREFIX = "kite_instruments_";
const DISK_VERSION = 1;
/** Exchanges we resolve cash equities/ETFs from, in preference order. */
const EXCHANGES = ["NSE", "BSE"] as const;

// ─── Test-only cache-dir override ────────────────────────────────────────────
// Allows deterministic unit tests to inject fixture files without touching the
// real workspace .cache directory. Never set this in production code.
let _testCacheDirOverride: string | null = null;

/** @internal — for unit tests only. Pass `null` to restore the real cache dir. */
export function _forTesting_overrideCacheDir(dir: string | null): void {
  _testCacheDirOverride = dir;
  cachedIndex = null; // force rebuild on next access
}

function effectiveCacheDir(): string {
  return _testCacheDirOverride ?? CACHE_DIR;
}
// ─────────────────────────────────────────────────────────────────────────────
const EX_PRIORITY: Record<string, number> = { NSE: 0, BSE: 1 };

interface RawInstrument {
  instrument_token: string | number;
  exchange_token: string | number;
  tradingsymbol: string;
  name?: string;
  instrument_type: string;
  segment: string;
  exchange: string;
}

export type ResolverStatus = "RESOLVED" | "UNRESOLVED";

export interface CanonicalInstrument {
  /** Canonical Kite tradingsymbol (e.g. "ARE&M", "TRIDENT", "NSDL"). */
  canonical_symbol: string;
  /** Human display name from the Kite master. */
  display_name: string;
  exchange: string;
  /** Coarse type label: NSE_EQUITY | BSE_EQUITY | NSE_ETF | BSE_ETF. */
  instrument_type: string;
  /** Quote key understood by Kite getQuote, e.g. "NSE:TRIDENT". */
  kite_key: string;
  instrument_token: number;
  /** BSE security/scrip code when the canonical instrument is BSE, else null. */
  bse_code: string | null;
  /** Known aliases that resolve to this instrument. */
  aliases: string[];
  source: "kite_instrument_master";
  resolver_status: ResolverStatus;
}

export interface ResolveResult {
  raw_symbol: string;
  normalized: string;
  resolved: boolean;
  instrument: CanonicalInstrument | null;
  /** Ordered list of strategies tried, for the diagnostics endpoint. */
  attempts: string[];
  matched_via: string | null;
  reason: string | null;
}

/**
 * Curated alias map — ONLY well-established corporate renames where the old
 * ticker no longer exists in the master. Kept intentionally tiny; generic
 * special-character handling (ARE&M↔AREM) is done by the alnum index, not here.
 */
const ALIASES: Record<string, string> = {
  // Amara Raja Batteries → Amara Raja Energy & Mobility (NSE ticker changed)
  AMARAJABAT: "ARE&M",
};

interface ResolverIndex {
  /** Cheap mtime-based signature of the source files (rebuild trigger). */
  diskSig: string;
  byKey: Map<string, CanonicalInstrument>; // `${EX}:${SYM}`
  bySym: Map<string, CanonicalInstrument[]>; // SYM → instruments (any exchange)
  byAlnum: Map<string, CanonicalInstrument[]>; // alnum(SYM) → instruments
  byBseCode: Map<string, CanonicalInstrument>; // BSE exchange_token → instrument
  all: CanonicalInstrument[]; // for search, NSE-preferred order
}

let cachedIndex: ResolverIndex | null = null;

function alnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Strip exchange suffixes / whitespace; preserve `&` and other ticker chars. */
export function normalizeSymbol(raw: string): string {
  let s = (raw ?? "").trim().toUpperCase();
  s = s.replace(/\s+/g, "");
  // Drop common Yahoo/exchange suffixes.
  s = s.replace(/\.(NS|BO|BSE|NSE)$/i, "");
  // Drop a "NSE:"/"BSE:" prefix if the user pasted a kite key.
  s = s.replace(/^(NSE|BSE):/i, "");
  return s;
}

function isEtf(sym: string, name: string): boolean {
  return /\bETF\b|BEES|LIQUIDBEES|GOLDBEES|SILVERBEES/i.test(`${sym} ${name}`);
}

function toCanonical(r: RawInstrument): CanonicalInstrument {
  const ex = r.exchange;
  const sym = String(r.tradingsymbol).toUpperCase();
  const name = (r.name ?? sym).toString();
  const etf = isEtf(sym, name);
  const typeLabel = `${ex}_${etf ? "ETF" : "EQUITY"}`;
  const token = Number(r.instrument_token);
  return {
    canonical_symbol: sym,
    display_name: name,
    exchange: ex,
    instrument_type: typeLabel,
    kite_key: `${ex}:${sym}`,
    instrument_token: Number.isFinite(token) ? token : 0,
    bse_code: ex === "BSE" ? String(r.exchange_token) : null,
    aliases: [],
    source: "kite_instrument_master",
    resolver_status: "RESOLVED",
  };
}

/**
 * Cheap rebuild-trigger signature: file size + mtime per master file. Avoids
 * parsing the (large) master JSON on every lookup — we only re-parse when a
 * file actually changes on disk. Empty string when no master file exists.
 */
function diskSignature(): string {
  const parts: string[] = [];
  const dir = effectiveCacheDir();
  for (const ex of EXCHANGES) {
    const file = path.join(dir, `${DISK_PREFIX}${ex}.json`);
    try {
      const st = fs.statSync(file);
      parts.push(`${ex}:${st.size}:${st.mtimeMs}`);
    } catch {
      // missing file contributes nothing to the signature
    }
  }
  return parts.join("|");
}

/**
 * Load raw instrument rows for one exchange from either the test-override
 * directory or the real diskCache. Returns null on any error or empty payload.
 */
function loadInstrumentFile(ex: string): RawInstrument[] | null {
  const override = _testCacheDirOverride;
  if (override) {
    // In test mode: read directly from the override directory.
    const file = path.join(override, `${DISK_PREFIX}${ex}.json`);
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as { version: number; payload: RawInstrument[] };
      if (parsed.version !== DISK_VERSION) return null;
      return Array.isArray(parsed.payload) && parsed.payload.length > 0 ? parsed.payload : null;
    } catch {
      return null;
    }
  }
  // Normal path: delegate to diskCache (uses the real CACHE_DIR).
  const blob = loadBlob<RawInstrument[]>(`${DISK_PREFIX}${ex}`, DISK_VERSION);
  if (!blob || !Array.isArray(blob.payload) || blob.payload.length === 0) return null;
  return blob.payload;
}

function buildIndex(): ResolverIndex {
  const byKey = new Map<string, CanonicalInstrument>();
  const bySym = new Map<string, CanonicalInstrument[]>();
  const byAlnum = new Map<string, CanonicalInstrument[]>();
  const byBseCode = new Map<string, CanonicalInstrument>();
  const all: CanonicalInstrument[] = [];
  const diskSig = diskSignature();

  for (const ex of EXCHANGES) {
    const rows = loadInstrumentFile(ex);
    if (!rows) continue;
    for (const r of rows) {
      // Cash equities + ETFs only — exclude indices and derivatives.
      if (r.instrument_type !== "EQ") continue;
      if (r.segment === "INDICES") continue;
      if (r.exchange !== ex) continue;
      const inst = toCanonical(r);
      byKey.set(`${ex}:${inst.canonical_symbol}`, inst);
      const symList = bySym.get(inst.canonical_symbol) ?? [];
      symList.push(inst);
      bySym.set(inst.canonical_symbol, symList);
      const ak = alnum(inst.canonical_symbol);
      const aList = byAlnum.get(ak) ?? [];
      aList.push(inst);
      byAlnum.set(ak, aList);
      if (inst.bse_code) byBseCode.set(inst.bse_code, inst);
      all.push(inst);
    }
  }

  const byPriority = (a: CanonicalInstrument, b: CanonicalInstrument) =>
    (EX_PRIORITY[a.exchange] ?? 99) - (EX_PRIORITY[b.exchange] ?? 99);
  for (const list of bySym.values()) list.sort(byPriority);
  for (const list of byAlnum.values()) list.sort(byPriority);
  all.sort(byPriority);

  return { diskSig, byKey, bySym, byAlnum, byBseCode, all };
}

function getIndex(): ResolverIndex {
  const sig = diskSignature();
  if (cachedIndex && cachedIndex.diskSig === sig && sig !== "") return cachedIndex;
  cachedIndex = buildIndex();
  return cachedIndex;
}

/** Force a rebuild on next access (used by tests after writing fixtures). */
export function resetResolverCache(): void {
  cachedIndex = null;
}

/** True when the on-disk master is present (resolver can do real work). */
export function isResolverReady(): boolean {
  return getIndex().all.length > 0;
}

/**
 * Per-exchange readiness: true when at least one instrument from that exchange
 * is present in the built index.
 *
 * `isResolverReady()` returns `true` as long as ANY exchange has data; this
 * function lets callers distinguish a fully-populated NSE+BSE master from one
 * where BSE instruments are absent (e.g. after a BSE cache corruption).
 */
export function getExchangeReadiness(): Record<(typeof EXCHANGES)[number], boolean> {
  const idx = getIndex();
  const result = {} as Record<(typeof EXCHANGES)[number], boolean>;
  for (const ex of EXCHANGES) {
    result[ex] = idx.all.some((inst) => inst.exchange === ex);
  }
  return result;
}

export interface ResolveOptions {
  /** Preferred exchange when a symbol exists on both NSE and BSE. */
  preferExchange?: "NSE" | "BSE";
}

/**
 * Resolve an arbitrary user symbol to ONE canonical instrument.
 * Deterministic, never fabricates: returns resolved=false with an explicit
 * reason when nothing in the master matches.
 */
export function resolveInstrument(raw: string, opts: ResolveOptions = {}): ResolveResult {
  const idx = getIndex();
  const normalized = normalizeSymbol(raw);
  const attempts: string[] = [];
  const prefer = opts.preferExchange ?? "NSE";
  const order = prefer === "BSE" ? ["BSE", "NSE"] : ["NSE", "BSE"];

  const fail = (reason: string): ResolveResult => ({
    raw_symbol: raw,
    normalized,
    resolved: false,
    instrument: null,
    attempts,
    matched_via: null,
    reason,
  });
  const ok = (inst: CanonicalInstrument, via: string): ResolveResult => ({
    raw_symbol: raw,
    normalized,
    resolved: true,
    instrument: { ...inst, aliases: aliasesFor(inst) },
    attempts,
    matched_via: via,
    reason: null,
  });

  if (!normalized) return fail("Empty symbol");
  if (idx.all.length === 0) {
    attempts.push("master-load");
    return fail("Instrument master unavailable on disk (Kite dump not warm-started)");
  }

  // 1) Curated alias map.
  attempts.push("alias-map");
  const aliased = ALIASES[normalized];
  const target = aliased ?? normalized;
  if (aliased) {
    const hit = pickByExchange(idx, target, order);
    if (hit) return ok(hit, `alias:${normalized}→${target}`);
  }

  // 2) BSE numeric scrip code (e.g. 544467 → NSDL).
  if (/^\d+$/.test(target)) {
    attempts.push("bse-numeric-code");
    const hit = idx.byBseCode.get(target);
    if (hit) return ok(hit, "bse-code");
    return fail(`No BSE instrument with scrip code ${target} in Kite master`);
  }

  // 3) Exact tradingsymbol, preferred exchange first.
  attempts.push("exact-symbol");
  const exact = pickByExchange(idx, target, order);
  if (exact) return ok(exact, "exact-symbol");

  // 4) Alphanumeric-normalized match (ARE&M ↔ AREM ↔ "ARE M").
  attempts.push("alnum-normalized");
  const aList = idx.byAlnum.get(alnum(target));
  if (aList && aList.length > 0) {
    const pref = aList.find(i => i.exchange === order[0]) ?? aList[0];
    return ok(pref, "alnum-normalized");
  }

  attempts.push("name-search");
  return fail("No matching instrument in Kite NSE/BSE master, alias map, or BSE code index");
}

function pickByExchange(idx: ResolverIndex, sym: string, order: string[]): CanonicalInstrument | null {
  for (const ex of order) {
    const hit = idx.byKey.get(`${ex}:${sym}`);
    if (hit) return hit;
  }
  const any = idx.bySym.get(sym);
  return any && any.length > 0 ? any[0] : null;
}

function aliasesFor(inst: CanonicalInstrument): string[] {
  const out: string[] = [];
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (target === inst.canonical_symbol) out.push(alias);
  }
  return out;
}

export interface InstrumentSearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string; // "Equity" | "ETF"
  instrument_type: string; // NSE_EQUITY etc.
  instrumentToken?: number;
}

/**
 * Substring/prefix search across the full master. NSE ranked above BSE; exact
 * and prefix matches rank above contains. Returns [] for empty query.
 */
export function searchMaster(query: string, limit = 25): InstrumentSearchHit[] {
  const q = normalizeSymbol(query);
  if (!q) return [];
  const idx = getIndex();
  const qa = alnum(q);
  const scored: { inst: CanonicalInstrument; score: number }[] = [];

  if (/^\d+$/.test(q)) {
    const codeHit = idx.byBseCode.get(q);
    if (codeHit) {
      scored.push({ inst: codeHit, score: 0 });
    }
  }

  for (const inst of idx.all) {
    if (/^\d+$/.test(q) && inst.bse_code === q) continue;
    const sym = inst.canonical_symbol;
    const name = inst.display_name.toUpperCase();
    let score = -1;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (alnum(sym).startsWith(qa)) score = 3;
    else if (sym.includes(q)) score = 4;
    else if (name.includes(q)) score = 5;
    if (score >= 0) {
      // Nudge NSE ahead of BSE within the same score band.
      score = score * 2 + (EX_PRIORITY[inst.exchange] ?? 1);
      scored.push({ inst, score });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.inst.canonical_symbol.localeCompare(b.inst.canonical_symbol));
  return scored.slice(0, limit).map(s => ({
    symbol: s.inst.canonical_symbol,
    name: s.inst.display_name,
    exchange: s.inst.exchange,
    type: s.inst.instrument_type.endsWith("ETF") ? "ETF" : "Equity",
    instrument_type: s.inst.instrument_type,
    instrumentToken: s.inst.instrument_token,
  }));
}
