/**
 * Phase 0.7A — legacy NSE-defaulting elimination.
 *
 * Every consumer that used to reach for `?? "NSE"` (or an `exchange = "NSE"`
 * default parameter) when an exchange was missing now either reads the
 * exchange from the source that established it, or fails closed with an
 * explicit reason code. These tests pin that behaviour so the defaults cannot
 * come back.
 *
 * Scope: pure functions, in-memory L1 candle store, and source-text guards for
 * the modules whose import has scheduler side-effects. No DB, no Kite, no
 * provider calls, no schema or workflow changes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeCanonicalExchange,
  resolveExchangeQualifiedIdentity,
  instrumentRegistry,
  buildCanonicalInstrumentId,
} from "./canonicalInstrument";
import {
  getKiteCandleSeries,
  _testOnly as candleStoreTestOnly,
  type KiteCandleEntry,
} from "./kiteCandle/kiteCandleStore";
import { ELIGIBLE_INSTRUMENT_EXCHANGE, classifyInstrument } from "./kiteCandle/instrumentEligibility";
import { KITE_SCANNER_QUOTE_EXCHANGE } from "./kiteScanner";
import { CURATED_UNIVERSE_EXCHANGE } from "./universe";
import {
  FNO_PAPER_V2_RUNTIME_AUTHORIZED,
  SWING_PAPER_V2_RUNTIME_AUTHORIZED,
} from "./v2PaperLocks";
import {
  FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
  SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
} from "./candleEvaluationControl";

const SRC = join(__dirname, "..");
const readSrc = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// 1. Shared identity contract
// ───────────────────────────────────────────────────────────────────────────

describe("P0.7A — normalizeCanonicalExchange (closed set, no default)", () => {
  it("accepts only NSE and BSE, case- and whitespace-insensitively", () => {
    expect(normalizeCanonicalExchange("NSE")).toBe("NSE");
    expect(normalizeCanonicalExchange(" bse ")).toBe("BSE");
  });

  it("returns null — never a default exchange — for anything else", () => {
    for (const bad of [null, undefined, "", "   ", "NSEIDX", "NS", "MCX", 1, {}, ["NSE"]]) {
      expect(normalizeCanonicalExchange(bad)).toBeNull();
    }
  });
});

describe("P0.7A — resolveExchangeQualifiedIdentity (resolution order)", () => {
  const TOKEN = 900_701;
  const AMBIG_NSE = 900_702;
  const AMBIG_BSE = 900_703;

  beforeEach(() => {
    // Registrations are idempotent for our purposes: re-registering the same
    // id+token is accepted, and we only assert on resolution behaviour.
    instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "P07ONLYNSE", providerInstrumentToken: TOKEN,
    });
    instrumentRegistry.register({
      exchange: "NSE", segment: "EQUITY", tradingSymbol: "P07DUAL", providerInstrumentToken: AMBIG_NSE,
    });
    instrumentRegistry.register({
      exchange: "BSE", segment: "EQUITY", tradingSymbol: "P07DUAL", providerInstrumentToken: AMBIG_BSE,
    });
  });

  it("1 — an existing canonical id wins and keeps its exchange", () => {
    const r = resolveExchangeQualifiedIdentity({
      canonicalInstrumentId: buildCanonicalInstrumentId("BSE", "EQUITY", "P07DUAL"),
      exchange: "NSE", // must NOT override the canonical id
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.qualified.exchange).toBe("BSE");
    expect(r.qualified.resolvedBy).toBe("CANONICAL_ID");
  });

  it("1b — a malformed canonical id fails closed, it does not fall through", () => {
    const r = resolveExchangeQualifiedIdentity({ canonicalInstrumentId: "RELIANCE", exchange: "NSE" });
    expect(r).toMatchObject({ ok: false, code: "CANONICAL_IDENTITY_REQUIRED" });
  });

  it("2 — an exact provider token resolves to its registered exchange", () => {
    const r = resolveExchangeQualifiedIdentity({ providerInstrumentToken: AMBIG_BSE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.qualified.exchange).toBe("BSE");
    expect(r.qualified.resolvedBy).toBe("PROVIDER_TOKEN");
  });

  it("2b — an unmapped provider token is PROVIDER_TOKEN_NOT_MAPPED, never NSE", () => {
    const r = resolveExchangeQualifiedIdentity({ providerInstrumentToken: 8_888_881, tradingSymbol: "P07DUAL" });
    expect(r).toMatchObject({ ok: false, code: "PROVIDER_TOKEN_NOT_MAPPED" });
  });

  it("3 — an explicit exchange plus an exact symbol qualifies", () => {
    const r = resolveExchangeQualifiedIdentity({ exchange: "bse", tradingSymbol: " p07dual " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.qualified.canonicalInstrumentId).toBe("BSE:EQUITY:P07DUAL");
    expect(r.qualified.resolvedBy).toBe("EXPLICIT_EXCHANGE_AND_SYMBOL");
  });

  it("3b — an invalid exchange is INVALID_EXCHANGE, not a fallback", () => {
    const r = resolveExchangeQualifiedIdentity({ exchange: "NSEE", tradingSymbol: "P07DUAL" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_EXCHANGE" });
  });

  it("4 — a symbol listed on both exchanges is AMBIGUOUS_EXCHANGE, never NSE-first", () => {
    const r = resolveExchangeQualifiedIdentity({ tradingSymbol: "P07DUAL", allowRegistryUniqueSymbol: true });
    expect(r).toMatchObject({ ok: false, code: "AMBIGUOUS_EXCHANGE" });
    if (r.ok) return;
    expect(r.detail).toContain("BSE:EQUITY:P07DUAL");
    expect(r.detail).toContain("NSE:EQUITY:P07DUAL");
  });

  it("4b — a registry-unique symbol resolves, an unknown one is IDENTITY_NOT_FOUND", () => {
    const unique = resolveExchangeQualifiedIdentity({ tradingSymbol: "P07ONLYNSE", allowRegistryUniqueSymbol: true });
    expect(unique.ok).toBe(true);
    if (unique.ok) expect(unique.qualified.resolvedBy).toBe("REGISTRY_UNIQUE_SYMBOL");

    const missing = resolveExchangeQualifiedIdentity({ tradingSymbol: "P07NOSUCH", allowRegistryUniqueSymbol: true });
    expect(missing).toMatchObject({ ok: false, code: "IDENTITY_NOT_FOUND" });
  });

  it("5 — a bare symbol without opt-in is CANONICAL_IDENTITY_REQUIRED", () => {
    expect(resolveExchangeQualifiedIdentity({ tradingSymbol: "P07ONLYNSE" }))
      .toMatchObject({ ok: false, code: "CANONICAL_IDENTITY_REQUIRED" });
    expect(resolveExchangeQualifiedIdentity({}))
      .toMatchObject({ ok: false, code: "CANONICAL_IDENTITY_REQUIRED" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Sites 1-3 — kiteCandleStore
// ───────────────────────────────────────────────────────────────────────────

function entryFor(symbol: string, exchange: KiteCandleEntry["exchange"]): KiteCandleEntry {
  return {
    symbol,
    exchange,
    timeframe: "day",
    sessionDate: "2026-08-11",
    barCount: 260,
    chart: null,
    fetchedAt: new Date(),
    status: "stale",
    errorCode: null,
  };
}

describe("P0.7A — candle store keys and reads are exchange-qualified", () => {
  beforeEach(() => {
    candleStoreTestOnly.clearMemCache();
    candleStoreTestOnly.resetCounters();
  });

  it("keeps the two listings of one symbol apart", () => {
    candleStoreTestOnly.setMemCacheEntry({ ...entryFor("DUALSYM", "NSE"), barCount: 111 });
    candleStoreTestOnly.setMemCacheEntry({ ...entryFor("DUALSYM", "BSE"), barCount: 222 });

    expect(getKiteCandleSeries("DUALSYM", "NSE").barCount).toBe(111);
    expect(getKiteCandleSeries("DUALSYM", "BSE").barCount).toBe(222);
  });

  it("does not serve the NSE series to a BSE reader", () => {
    candleStoreTestOnly.setMemCacheEntry(entryFor("ONLYNSE", "NSE"));
    const bse = getKiteCandleSeries("ONLYNSE", "BSE");
    expect(bse.status).toBe("pending");
    expect(bse.chart).toBeNull();
  });

  it("refuses to cache an entry whose exchange is not recognised", () => {
    const bogus = { ...entryFor("BADEXCH", "NSE"), exchange: "MCX" } as unknown as KiteCandleEntry;
    expect(candleStoreTestOnly.setMemCacheEntry(bogus)).toBe(false);
    expect(getKiteCandleSeries("BADEXCH", "NSE").status).toBe("pending");
    expect(getKiteCandleSeries("BADEXCH", "BSE").status).toBe("pending");
  });

  it("drops a database row that is not exchange-qualified instead of reading it as NSE", () => {
    const base = {
      symbol: "DBROW", timeframe: "day", session_date: "2026-08-11",
      bar_count: 260, bars_json: null, fetched_at: null, status: "stale", error_code: null,
    };
    expect(candleStoreTestOnly.dbRowToEntry({ ...base, exchange: "" })).toBeNull();
    expect(candleStoreTestOnly.dbRowToEntry({ ...base, exchange: "MCX" })).toBeNull();
    const good = candleStoreTestOnly.dbRowToEntry({ ...base, exchange: "bse" });
    expect(good?.exchange).toBe("BSE");
  });

  it("declares the curated universe exchange at the universe, not per call site", () => {
    expect(CURATED_UNIVERSE_EXCHANGE).toBe("NSE");
    const src = readSrc("lib/kiteCandle/kiteCandleStore.ts");
    // Site 1: cacheKey default parameter. Site 2: getKiteCandleSeries default.
    expect(src).not.toMatch(/exchange\s*=\s*"NSE"/);
    // Site 3: fetchEntryFromKite's hardcoded exchange.
    expect(src).not.toMatch(/const\s+exchange\s*=\s*"NSE"/);
    expect(src).not.toMatch(/\?\?\s*"NSE"/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2b. Site 9 — the candle table's own column default
//
// `exchange TEXT NOT NULL DEFAULT 'NSE'` defeated every guard above: a writer
// that omitted the column produced a row that LOOKS exchange-qualified, so
// restore-time validation could not detect, count or reject it.
// ───────────────────────────────────────────────────────────────────────────

describe("P0.7A — no database-level exchange default remains", () => {
  const storeSrc = readSrc("lib/kiteCandle/kiteCandleStore.ts");
  const ddl = storeSrc.slice(
    storeSrc.indexOf("CREATE TABLE IF NOT EXISTS kite_candle_store"),
    storeSrc.indexOf("logger.info(\"kiteCandleStore: schema ensured"),
  );

  it("the runtime DDL declares exchange with no default", () => {
    expect(ddl).toContain("exchange            TEXT NOT NULL");
    expect(ddl).not.toMatch(/exchange\s+TEXT NOT NULL DEFAULT/);
    expect(ddl).not.toMatch(/DEFAULT\s+'NSE'/);
  });

  it("no DEFAULT 'NSE' is declared anywhere in the store or the warehouse", () => {
    expect(storeSrc).not.toMatch(/DEFAULT\s+'NSE'/);
    expect(readSrc("lib/kiteCandle/fullNseWarehouse.ts")).not.toMatch(/DEFAULT\s+'NSE'/);
  });

  it("ships an idempotent DROP DEFAULT migration that runtime never executes", () => {
    const migration = readFileSync(
      join(SRC, "..", "..", "..", "docs", "migrations", "kite_candle_store_exchange_drop_default.sql"),
      "utf8",
    );
    expect(migration).toMatch(/ALTER COLUMN exchange DROP DEFAULT/);
    // Idempotent: guarded on the default actually being present.
    expect(migration).toContain("column_default IS NOT NULL");
    // Data must not be touched by a schema migration.
    expect(migration).not.toMatch(/\b(UPDATE|INSERT|DELETE|TRUNCATE)\b\s+(?!.*--)/);
    // The ALTER must not be smuggled into the boot path.
    expect(storeSrc).not.toMatch(/ALTER COLUMN exchange DROP DEFAULT/);
    expect(storeSrc).not.toMatch(/ALTER TABLE kite_candle_store/);
  });

  it("documents production application as a separate owner-authorized operation", () => {
    const docs = join(SRC, "..", "..", "..", "docs", "migrations");
    const migration = readFileSync(join(docs, "kite_candle_store_exchange_drop_default.sql"), "utf8");
    const runbook = readFileSync(
      join(docs, "kite_candle_store_exchange_drop_default.RUNBOOK.md"),
      "utf8",
    );
    // Committing or publishing the file is not execution — the earlier claim
    // to the contrary is explicitly withdrawn.
    expect(migration).toMatch(/does NOT execute/);
    expect(runbook).toMatch(/withdrawn/);
    // Pre-check, post-checks, row-count proof, and a conditional rollback.
    expect(runbook).toMatch(/NOT YET PERFORMED/);
    expect(runbook).toMatch(/column_default IS NULL/);
    expect(runbook).toMatch(/rows_before = rows_after/);
    expect(runbook).toMatch(/ALTER COLUMN exchange SET DEFAULT 'NSE'/);
    // The development execution is disclosed, with its exact effect.
    expect(runbook).toMatch(/development database only/);
    expect(runbook).toMatch(/Row data changed \| none/);
  });

  it("the Drizzle declaration carries no exchange default, so a publish diff cannot re-add it", () => {
    const schemaSrc = readFileSync(
      join(SRC, "..", "..", "..", "lib", "db", "src", "schema", "runtimeTables.ts"),
      "utf8",
    );
    const start = schemaSrc.indexOf("export const kiteCandleStore");
    expect(start).toBeGreaterThan(-1);
    const after = schemaSrc.indexOf("export const", start + 1);
    const decl = schemaSrc.slice(start, after === -1 ? undefined : after);
    expect(decl).toMatch(/text\("exchange"\)\.notNull\(\),/);
    expect(decl).not.toMatch(/text\("exchange"\)[^\n]*\.default\(/);
  });
});

describe("P0.7A — every L2 write states a validated exchange", () => {
  const { validateWriteExchange } = candleStoreTestOnly;
  const storeSrc = readSrc("lib/kiteCandle/kiteCandleStore.ts");

  it("omitted exchange fails", () => {
    expect(validateWriteExchange({ symbol: "INFY" } as never)).toBeNull();
    expect(validateWriteExchange({ symbol: "INFY", exchange: null } as never)).toBeNull();
    expect(validateWriteExchange({ symbol: "INFY", exchange: "" } as never)).toBeNull();
    expect(validateWriteExchange({ symbol: "INFY", exchange: "  " } as never)).toBeNull();
  });

  it("invalid exchange fails", () => {
    for (const bad of ["NSEIDX", "NS", "MCX", "nse-eq", 1, {}]) {
      expect(validateWriteExchange({ symbol: "INFY", exchange: bad } as never)).toBeNull();
    }
  });

  it("explicit NSE succeeds", () => {
    expect(validateWriteExchange({ symbol: "INFY", exchange: "NSE" })).toBe("NSE");
    expect(validateWriteExchange({ symbol: "INFY", exchange: " nse " } as never)).toBe("NSE");
  });

  it("explicit BSE succeeds", () => {
    expect(validateWriteExchange({ symbol: "INFY", exchange: "BSE" })).toBe("BSE");
  });

  it("the single DB writer validates before any SQL and binds the validated value", () => {
    const fn = storeSrc.slice(storeSrc.indexOf("async function upsertToDb("));
    const guard = fn.indexOf("validateWriteExchange(entry)");
    const insert = fn.indexOf("INSERT INTO kite_candle_store");
    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(guard);
    expect(fn.slice(guard, insert)).toContain("CANONICAL_IDENTITY_REQUIRED");
    expect(fn.slice(guard, insert)).toContain("INVALID_EXCHANGE");
    // The row carries the validated value, not the raw field.
    expect(fn.slice(insert, insert + 600)).toContain("${writeExchange}");
    expect(fn.slice(insert, insert + 600)).not.toContain("${entry.exchange}");
  });

  it("upsertToDb is the only writer of the table", () => {
    // Any other INSERT/UPDATE against kite_candle_store would bypass the gate.
    const writers = [...storeSrc.matchAll(/(INSERT INTO|UPDATE)\s+kite_candle_store/g)];
    expect(writers).toHaveLength(1);
    for (const rel of ["lib/kiteCandle/fullNseWarehouse.ts", "lib/scanner.ts", "lib/fullNseScanner.ts", "routes/scanner.ts"]) {
      expect(readSrc(rel)).not.toMatch(/(INSERT INTO|UPDATE)\s+kite_candle_store/);
    }
  });

  it("the public store entry point refuses an unqualified entry before the writer", () => {
    const fn = storeSrc.slice(storeSrc.indexOf("export async function storeKiteCandleEntry("));
    const guard = fn.indexOf("cacheKeyForEntry(entry)");
    const write = fn.indexOf("await upsertToDb(entry)");
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
    expect(fn.slice(guard, write)).toContain("INVALID_EXCHANGE");
  });
});

describe("P0.7A — historical rows are not silently trusted", () => {
  it("a stored row must re-prove its exchange on every restore", () => {
    // The reader never infers: an unrecognised stored value is dropped, and the
    // restore path counts the drops instead of quietly loading fewer rows.
    const base = {
      symbol: "OLDROW", timeframe: "day", session_date: "2026-03-04",
      bar_count: 250, bars_json: null, fetched_at: null, status: "ok", error_code: null,
    };
    expect(candleStoreTestOnly.dbRowToEntry({ ...base, exchange: "" })).toBeNull();
    expect(candleStoreTestOnly.dbRowToEntry({ ...base, exchange: "NSEIDX" })).toBeNull();

    const storeSrc = readSrc("lib/kiteCandle/kiteCandleStore.ts");
    const loader = storeSrc.slice(storeSrc.indexOf("async function loadFromDb("));
    expect(loader.slice(0, loader.indexOf("return loaded"))).toContain("rejectedExchange");
  });

  it("a row that reads back as NSE is not evidence that NSE was written explicitly", () => {
    // Nothing in the row records who wrote it or whether the value came from a
    // column default, so provenance cannot be recovered — and is never guessed.
    const nseRow = candleStoreTestOnly.dbRowToEntry({
      symbol: "OLDROW", exchange: "NSE", timeframe: "day", session_date: "2026-03-04",
      bar_count: 250, bars_json: null, fetched_at: null, status: "ok", error_code: null,
    });
    expect(nseRow?.exchange).toBe("NSE");
    // There is no provenance field to consult — asserting the absence keeps a
    // future "trust this row" shortcut from being built on thin air.
    expect(nseRow).not.toHaveProperty("exchangeProvenance");
    expect(nseRow).not.toHaveProperty("exchangeVerified");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Site 4 — full-NSE warehouse eligibility
// ───────────────────────────────────────────────────────────────────────────

describe("P0.7A — warehouse eligibility requires the master row's own exchange", () => {
  it("the classifier gate and the exported constant are the same exchange", () => {
    expect(ELIGIBLE_INSTRUMENT_EXCHANGE).toBe("NSE");
    const cls = classifyInstrument({
      symbol: "SOMEBSE", name: "Some BSE Co", instrumentType: "EQ",
      segment: "BSE", exchange: "BSE", inCurrentMaster: true, nseRef: null,
    });
    expect(cls.eligibilityClass).toBe("OTHER_UNSUPPORTED");
  });

  it("no longer substitutes NSE for a master row with no exchange or segment", () => {
    const src = readSrc("lib/kiteCandle/fullNseWarehouse.ts");
    expect(src).not.toMatch(/segment:\s*instData\.segment\s*\?\?\s*"NSE"/);
    expect(src).not.toMatch(/exchange:\s*instData\.exchange\s*\?\?\s*"NSE"/);
    expect(src).not.toMatch(/\?\?\s*"NSE"/);
    // The unqualified row is recorded as excluded, with a reason.
    expect(src).toContain("identityUnqualified");
    expect(src).toContain("INVALID_EXCHANGE");
    expect(src).toContain("CANONICAL_IDENTITY_REQUIRED");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Site 5 — staged swing approval → paper equity trade
//
// paperTradingEq.ts installs scheduler timers on import, so this site is
// pinned by source-text assertions rather than by importing the module.
// ───────────────────────────────────────────────────────────────────────────

describe("P0.7A — a staged order without an exact exchange opens no paper trade", () => {
  const src = readSrc("lib/paperTradingEq.ts");

  it("removed the NSE fallback from the staged-order signal", () => {
    expect(src).not.toMatch(/exchange:\s*stagingRow\.exchange\s*\?\?\s*"NSE"/);
    expect(src).not.toMatch(/\?\?\s*"NSE"/);
  });

  it("fails closed with a reason code before any trade is opened", () => {
    const fn = src.slice(src.indexOf("export async function openPaperEquityTradeFromStagedOrder"));
    const guard = fn.indexOf("normalizeCanonicalExchange(stagingRow.exchange)");
    const open = fn.indexOf("return openPaperEquityTrade(");
    expect(guard).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(guard); // guard precedes the writer call
    expect(fn.slice(guard, open)).toContain("CANONICAL_IDENTITY_REQUIRED");
    expect(fn.slice(guard, open)).toContain("INVALID_EXCHANGE");
    expect(fn.slice(guard, open)).toMatch(/return null;/);
  });

  it("the central writer gates every caller, before any DB access", () => {
    // A guard placed only in the staged caller is bypassable: openPaperEquityTrade
    // is also reached from the AUTO tick and the MANUAL route, and it persists
    // signal.exchange verbatim. The gate therefore lives in the writer itself.
    const fn = src.slice(src.indexOf("export async function openPaperEquityTrade("));
    const guard = fn.indexOf("normalizeCanonicalExchange(signal.exchange)");
    const firstDbTouch = fn.indexOf("await ensurePaperEqProvenanceColumns()");
    expect(guard).toBeGreaterThan(-1);
    expect(firstDbTouch).toBeGreaterThan(guard);
    const block = fn.slice(guard, firstDbTouch);
    expect(block).toContain("CANONICAL_IDENTITY_REQUIRED");
    expect(block).toContain("INVALID_EXCHANGE");
    expect(block).toMatch(/return null;/);
  });

  it("persists the validated exchange, not the raw signal field", () => {
    // " nse " normalises to NSE but must not be stored verbatim — one order
    // book, one stored representation.
    const fn = src.slice(src.indexOf("export async function openPaperEquityTrade("));
    const insert = fn.indexOf(".insert(paperTradeEqTable)");
    expect(insert).toBeGreaterThan(-1);
    const values = fn.slice(insert, insert + 800);
    expect(values).toContain("exchange: signalExchange");
    expect(values).not.toContain("exchange: signal.exchange");
  });

  it("the MANUAL lane does not fabricate an exchange for the writer to rubber-stamp", () => {
    // A hardcoded "NSE" here would make the writer gate unfalsifiable for this
    // caller: it would only ever validate a value this function invented.
    const fn = src.slice(
      src.indexOf("export async function openManualPaperEquityTrade("),
      src.indexOf("export async function openPaperEquityTradeFromStagedOrder"),
    );
    expect(fn).not.toMatch(/exchange:\s*"NSE"/);
    const guard = fn.indexOf("normalizeCanonicalExchange(row.quote.exchange)");
    const signal = fn.indexOf("const signal: SwingSignal");
    expect(guard).toBeGreaterThan(-1);
    expect(signal).toBeGreaterThan(guard);
    // Refused with a user-facing reason, not silently downgraded.
    expect(fn.slice(guard, signal)).toMatch(/reason:/);
    expect(fn.slice(signal, signal + 400)).toContain("exchange: rowExchange");
  });

  it("the AUTO lane emits no signal for a row that is not exchange-qualified", () => {
    const swingSrc = readSrc("lib/swingSignals.ts");
    expect(swingSrc).not.toMatch(/exchange:\s*"NSE"/);
    const fn = swingSrc.slice(swingSrc.indexOf("export async function buildSwingSignalFromRow"));
    const guard = fn.indexOf("normalizeCanonicalExchange(row.quote.exchange)");
    expect(guard).toBeGreaterThan(-1);
    expect(fn.slice(guard, guard + 500)).toMatch(/return null;/);
  });

  it("scanner rows carry the exchange declared by their source, not a literal", () => {
    // Both lanes now read row.quote.exchange, so the row builders must state it
    // from the table/quote that established the listing.
    const scannerSrc = readSrc("lib/scanner.ts");
    expect(scannerSrc).not.toMatch(/exchange:\s*meta\.exchangeName\s*\?\?\s*"NSE"/);
    expect(scannerSrc).not.toMatch(/exchange:\s*"NSE"/);
    expect(scannerSrc).toMatch(/exchange:\s*CURATED_UNIVERSE_EXCHANGE/);

    const fullNseSrc = readSrc("lib/fullNseScanner.ts");
    // Every row-building Quote literal reads the exchange off the quote that
    // priced it. The only surviving "NSE" literal describes the NSE master rows
    // handed to the eligibility classifier — a declared input, not a row identity.
    const quoteLiterals = [...fullNseSrc.matchAll(/const quote: Quote = \{[\s\S]*?\n {2}\};/g)].map(m => m[0]);
    expect(quoteLiterals.length).toBeGreaterThan(0);
    for (const lit of quoteLiterals) {
      expect(lit).not.toMatch(/exchange:\s*"NSE"/);
      expect(lit).toMatch(/exchange:\s*kq\.exchange/);
    }
    for (const m of fullNseSrc.matchAll(/exchange:\s*"NSE"/g)) {
      const context = fullNseSrc.slice(Math.max(0, m.index! - 400), m.index!);
      expect(context).toContain("classifyInstrument(");
    }
  });

  it("the refusal decision matches the shared contract", () => {
    // The guard's decision function, exercised over the values the nullable
    // staging column can actually hold.
    expect(normalizeCanonicalExchange(null)).toBeNull();       // never staged with one
    expect(normalizeCanonicalExchange("nse")).toBe("NSE");     // explicit NSE still opens
    expect(normalizeCanonicalExchange("BSE")).toBe("BSE");     // BSE stays BSE
    expect(normalizeCanonicalExchange("NSE ")).toBe("NSE");
    expect(normalizeCanonicalExchange("NSX")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Site 6 — ETF quote route
// ───────────────────────────────────────────────────────────────────────────

describe("P0.7A — the ETF quote route reports the exchange it was priced on", () => {
  it("the quote loader stamps the exchange it requested", () => {
    expect(KITE_SCANNER_QUOTE_EXCHANGE).toBe("NSE");
    const src = readSrc("lib/kiteScanner.ts");
    // Key construction and the stamped field share one constant, so they
    // cannot drift apart.
    expect(src).toContain("`${KITE_SCANNER_QUOTE_EXCHANGE}:${s}`");
    expect(src).toContain("exchange: KITE_SCANNER_QUOTE_EXCHANGE,");
  });

  it("the route no longer types its own NSE literal and fails closed", () => {
    const src = readSrc("routes/scanner.ts");
    const route = src.slice(src.indexOf('router.get("/etf/:symbol/quote"'));
    const handler = route.slice(0, route.indexOf("router.get", 10));
    expect(handler).not.toMatch(/exchange:\s*"NSE"/);
    expect(handler).toContain("normalizeCanonicalExchange(q.exchange)");
    expect(handler).toContain("CANONICAL_IDENTITY_REQUIRED");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Safety locks — unchanged by this phase
// ───────────────────────────────────────────────────────────────────────────

describe("P0.7A — all four safety locks remain false", () => {
  it("no lock was flipped", () => {
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED).toBe(false);
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
  });

  it("the locks are still declared as runtime-flippable booleans", () => {
    expect(readSrc("lib/v2PaperLocks.ts")).toContain("false as boolean");
    expect(readSrc("lib/candleEvaluationControl.ts")).toContain("false as boolean");
  });
});
