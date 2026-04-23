/**
 * Institutional flows: FII/DII cash + Participant-wise OI.
 *
 * Sources:
 *   - FII/DII current day: NSE  https://www.nseindia.com/api/fiidiiTradeReact
 *   - FII/DII history    : niftytrader webapi (returns ~1y of daily net values)
 *   - Participant OI     : NSE archive CSV
 *                          https://archives.nseindia.com/content/nsccl/fao_participant_oi_DDMMYYYY.csv
 *
 * All data is persisted in Postgres (fii_dii_daily, participant_oi_daily) so we can
 * serve historical aggregations without re-fetching, and so we accumulate data over
 * time even if upstream sources change.
 */

import { db } from "@workspace/db";
import { fiiDiiDailyTable, participantOiDailyTable } from "@workspace/db/schema";
import { sql, gte, asc, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NSE_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/reports/fii-dii",
};

const ARCHIVE_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: "https://www.nseindia.com/",
};

// ───────────────────── helpers ─────────────────────

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse "22-Apr-2026" → ISO "2026-04-22". */
function parseNseDate(s: string): string | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const mm = months[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 12_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ──────────────── FII/DII cash fetchers ────────────────

interface FiiDiiRow {
  date: string;        // ISO yyyy-mm-dd
  fiiBuy: number;
  fiiSell: number;
  fiiNet: number;
  diiBuy: number;
  diiSell: number;
  diiNet: number;
  source: string;
}

/** NSE returns just the latest day, both FII/FPI and DII categories. */
async function fetchNseCurrent(): Promise<FiiDiiRow | null> {
  try {
    const res = await fetchWithTimeout(
      "https://www.nseindia.com/api/fiidiiTradeReact",
      { headers: NSE_HEADERS },
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{
      category: string;
      date: string;
      buyValue: string;
      sellValue: string;
      netValue: string;
    }>;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const fii = arr.find(r => /FII|FPI/i.test(r.category));
    const dii = arr.find(r => /^DII$/i.test(r.category));
    if (!fii || !dii) return null;
    const iso = parseNseDate(fii.date);
    if (!iso) return null;
    return {
      date: iso,
      fiiBuy: Number(fii.buyValue),
      fiiSell: Number(fii.sellValue),
      fiiNet: Number(fii.netValue),
      diiBuy: Number(dii.buyValue),
      diiSell: Number(dii.sellValue),
      diiNet: Number(dii.netValue),
      source: "nse",
    };
  } catch (err) {
    logger.warn({ err }, "fetchNseCurrent failed");
    return null;
  }
}

/** niftytrader gives ~1 year of daily NET values (no buy/sell breakdown). */
async function fetchNiftytraderHistory(): Promise<FiiDiiRow[]> {
  try {
    const res = await fetchWithTimeout(
      "https://webapi.niftytrader.in/webapi/Resource/fii-dii-activity-data",
      { headers: { "User-Agent": UA } },
      15_000,
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      resultData?: { fii_dii_data?: Array<{
        created_at: string;
        fii_net_value: number;
        dii_net_value: number;
      }> };
    };
    const rows = j.resultData?.fii_dii_data ?? [];
    return rows
      .map(r => {
        const iso = r.created_at?.slice(0, 10);
        if (!iso) return null;
        const fiiNet = Number(r.fii_net_value);
        const diiNet = Number(r.dii_net_value);
        if (!Number.isFinite(fiiNet) || !Number.isFinite(diiNet)) return null;
        return {
          date: iso,
          fiiBuy: 0,
          fiiSell: 0,
          fiiNet,
          diiBuy: 0,
          diiSell: 0,
          diiNet,
          source: "niftytrader",
        } satisfies FiiDiiRow;
      })
      .filter((x): x is FiiDiiRow => x !== null);
  } catch (err) {
    logger.warn({ err }, "fetchNiftytraderHistory failed");
    return [];
  }
}

async function upsertFiiDii(row: FiiDiiRow): Promise<void> {
  await db
    .insert(fiiDiiDailyTable)
    .values({
      date: row.date,
      fiiBuy: row.fiiBuy.toFixed(2),
      fiiSell: row.fiiSell.toFixed(2),
      fiiNet: row.fiiNet.toFixed(2),
      diiBuy: row.diiBuy.toFixed(2),
      diiSell: row.diiSell.toFixed(2),
      diiNet: row.diiNet.toFixed(2),
      source: row.source,
    })
    .onConflictDoUpdate({
      target: fiiDiiDailyTable.date,
      set: {
        // Prefer NSE values (have buy/sell). Don't overwrite NSE with niftytrader.
        fiiBuy: sql`CASE WHEN ${fiiDiiDailyTable.source} = 'nse' AND EXCLUDED.source <> 'nse' THEN ${fiiDiiDailyTable.fiiBuy} ELSE EXCLUDED.fii_buy END`,
        fiiSell: sql`CASE WHEN ${fiiDiiDailyTable.source} = 'nse' AND EXCLUDED.source <> 'nse' THEN ${fiiDiiDailyTable.fiiSell} ELSE EXCLUDED.fii_sell END`,
        fiiNet: sql`EXCLUDED.fii_net`,
        diiBuy: sql`CASE WHEN ${fiiDiiDailyTable.source} = 'nse' AND EXCLUDED.source <> 'nse' THEN ${fiiDiiDailyTable.diiBuy} ELSE EXCLUDED.dii_buy END`,
        diiSell: sql`CASE WHEN ${fiiDiiDailyTable.source} = 'nse' AND EXCLUDED.source <> 'nse' THEN ${fiiDiiDailyTable.diiSell} ELSE EXCLUDED.dii_sell END`,
        diiNet: sql`EXCLUDED.dii_net`,
        source: sql`CASE WHEN ${fiiDiiDailyTable.source} = 'nse' AND EXCLUDED.source <> 'nse' THEN ${fiiDiiDailyTable.source} ELSE EXCLUDED.source END`,
        updatedAt: sql`now()`,
      },
    });
}

export async function refreshFiiDii(): Promise<{ inserted: number; latest: string | null }> {
  const hist = await fetchNiftytraderHistory();
  for (const r of hist) await upsertFiiDii(r);
  const cur = await fetchNseCurrent();
  if (cur) await upsertFiiDii(cur);
  const latest = await db
    .select({ d: fiiDiiDailyTable.date })
    .from(fiiDiiDailyTable)
    .orderBy(desc(fiiDiiDailyTable.date))
    .limit(1);
  return { inserted: hist.length + (cur ? 1 : 0), latest: latest[0]?.d ?? null };
}

// ──────────────── Participant OI fetcher ────────────────

interface ParticipantOiRow {
  date: string;
  clientType: string;
  futureIndexLong: number;
  futureIndexShort: number;
  futureStockLong: number;
  futureStockShort: number;
  optionIndexCallLong: number;
  optionIndexPutLong: number;
  optionIndexCallShort: number;
  optionIndexPutShort: number;
  optionStockCallLong: number;
  optionStockPutLong: number;
  optionStockCallShort: number;
  optionStockPutShort: number;
  totalLongContracts: number;
  totalShortContracts: number;
}

/** Robust CSV split that tolerates quoted commas (NSE doesn't use them, but be safe). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function num(s: string): number {
  const n = Number(s.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function fetchParticipantOiForDate(d: Date): Promise<ParticipantOiRow[] | null> {
  const url = `https://archives.nseindia.com/content/nsccl/fao_participant_oi_${ddmmyyyy(d)}.csv`;
  try {
    const res = await fetchWithTimeout(url, { headers: ARCHIVE_HEADERS }, 12_000);
    if (!res.ok) return null;
    const txt = await res.text();
    if (!txt || txt.trim().length < 50) return null;
    const lines = txt.split(/\r?\n/).filter(l => l.trim().length > 0);
    // Find header line containing "Client Type"
    const headerIdx = lines.findIndex(l => /Client Type/i.test(l));
    if (headerIdx < 0) return null;
    const dataLines = lines.slice(headerIdx + 1);
    const out: ParticipantOiRow[] = [];
    for (const line of dataLines) {
      const cols = splitCsvLine(line);
      if (cols.length < 15) continue;
      const ct = cols[0]?.trim();
      if (!ct || /^total$/i.test(ct)) continue;
      out.push({
        date: isoDate(d),
        clientType: ct,
        futureIndexLong: num(cols[1]),
        futureIndexShort: num(cols[2]),
        futureStockLong: num(cols[3]),
        futureStockShort: num(cols[4]),
        optionIndexCallLong: num(cols[5]),
        optionIndexPutLong: num(cols[6]),
        optionIndexCallShort: num(cols[7]),
        optionIndexPutShort: num(cols[8]),
        optionStockCallLong: num(cols[9]),
        optionStockPutLong: num(cols[10]),
        optionStockCallShort: num(cols[11]),
        optionStockPutShort: num(cols[12]),
        totalLongContracts: num(cols[13]),
        totalShortContracts: num(cols[14]),
      });
    }
    return out;
  } catch (err) {
    logger.warn({ err, url }, "fetchParticipantOiForDate failed");
    return null;
  }
}

async function upsertParticipantOi(rows: ParticipantOiRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (const r of rows) {
    await db
      .insert(participantOiDailyTable)
      .values(r)
      .onConflictDoUpdate({
        target: [participantOiDailyTable.date, participantOiDailyTable.clientType],
        set: {
          futureIndexLong: r.futureIndexLong,
          futureIndexShort: r.futureIndexShort,
          futureStockLong: r.futureStockLong,
          futureStockShort: r.futureStockShort,
          optionIndexCallLong: r.optionIndexCallLong,
          optionIndexPutLong: r.optionIndexPutLong,
          optionIndexCallShort: r.optionIndexCallShort,
          optionIndexPutShort: r.optionIndexPutShort,
          optionStockCallLong: r.optionStockCallLong,
          optionStockPutLong: r.optionStockPutLong,
          optionStockCallShort: r.optionStockCallShort,
          optionStockPutShort: r.optionStockPutShort,
          totalLongContracts: r.totalLongContracts,
          totalShortContracts: r.totalShortContracts,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Walk back up to N business days; persist whatever exists. */
export async function refreshParticipantOi(daysBack = 30): Promise<{ datesFetched: string[] }> {
  const got: string[] = [];
  const now = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    // Skip weekends
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const rows = await fetchParticipantOiForDate(d);
    if (rows && rows.length > 0) {
      await upsertParticipantOi(rows);
      got.push(isoDate(d));
    }
  }
  return { datesFetched: got };
}

// ──────────────── Read APIs (used by routes) ────────────────

export interface FiiDiiDayDto {
  date: string;
  fiiBuy: number;
  fiiSell: number;
  fiiNet: number;
  diiBuy: number;
  diiSell: number;
  diiNet: number;
  source: string;
  niftyClose?: number | null;
  niftyChangePct?: number | null;
}

export interface FiiDiiMonthDto {
  month: string;     // "YYYY-MM"
  label: string;     // "Apr 2026"
  fiiBuy: number;
  fiiSell: number;
  fiiNet: number;
  diiBuy: number;
  diiSell: number;
  diiNet: number;
  daysCount: number;
  days: FiiDiiDayDto[];
}

/* ── Nifty 50 daily close cache (for FII/DII chart overlay) ── */
let _niftyCache: { ts: number; map: Map<string, { close: number; pct: number }> } | null = null;
async function getNiftyCloseMap(): Promise<Map<string, { close: number; pct: number }>> {
  const now = Date.now();
  if (_niftyCache && now - _niftyCache.ts < 30 * 60 * 1000) return _niftyCache.map;
  const map = new Map<string, { close: number; pct: number }>();
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=2y&interval=1d";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) {
      const j: any = await r.json();
      const result = j?.chart?.result?.[0];
      const ts: number[] = result?.timestamp ?? [];
      const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
      let prev: number | null = null;
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null) continue;
        const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        const pct = prev != null && prev > 0 ? ((c - prev) / prev) * 100 : 0;
        map.set(d, { close: Number(c.toFixed(2)), pct: Number(pct.toFixed(2)) });
        prev = c;
      }
    }
  } catch { /* swallow */ }
  _niftyCache = { ts: now, map };
  return map;
}

