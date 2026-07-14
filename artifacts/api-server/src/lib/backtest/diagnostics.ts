/**
 * F&O Replay Diagnostics — pure analytics functions.
 *
 * Input: a list of DiagTrade (mapped from backtest_trades + optional expiry join).
 * Output: FnoReplayDiagnosticsOut — all diagnostic sections (Parts B–I).
 *
 * ABSOLUTE RULES:
 *   - No DB access. No side effects. No imports from option pricing / signals.
 *   - All simulation outputs are tagged simulationType: "SIMULATION_ONLY".
 *   - No division by zero. Null for undefined metrics.
 *   - No fabricated data. If a field is missing, it is null.
 */

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface DiagTrade {
  id: string;
  indexSymbol: string;
  setupKey: string | null;
  setupName: string | null;
  direction: string;
  optionType: string | null;
  strike: number | null;
  entryAt: string | null;
  exitAt: string | null;
  optionEntry: number | null;
  optionExit: number | null;
  grossPnl: number | null;
  spreadCost: number | null;
  explicitCosts: number | null; // total costs minus spreadCost
  totalCosts: number | null;
  netPnl: number | null;
  pricingMode: string | null;
  exitReason: string | null;
  tier: string | null;
  entryPremiumSource: string | null;
  exitPremiumSource: string | null;
  expiryDate: string | null; // YYYY-MM-DD from option_chain_snapshot join
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface DiagStats {
  totalTrades: number;
  pricedTrades: number;
  unavailableTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
  maxDrawdown: number;
  bestTrade: number | null;
  worstTrade: number | null;
  avgEntryPremium: number | null;
  avgSpreadCost: number | null;
}

export interface DiagGroup extends DiagStats {
  key: string;
  label: string;
}

export interface DiagSetupGroup extends DiagGroup {
  underlying: string;
  direction: string | null;
  optionType: string | null;
}

export interface DiagDayCluster extends DiagStats {
  date: string;
  underlying: string;
}

export interface DiagReentryCluster {
  underlying: string;
  date: string;
  strike: number;
  direction: string;
  optionType: string | null;
  numEntries: number;
  totalGrossPnl: number;
  totalCosts: number;
  totalNetPnl: number;
  exitReasons: string[];
  timeGapMinutes: number | null;
  simulationNoReentry: SimulationResult;
}

export interface DiagUnavailableReason {
  reason: string;
  count: number;
  underlyings: string[];
  exampleDates: string[];
}

export interface SimulationResult {
  label: string;
  simulationType: "SIMULATION_ONLY";
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
}

export interface MinPremiumSimResult extends SimulationResult {
  minPremiumThreshold: number;
  tradesFiltered: number;
}

export interface FnoReplayDiagnosticsOut {
  runId: string;
  backtestMode: string | null;
  fromDate: string | null;
  toDate: string | null;
  instrument: string;
  generatedAt: string;

  // Part B: breakdown groups
  byUnderlying: DiagGroup[];
  bySetup: DiagSetupGroup[];
  byDirection: DiagGroup[];
  byOptionType: DiagGroup[];
  byExitReason: DiagGroup[];
  byTimeOfDay: DiagGroup[];
  byDayOfWeek: DiagGroup[];
  byExpiryDistance: DiagGroup[];
  byPremiumBucket: DiagGroup[];
  byCostBucket: DiagGroup[];
  bySnapshotAvailability: DiagGroup[];

  // Part B: date clusters
  worstLossClusters: DiagDayCluster[];
  bestProfitClusters: DiagDayCluster[];

  // Part F: re-entry audit
  reentryClusters: DiagReentryCluster[];

  // Part G: SENSEX focused audit
  sensexAudit: {
    all: DiagStats;
    excludingJun11to17: SimulationResult;
    byDirection: DiagGroup[];
    byExitReason: DiagGroup[];
    byTimeOfDay: DiagGroup[];
    byPremiumBucket: DiagGroup[];
    byExpiryDistance: DiagGroup[];
  };

  // Part H: BANKNIFTY robustness
  bankniftyAudit: {
    all: DiagStats;
    excludingBestTrade: SimulationResult;
    excludingWorstTrade: SimulationResult;
    excludingBothBestAndWorst: SimulationResult;
    robustnessVerdict: string;
    bySetup: DiagGroup[];
    byDirection: DiagGroup[];
    byExpiryDistance: DiagGroup[];
  };

  // Part I: snapshot unavailability
  unavailableReasons: DiagUnavailableReason[];
  unavailableByUnderlying: DiagGroup[];
  unavailableByDate: { date: string; underlying: string; count: number }[];

  // Part E: cost simulation recommendation
  simulationOnlyRecommendations: {
    tag: "SIMULATION_ONLY";
    label: string;
    description: string;
    value: string | null;
    results: (SimulationResult | MinPremiumSimResult)[];
  }[];
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function isPriced(t: DiagTrade): boolean {
  return t.pricingMode !== "UNAVAILABLE" && t.netPnl !== null;
}

function safeMs(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return isNaN(ms) ? 0 : ms;
}

/** Parse a trade's entry time into hours + minutes in IST (UTC+5:30). */
function entryHourMinIST(iso: string | null): { h: number; m: number } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  const istMs = ms + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}

/** YYYY-MM-DD in IST. */
function entryDateIST(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  const istMs = ms + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.toISOString().slice(0, 10);
}

/** Day-of-week in IST (0 = Sunday). */
function entryDayIST(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  const istMs = ms + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).getUTCDay();
}

