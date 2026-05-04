import { db, ivHistoryTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "./logger";

const IV_LOOKBACK_DAYS = 252;

function istDateStr(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export async function recordAtmIv(underlying: string, atmIv: number): Promise<void> {
  const today = istDateStr();
  try {
    await db
      .insert(ivHistoryTable)
      .values({ underlying: underlying.toUpperCase(), recordDate: today, atmIv: String(atmIv) })
      .onConflictDoUpdate({
        target: [ivHistoryTable.underlying, ivHistoryTable.recordDate],
        set: { atmIv: String(atmIv) },
      });
  } catch (err) {
    logger.warn({ err: (err as Error).message, underlying }, "IV history upsert failed");
  }
}

export interface IvMetrics {
  ivRank: number | null;
  ivPercentile: number | null;
}

export async function computeIvMetrics(underlying: string, currentIv: number): Promise<IvMetrics> {
  try {
    const rows = await db
      .select({ atmIv: ivHistoryTable.atmIv })
      .from(ivHistoryTable)
      .where(eq(ivHistoryTable.underlying, underlying.toUpperCase()))
      .orderBy(desc(ivHistoryTable.recordDate))
      .limit(IV_LOOKBACK_DAYS);

    if (rows.length < 5) {
      return { ivRank: null, ivPercentile: null };
    }

    const ivValues = rows.map(r => Number(r.atmIv));
    const min = Math.min(...ivValues);
    const max = Math.max(...ivValues);
    const range = max - min;

    const ivRank = range > 0
      ? Math.min(100, Math.max(0, Math.round(((currentIv - min) / range) * 100)))
      : 50;

    const below = ivValues.filter(v => v < currentIv).length;
    const ivPercentile = Math.min(100, Math.max(0, Math.round((below / ivValues.length) * 100)));

    return { ivRank, ivPercentile };
  } catch (err) {
    logger.warn({ err: (err as Error).message, underlying }, "IV metrics computation failed");
    return { ivRank: null, ivPercentile: null };
  }
}

export async function enrichAnalyticsWithIv(
  analytics: { underlying: string; atmIv: number | null; ivPercentile: number | null; ivRank?: number | null },
): Promise<{ ivRank: number | null; ivPercentile: number | null }> {
  if (analytics.atmIv == null) {
    return { ivRank: null, ivPercentile: null };
  }

  await recordAtmIv(analytics.underlying, analytics.atmIv);

  const metrics = await computeIvMetrics(analytics.underlying, analytics.atmIv);
  return metrics;
}