export async function getFiiDiiMonthly(monthsBack = 12): Promise<FiiDiiMonthDto[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  cutoff.setDate(1);
  const [rows, niftyMap] = await Promise.all([
    db.select().from(fiiDiiDailyTable).where(gte(fiiDiiDailyTable.date, isoDate(cutoff))).orderBy(asc(fiiDiiDailyTable.date)),
    getNiftyCloseMap().catch(() => new Map<string, { close: number; pct: number }>()),
  ]);
  const byMonth = new Map<string, FiiDiiDayDto[]>();
  for (const r of rows) {
    const key = r.date.slice(0, 7); // YYYY-MM
    const nifty = niftyMap.get(r.date);
    const day: FiiDiiDayDto = {
      date: r.date,
      fiiBuy: Number(r.fiiBuy),
      fiiSell: Number(r.fiiSell),
      fiiNet: Number(r.fiiNet),
      diiBuy: Number(r.diiBuy),
      diiSell: Number(r.diiSell),
      diiNet: Number(r.diiNet),
      source: r.source,
      niftyClose: nifty?.close ?? null,
      niftyChangePct: nifty?.pct ?? null,
    };
    const arr = byMonth.get(key) ?? [];
    arr.push(day);
    byMonth.set(key, arr);
  }
  const months: FiiDiiMonthDto[] = [];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const [key, days] of byMonth) {
    const [y, m] = key.split("-").map(Number);
    const agg = days.reduce(
      (a, d) => {
        a.fiiBuy += d.fiiBuy;
        a.fiiSell += d.fiiSell;
        a.fiiNet += d.fiiNet;
        a.diiBuy += d.diiBuy;
        a.diiSell += d.diiSell;
        a.diiNet += d.diiNet;
        return a;
      },
      { fiiBuy: 0, fiiSell: 0, fiiNet: 0, diiBuy: 0, diiSell: 0, diiNet: 0 },
    );
    // Days in DESC inside a month for nicer display (latest first)
    days.sort((a, b) => (a.date < b.date ? 1 : -1));
    months.push({
      month: key,
      label: `${monthNames[m - 1]} ${y}`,
      ...agg,
      daysCount: days.length,
      days,
    });
  }
  // Months in DESC (latest first)
  months.sort((a, b) => (a.month < b.month ? 1 : -1));
  return months;
}

