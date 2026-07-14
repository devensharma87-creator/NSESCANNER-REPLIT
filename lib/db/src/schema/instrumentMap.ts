/**
 * Cross-provider instrument map — links each canonical symbol to BOTH the
 * authoritative Kite identifiers and the secondary INDstocks identifiers.
 *
 * This is the gate that makes INDstocks data safe to use: an INDstocks quote may
 * only ever be consumed (for validation OR failover) when the symbol's mapping
 * row here is `mappingStatus = "VERIFIED"` and — for derivatives — not expired.
 * Unverified / conflicting / expired mappings are NEVER used; they are reported
 * with a reason. Nothing is fabricated: a row exists only when it was built from
 * BOTH providers' instrument masters.
 *
 * Single source of truth for the resolver (`instrumentMapStore.ts`) and the
 * pure matcher (`instrumentMapMatch.ts`). Write-only substrate for the trusted
 * layer — it never places orders or feeds a signal directly.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Asset class of a mapped instrument. */
export const INSTRUMENT_ASSET_CLASSES = ["EQUITY", "INDEX", "FUT", "OPT"] as const;
export type InstrumentAssetClass = (typeof INSTRUMENT_ASSET_CLASSES)[number];

/**
 * Mapping status — only VERIFIED rows may serve INDstocks data.
 *   VERIFIED   — both providers resolve the same instrument, fields complete,
 *                and (for derivatives) the contract has not expired.
 *   UNVERIFIED — built but not yet cross-checked, or missing one side / fields.
 *   CONFLICT   — the two providers disagree on identity (exchange/lot/strike/…).
 *   EXPIRED    — a derivative whose expiry date is in the past.
 */
export const MAPPING_STATUSES = ["VERIFIED", "UNVERIFIED", "CONFLICT", "EXPIRED"] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

export const instrumentMapTable = pgTable(
  "instrument_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Canonical app symbol (uppercase). EQ: NSE tradingsymbol; deriv: contract symbol. */
    canonicalSymbol: text("canonical_symbol").notNull(),
    assetClass: text("asset_class").notNull(),

    // ── Authoritative (Kite) identifiers ──────────────────────────────────
    kiteInstrumentToken: integer("kite_instrument_token"),
    kiteTradingSymbol: text("kite_trading_symbol"),
    kiteExchange: text("kite_exchange"),

    // ── Secondary (INDstocks) identifiers ─────────────────────────────────
    /** INDstocks SECURITY_ID from its instrument master. */
    indstocksSecurityId: text("indstocks_security_id"),
    /** `SEGMENT_TOKEN` scrip-code used by INDstocks quote/historical endpoints. */
    indstocksScripCode: text("indstocks_scrip_code"),
    indstocksTradingSymbol: text("indstocks_trading_symbol"),
    indstocksExchange: text("indstocks_exchange"),

    // ── Contract attributes (shared, used for derivative verification) ─────
    lotSize: integer("lot_size"),
    tickSize: doublePrecision("tick_size"),
    expiryDate: date("expiry_date", { mode: "string" }),
    strike: doublePrecision("strike"),
    optionType: text("option_type"), // CE | PE | null

    // ── Verification state ────────────────────────────────────────────────
    mappingStatus: text("mapping_status").notNull().default("UNVERIFIED"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    mappingWarning: text("mapping_warning"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("instrument_map_symbol_class_uniq").on(t.canonicalSymbol, t.assetClass),
    index("instrument_map_status_idx").on(t.mappingStatus),
    index("instrument_map_expiry_idx").on(t.expiryDate),
  ],
);

export const insertInstrumentMapSchema = createInsertSchema(instrumentMapTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInstrumentMap = z.infer<typeof insertInstrumentMapSchema>;
export type InstrumentMapRow = typeof instrumentMapTable.$inferSelect;
export type NewInstrumentMapRow = typeof instrumentMapTable.$inferInsert;
