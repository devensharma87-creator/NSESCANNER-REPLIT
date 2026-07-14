/**
 * S4b (2026-05-28) — pure sector-strength aggregator.
 *
 * READ-ONLY / DIAGNOSTIC. This module is intentionally a leaf with no
 * I/O, no DB, no Kite, no time sources beyond the caller-supplied
 * `nowIso`. Its only consumer is the owner-only
 * `/api/stocks-to-watch/diagnostics/sector-strength` route.
 *
 * Design rules (per S4b spec):
 *   - Does NOT influence swing score / action / quality_grade / setup /
 *     entry / stop_loss / target1 / target2 / rr_to_t1 / trigger_hit /
 *     paper-equity execution.
 *   - Computes only from columns already persisted on
 *     `swing_scan_result`. EMA breadth / 20-day-high breadth are
 *     surfaced as "unavailable" (the schema does not store EMA-vs-close
 *     or window-extreme flags per row, and adding columns is out of
 *     scope per S4 guardrails).
 *   - Member-count floor (`SECTOR_STRENGTH_MIN_MEMBERS`) gates the
 *     `rank` field — sectors below the floor get `rank: null` and
 *     `confident: false` but still appear in the response so the owner
 *     can see thin-sector noise.
 */

export const SECTOR_STRENGTH_MIN_MEMBERS = 5;

/**
 * Raw row shape the route hands to the aggregator. Mirrors the subset
 * of `swing_scan_result` columns needed for sector aggregation. Numeric
 * fields arrive as plain `number | null` (the route is responsible for
 * `Number(...)`-ing the `numeric(_,2)` strings drizzle returns).
 */
export interface SectorStrengthInputRow {
  symbol: string;
  sector: string | null;
  industry: string | null;
  score: number;
  rsScore: number | null;
  rs20: number | null;
  rs50: number | null;
  rs120: number | null;
  action: string;
}

export interface SectorStrength {
  sector: string;
  memberCount: number;
  /** True iff memberCount >= SECTOR_STRENGTH_MIN_MEMBERS. */
  confident: boolean;
  /** 1-based rank by avgRsScore desc among CONFIDENT sectors; null otherwise. */
  rank: number | null;
  avgScore: number;
  avgRsScore: number | null;
  avgRs20: number | null;
  avgRs50: number | null;
  avgRs120: number | null;
  /** Histogram of Action labels (BUY ZONE / BUY / WATCH / AVOID / etc.). */
  actionCounts: Record<string, number>;
  /** Up to 5 names sorted by score desc. */
  topByScore: Array<{ symbol: string; score: number }>;
  /** Up to 5 names sorted by rsScore desc (rows without rsScore are dropped). */
  topByRsScore: Array<{ symbol: string; rsScore: number }>;
}

export interface SectorStrengthSummary {
  generatedAt: string;
  /** scan_date of the source rows; null when input is empty. */
  scanDate: string | null;
  totalRows: number;
  totalSectors: number;
  confidentSectors: number;
  minMembers: number;
  /**
   * Rows that could NOT be placed in any sector because their sector label was
   * null/empty. Surfaced (not silently dropped) so the operator can see how
   * complete the sector aggregation is. mappedRows = totalRows - excludedNoSector.
   */
  excludedNoSector: number;
  /**
   * Metrics the swing schema does not currently persist. Surfaced for
   * UI/operator clarity rather than silently omitted.
   */
  unavailableMetrics: Array<{ metric: string; reason: string }>;
  /**
   * Sectors sorted: confident (by rank asc) first, then unconfident
   * (by memberCount desc, then sector name asc) for deterministic UI.
   */
  sectors: SectorStrength[];
}

const UNAVAILABLE_METRICS: SectorStrengthSummary["unavailableMetrics"] = [
  {
    metric: "pctAboveEma20",
    reason:
      "swing_scan_result does not persist per-row EMA20-vs-close; would require schema change (out of S4b scope).",
  },
  {
    metric: "pctAboveEma50",
    reason:
      "swing_scan_result does not persist per-row EMA50-vs-close; would require schema change (out of S4b scope).",
  },
  {
    metric: "pctAboveEma200",
    reason:
      "swing_scan_result does not persist per-row EMA200-vs-close; would require schema change (out of S4b scope).",
  },
  {
    metric: "pct20dHigh",
    reason:
      "swing_scan_result does not persist a 20-day window-high flag; only 52w extremes are stored.",
  },
];

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return Math.round((s / xs.length) * 100) / 100;
}