export interface ParticipantOiDayDto {
  date: string;
  rows: Array<{
    clientType: string;
    futureIndexLong: number;
    futureIndexShort: number;
    futureIndexNet: number;
    futureStockLong: number;
    futureStockShort: number;
    futureStockNet: number;
    optionIndexCallLong: number;
    optionIndexCallShort: number;
    optionIndexPutLong: number;
    optionIndexPutShort: number;
    optionStockCallLong: number;
    optionStockCallShort: number;
    optionStockPutLong: number;
    optionStockPutShort: number;
    totalLongContracts: number;
    totalShortContracts: number;
    netContracts: number;
  }>;
  availableDates: string[];
}

const PARTICIPANT_ORDER = ["Client", "FII", "DII", "Pro", "TOTAL"];

export async function getParticipantOi(date?: string): Promise<ParticipantOiDayDto | null> {
  // Available dates (descending)
  const dateRows = await db
    .selectDistinct({ d: participantOiDailyTable.date })
    .from(participantOiDailyTable)
    .orderBy(desc(participantOiDailyTable.date))
    .limit(60);
  const availableDates = dateRows.map(r => r.d);
  if (availableDates.length === 0) return null;
  const useDate = date && availableDates.includes(date) ? date : availableDates[0];
  const rows = await db
    .select()
    .from(participantOiDailyTable)
    .where(eq(participantOiDailyTable.date, useDate));
  const mapped = rows.map(r => ({
    clientType: r.clientType,
    futureIndexLong: r.futureIndexLong,
    futureIndexShort: r.futureIndexShort,
    futureIndexNet: r.futureIndexLong - r.futureIndexShort,
    futureStockLong: r.futureStockLong,
    futureStockShort: r.futureStockShort,
    futureStockNet: r.futureStockLong - r.futureStockShort,
    optionIndexCallLong: r.optionIndexCallLong,
    optionIndexCallShort: r.optionIndexCallShort,
    optionIndexPutLong: r.optionIndexPutLong,
    optionIndexPutShort: r.optionIndexPutShort,
    optionStockCallLong: r.optionStockCallLong,
    optionStockCallShort: r.optionStockCallShort,
    optionStockPutLong: r.optionStockPutLong,
    optionStockPutShort: r.optionStockPutShort,
    totalLongContracts: r.totalLongContracts,
    totalShortContracts: r.totalShortContracts,
    netContracts: r.totalLongContracts - r.totalShortContracts,
  }));
  mapped.sort((a, b) => {
    const ai = PARTICIPANT_ORDER.indexOf(a.clientType);
    const bi = PARTICIPANT_ORDER.indexOf(b.clientType);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return { date: useDate, rows: mapped, availableDates };
}

// ──────────────── Background refresher ────────────────

let refreshTimer: NodeJS.Timeout | null = null;

export function startInstFlowsRefresher(): void {
  if (refreshTimer) return;
  const tick = async () => {
    try {
      await refreshFiiDii();
    } catch (err) {
      logger.warn({ err }, "FII/DII refresh tick failed");
    }
    try {
      await refreshParticipantOi(10);
    } catch (err) {
      logger.warn({ err }, "Participant OI refresh tick failed");
    }
  };
  // Initial backfill (longer history) without blocking server start
  void (async () => {
    try {
      const r1 = await refreshFiiDii();
      logger.info({ inserted: r1.inserted, latest: r1.latest }, "FII/DII initial backfill");
    } catch (err) {
      logger.warn({ err }, "FII/DII initial backfill failed");
    }
    try {
      const r2 = await refreshParticipantOi(45);
      logger.info({ days: r2.datesFetched.length }, "Participant OI initial backfill");
    } catch (err) {
      logger.warn({ err }, "Participant OI initial backfill failed");
    }
  })();
  // Refresh every 15 min
  refreshTimer = setInterval(tick, 15 * 60 * 1000);
}