// ---------------------------------------------------------------------------
// Bucket classifiers
// ---------------------------------------------------------------------------

export function timeOfDayBucket(iso: string | null): string {
  const hm = entryHourMinIST(iso);
  if (!hm) return "Unknown";
  const tot = hm.h * 60 + hm.m;
  if (tot < 9 * 60 + 15) return "Pre-market";
  if (tot < 9 * 60 + 30) return "09:15–09:30";
  if (tot < 10 * 60) return "09:30–10:00";
  if (tot < 11 * 60) return "10:00–11:00";
  if (tot < 12 * 60 + 30) return "11:00–12:30";
  if (tot < 14 * 60) return "12:30–14:00";
  if (tot < 15 * 60) return "14:00–15:00";
  return "15:00–15:20";
}

export function expiryDistanceBucket(daysToExpiry: number | null): string {
  if (daysToExpiry === null || daysToExpiry < 0) return "Unknown";
  if (daysToExpiry === 0) return "0DTE";
  if (daysToExpiry === 1) return "1DTE";
  if (daysToExpiry === 2) return "2DTE";
  if (daysToExpiry <= 5) return "3–5DTE";
  return ">5DTE";
}

export function premiumBucket(premium: number | null): string {
  if (premium === null || premium <= 0) return "Unknown";
  if (premium < 75) return "<₹75";
  if (premium < 125) return "₹75–₹125";
  if (premium < 200) return "₹125–₹200";
  if (premium < 400) return "₹200–₹400";
  if (premium < 800) return "₹400–₹800";
  return ">₹800";
}

export function costBucket(totalCosts: number | null): string {
  if (totalCosts === null || totalCosts < 0) return "Unknown";
  if (totalCosts < 200) return "<₹200";
  if (totalCosts < 500) return "₹200–₹500";
  if (totalCosts < 1000) return "₹500–₹1000";
  if (totalCosts < 2000) return "₹1000–₹2000";
  return ">₹2000";
}

