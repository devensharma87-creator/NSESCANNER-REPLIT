/**
 * Background scheduler for saved screener presets. Ticks every 30s,
 * runs any preset that is due, and flags any symbol that wasn't in the
 * previous cycle's hits as a "new hit". Pending alerts accumulate
 * (deduped by symbol) until the user acknowledges them.
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { globalScreenerPresetsTable } from "@workspace/db/schema";
import { logger } from "../logger";
import { runGlobalScreener, ScreenerBody, type ScreenerBodyInput } from "./screener";

const TICK_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let booted = false;
const inFlight = new Set<string>();

type StoredHit = {
  symbol: string;
  displayName: string;
  assetClass: string;
  price: number | null;
  changePct: number | null;
  matched: string[];
};

function isDue(intervalMin: number, lastRunAt: Date | null, now: number): boolean {
  if (!lastRunAt) return true;
  return now - lastRunAt.getTime() >= intervalMin * 60_000;
}

async function runOne(
  presetId: string,
  body: ScreenerBodyInput,
  prevHitSymbols: string[],
  pendingAlerts: StoredHit[],
  options: { silentBaseline: boolean } = { silentBaseline: false },
): Promise<void> {
  try {
    const result = await runGlobalScreener(body);
    const currentSymbols = result.hits.map(h => h.symbol);
    const prevSet = new Set(prevHitSymbols);
    const fresh: StoredHit[] = result.hits
      .filter(h => !prevSet.has(h.symbol))
      .map(h => ({
        symbol: h.symbol,
        displayName: h.displayName,
        assetClass: h.assetClass,
        price: h.price,
        changePct: h.changePct,
        matched: h.matched,
      }));

    const updates: Partial<typeof globalScreenerPresetsTable.$inferInsert> = {
      lastRunAt: new Date(),
      lastRunError: null,
      lastHitSymbols: currentSymbols,
    };

    if (fresh.length > 0 && !options.silentBaseline) {
      // Merge with any unacknowledged alerts so a fresh batch doesn't
      // overwrite earlier ones. Newer entries win on duplicate symbols.
      const freshSet = new Set(fresh.map(h => h.symbol));
      const merged = [...fresh, ...pendingAlerts.filter(h => !freshSet.has(h.symbol))];
      updates.lastNewHits = merged;
      updates.lastNewHitsAt = new Date();
      logger.info(
        { presetId, newHitCount: fresh.length, newSymbols: fresh.map(h => h.symbol) },
        "screener preset produced new hits",
      );
    } else if (options.silentBaseline) {
      logger.info(
        { presetId, baselineCount: currentSymbols.length },
        "screener preset baseline established (no alerts on first scheduled run)",
      );
    }

    await db.update(globalScreenerPresetsTable)
      .set(updates)
      .where(eq(globalScreenerPresetsTable.id, presetId));
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    logger.warn({ presetId, err: msg }, "scheduled screener preset run failed");
    try {
      await db.update(globalScreenerPresetsTable)
        .set({ lastRunAt: new Date(), lastRunError: msg })
        .where(eq(globalScreenerPresetsTable.id, presetId));
    } catch (writeErr) {
      logger.error({ presetId, err: (writeErr as Error).message }, "failed to persist preset run error");
    }
  } finally {
    inFlight.delete(presetId);
  }
}

async function tick(): Promise<void> {
  let due: Array<typeof globalScreenerPresetsTable.$inferSelect> = [];
  try {
    due = await db.select().from(globalScreenerPresetsTable)
      .where(isNotNull(globalScreenerPresetsTable.autoRunIntervalMin));
  } catch (err) {
    logger.error({ err: (err as Error).message }, "preset scheduler: failed to load presets");
    return;
  }
  const now = Date.now();
  for (const row of due) {
    if (row.autoRunIntervalMin == null) continue;
    if (!isDue(row.autoRunIntervalMin, row.lastRunAt, now)) continue;
    if (inFlight.has(row.id)) continue;

    const parsed = ScreenerBody.safeParse(row.body);
    if (!parsed.success) {
      logger.warn({ presetId: row.id }, "skipping preset with invalid body");
      continue;
    }
    inFlight.add(row.id);
    const prev = Array.isArray(row.lastHitSymbols) ? (row.lastHitSymbols as string[]) : [];
    const pending = Array.isArray(row.lastNewHits) ? (row.lastNewHits as StoredHit[]) : [];
    // Establish a silent baseline on the very first scheduled run for a
    // preset (lastRunAt unset) so the user isn't blasted with "new hits"
    // for every symbol that already qualifies the moment they enable
    // auto-run. Manual run-now still surfaces all hits.
    const silentBaseline = row.lastRunAt == null;
    void runOne(row.id, parsed.data, prev, pending, { silentBaseline });
  }
}

export function startScreenerPresetScheduler(): void {
  if (booted) return;
  booted = true;
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  setTimeout(() => { void tick(); }, 5_000);
  logger.info("Screener preset scheduler started (30s tick)");
}

export function stopScreenerPresetScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  booted = false;
  inFlight.clear();
}

export async function runPresetNow(presetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (inFlight.has(presetId)) return { ok: true };
  const [row] = await db.select().from(globalScreenerPresetsTable)
    .where(eq(globalScreenerPresetsTable.id, presetId));
  if (!row) return { ok: false, error: "not found" };
  const parsed = ScreenerBody.safeParse(row.body);
  if (!parsed.success) return { ok: false, error: "invalid body" };
  inFlight.add(presetId);
  const prev = Array.isArray(row.lastHitSymbols) ? (row.lastHitSymbols as string[]) : [];
  const pending = Array.isArray(row.lastNewHits) ? (row.lastNewHits as StoredHit[]) : [];
  await runOne(presetId, parsed.data, prev, pending);
  return { ok: true };
}
