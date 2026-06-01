/**
 * Operator-controlled "muted" instruments.
 *
 * Reads / writes the `global_instrument_overrides` table. The refreshers
 * (`refreshBinance`, `refreshYahooBatch`) and the dashboard route call
 * `loadDisabledSet()` once per cycle / request to skip muted symbols
 * without a code change to `universe.ts`.
 *
 * Persistence semantics: a row exists ONLY for symbols that have been
 * explicitly muted at least once. Re-enabling flips `disabled` to 0 (we
 * keep the row so the UI can show the prior `disabledAt` / note for
 * audit). Asking for the set repeatedly across a single refresh cycle
 * is fine — the queries are tiny (single-digit row counts in practice).
 */

import { db } from "@workspace/db";
import { globalInstrumentOverridesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export interface InstrumentOverrideRow {
  symbol: string;
  disabled: boolean;
  disabledAt: string | null;
  note: string | null;
  updatedAt: string;
}

function rowToOut(r: typeof globalInstrumentOverridesTable.$inferSelect): InstrumentOverrideRow {
  return {
    symbol: r.symbol,
    disabled: r.disabled === 1,
    disabledAt: r.disabledAt ? r.disabledAt.toISOString() : null,
    note: r.note,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Fast lookup set of currently-disabled symbols (uppercase). */
export async function loadDisabledSet(): Promise<Set<string>> {
  // W6-P5 Phase 1G: fail-soft. This runs at the top of every refresher cycle,
  // BEFORE the per-symbol try/catch. A DB timeout here must NOT reject the
  // refresher (which would become an unhandled rejection and crash the shared
  // process). Degrade to "nothing muted" for this cycle and log a warning.
  try {
    const rows = await db.select({ symbol: globalInstrumentOverridesTable.symbol })
      .from(globalInstrumentOverridesTable)
      .where(eq(globalInstrumentOverridesTable.disabled, 1));
    return new Set(rows.map(r => r.symbol.toUpperCase()));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "loadDisabledSet failed (fail-soft — treating all symbols as enabled this cycle)",
    );
    return new Set<string>();
  }
}

/** Full list, including re-enabled rows (for the operator audit view). */
export async function listOverrides(): Promise<InstrumentOverrideRow[]> {
  const rows = await db.select().from(globalInstrumentOverridesTable);
  return rows.map(rowToOut).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Active mutes only — what the dashboard popover lists under "Disabled". */
export async function listDisabled(): Promise<InstrumentOverrideRow[]> {
  const rows = await db.select().from(globalInstrumentOverridesTable)
    .where(eq(globalInstrumentOverridesTable.disabled, 1));
  return rows.map(rowToOut).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function setDisabled(symbol: string, note: string | null): Promise<InstrumentOverrideRow> {
  const sym = symbol.toUpperCase();
  const now = new Date();
  const [row] = await db.insert(globalInstrumentOverridesTable).values({
    symbol: sym,
    disabled: 1,
    disabledAt: now,
    note,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: globalInstrumentOverridesTable.symbol,
    set: { disabled: 1, disabledAt: now, note, updatedAt: now },
  }).returning();
  return rowToOut(row!);
}

export async function clearDisabled(symbol: string): Promise<InstrumentOverrideRow | null> {
  const sym = symbol.toUpperCase();
  const now = new Date();
  // Only flip an existing row — if no override row exists the symbol was
  // never muted, so there's nothing to clear and we surface a 404 upstream.
  const [row] = await db.update(globalInstrumentOverridesTable)
    .set({ disabled: 0, disabledAt: null, updatedAt: now })
    .where(eq(globalInstrumentOverridesTable.symbol, sym))
    .returning();
  return row ? rowToOut(row) : null;
}