export function daysToExpiry(expiryDate: string | null, entryAt: string | null): number | null {
  if (!expiryDate || !entryAt) return null;
  const exp = Date.parse(expiryDate);
  const ent = Date.parse(entryDateIST(entryAt) ?? "");
  if (isNaN(exp) || isNaN(ent)) return null;
  return Math.max(0, Math.round((exp - ent) / (24 * 60 * 60 * 1000)));
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

function computeMaxDrawdown(sortedNetPnls: number[]): number {
  let peak = 0, maxDD = 0, running = 0;
  for (const p of sortedNetPnls) {
    running += p;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

export function computeStats(trades: DiagTrade[]): DiagStats {
  const priced = trades.filter(isPriced);
  const wins = priced.filter((t) => (t.netPnl ?? 0) > 0);
  const losses = priced.filter((t) => (t.netPnl ?? 0) <= 0);

  const grossPnl = priced.reduce((s, t) => s + (t.grossPnl ?? 0), 0);
  const totalCosts = priced.reduce((s, t) => s + (t.totalCosts ?? 0), 0);
  const netPnl = priced.reduce((s, t) => s + (t.netPnl ?? 0), 0);

  const grossWin = wins.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.netPnl ?? 0), 0));

  const avgWin = wins.length > 0 ? grossWin / wins.length : null;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : null;

  let profitFactor: number | null = null;
  if (grossLoss > 0) {
    profitFactor = Math.min(grossWin / grossLoss, 9999);
  } else if (wins.length > 0) {
    profitFactor = 9999; // no losses — cap to avoid Infinity in JSON
  }

  const winRate = priced.length > 0 ? wins.length / priced.length : null;
  const expectancyPerTrade = priced.length > 0 ? netPnl / priced.length : null;

  const sorted = [...priced].sort((a, b) => safeMs(a.entryAt) - safeMs(b.entryAt));
  const maxDrawdown = computeMaxDrawdown(sorted.map((t) => t.netPnl ?? 0));

  const premiums = priced.map((t) => t.optionEntry).filter((p): p is number => p !== null);
  const spreads = priced.map((t) => t.spreadCost).filter((s): s is number => s !== null);

  return {
    totalTrades: trades.length,
    pricedTrades: priced.length,
    unavailableTrades: trades.length - priced.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    grossPnl,
    totalCosts,
    netPnl,
    avgWin,
    avgLoss,
    profitFactor,
    expectancyPerTrade,
    maxDrawdown,
    bestTrade: priced.length > 0 ? Math.max(...priced.map((t) => t.netPnl ?? 0)) : null,
    worstTrade: priced.length > 0 ? Math.min(...priced.map((t) => t.netPnl ?? 0)) : null,
    avgEntryPremium: premiums.length > 0 ? premiums.reduce((s, v) => s + v, 0) / premiums.length : null,
    avgSpreadCost: spreads.length > 0 ? spreads.reduce((s, v) => s + v, 0) / spreads.length : null,
  };
}

function toSimResult(label: string, trades: DiagTrade[]): SimulationResult {
  const s = computeStats(trades);
  return {
    label,
    simulationType: "SIMULATION_ONLY",
    trades: s.pricedTrades,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate,
    grossPnl: s.grossPnl,
    totalCosts: s.totalCosts,
    netPnl: s.netPnl,
    profitFactor: s.profitFactor,
    expectancyPerTrade: s.expectancyPerTrade,
  };
}

// ---------------------------------------------------------------------------
// Group-by helpers
// ---------------------------------------------------------------------------

