import { db, appStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Tiny fail-open accessor for the additive `app_state` key→value table.
 *
 * Every function swallows DB errors and degrades gracefully — operational KV
 * state (e.g. "kite offline since") must never crash a status read or a
 * background scheduler tick.
 */

/** Read a single value by key. Returns null if absent or on error. */
export async function getAppState(key: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(eq(appStateTable.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, "app_state read failed (fail-open)");
    return null;
  }
}

/**
 * Insert a key→value pair only if the key is absent. Existing values are
 * preserved (NOT last-writer-wins), so the FIRST write for a key wins — which
 * is exactly the semantics needed for a "first observed offline" timestamp.
 */
export async function setAppStateIfAbsent(key: string, value: string): Promise<void> {
  try {
    await db
      .insert(appStateTable)
      .values({ key, value })
      .onConflictDoNothing({ target: appStateTable.key });
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, "app_state insert-if-absent failed (fail-open)");
  }
}

/** Delete a key if present. No-op when absent. */
export async function deleteAppState(key: string): Promise<void> {
  try {
    await db.delete(appStateTable).where(eq(appStateTable.key, key));
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, "app_state delete failed (fail-open)");
  }
}