function meanRequired(xs: readonly number[]): number {
  const m = mean(xs);
  return m ?? 0;
}

/**
 * Pure aggregation. Caller is responsible for sourcing rows from the
 * latest scan_date and for stringifying date.
 */
export function computeSectorStrength(
  rows: readonly SectorStrengthInputRow[],
  opts: { scanDate: string | null; nowIso?: string },
): SectorStrengthSummary {
  const generatedAt = opts.nowIso ?? new Date().toISOString();

  // Group by sector. Rows with null/empty sector cannot be aggregated, but we
  // COUNT them (excludedNoSector) rather than silently dropping them so the UI
  // can show how complete the sector view actually is.
  const buckets = new Map<string, SectorStrengthInputRow[]>();
  let excludedNoSector = 0;
  for (const r of rows) {
    const sec = (r.sector ?? "").trim();
    if (!sec) {
      excludedNoSector++;
      continue;
    }
    const arr = buckets.get(sec);
    if (arr) arr.push(r);
    else buckets.set(sec, [r]);
  }

  const sectors: SectorStrength[] = [];
  for (const [sector, members] of buckets) {
    const memberCount = members.length;
    const confident = memberCount >= SECTOR_STRENGTH_MIN_MEMBERS;

    const scores = members.map((m) => m.score);
    const rsScores = members.map((m) => m.rsScore).filter((v): v is number => v != null);
    const rs20s = members.map((m) => m.rs20).filter((v): v is number => v != null);
    const rs50s = members.map((m) => m.rs50).filter((v): v is number => v != null);
    const rs120s = members.map((m) => m.rs120).filter((v): v is number => v != null);

    const actionCounts: Record<string, number> = {};
    for (const m of members) {
      actionCounts[m.action] = (actionCounts[m.action] ?? 0) + 1;
    }

    // Secondary tie-break on `symbol` ASC so two rows with identical
    // score/rsScore produce deterministic output regardless of the
    // upstream DB row order (architect S4b review).
    const topByScore = [...members]
      .sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol))
      .slice(0, 5)
      .map((m) => ({ symbol: m.symbol, score: m.score }));

    const topByRsScore = members
      .filter((m): m is SectorStrengthInputRow & { rsScore: number } => m.rsScore != null)
      .sort((a, b) => (b.rsScore - a.rsScore) || a.symbol.localeCompare(b.symbol))
      .slice(0, 5)
      .map((m) => ({ symbol: m.symbol, rsScore: m.rsScore }));

    sectors.push({
      sector,
      memberCount,
      confident,
      rank: null, // filled below
      avgScore: meanRequired(scores),
      avgRsScore: mean(rsScores),
      avgRs20: mean(rs20s),
      avgRs50: mean(rs50s),
      avgRs120: mean(rs120s),
      actionCounts,
      topByScore,
      topByRsScore,
    });
  }

  // Rank confident sectors by avgRsScore desc (sectors with no rsScore
  // data sort to the bottom of the confident group).
  const confidentList = sectors
    .filter((s) => s.confident)
    .sort((a, b) => {
      const ar = a.avgRsScore;
      const br = b.avgRsScore;
      if (ar == null && br == null) return a.sector.localeCompare(b.sector);
      if (ar == null) return 1;
      if (br == null) return -1;
      if (br !== ar) return br - ar;
      return a.sector.localeCompare(b.sector);
    });
  confidentList.forEach((s, i) => {
    s.rank = i + 1;
  });

  const unconfidentList = sectors
    .filter((s) => !s.confident)
    .sort((a, b) => {
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.sector.localeCompare(b.sector);
    });

  return {
    generatedAt,
    scanDate: opts.scanDate,
    totalRows: rows.length,
    totalSectors: sectors.length,
    confidentSectors: confidentList.length,
    minMembers: SECTOR_STRENGTH_MIN_MEMBERS,
    excludedNoSector,
    unavailableMetrics: UNAVAILABLE_METRICS,
    sectors: [...confidentList, ...unconfidentList],
  };
}
