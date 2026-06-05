import { db, paperTradeFoTable, paperTradeEqTable } from "@workspace/db";
import { eq, sql, and, gte } from "drizzle-orm";
import { logger } from "./logger";

export interface SetupStats {
  setupKey: string;
  trades: number;
  wins: number;
  losses: number;
  /** Win % over trades; null when no trades (honest "—" instead of a fake 0%). */
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
}

export interface ExitReasonStats {
  reason: string;
  count: number;
  pct: number;
}

export interface HourBucket {
  hour: number;
  trades: number;
  wins: number;
  /** Win % over trades; null when no trades. */
  winRate: number | null;
  totalPnl: number;
}

export interface JournalAnalyticsResult {
  segment: "FNO" | "EQUITY";
  totalTrades: number;
  setupStats: SetupStats[];
  exitReasonStats: ExitReasonStats[];
  hourBuckets: HourBucket[];
  tagStats: { tag: string; count: number; winRate: number | null; avgPnl: number }[];
}

export async function getJournalAnalytics(segment: "FNO" | "EQUITY"): Promise<JournalAnalyticsResult> {
  if (segment === "FNO") return getFoJournalAnalytics();
  return getEqJournalAnalytics();
}

async function getFoJournalAnalytics(): Promise<JournalAnalyticsResult> {
  const rows = await db
    .select({
      setupKey: paperTradeFoTable.setupKey,
      exitReason: paperTradeFoTable.exitReason,
      realizedPnl: paperTradeFoTable.realizedPnl,
      openedAt: paperTradeFoTable.openedAt,
      tags: paperTradeFoTable.tags,
    })
    .from(paperTradeFoTable)
    .where(eq(paperTradeFoTable.status, "CLOSED"));

  return buildAnalytics("FNO", rows);
}

async function getEqJournalAnalytics(): Promise<JournalAnalyticsResult> {
  const rows = await db
    .select({
      setupKey: sql<string>`'SWING'`,
      exitReason: paperTradeEqTable.exitReason,
      realizedPnl: paperTradeEqTable.realizedPnl,
      openedAt: paperTradeEqTable.openedAt,
      tags: paperTradeEqTable.tags,
    })
    .from(paperTradeEqTable)
    .where(eq(paperTradeEqTable.status, "CLOSED"));

  return buildAnalytics("EQUITY", rows);
}

export function buildAnalytics(
  segment: "FNO" | "EQUITY",
  rows: { setupKey: string; exitReason: string | null; realizedPnl: string | null; openedAt: Date; tags: string[] | null }[],
): JournalAnalyticsResult {
  const totalTrades = rows.length;

  const setupMap = new Map<string, { trades: number; wins: number; losses: number; totalPnl: number }>();
  const exitMap = new Map<string, number>();
  const hourMap = new Map<number, { trades: number; wins: number; totalPnl: number }>();
  const tagMap = new Map<string, { count: number; wins: number; totalPnl: number }>();

  for (const r of rows) {
    const pnl = Number(r.realizedPnl ?? 0);
    const win = pnl > 0;

    const sk = r.setupKey || "UNKNOWN";
    const se = setupMap.get(sk) ?? { trades: 0, wins: 0, losses: 0, totalPnl: 0 };
    se.trades++;
    if (win) se.wins++; else se.losses++;
    se.totalPnl += pnl;
    setupMap.set(sk, se);

    const er = r.exitReason ?? "UNKNOWN";
    exitMap.set(er, (exitMap.get(er) ?? 0) + 1);

    const istHour = new Date(r.openedAt.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
    const hb = hourMap.get(istHour) ?? { trades: 0, wins: 0, totalPnl: 0 };
    hb.trades++;
    if (win) hb.wins++;
    hb.totalPnl += pnl;
    hourMap.set(istHour, hb);

    if (r.tags) {
      for (const tag of r.tags) {
        const tb = tagMap.get(tag) ?? { count: 0, wins: 0, totalPnl: 0 };
        tb.count++;
        if (win) tb.wins++;
        tb.totalPnl += pnl;
        tagMap.set(tag, tb);
      }
    }
  }

  const setupStats: SetupStats[] = Array.from(setupMap.entries())
    .map(([setupKey, s]) => ({
      setupKey,
      trades: s.trades,
      wins: s.wins,
      losses: s.losses,
      winRate: s.trades > 0 ? +(s.wins / s.trades * 100).toFixed(1) : null,
      totalPnl: +s.totalPnl.toFixed(2),
      avgPnl: s.trades > 0 ? +(s.totalPnl / s.trades).toFixed(2) : 0,
    }))
    .sort((a, b) => b.trades - a.trades);

  const exitReasonStats: ExitReasonStats[] = Array.from(exitMap.entries())
    .map(([reason, count]) => ({
      reason,
      count,
      pct: totalTrades > 0 ? +(count / totalTrades * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const hourBuckets: HourBucket[] = Array.from(hourMap.entries())
    .map(([hour, hb]) => ({
      hour,
      trades: hb.trades,
      wins: hb.wins,
      winRate: hb.trades > 0 ? +(hb.wins / hb.trades * 100).toFixed(1) : null,
      totalPnl: +hb.totalPnl.toFixed(2),
    }))
    .sort((a, b) => a.hour - b.hour);

  const tagStats = Array.from(tagMap.entries())
    .map(([tag, tb]) => ({
      tag,
      count: tb.count,
      winRate: tb.count > 0 ? +(tb.wins / tb.count * 100).toFixed(1) : null,
      avgPnl: tb.count > 0 ? +(tb.totalPnl / tb.count).toFixed(2) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { segment, totalTrades, setupStats, exitReasonStats, hourBuckets, tagStats };
}