function groupByKey<K extends string>(
  trades: DiagTrade[],
  keyFn: (t: DiagTrade) => K | null,
  labelFn: (k: K) => string,
  sortFn?: (a: K, b: K) => number,
): DiagGroup[] {
  const map = new Map<K, DiagTrade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    if (k === null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  const keys = [...map.keys()];
  if (sortFn) keys.sort(sortFn);
  return keys.map((k) => ({
    key: k,
    label: labelFn(k),
    ...computeStats(map.get(k)!),
  }));
}

// ---------------------------------------------------------------------------
// Part C: Time-of-day
// ---------------------------------------------------------------------------

const TOD_ORDER = [
  "09:15–09:30",
  "09:30–10:00",
  "10:00–11:00",
  "11:00–12:30",
  "12:30–14:00",
  "14:00–15:00",
  "15:00–15:20",
  "Pre-market",
  "Unknown",
];

// ---------------------------------------------------------------------------
// Part D: Expiry distance — compute DTE for each trade
// ---------------------------------------------------------------------------

function enrichDte(trades: DiagTrade[]): (DiagTrade & { dte: number | null })[] {
  return trades.map((t) => ({
    ...t,
    dte: daysToExpiry(t.expiryDate, t.entryAt),
  }));
}

const EXPIRY_ORDER = ["0DTE", "1DTE", "2DTE", "3–5DTE", ">5DTE", "Unknown"];

// ---------------------------------------------------------------------------
// Part F: Re-entry cluster detection
// ---------------------------------------------------------------------------

export function detectReentryClusters(trades: DiagTrade[]): DiagReentryCluster[] {
  const clusters: DiagReentryCluster[] = [];
  const grouped = new Map<string, DiagTrade[]>();

  for (const t of trades) {
    const date = entryDateIST(t.entryAt);
    if (!date || t.strike === null) continue;
    const key = `${t.indexSymbol}::${date}::${t.strike}::${t.direction}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  for (const [, group] of grouped) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => safeMs(a.entryAt) - safeMs(b.entryAt));
    const first = sorted[0]!;
    const date = entryDateIST(first.entryAt)!;

    // Time gap between first and last entry
    const firstMs = safeMs(first.entryAt);
    const lastMs = safeMs(sorted[sorted.length - 1]!.entryAt);
    const timeGapMinutes = lastMs > firstMs ? Math.round((lastMs - firstMs) / 60000) : null;

    const totalGrossPnl = group.reduce((s, t) => s + (t.grossPnl ?? 0), 0);
    const totalCosts = group.reduce((s, t) => s + (t.totalCosts ?? 0), 0);
    const totalNetPnl = group.reduce((s, t) => s + (t.netPnl ?? 0), 0);

    // Simulation: take only the first trade
    const firstOnly = [first];
    const simNoReentry = toSimResult("SIMULATION_ONLY_NO_REENTRY", firstOnly);

    clusters.push({
      underlying: first.indexSymbol,
      date,
      strike: first.strike!,
      direction: first.direction,
      optionType: first.optionType,
      numEntries: group.length,
      totalGrossPnl,
      totalCosts,
      totalNetPnl,
      exitReasons: sorted.map((t) => t.exitReason ?? "UNKNOWN"),
      timeGapMinutes,
      simulationNoReentry: simNoReentry,
    });
  }

  return clusters.sort((a, b) => a.totalNetPnl - b.totalNetPnl); // worst first
}

// ---------------------------------------------------------------------------
// Part G: SENSEX audit
// ---------------------------------------------------------------------------

function sensexAudit(trades: DiagTrade[]) {
  const sx = trades.filter((t) => t.indexSymbol === "SENSEX");
  const jun11 = "2026-06-11";
  const jun17 = "2026-06-17";
  const sxExcl = sx.filter((t) => {
    const d = entryDateIST(t.entryAt);
    if (!d) return true;
    return d < jun11 || d > jun17;
  });

  const withDte = enrichDte(sx);

  return {
    all: computeStats(sx),
    excludingJun11to17: toSimResult("SENSEX_EXCLUDING_JUN_11_TO_JUN_17", sxExcl),
    byDirection: groupByKey(sx, (t) => t.direction, (k) => k),
    byExitReason: groupByKey(sx, (t) => t.exitReason ?? "UNKNOWN", (k) => k),
    byTimeOfDay: groupByKey(
      sx,
      (t) => timeOfDayBucket(t.entryAt),
      (k) => k,
      (a, b) => TOD_ORDER.indexOf(a) - TOD_ORDER.indexOf(b),
    ),
    byPremiumBucket: groupByKey(sx, (t) => premiumBucket(t.optionEntry), (k) => k),
    byExpiryDistance: groupByKey(
      withDte,
      (t) => expiryDistanceBucket((t as DiagTrade & { dte: number | null }).dte),
      (k) => k,
      (a, b) => EXPIRY_ORDER.indexOf(a) - EXPIRY_ORDER.indexOf(b),
    ),
  };
}

// ---------------------------------------------------------------------------
// Part H: BANKNIFTY robustness
// ---------------------------------------------------------------------------

function bankniftyAudit(trades: DiagTrade[]) {
  const bn = trades.filter((t) => t.indexSymbol === "BANKNIFTY");
  const priced = bn.filter(isPriced);

  const allStats = computeStats(bn);

  if (priced.length === 0) {
    const emptyResult = (label: string): SimulationResult => ({
      label,
      simulationType: "SIMULATION_ONLY",
      trades: 0, wins: 0, losses: 0, winRate: null,
      grossPnl: 0, totalCosts: 0, netPnl: 0, profitFactor: null, expectancyPerTrade: null,
    });
    return {
      all: allStats,
      excludingBestTrade: emptyResult("BANKNIFTY_EXCLUDING_BEST_TRADE"),
      excludingWorstTrade: emptyResult("BANKNIFTY_EXCLUDING_WORST_TRADE"),
      excludingBothBestAndWorst: emptyResult("BANKNIFTY_EXCLUDING_BEST_AND_WORST"),
      robustnessVerdict: "INSUFFICIENT_DATA",
      bySetup: [],
      byDirection: [],
      byExpiryDistance: [],
    };
  }

  const bestPnl = Math.max(...priced.map((t) => t.netPnl ?? 0));
  const worstPnl = Math.min(...priced.map((t) => t.netPnl ?? 0));

  let bestIdx = -1, worstIdx = -1;
  for (let i = 0; i < priced.length; i++) {
    if ((priced[i]!.netPnl ?? 0) === bestPnl && bestIdx === -1) bestIdx = i;
    if ((priced[i]!.netPnl ?? 0) === worstPnl && worstIdx === -1) worstIdx = i;
  }

  const excludeBest = bn.filter((t) => {
    const idx = priced.findIndex((p) => p.id === t.id);
    return idx !== bestIdx;
  });
  const excludeWorst = bn.filter((t) => {
    const idx = priced.findIndex((p) => p.id === t.id);
    return idx !== worstIdx;
  });
  const excludeBoth = bn.filter((t) => {
    const idx = priced.findIndex((p) => p.id === t.id);
    return idx !== bestIdx && idx !== worstIdx;
  });

  const exclBestResult = toSimResult("BANKNIFTY_EXCLUDING_BEST_TRADE", excludeBest);
  const robustnessVerdict =
    exclBestResult.netPnl > 0
      ? "BANKNIFTY_EDGE_APPEARS_ROBUST_EARLY_SAMPLE"
      : "BANKNIFTY_EDGE_DEPENDS_ON_OUTLIER_TRADE";

  const withDte = enrichDte(bn);

  return {
    all: allStats,
    excludingBestTrade: exclBestResult,
    excludingWorstTrade: toSimResult("BANKNIFTY_EXCLUDING_WORST_TRADE", excludeWorst),
    excludingBothBestAndWorst: toSimResult("BANKNIFTY_EXCLUDING_BEST_AND_WORST", excludeBoth),
    robustnessVerdict,
    bySetup: groupByKey(bn, (t) => t.setupKey ?? "UNKNOWN", (k) => k),
    byDirection: groupByKey(bn, (t) => t.direction, (k) => k),
    byExpiryDistance: groupByKey(
      withDte,
      (t) => expiryDistanceBucket((t as DiagTrade & { dte: number | null }).dte),
      (k) => k,
      (a, b) => EXPIRY_ORDER.indexOf(a) - EXPIRY_ORDER.indexOf(b),
    ),
  };
}

// ---------------------------------------------------------------------------
// Part I: Snapshot unavailability
// ---------------------------------------------------------------------------

function categorizeUnavailableReason(t: DiagTrade): string {
  const ep = (t.entryPremiumSource ?? "").toLowerCase();
  const xp = (t.exitPremiumSource ?? "").toLowerCase();
  // Check if looks like a real snapshot timestamp (starts with digit/year)
  const entryHasTs = /^\d{4}/.test(ep);
  const exitHasTs = /^\d{4}/.test(xp);
  if (!entryHasTs && !exitHasTs) return "No snapshot found (entry + exit)";
  if (!entryHasTs) return "No entry snapshot within tolerance";
  if (!exitHasTs) return "No exit snapshot within tolerance";
  return "Snapshot rejected (stale or missing bid/ask)";
}

function unavailableReasons(trades: DiagTrade[]): DiagUnavailableReason[] {
  const unavail = trades.filter((t) => !isPriced(t));
  const reasonMap = new Map<string, { underlyings: Set<string>; dates: Set<string> }>();
  for (const t of unavail) {
    const reason = categorizeUnavailableReason(t);
    if (!reasonMap.has(reason)) reasonMap.set(reason, { underlyings: new Set(), dates: new Set() });
    const entry = reasonMap.get(reason)!;
    entry.underlyings.add(t.indexSymbol);
    const d = entryDateIST(t.entryAt);
    if (d) entry.dates.add(d);
  }
  return [...reasonMap.entries()]
    .map(([reason, { underlyings, dates }]) => ({
      reason,
      count: unavail.filter((t) => categorizeUnavailableReason(t) === reason).length,
      underlyings: [...underlyings].sort(),
      exampleDates: [...dates].sort().slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Part E: Cost simulation recommendations
// ---------------------------------------------------------------------------

function minPremiumSimulation(trades: DiagTrade[], threshold: number): MinPremiumSimResult {
  const filtered = trades.filter((t) => (t.optionEntry ?? 0) >= threshold);
  const excluded = trades.filter((t) => isPriced(t) && (t.optionEntry ?? 0) < threshold);
  const s = computeStats(filtered);
  return {
    label: `SIMULATION_ONLY_MIN_ENTRY_PREMIUM_${threshold}`,
    simulationType: "SIMULATION_ONLY",
    minPremiumThreshold: threshold,
    tradesFiltered: excluded.length,
    trades: s.pricedTrades,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate,
    grossPnl: s.grossPnl,
    totalCosts: s.totalCosts,
    netPnl: s.netPnl,
    profitFactor: s.profitFactor,
    expectancyPerTrade: s.expectancyPerTrade,
  };
}

// ---------------------------------------------------------------------------
// Day-cluster analysis
// ---------------------------------------------------------------------------

function dayCluster(trades: DiagTrade[]): DiagDayCluster[] {
  const map = new Map<string, DiagTrade[]>();
  for (const t of trades) {
    const date = entryDateIST(t.entryAt);
    if (!date) continue;
    const key = `${t.indexSymbol}::${date}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return [...map.entries()].map(([key, ts]) => {
    const [underlying, date] = key.split("::");
    return { underlying: underlying!, date: date!, ...computeStats(ts) };
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface DiagnosticsRunMeta {
  runId: string;
  backtestMode: string | null;
  fromDate: string | null;
  toDate: string | null;
  instrument: string;
}

export function computeDiagnostics(
  meta: DiagnosticsRunMeta,
  trades: DiagTrade[],
): FnoReplayDiagnosticsOut {
  const withDte = enrichDte(trades);

  const byUnderlying = groupByKey(trades, (t) => t.indexSymbol, (k) => k);

  // Setup groups — key by underlying + setupKey
  const setupMap = new Map<string, DiagTrade[]>();
  for (const t of trades) {
    const k = `${t.indexSymbol}::${t.setupKey ?? "UNKNOWN"}::${t.direction}`;
    if (!setupMap.has(k)) setupMap.set(k, []);
    setupMap.get(k)!.push(t);
  }
  const bySetup: DiagSetupGroup[] = [...setupMap.entries()].map(([k, ts]) => {
    const [underlying, setupKey, dir] = k.split("::");
    return {
      key: k,
      label: `${underlying} ${setupKey} ${dir}`,
      underlying: underlying!,
      direction: dir ?? null,
      optionType: ts[0]?.optionType ?? null,
      ...computeStats(ts),
    };
  });

  const byDirection = groupByKey(trades, (t) => t.direction, (k) => k);
  const byOptionType = groupByKey(trades, (t) => t.optionType ?? "UNKNOWN", (k) => k);
  const byExitReason = groupByKey(trades, (t) => t.exitReason ?? "UNKNOWN", (k) => k);

  const byTimeOfDay = groupByKey(
    trades,
    (t) => timeOfDayBucket(t.entryAt),
    (k) => k,
    (a, b) => TOD_ORDER.indexOf(a) - TOD_ORDER.indexOf(b),
  );

  const byDayOfWeek = groupByKey(
    trades,
    (t) => {
      const d = entryDayIST(t.entryAt);
      return d !== null ? String(d) : null;
    },
    (k) => DAY_LABELS[Number(k)] ?? k,
    (a, b) => Number(a) - Number(b),
  );

  const byExpiryDistance = groupByKey(
    withDte,
    (t) => expiryDistanceBucket((t as DiagTrade & { dte: number | null }).dte),
    (k) => k,
    (a, b) => EXPIRY_ORDER.indexOf(a) - EXPIRY_ORDER.indexOf(b),
  );

  const byPremiumBucket = groupByKey(
    trades,
    (t) => premiumBucket(t.optionEntry),
    (k) => k,
  );

  const byCostBucket = groupByKey(
    trades,
    (t) => costBucket(t.totalCosts),
    (k) => k,
  );

  const bySnapshotAvailability = groupByKey(
    trades,
    (t) => t.pricingMode ?? "UNKNOWN",
    (k) => k,
  );

  // Day clusters
  const clusters = dayCluster(trades);
  const worstLossClusters = clusters
    .filter((c) => c.pricedTrades > 0)
    .sort((a, b) => a.netPnl - b.netPnl)
    .slice(0, 10);
  const bestProfitClusters = clusters
    .filter((c) => c.pricedTrades > 0)
    .sort((a, b) => b.netPnl - a.netPnl)
    .slice(0, 10);

  const reentryClusters = detectReentryClusters(trades);

  // Unavailability analysis
  const reasons = unavailableReasons(trades);
  const unavailByUnderlying = groupByKey(
    trades.filter((t) => !isPriced(t)),
    (t) => t.indexSymbol,
    (k) => k,
  );
  const unavailByDateMap = new Map<string, number>();
  for (const t of trades.filter((t) => !isPriced(t))) {
    const d = entryDateIST(t.entryAt);
    if (!d) continue;
    const k = `${t.indexSymbol}::${d}`;
    unavailByDateMap.set(k, (unavailByDateMap.get(k) ?? 0) + 1);
  }
  const unavailableByDate = [...unavailByDateMap.entries()]
    .map(([k, count]) => {
      const [underlying, date] = k.split("::");
      return { underlying: underlying!, date: date!, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Simulation recommendations
  const premiumThresholds = [75, 100, 125, 150, 200];
  const premiumSimResults = premiumThresholds.map((th) =>
    minPremiumSimulation(trades, th),
  );
  // Find the threshold that turns net positive (or the best performing)
  const bestThreshold = premiumSimResults.reduce((best, cur) =>
    cur.netPnl > best.netPnl ? cur : best,
  );

  // No-reentry simulation across all trades
  const noReentryTrades = trades.filter((t) => {
    const cluster = reentryClusters.find(
      (c) =>
        c.underlying === t.indexSymbol &&
        c.strike === t.strike &&
        c.direction === t.direction &&
        entryDateIST(t.entryAt) === c.date,
    );
    if (!cluster) return true;
    // Keep only the first trade in each re-entry cluster
    const sortedGroup = trades
      .filter(
        (x) =>
          x.indexSymbol === t.indexSymbol &&
          x.strike === t.strike &&
          x.direction === t.direction &&
          entryDateIST(x.entryAt) === cluster.date,
      )
      .sort((a, b) => safeMs(a.entryAt) - safeMs(b.entryAt));
    return sortedGroup[0]?.id === t.id;
  });

  const simulationOnlyRecommendations: FnoReplayDiagnosticsOut["simulationOnlyRecommendations"] = [
    {
      tag: "SIMULATION_ONLY",
      label: "Minimum Entry Premium Filter",
      description:
        "Simulate excluding trades where entry premium is below threshold. " +
        "Goal: confirm whether low-premium trades (high cost-drag ratio) are causing net losses.",
      value: `SIMULATION_ONLY_MIN_ENTRY_PREMIUM = ₹${bestThreshold.minPremiumThreshold}`,
      results: premiumSimResults,
    },
    {
      tag: "SIMULATION_ONLY",
      label: "No Same-Strike Same-Day Re-entry",
      description:
        "Simulate skipping re-entries after a stop on the same underlying/strike/direction on the same day. " +
        `Affected clusters: ${reentryClusters.length}.`,
      value:
        reentryClusters.length > 0
          ? `SIMULATION_ONLY_NO_REENTRY_AFTER_STOP`
          : "No re-entry clusters found",
      results: reentryClusters.length > 0
        ? [toSimResult("SIMULATION_ONLY_NO_REENTRY_AFTER_STOP", noReentryTrades)]
        : [],
    },
    {
      tag: "SIMULATION_ONLY",
      label: "Exclude Jun 11–17 Cluster from SENSEX",
      description:
        "SENSEX had 5 consecutive losses Jun 11–17 (reversal cluster). " +
        "Simulation shows SENSEX performance if that week is excluded.",
      value: "SENSEX_EXCLUDING_JUN_11_TO_JUN_17",
      results: [toSimResult("SENSEX_EXCLUDING_JUN_11_TO_JUN_17",
        trades.filter((t) => {
          if (t.indexSymbol !== "SENSEX") return true;
          const d = entryDateIST(t.entryAt);
          if (!d) return true;
          return d < "2026-06-11" || d > "2026-06-17";
        }),
      )],
    },
  ];

  return {
    runId: meta.runId,
    backtestMode: meta.backtestMode,
    fromDate: meta.fromDate,
    toDate: meta.toDate,
    instrument: meta.instrument,
    generatedAt: new Date().toISOString(),

    byUnderlying,
    bySetup,
    byDirection,
    byOptionType,
    byExitReason,
    byTimeOfDay,
    byDayOfWeek,
    byExpiryDistance,
    byPremiumBucket,
    byCostBucket,
    bySnapshotAvailability,

    worstLossClusters,
    bestProfitClusters,

    reentryClusters,

    sensexAudit: sensexAudit(trades),
    bankniftyAudit: bankniftyAudit(trades),

    unavailableReasons: reasons,
    unavailableByUnderlying: unavailByUnderlying,
    unavailableByDate,

    simulationOnlyRecommendations,
  };
}
