/**
 * Portfolio Analyser — benchmark comparison (pure, tested).
 *
 * HONEST BY CONSTRUCTION. A benchmark return is only shown when a real index
 * series is supplied. Sector over/under-weight is computed against a REAL,
 * dated NIFTY 500 sector-weight reference (see `NIFTY500_SECTOR_REFERENCE`)
 * rolled up to this app's sector vocabulary — never fabricated. Portfolio
 * sectors that have no confident mapping into the reference taxonomy are
 * surfaced explicitly as "not benchmarked", not silently dropped or invented.
 */

/**
 * Selectable benchmark indices. Each maps to a real index series fetched via the
 * existing chart endpoint (segment "index", Kite→Yahoo). No fabricated series:
 * if a given index returns no closes, the comparison falls back to the explicit
 * "unavailable" state per index.
 */
export interface BenchmarkOption {
  /** Stable selector key. */
  key: "NIFTY" | "NIFTY500" | "BANKNIFTY" | "SENSEX";
  /** Chart-endpoint symbol (segment "index"). */
  symbol: string;
  /** Human label shown in the panel. */
  name: string;
}

export const BENCHMARK_OPTIONS: readonly BenchmarkOption[] = [
  { key: "NIFTY", symbol: "NIFTY", name: "NIFTY 50" },
  { key: "NIFTY500", symbol: "NIFTY500", name: "NIFTY 500" },
  { key: "BANKNIFTY", symbol: "BANKNIFTY", name: "Bank Nifty" },
  { key: "SENSEX", symbol: "SENSEX", name: "Sensex" },
] as const;

export interface BenchmarkInput {
  /** Portfolio total return over the comparison window (%), null if unknown. */
  portfolioReturnPct: number | null;
  /** Real benchmark return over the SAME window (%), null when no series supplied. */
  benchmarkReturnPct: number | null;
  /** Human label for the benchmark, e.g. "NIFTY 50". */
  benchmarkName: string;
  /** Description of the comparison window, e.g. "since earliest purchase (2024-01-15)". */
  windowLabel: string | null;
}

export interface BenchmarkComparison {
  benchmarkName: string;
  windowLabel: string | null;
  portfolioReturnPct: number | null;
  benchmarkReturnPct: number | null;
  /** portfolio − benchmark (percentage points), null when either side missing. */
  relativePct: number | null;
  /** "outperforming" | "underperforming" | "in line" | null. */
  verdict: "outperforming" | "underperforming" | "in line" | null;
  /** Non-null when the return comparison cannot be made. */
  returnUnavailable: string | null;
}

export function compareToBenchmark(input: BenchmarkInput): BenchmarkComparison {
  const { portfolioReturnPct, benchmarkReturnPct, benchmarkName, windowLabel } = input;

  let relativePct: number | null = null;
  let verdict: BenchmarkComparison["verdict"] = null;
  let returnUnavailable: string | null = null;

  if (portfolioReturnPct == null && benchmarkReturnPct == null) {
    returnUnavailable =
      "Benchmark comparison unavailable — neither a portfolio return nor a live benchmark series could be computed.";
  } else if (benchmarkReturnPct == null) {
    returnUnavailable = `${benchmarkName} series unavailable for this window — cannot compute relative performance.`;
  } else if (portfolioReturnPct == null) {
    returnUnavailable =
      "Portfolio return unavailable (no live values) — cannot compute relative performance.";
  } else {
    relativePct = portfolioReturnPct - benchmarkReturnPct;
    verdict = relativePct > 0.5 ? "outperforming" : relativePct < -0.5 ? "underperforming" : "in line";
  }

  return {
    benchmarkName,
    windowLabel,
    portfolioReturnPct,
    benchmarkReturnPct,
    relativePct,
    verdict,
    returnUnavailable,
  };
}

/**
 * Compute a buy-and-hold benchmark return (%) from a real index close series.
 * Returns null when there are fewer than two finite closes — never a guess.
 */
export function benchmarkReturnFromCloses(closes: number[]): number | null {
  const finite = closes.filter(c => Number.isFinite(c));
  if (finite.length < 2) return null;
  const first = finite[0];
  const last = finite[finite.length - 1];
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

/** A single plottable point of the index series, rebased to % from window start. */
export interface BenchmarkSeriesPoint {
  /** Epoch seconds (UTC) of the candle. */
  t: number;
  /** ISO yyyy-mm-dd date for the X axis. */
  date: string;
  /** Index % change from the first covered close (first point is always 0). */
  indexPct: number;
}

/**
 * Build a rebased index series (% change from the window's first close) for a
 * small benchmark line chart. HONEST: returns an empty array when fewer than
 * two finite closes are available or the first close is zero — never a guess.
 * The final point's `indexPct` equals `benchmarkReturnFromCloses` over the same
 * closes, so the chart and the headline number agree by construction.
 */
export function buildBenchmarkSeries(
  candles: { t: number; c: number }[],
): BenchmarkSeriesPoint[] {
  const finite = candles.filter(
    c => Number.isFinite(c.t) && Number.isFinite(c.c),
  );
  if (finite.length < 2) return [];
  const first = finite[0].c;
  if (first === 0) return [];
  return finite.map(c => ({
    t: c.t,
    date: new Date(c.t * 1000).toISOString().slice(0, 10),
    indexPct: ((c.c - first) / first) * 100,
  }));
}

// ---------------------------------------------------------------------------
// Portfolio value path — Σ qty × daily close, rebased to % from window start
// ---------------------------------------------------------------------------

/** Daily close history for one holding (current quantity + its candles). */
export interface PortfolioHoldingHistory {
  symbol: string;
  /** Current quantity of shares held. */
  qty: number;
  /** Daily candles (epoch seconds + close). Empty when no history is available. */
  candles: { t: number; c: number }[];
}

/** A single plottable point of the portfolio value path, rebased to % from start. */
export interface PortfolioValuePoint {
  /** Epoch seconds (UTC) of the day. */
  t: number;
  /** ISO yyyy-mm-dd date for the X axis. */
  date: string;
  /** Portfolio market-value % change from the first fully-covered day (first point is 0). */
  portfolioPct: number;
}

export interface PortfolioValueSeries {
  /** Rebased value path; empty when no honest path can be built. */
  points: PortfolioValuePoint[];
  /** Total holdings considered. */
  totalHoldings: number;
  /** Holdings that contributed at least one usable daily close. */
  coveredHoldings: number;
  /** Symbols with no usable daily history (excluded from the path). */
  missingSymbols: string[];
  /** First date where every covered holding has data (the path's start), null if none. */
  firstFullCoverageDate: string | null;
  /** True when some holdings lack full history over the window (path is a partial view). */
  partial: boolean;
  /** Non-null when no honest path can be drawn at all. */
  unavailable: string | null;
}

function isoDay(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/**
 * Build the portfolio's market-value path (Σ qty × daily close) rebased to %
 * change from the first fully-covered trading day, so it shares the index
 * chart's Y axis.
 *
 * HONEST BY CONSTRUCTION:
 *  - Only holdings with real daily closes contribute; those with no history are
 *    surfaced in `missingSymbols` and never imputed.
 *  - The path is only drawn over days where EVERY covered holding has a close,
 *    so the basket composition is constant and the % move is a true return —
 *    no fabricated values and no artificial jumps when a holding's history
 *    starts mid-window.
 *  - `partial` flags when the view omits holdings (missing history) or starts
 *    later than the earliest available data, so the UI can label it plainly.
 *  - Returns an empty `points` array (with a reason) rather than guessing when
 *    there is no overlapping history to plot.
 */
export function buildPortfolioValueSeries(
  holdings: PortfolioHoldingHistory[],
): PortfolioValueSeries {
  const totalHoldings = holdings.length;
  const missingSymbols: string[] = [];

  // Per-holding date→close maps (dedup per day, last close wins).
  const perHolding: { qty: number; byDate: Map<string, { t: number; c: number }> }[] = [];
  for (const h of holdings) {
    const byDate = new Map<string, { t: number; c: number }>();
    if (Number.isFinite(h.qty)) {
      for (const k of h.candles) {
        if (!Number.isFinite(k.t) || !Number.isFinite(k.c)) continue;
        byDate.set(isoDay(k.t), { t: k.t, c: k.c });
      }
    }
    if (byDate.size === 0) {
      missingSymbols.push(h.symbol);
    } else {
      perHolding.push({ qty: h.qty, byDate });
    }
  }

  const coveredHoldings = perHolding.length;
  const base = {
    totalHoldings,
    coveredHoldings,
    missingSymbols,
    firstFullCoverageDate: null as string | null,
    partial: missingSymbols.length > 0,
  };

  if (coveredHoldings === 0) {
    return {
      ...base,
      points: [],
      unavailable:
        "Portfolio value path unavailable — no holdings have daily price history for this window.",
    };
  }

  // Union of all dates seen across covered holdings.
  const dates = new Map<string, number>(); // date → representative epoch seconds
  for (const ph of perHolding) {
    for (const [date, { t }] of ph.byDate) {
      const prev = dates.get(date);
      dates.set(date, prev == null ? t : Math.min(prev, t));
    }
  }

  // Days where every covered holding has a close (constant-basket days).
  const fullDays: { date: string; t: number; value: number }[] = [];
  let earliestCoveredT = Infinity;
  for (const [date, t] of dates) {
    if (t < earliestCoveredT) earliestCoveredT = t;
    let value = 0;
    let covered = 0;
    for (const ph of perHolding) {
      const hit = ph.byDate.get(date);
      if (!hit) continue;
      covered += 1;
      value += ph.qty * hit.c;
    }
    if (covered === coveredHoldings) fullDays.push({ date, t, value });
  }
  fullDays.sort((a, b) => a.t - b.t);

  if (fullDays.length < 2) {
    return {
      ...base,
      points: [],
      unavailable:
        "Portfolio value path unavailable — holdings have no overlapping daily history to plot.",
    };
  }

  const baseValue = fullDays[0].value;
  if (baseValue === 0) {
    return {
      ...base,
      points: [],
      unavailable:
        "Portfolio value path unavailable — starting value is zero, cannot rebase to %.",
    };
  }

  const points: PortfolioValuePoint[] = fullDays.map(d => ({
    t: d.t,
    date: d.date,
    portfolioPct: ((d.value - baseValue) / baseValue) * 100,
  }));

  const firstFullCoverageDate = points[0].date;
  const partial =
    missingSymbols.length > 0 || points[0].t > earliestCoveredT;

  return {
    ...base,
    points,
    firstFullCoverageDate,
    partial,
    unavailable: null,
  };
}

/** A point on the combined chart: index and portfolio % on a shared date axis. */
export interface CombinedSeriesPoint {
  t: number;
  date: string;
  /** Index % change from window start; null when the index has no point that day. */
  indexPct: number | null;
  /** Portfolio % change from window start; null when the portfolio has no point that day. */
  portfolioPct: number | null;
}

/**
 * Merge the index series and the portfolio value path onto a single, sorted
 * date axis so Recharts can plot both lines together. Missing values stay null
 * (the chart uses `connectNulls`) — never fabricated to fill gaps.
 */
export function mergeBenchmarkAndPortfolio(
  indexSeries: BenchmarkSeriesPoint[],
  portfolioPoints: PortfolioValuePoint[],
): CombinedSeriesPoint[] {
  const byDate = new Map<string, CombinedSeriesPoint>();
  for (const p of indexSeries) {
    byDate.set(p.date, { t: p.t, date: p.date, indexPct: p.indexPct, portfolioPct: null });
  }
  for (const p of portfolioPoints) {
    const existing = byDate.get(p.date);
    if (existing) {
      existing.portfolioPct = p.portfolioPct;
    } else {
      byDate.set(p.date, { t: p.t, date: p.date, indexPct: null, portfolioPct: p.portfolioPct });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Sector over/under-weight vs a REAL, dated NIFTY 500 reference
// ---------------------------------------------------------------------------

/** Date the reference weights below were captured (ISO). */
export const NIFTY500_SECTOR_REFERENCE_AS_OF = "2026-06-03";

/** Provenance of the reference weights (published NSE NIFTY 500 sector data). */
export const NIFTY500_SECTOR_REFERENCE_SOURCE =
  "NSE NIFTY 500 sector weights (published constituent industry weights)";

/**
 * NSE reconstitutes the NIFTY 500 semi-annually (and weights drift continuously
 * with price moves between reconstitutions). Past this age the static reference
 * is flagged stale so the panel prompts a refresh instead of silently drifting.
 */
export const NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS = 180;

/**
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO REFRESH THE NIFTY 500 SECTOR REFERENCE (low-friction manual update)
 * ─────────────────────────────────────────────────────────────────────────
 * The over/under-weight comparison is honest only while these weights track
 * the live index. Refresh roughly every quarter (or whenever the panel shows
 * the amber "reference may be stale" note). The whole job is editing this one
 * file — no backend, schema, or migration changes.
 *
 * 1. SOURCE the current weights. Use NSE's published "NIFTY 500" factsheet /
 *    index methodology page (niftyindices.com) and take its **industry / sector
 *    representation** (% weightage) table. That table is the authority; every
 *    number below must trace back to one of its rows.
 * 2. ROLL UP each NSE industry row into exactly ONE app bucket using the map in
 *    the `NIFTY500_SECTOR_REFERENCE` doc comment directly below. Keep it a true
 *    partition: every NSE row lands in one bucket, nothing is double-counted,
 *    and anything that fits no bucket goes to `Other`.
 * 3. UPDATE three things in lock-step:
 *      a. the weights in `NIFTY500_SECTOR_REFERENCE` (they must still sum to
 *         ~100% — the `benchmark.test.ts` partition-sum guard enforces this),
 *      b. `NIFTY500_SECTOR_REFERENCE_AS_OF` → the real capture date (ISO), and
 *      c. `NIFTY500_SECTOR_REFERENCE_SOURCE` if the provenance wording changes.
 *    Do NOT bump the as-of date without actually updating the weights — the
 *    label must reflect the TRUE capture date, never "now".
 * 4. VERIFY: `pnpm --filter @workspace/scanner run test` (partition-sum + this
 *    file's tests) and `pnpm run typecheck`. The panel's as-of label and the
 *    staleness note both read from the constants above automatically.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Reported staleness of the static reference relative to `now`. */
export interface SectorReferenceStaleness {
  asOf: string;
  /** Whole days since the reference was captured (0 when capture date is in the future). */
  ageDays: number;
  maxAgeDays: number;
  /** True once `ageDays` exceeds `maxAgeDays` — UI should prompt a refresh. */
  stale: boolean;
}

/**
 * Compute how old the static NIFTY 500 sector reference is. Pure given `now`
 * (defaults to the current date) so the panel can surface an honest "may be
 * stale" prompt rather than letting the comparison drift silently.
 */
export function sectorReferenceStaleness(now: Date = new Date()): SectorReferenceStaleness {
  const asOfMs = Date.parse(`${NIFTY500_SECTOR_REFERENCE_AS_OF}T00:00:00Z`);
  const ageDays = Number.isFinite(asOfMs)
    ? Math.max(0, Math.floor((now.getTime() - asOfMs) / 86_400_000))
    : 0;
  return {
    asOf: NIFTY500_SECTOR_REFERENCE_AS_OF,
    ageDays,
    maxAgeDays: NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS,
    stale: ageDays > NIFTY500_SECTOR_REFERENCE_MAX_AGE_DAYS,
  };
}

/**
 * NIFTY 500 sector weights (% of index), rolled up to THIS app's sector
 * vocabulary. Every number traces to the published NSE NIFTY 500 industry
 * weightage table captured on `NIFTY500_SECTOR_REFERENCE_AS_OF`; each NSE
 * industry row is assigned to exactly one bucket below, so the set is a true
 * partition that sums to ~100% and never double-counts.
 *
 * Roll-up (NSE industry rows → app bucket):
 *   Banking                ← Banks
 *   Financials             ← Financial Services + Capital Markets
 *   Insurance              ← Insurance
 *   IT                     ← Information Technology
 *   Auto                   ← Automobiles
 *   Healthcare             ← Healthcare + Healthcare Services  (covers Pharma too)
 *   Metals                 ← Metals & Mining
 *   Energy                 ← Petroleum Products + Power + Oil & Gas + Energy
 *   Construction           ← Construction
 *   Capital Goods          ← Capital Goods + Industrial Products
 *   FMCG                   ← Consumer Goods + FMCG + Food Products + Beverages
 *   Telecom                ← Telecom
 *   Consumer Discretionary ← Retail + Leisure Services + Consumer Services
 *   Defence                ← Aerospace & Defense
 *   Chemicals              ← Chemicals
 *   Real Estate            ← Realty
 *   Logistics              ← Transport + Logistics & Cargo + Transport Services
 *   Aviation               ← Aviation
 *   Media                  ← Media
 *   Other                  ← Textiles + Diversified + Commercial Services + Forest Materials + NA
 */
export const NIFTY500_SECTOR_REFERENCE: Readonly<Record<string, number>> = {
  Banking: 12.5,
  Financials: 10.2,
  Insurance: 2.93,
  IT: 6.51,
  Auto: 7.83,
  Healthcare: 6.71,
  Metals: 5.51,
  Energy: 13.03,
  Construction: 4.04,
  "Capital Goods": 6.02,
  FMCG: 8.38,
  Telecom: 3.91,
  "Consumer Discretionary": 3.67,
  Defence: 2.34,
  Chemicals: 2.06,
  "Real Estate": 1.28,
  Logistics: 1.68,
  Aviation: 0.42,
  Media: 0.12,
  Other: 0.86,
};

/**
 * Lower-cased synonyms → canonical reference bucket. Lets us absorb the
 * various sector spellings the live data sources emit (e.g. "Pharma",
 * "Oil & Gas", "Financial Services") without inventing weights.
 */
const SECTOR_ALIASES: Readonly<Record<string, string>> = {
  // Banking
  bank: "Banking",
  banks: "Banking",
  "private banks": "Banking",
  "public sector banks": "Banking",
  // Financials
  "financial services": "Financials",
  finance: "Financials",
  financial: "Financials",
  nbfc: "Financials",
  "capital markets": "Financials",
  // Insurance
  insurance: "Insurance",
  // IT
  "information technology": "IT",
  technology: "IT",
  software: "IT",
  "it services": "IT",
  // Auto
  automobile: "Auto",
  automobiles: "Auto",
  "automobile and auto components": "Auto",
  "auto components": "Auto",
  // Healthcare (NSE lumps pharma under healthcare)
  pharma: "Healthcare",
  pharmaceuticals: "Healthcare",
  "health care": "Healthcare",
  "healthcare services": "Healthcare",
  // Metals
  "metals & mining": "Metals",
  "metals and mining": "Metals",
  mining: "Metals",
  steel: "Metals",
  // Energy
  "oil & gas": "Energy",
  "oil and gas": "Energy",
  "oil gas & consumable fuels": "Energy",
  "petroleum products": "Energy",
  power: "Energy",
  utilities: "Energy",
  // Capital Goods
  industrials: "Capital Goods",
  "industrial products": "Capital Goods",
  engineering: "Capital Goods",
  // FMCG
  "consumer goods": "FMCG",
  "consumer staples": "FMCG",
  "fast moving consumer goods": "FMCG",
  "food products": "FMCG",
  beverages: "FMCG",
  // Telecom
  telecommunication: "Telecom",
  telecommunications: "Telecom",
  // Consumer Discretionary
  "consumer durables": "Consumer Discretionary",
  retail: "Consumer Discretionary",
  "consumer services": "Consumer Discretionary",
  "leisure services": "Consumer Discretionary",
  // Defence
  "aerospace & defense": "Defence",
  "aerospace & defence": "Defence",
  defense: "Defence",
  // Real Estate
  realty: "Real Estate",
  "real estate": "Real Estate",
  // Logistics
  transport: "Logistics",
  "transport services": "Logistics",
  "logistics & cargo": "Logistics",
};

/**
 * Resolve a raw sector label to a reference bucket key, or null when it does
 * not confidently map (kept honest — no fuzzy guessing into a weight).
 */
export function normalizeSectorKey(sector: string): string | null {
  const raw = (sector ?? "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  if (low === "unknown" || low === "unmapped" || low === "other" || low === "na") return null;
  // Exact bucket match (case-insensitive against the reference keys).
  for (const key of Object.keys(NIFTY500_SECTOR_REFERENCE)) {
    if (key.toLowerCase() === low) return key === "Other" ? null : key;
  }
  return SECTOR_ALIASES[low] ?? null;
}

// ---------------------------------------------------------------------------
// Per-sector index return — each held sector vs its OWN NSE sectoral index
// ---------------------------------------------------------------------------

/** An NSE sectoral index that represents one of this app's sector buckets. */
export interface SectorIndexRef {
  /** Canonical app sector bucket this index represents. */
  sector: string;
  /** Chart-endpoint symbol (segment "index"). */
  symbol: string;
  /** Human label shown in the panel. */
  name: string;
}

/**
 * Map this app's sector buckets → their NSE sectoral index. Only buckets that
 * have a clean, single published sectoral index are listed; everything else
 * (Insurance, Construction, Capital Goods, Telecom, Consumer Discretionary,
 * Defence, Chemicals, Logistics, Aviation, Other) has NO standard NSE sector
 * index and is therefore honestly reported as "no sector index" — never mapped
 * to an unrelated index. Symbols MUST exist in the server's CURATED_INDICES so
 * the existing chart endpoint can resolve a real daily series (Kite→Yahoo).
 */
export const SECTOR_INDEX_MAP: Readonly<Record<string, SectorIndexRef>> = {
  Banking: { sector: "Banking", symbol: "BANKNIFTY", name: "NIFTY BANK" },
  Financials: { sector: "Financials", symbol: "FINNIFTY", name: "NIFTY FIN SERVICE" },
  IT: { sector: "IT", symbol: "NIFTYIT", name: "NIFTY IT" },
  Auto: { sector: "Auto", symbol: "NIFTYAUTO", name: "NIFTY AUTO" },
  Healthcare: { sector: "Healthcare", symbol: "NIFTYPHARMA", name: "NIFTY PHARMA" },
  Metals: { sector: "Metals", symbol: "NIFTYMETAL", name: "NIFTY METAL" },
  Energy: { sector: "Energy", symbol: "NIFTYENERGY", name: "NIFTY ENERGY" },
  FMCG: { sector: "FMCG", symbol: "NIFTYFMCG", name: "NIFTY FMCG" },
  "Real Estate": { sector: "Real Estate", symbol: "NIFTYREALTY", name: "NIFTY REALTY" },
  Media: { sector: "Media", symbol: "NIFTYMEDIA", name: "NIFTY MEDIA" },
};

/**
 * Resolve a raw portfolio sector label to its NSE sectoral index, or null when
 * the sector does not confidently map to a published sector index. Reuses the
 * same alias normalisation as the over/under-weight comparison so e.g. "Pharma"
 * resolves to NIFTY PHARMA via the Healthcare bucket — no fuzzy guessing.
 */
export function sectorIndexFor(sector: string): SectorIndexRef | null {
  const key = normalizeSectorKey(sector);
  if (!key) return null;
  return SECTOR_INDEX_MAP[key] ?? null;
}

/**
 * Distinct sector indices needed for the sectors actually held (weight > 0).
 * Lets the page fetch one series per relevant index, de-duplicated. Sectors
 * with no mapped index are omitted (surfaced as "no sector index" in the UI).
 */
export function sectorIndexesForSectors(
  sectors: { sector: string; weightPct: number | null }[],
): SectorIndexRef[] {
  const seen = new Map<string, SectorIndexRef>();
  for (const s of sectors) {
    if (s.weightPct == null || !(s.weightPct > 0)) continue;
    const ref = sectorIndexFor(s.sector);
    if (ref && !seen.has(ref.symbol)) seen.set(ref.symbol, ref);
  }
  return Array.from(seen.values());
}

export interface SectorWeightRow {
  /** Canonical reference bucket label. */
  sector: string;
  /** Portfolio weight in this bucket (% of total current value). */
  portfolioPct: number;
  /** Real NIFTY 500 reference weight for this bucket (%). */
  benchmarkPct: number;
  /** portfolio − benchmark (percentage points). */
  diffPct: number;
  stance: "overweight" | "underweight" | "in line";
}

export interface SectorWeightComparison {
  asOf: string;
  source: string;
  /** Per-bucket comparison rows, sorted by absolute over/under-weight desc. */
  rows: SectorWeightRow[];
  /** Portfolio sectors that did not map into the reference taxonomy. */
  unmapped: { sector: string; portfolioPct: number }[];
  /** Share of portfolio current value covered by mapped sectors (%). */
  coveragePct: number;
  /** Non-null when no comparison can be made at all. */
  unavailable: string | null;
}

const IN_LINE_TOLERANCE_PP = 0.5;

/**
 * Compare portfolio sector weights against the dated NIFTY 500 reference.
 * `sectors` is the per-sector portfolio allocation (weightPct = % of current
 * value). Every reference bucket is reported (including 0% portfolio holdings,
 * which read as underweight by the full benchmark weight) so under-exposure is
 * visible, not hidden. Unmapped portfolio sectors are surfaced separately.
 */
export function compareSectorWeights(
  sectors: { sector: string; weightPct: number | null }[],
): SectorWeightComparison {
  const base = {
    asOf: NIFTY500_SECTOR_REFERENCE_AS_OF,
    source: NIFTY500_SECTOR_REFERENCE_SOURCE,
  };

  const usable = sectors.filter(s => s.weightPct != null && Number.isFinite(s.weightPct));
  if (usable.length === 0) {
    return {
      ...base,
      rows: [],
      unmapped: [],
      coveragePct: 0,
      unavailable:
        "Sector over/under-weight unavailable — no live portfolio sector weights could be computed.",
    };
  }

  // Aggregate portfolio weight into reference buckets; track unmapped weight.
  const portfolioByBucket = new Map<string, number>();
  const unmappedMap = new Map<string, number>();
  let mappedWeight = 0;
  for (const s of usable) {
    const w = s.weightPct as number;
    const key = normalizeSectorKey(s.sector);
    if (key) {
      portfolioByBucket.set(key, (portfolioByBucket.get(key) ?? 0) + w);
      mappedWeight += w;
    } else {
      const label = (s.sector ?? "").trim() || "Unknown";
      unmappedMap.set(label, (unmappedMap.get(label) ?? 0) + w);
    }
  }

  const rows: SectorWeightRow[] = Object.entries(NIFTY500_SECTOR_REFERENCE)
    .filter(([sector]) => sector !== "Other")
    .map(([sector, benchmarkPct]) => {
      const portfolioPct = portfolioByBucket.get(sector) ?? 0;
      const diffPct = portfolioPct - benchmarkPct;
      const stance: SectorWeightRow["stance"] =
        diffPct > IN_LINE_TOLERANCE_PP
          ? "overweight"
          : diffPct < -IN_LINE_TOLERANCE_PP
            ? "underweight"
            : "in line";
      return { sector, portfolioPct, benchmarkPct, diffPct, stance };
    })
    .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

  const unmapped = Array.from(unmappedMap.entries())
    .map(([sector, portfolioPct]) => ({ sector, portfolioPct }))
    .sort((a, b) => b.portfolioPct - a.portfolioPct);

  const totalWeight = usable.reduce((sum, s) => sum + (s.weightPct as number), 0);
  const coveragePct = totalWeight > 0 ? (mappedWeight / totalWeight) * 100 : 0;

  return {
    ...base,
    rows,
    unmapped,
    coveragePct,
    unavailable: null,
  };
}
