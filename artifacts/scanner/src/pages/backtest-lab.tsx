/**
 * Backtest Lab — F&O research (owner OR subscriber, tab-gated).
 *
 * Three honest Backtest Modes (V2):
 *   - OFFICIAL_ENGINE: the existing engine replay. Two sub-modes:
 *       · REAL_REPLAY — 100% real captured signals + outcomes (no fabrication;
 *         signals with no captured option exit are EXCLUDED from P&L).
 *       · DIRECTIONAL — directional layer on real 15-min SPOT candles; option P&L
 *         via a clearly-LABELED delta proxy (premiums left blank).
 *   - STRATEGY_RESEARCH: generic strategy registry on the same real spot candles,
 *     with confirmation-filter toggles + a MULTI-FACTOR comparison/ranking board.
 *   - COMPARE_OFFICIAL_VS_STRATEGIES: the Official Engine alongside the selected
 *     strategies on identical candles.
 *
 * Hard rules honoured in the UI: no fake/synthetic option data; option/spread/volume
 * confirmation filters are AUTO-DISABLED (no historical option data) and shown as
 * such; every modeled field is flagged; honest "unavailable"/loading/empty states;
 * never a fabricated number where the source is missing.
 */
import { useMemo, useState } from "react";
import {
  useListBacktestRuns,
  useCreateBacktestRun,
  useGetBacktestRun,
  useGetBacktestRunTrades,
  useGetBacktestRunBlocked,
  useGetBacktestSnapshotCoverage,
  useGetBacktestStrategies,
  useDeleteBacktestRun,
  getGetBacktestRunQueryKey,
  getGetBacktestRunTradesQueryKey,
  getGetBacktestRunBlockedQueryKey,
} from "@workspace/api-client-react";
import type {
  BacktestRunRequestMode,
  BacktestRunRequestInstrument,
  BacktestRunRequestBacktestMode,
  BacktestSummary,
  BacktestTrade,
  BacktestDataQuality,
  BacktestBlockedSetup,
  BacktestFilterConfig,
  BacktestStrategyMeta,
  BacktestStrategyComparison,
  BacktestStrategyAggregate,
  BacktestRankingCard,
} from "@workspace/api-client-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FlaskConical,
  Play,
  Download,
  Trash2,
  AlertTriangle,
  Info,
  RefreshCw,
  Trophy,
  Layers,
  Filter,
} from "lucide-react";
import {
  computeDominantBlocker,
  isLikelyOverFiltered,
  relaxFilters,
  type DominantBlocker,
} from "@/lib/backtestBlockers";

// ───────────── formatting (honest: never fabricate a number) ─────────────

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${inr0.format(Math.abs(n))}`;
}

function num(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}%`;
}

function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return (
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(ms)) + " IST"
    );
  } catch {
    return iso;
  }
}

// ───────── Session-validity audit (NSE regular session 09:15–15:30 IST) ─────────
const SESSION_OPEN_MIN = 9 * 60 + 15;
const SESSION_CLOSE_MIN = 15 * 60 + 30;

/** IST minute-of-day for a TRUE-UTC ISO instant, or null when unparseable. */
function istMinuteFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const hh = Number(parts.find((p) => p.type === "hour")?.value);
    const mm = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return (hh % 24) * 60 + mm;
  } catch {
    return null;
  }
}

/** True when an emitted timestamp falls inside the NSE regular session. */
function isSessionValidIso(iso: string | null | undefined): boolean {
  const m = istMinuteFromIso(iso);
  if (m == null) return false;
  return m >= SESSION_OPEN_MIN && m <= SESSION_CLOSE_MIN;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}

// ───────────── mode metadata ─────────────

const BACKTEST_MODES: {
  key: BacktestRunRequestBacktestMode;
  label: string;
  blurb: string;
}[] = [
  {
    key: "OFFICIAL_ENGINE",
    label: "Official F&O Engine",
    blurb: "Replay the production engine — real captured signals, or the directional layer.",
  },
  {
    key: "STRATEGY_RESEARCH",
    label: "Strategy Research",
    blurb: "Run generic strategies on real spot candles with confirmation-filter toggles.",
  },
  {
    key: "COMPARE_OFFICIAL_VS_STRATEGIES",
    label: "Compare",
    blurb: "Official Engine side-by-side with the selected strategies on identical candles.",
  },
];

const OFFICIAL_SUBMODES: { key: BacktestRunRequestMode; label: string; blurb: string }[] = [
  {
    key: "REAL_REPLAY",
    label: "Real Replay",
    blurb:
      "100% real — replays the engine's actually-captured signals & outcomes. Window grows daily.",
  },
  {
    key: "DIRECTIONAL",
    label: "Directional (2yr)",
    blurb:
      "Directional layer on real 15-min SPOT candles. Option P&L via a labeled delta proxy — premiums left blank.",
  },
];

const INSTRUMENTS: BacktestRunRequestInstrument[] = ["ALL", "NIFTY", "BANKNIFTY", "SENSEX"];

// Filter toggles that depend on option/spread/volume history we do NOT have — always
// auto-disabled and shown as such (never silently applied).
const AUTO_DISABLED_FILTERS: (keyof BacktestFilterConfig)[] = [
  "optionChainConfirmation",
  "avoidWideSpread",
  "avoidLowVolume",
];

const FILTER_LABELS: Record<keyof BacktestFilterConfig, string> = {
  vwapFilter: "VWAP Filter",
  emaTrendFilter: "EMA Trend Filter",
  optionChainConfirmation: "Option Chain Confirmation",
  avoidChopZone: "Avoid Chop Zone",
  avoidLast15Minutes: "Avoid Last 15 Minutes",
  avoidWideSpread: "Avoid Wide Spread Options",
  avoidLowVolume: "Avoid Low Volume Options",
  minimumRiskReward: "Minimum Risk:Reward",
};

const DEFAULT_FILTERS: Required<BacktestFilterConfig> = {
  vwapFilter: true,
  emaTrendFilter: true,
  optionChainConfirmation: false,
  avoidChopZone: true,
  avoidLast15Minutes: true,
  avoidWideSpread: false,
  avoidLowVolume: false,
  minimumRiskReward: 1.5,
};

const OFFICIAL_STRATEGY_ID = "OFFICIAL_ENGINE";

// Compact abbreviations for the user-configurable confirmation toggles, used in the
// runs-list per-row filter summary (auto-disabled option/spread/volume filters are
// excluded — they never apply in a backtest).
const FILTER_ABBR: Partial<Record<keyof BacktestFilterConfig, string>> = {
  vwapFilter: "VWAP",
  emaTrendFilter: "EMA",
  avoidChopZone: "Chop",
  avoidLast15Minutes: "Last15",
};

// Build a compact, honest summary of how a saved run was configured. Official-engine
// runs persist null filters (engine replay) and are labelled as such rather than
// fabricating defaults.
function summarizeRunFilters(
  filters: BacktestFilterConfig | null | undefined,
  maxTradesPerDay: number | null | undefined,
): { short: string; full: string } {
  if (!filters) {
    return {
      short: "engine replay",
      full: "Engine replay — this run used the official engine, not custom confirmation filters.",
    };
  }
  const merged: Required<BacktestFilterConfig> = { ...DEFAULT_FILTERS, ...filters };
  const abbrKeys = Object.keys(FILTER_ABBR) as (keyof BacktestFilterConfig)[];
  const on = abbrKeys.filter((k) => Boolean(merged[k]));
  const parts: string[] = [];
  parts.push(on.length > 0 ? on.map((k) => FILTER_ABBR[k]).join("·") : "no filters");
  parts.push(`R:R ${num(merged.minimumRiskReward)}`);
  if (typeof maxTradesPerDay === "number") parts.push(`≤${maxTradesPerDay}/day`);
  const short = parts.join(" · ");

  const fullLines = abbrKeys.map((k) => `${FILTER_LABELS[k]}: ${merged[k] ? "on" : "off"}`);
  fullLines.push(`${FILTER_LABELS.minimumRiskReward}: ${num(merged.minimumRiskReward)}`);
  if (typeof maxTradesPerDay === "number") fullLines.push(`Max trades/day: ${maxTradesPerDay}`);
  fullLines.push(
    `Auto-disabled (no historical data): ${AUTO_DISABLED_FILTERS.map((k) => FILTER_LABELS[k]).join(", ")}`,
  );
  return { short, full: fullLines.join("\n") };
}

// ───────────── small presentational helpers ─────────────

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "muted";
  hint?: string;
}) {
  const color =
    tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function toneFor(n: number | null | undefined): "pos" | "neg" | "muted" {
  if (n == null || !Number.isFinite(n)) return "muted";
  return n > 0 ? "pos" : n < 0 ? "neg" : "muted";
}

// Official-engine trades use BULLISH/BEARISH; strategy trades use LONG/SHORT.
function isBullishDirection(direction: string | null | undefined): boolean {
  const d = (direction ?? "").toUpperCase();
  return d === "BULLISH" || d === "BULL" || d === "LONG";
}

// ───────────── CSV export (client-side, honest — blanks stay blank) ─────────────

function buildTradesCsv(trades: BacktestTrade[]): string {
  const cols = [
    "indexSymbol",
    "strategyName",
    "signalSource",
    "setupKey",
    "direction",
    "optionType",
    "strike",
    "entryAt",
    "exitAt",
    "entrySpot",
    "exitSpot",
    "optionEntry",
    "optionExit",
    "lots",
    "lotSize",
    "qty",
    "pnl",
    "exitReason",
    "confidence",
    "tier",
    "regime",
    "modeled",
  ] as const;
  const esc = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const rows = trades.map((t) =>
    cols.map((c) => esc((t as unknown as Record<string, unknown>)[c])).join(","),
  );
  return [head, ...rows].join("\n");
}

// ───────────── panels ─────────────

const equityConfig = {
  equity: { label: "Equity", color: "hsl(199 89% 60%)" },
} satisfies ChartConfig;

function EquityCurve({ summary }: { summary: BacktestSummary }) {
  const pts = (summary.equityCurve ?? []).map((p, i) => ({
    i,
    t: p.t,
    equity: p.equity,
  }));
  if (pts.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        Not enough decided trades to plot an equity curve.
      </div>
    );
  }
  return (
    <ChartContainer config={equityConfig} className="h-[220px] w-full">
      <AreaChart data={pts} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis dataKey="i" tickLine={false} axisLine={false} tick={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v) => inr0.format(Number(v))}
          tick={{ fontSize: 10 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_l, p) => shortDateTime(p?.[0]?.payload?.t)}
              formatter={(v) => money(Number(v))}
            />
          }
        />
        <Area
          dataKey="equity"
          type="monotone"
          stroke="var(--color-equity)"
          fill="var(--color-equity)"
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

const distConfig = {
  count: { label: "Trades", color: "hsl(199 89% 60%)" },
} satisfies ChartConfig;

function PnlDistribution({ trades }: { trades: BacktestTrade[] }) {
  const decided = trades.map((t) => t.pnl).filter((n): n is number => n != null && Number.isFinite(n));
  const bins = useMemo(() => {
    if (decided.length === 0) return [];
    const min = Math.min(...decided);
    const max = Math.max(...decided);
    if (min === max) return [{ label: money(min), count: decided.length }];
    const N = 9;
    const w = (max - min) / N;
    const arr = Array.from({ length: N }, (_, i) => ({
      lo: min + i * w,
      hi: min + (i + 1) * w,
      count: 0,
    }));
    for (const v of decided) {
      let idx = Math.floor((v - min) / w);
      if (idx >= N) idx = N - 1;
      if (idx < 0) idx = 0;
      arr[idx]!.count += 1;
    }
    return arr.map((b) => ({ label: inr0.format(Math.round((b.lo + b.hi) / 2)), count: b.count }));
  }, [decided]);

  if (bins.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        No decided trades to chart (P&L distribution needs captured outcomes).
      </div>
    );
  }
  return (
    <ChartContainer config={distConfig} className="h-[220px] w-full">
      <BarChart data={bins} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} interval={0} angle={-30} height={40} textAnchor="end" />
        <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} tick={{ fontSize: 10 }} />
        <ReferenceLine x={0} stroke="hsl(351 95% 71%)" />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function DataQualityPanel({ dq }: { dq: BacktestDataQuality }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Info className="h-4 w-4 text-amber-400" />
          Data quality &amp; honesty
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex flex-wrap gap-2">
          <Badge ok={dq.optionDataAvailable} label="Real option P&L" offLabel="Option P&L unavailable" />
          <Badge ok={dq.ivAvailable} label="IV history" offLabel="IV unavailable" />
          <Badge ok={dq.oiAvailable} label="OI history" offLabel="OI unavailable" />
        </div>

        {dq.candleCoverage && (
          <div className="text-muted-foreground">
            Candle coverage:{" "}
            <span className="text-foreground">
              {shortDate(dq.candleCoverage.from)} → {shortDate(dq.candleCoverage.to)}
            </span>{" "}
            ({dq.candleCoverage.count.toLocaleString("en-IN")} bars)
          </div>
        )}

        {dq.modeledFields.length > 0 && (
          <div>
            <div className="font-medium text-amber-300">Modeled (NOT real) fields:</div>
            <ul className="ml-4 list-disc text-muted-foreground">
              {dq.modeledFields.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {dq.warnings.length > 0 && (
          <div>
            <div className="font-medium text-foreground">Notes:</div>
            <ul className="ml-4 list-disc text-muted-foreground">
              {dq.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {dq.snapshotCoverage && (
          <div className="rounded-md border border-border bg-card/60 p-2">
            <div className="font-medium text-foreground">
              Option-chain snapshot coverage (Mode D capture)
            </div>
            <div className="mt-1 text-muted-foreground">
              {dq.snapshotCoverage.count > 0 ? (
                <>
                  {dq.snapshotCoverage.count.toLocaleString("en-IN")} snapshots ·{" "}
                  {shortDate(dq.snapshotCoverage.earliest)} → {shortDate(dq.snapshotCoverage.latest)}
                  {dq.snapshotCoverage.underlyings.length > 0 && (
                    <> · {dq.snapshotCoverage.underlyings.join(", ")}</>
                  )}
                </>
              ) : (
                "No option-chain snapshots captured yet — a faithful 2yr option replay accrues as the prod ingestor runs."
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Badge({ ok, label, offLabel }: { ok: boolean; label: string; offLabel: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        ok ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? label : offLabel}
    </span>
  );
}

// ───────────── strategy picker ─────────────

function StrategyPicker({
  strategies,
  selected,
  onToggle,
  loading,
  error,
}: {
  strategies: BacktestStrategyMeta[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">Loading strategy catalog…</div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
        Strategy catalog unavailable — cannot run a strategy backtest right now.
      </div>
    );
  }
  if (strategies.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        No strategies registered.
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {strategies.map((s) => {
        const on = selected.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            className={`rounded-lg border p-2.5 text-left text-xs transition ${
              on ? "border-sky-400 bg-sky-500/10" : "border-border hover:border-sky-400/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{s.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${
                  s.riskLevel === "HIGH"
                    ? "bg-rose-500/15 text-rose-300"
                    : s.riskLevel === "LOW"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {s.riskLevel}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{s.description}</div>
            <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] text-muted-foreground">
              <span className="rounded bg-muted px-1 py-0.5">{s.category}</span>
              <span className="rounded bg-muted px-1 py-0.5" title="Best market condition">
                {s.bestCondition}
              </span>
            </div>
            {(s.suitableIndices.length > 0 || s.recommendedTimeframes.length > 0) && (
              <div className="mt-1 space-y-0.5 text-[9px] text-muted-foreground">
                {s.suitableIndices.length > 0 && (
                  <div title="Indices this strategy suits best">
                    <span className="text-muted-foreground/70">Indices: </span>
                    {s.suitableIndices.join(", ")}
                  </div>
                )}
                {s.recommendedTimeframes.length > 0 && (
                  <div title="Recommended timeframes (only 15m has real candles in this environment)">
                    <span className="text-muted-foreground/70">TFs: </span>
                    {s.recommendedTimeframes.join(", ")}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ───────────── advanced per-strategy params ─────────────

function AdvancedParamsPanel({
  strategies,
  selected,
  overrides,
  onChange,
}: {
  strategies: BacktestStrategyMeta[];
  selected: Set<string>;
  overrides: Record<string, Record<string, number>>;
  onChange: (next: Record<string, Record<string, number>>) => void;
}) {
  const chosen = strategies.filter((s) => selected.has(s.id) && s.id !== OFFICIAL_STRATEGY_ID);
  const withParams = chosen.filter((s) => Object.keys(s.defaultParams ?? {}).length > 0);
  if (withParams.length === 0) return null;

  function setParam(stratId: string, key: string, raw: string, fallback: number) {
    const val = raw.trim() === "" ? fallback : Number(raw);
    const safe = Number.isFinite(val) ? val : fallback;
    const nextStrat = { ...(overrides[stratId] ?? {}), [key]: safe };
    onChange({ ...overrides, [stratId]: nextStrat });
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Advanced params (selected strategies)
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {withParams.map((s) => {
          const defaults = s.defaultParams ?? {};
          const ov = overrides[s.id] ?? {};
          return (
            <div key={s.id} className="rounded-lg border border-border bg-card/40 p-2.5">
              <div className="mb-1.5 text-xs font-semibold">{s.name}</div>
              <div className="space-y-1.5">
                {Object.entries(defaults).map(([key, def]) => {
                  const cur = ov[key] ?? (def as number);
                  return (
                    <label key={key} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-muted-foreground" title={`Default ${def}`}>
                        {key}
                      </span>
                      <input
                        type="number"
                        value={cur}
                        step={0.25}
                        onChange={(e) => setParam(s.id, key, e.target.value, def as number)}
                        className="w-20 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── confirmation-filter toggles ─────────────

function FilterToggles({
  filters,
  onChange,
}: {
  filters: Required<BacktestFilterConfig>;
  onChange: (next: Required<BacktestFilterConfig>) => void;
}) {
  const boolKeys: (keyof BacktestFilterConfig)[] = [
    "vwapFilter",
    "emaTrendFilter",
    "avoidChopZone",
    "avoidLast15Minutes",
  ];
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Confirmation filters
      </div>
      <div className="flex flex-wrap gap-2">
        {boolKeys.map((k) => {
          const on = Boolean(filters[k]);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ ...filters, [k]: !on })}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                on ? "border-sky-400 bg-sky-500/10 text-foreground" : "border-border text-muted-foreground"
              }`}
            >
              {FILTER_LABELS[k]} {on ? "✓" : "✗"}
            </button>
          );
        })}
        <label className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px]">
          <span className="text-muted-foreground">Min R:R</span>
          <input
            type="number"
            value={filters.minimumRiskReward}
            min={0}
            step={0.25}
            onChange={(e) =>
              onChange({ ...filters, minimumRiskReward: Math.max(0, Number(e.target.value)) })
            }
            className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
            title="Minimum reward:risk multiple; 0 disables this filter"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {AUTO_DISABLED_FILTERS.map((k) => (
          <span
            key={k}
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
            title="Auto-disabled — no historical option-chain/spread/volume data exists. Never silently applied."
          >
            {FILTER_LABELS[k]} — auto-disabled
          </span>
        ))}
      </div>
    </div>
  );
}

// ───────────── read-only "filters used" summary for a saved run ─────────────

function RunFiltersUsed({
  filters,
  maxTradesPerDay,
}: {
  filters: BacktestFilterConfig | null | undefined;
  maxTradesPerDay: number | null | undefined;
}) {
  // Official-engine runs persist null filters — they replay the engine, not custom
  // confirmation filters. Be honest rather than fabricating defaults.
  if (!filters) {
    return (
      <div className="rounded-lg border border-border bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="text-[10px] uppercase tracking-wide">Filters used</span>{" "}
        — n/a · engine replay (this run used the official engine, not custom confirmation filters).
      </div>
    );
  }

  const merged: Required<BacktestFilterConfig> = { ...DEFAULT_FILTERS, ...filters };
  const boolKeys: (keyof BacktestFilterConfig)[] = [
    "vwapFilter",
    "emaTrendFilter",
    "avoidChopZone",
    "avoidLast15Minutes",
  ];

  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Filters used for this run
      </div>
      <div className="flex flex-wrap gap-1.5">
        {boolKeys.map((k) => {
          const on = Boolean(merged[k]);
          return (
            <span
              key={k}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                on
                  ? "border-sky-400/60 bg-sky-500/10 text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {FILTER_LABELS[k]} {on ? "✓" : "✗"}
            </span>
          );
        })}
        <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground tabular-nums">
          {FILTER_LABELS.minimumRiskReward}: {num(merged.minimumRiskReward)}
        </span>
        {typeof maxTradesPerDay === "number" && (
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground tabular-nums">
            Max trades/day: {maxTradesPerDay}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {AUTO_DISABLED_FILTERS.map((k) => (
          <span
            key={k}
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
            title="Auto-disabled — no historical option-chain/spread/volume data exists. Never silently applied."
          >
            {FILTER_LABELS[k]} — auto-disabled
          </span>
        ))}
      </div>
    </div>
  );
}

// ───────────── multi-factor comparison / ranking dashboard ─────────────

const RANK_TONE: Record<string, string> = {
  BEST_OVERALL: "border-emerald-500/40 bg-emerald-500/10",
  HIGHEST_WIN_RATE: "border-sky-500/40 bg-sky-500/10",
  BEST_PROFIT_FACTOR: "border-violet-500/40 bg-violet-500/10",
  LOWEST_DRAWDOWN: "border-amber-500/40 bg-amber-500/10",
  MOST_CONSISTENT: "border-teal-500/40 bg-teal-500/10",
  MOST_STABLE: "border-teal-500/40 bg-teal-500/10",
  BEST_TIMEFRAME: "border-indigo-500/40 bg-indigo-500/10",
  WORST_TIMEFRAME: "border-rose-500/40 bg-rose-500/10",
};

function RankingCards({ cards }: { cards: BacktestRankingCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`rounded-lg border p-2.5 ${RANK_TONE[c.key] ?? "border-border bg-card/60"}`}
        >
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Trophy className="h-3 w-3" />
            {c.label}
          </div>
          <div className="mt-1 truncate text-sm font-semibold" title={c.strategyName ?? undefined}>
            {c.strategyName ?? "n/a"}
          </div>
          {c.value && <div className="text-xs tabular-nums text-muted-foreground">{c.value}</div>}
          {c.note && <div className="mt-0.5 text-[10px] text-muted-foreground">{c.note}</div>}
        </div>
      ))}
    </div>
  );
}

function AggregateTable({ rows }: { rows: BacktestStrategyAggregate[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        No strategy results to aggregate.
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Strategy</th>
            <th className="px-2 py-1.5 text-right font-medium">Score</th>
            <th className="px-2 py-1.5 text-right font-medium">Trades</th>
            <th className="px-2 py-1.5 text-right font-medium">Win%</th>
            <th className="px-2 py-1.5 text-right font-medium">Net P&L</th>
            <th className="px-2 py-1.5 text-right font-medium">PF</th>
            <th className="px-2 py-1.5 text-right font-medium">Avg R</th>
            <th
              className="px-2 py-1.5 text-right font-medium"
              title="Consistency = mean per-trade net ÷ stdev (higher = steadier). n/a with <2 trades."
            >
              Cons.
            </th>
            <th
              className="px-2 py-1.5 text-right font-medium"
              title="Data quality = executed ÷ (executed + data-blocked) opportunities. n/a with no opportunities."
            >
              Data
            </th>
            <th className="px-2 py-1.5 text-right font-medium">Max DD</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.strategyId}
              className={`border-t border-border/60 hover:bg-muted/30 ${
                r.strategyId === OFFICIAL_STRATEGY_ID ? "bg-sky-500/5" : ""
              }`}
            >
              <td className="px-2 py-1.5">
                {r.strategyName}
                {r.strategyId === OFFICIAL_STRATEGY_ID && (
                  <span className="ml-1 rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">engine</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.compositeScore == null ? (
                  <span
                    className="text-muted-foreground"
                    title={r.eligible ? "Score unavailable" : "Too few trades to rank fairly"}
                  >
                    n/a
                  </span>
                ) : (
                  <span className="font-semibold">{num(r.compositeScore, 0)}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.totalTrades}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.winRate)}</td>
              <td
                className={`px-2 py-1.5 text-right tabular-nums ${
                  toneFor(r.netPnl) === "pos" ? "text-emerald-400" : toneFor(r.netPnl) === "neg" ? "text-rose-400" : ""
                }`}
              >
                {money(r.netPnl)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{num(r.profitFactor)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{num(r.avgR)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.consistency == null ? (
                  <span className="text-muted-foreground" title="Need ≥2 trades">n/a</span>
                ) : (
                  num(r.consistency)
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.dataQuality == null ? (
                  <span className="text-muted-foreground" title="No opportunities recorded">n/a</span>
                ) : (
                  pct(r.dataQuality)
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-rose-400">{money(r.maxDrawdown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonRowsTable({ comparison }: { comparison: BacktestStrategyComparison }) {
  if (comparison.rows.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        No per-(strategy × index) rows to show.
      </div>
    );
  }
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Strategy</th>
            <th className="px-2 py-1.5 font-medium">Idx</th>
            <th className="px-2 py-1.5 text-right font-medium">Trades</th>
            <th className="px-2 py-1.5 text-right font-medium">Win%</th>
            <th className="px-2 py-1.5 text-right font-medium">Gross</th>
            <th className="px-2 py-1.5 text-right font-medium">Charges</th>
            <th className="px-2 py-1.5 text-right font-medium">Slippage</th>
            <th className="px-2 py-1.5 text-right font-medium">Net</th>
            <th className="px-2 py-1.5 text-right font-medium">PF</th>
            <th className="px-2 py-1.5 text-right font-medium">Avg R</th>
            <th className="px-2 py-1.5 text-right font-medium">Max DD</th>
            <th className="px-2 py-1.5 text-right font-medium" title="Target1 / Target2 / Stop / Time exits">
              T1/T2/SL/T
            </th>
            <th className="px-2 py-1.5 text-right font-medium" title="Filter-rejected / data-blocked / risk-blocked">
              Rej/Data/Risk
            </th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((r, i) => (
            <tr key={`${r.strategyId}-${r.indexSymbol}-${i}`} className="border-t border-border/60 hover:bg-muted/30">
              <td className="px-2 py-1.5">{r.strategyName}</td>
              <td className="px-2 py-1.5">{r.indexSymbol}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.totalTrades}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.winRate)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(r.grossPnl)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                {r.charges ? money(-r.charges) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                {r.slippage ? money(-r.slippage) : "—"}
              </td>
              <td
                className={`px-2 py-1.5 text-right tabular-nums font-medium ${
                  toneFor(r.netPnl) === "pos" ? "text-emerald-400" : toneFor(r.netPnl) === "neg" ? "text-rose-400" : ""
                }`}
              >
                {money(r.netPnl)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{num(r.profitFactor)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{num(r.avgR)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-rose-400">{money(r.maxDrawdown)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                {r.target1HitCount}/{r.target2HitCount}/{r.slHitCount}/{r.timeExitCount}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                {r.rejectedSetupCount}/{r.dataBlockedCount}/{r.riskBlockedCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonDashboard({ comparison }: { comparison: BacktestStrategyComparison }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Trophy className="h-4 w-4 text-amber-300" />
            Multi-factor ranking
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <RankingCards cards={comparison.ranking} />
          <p className="text-[10px] text-muted-foreground">
            Ranking is multi-factor (composite of net P&amp;L, profit factor, win-rate,
            expectancy/avg-R, drawdown, consistency, and data quality) — never net-profit alone.
            Strategies with too few trades are not ranked.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-sky-300" />
            Per-strategy comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AggregateTable rows={comparison.byStrategy} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Breakdown by strategy × index</CardTitle>
        </CardHeader>
        <CardContent>
          <ComparisonRowsTable comparison={comparison} />
        </CardContent>
      </Card>

      {comparison.notes.length > 0 && (
        <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Comparison notes</div>
          <ul className="ml-4 list-disc">
            {comparison.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ───────────── trades / blocked tables (with attribution) ─────────────

function TradesTable({ trades, showAttribution }: { trades: BacktestTrade[]; showAttribution: boolean }) {
  if (trades.length === 0) {
    return <div className="py-8 text-center text-xs text-muted-foreground">No trades in this run.</div>;
  }
  const offSession = trades.filter(
    (t) => !isSessionValidIso(t.entryAt) || !isSessionValidIso(t.exitAt),
  );
  const allValid = offSession.length === 0;
  return (
    <div className="space-y-2">
      <div
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
          allValid
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-rose-500/40 bg-rose-500/10 text-rose-300"
        }`}
      >
        <span className="font-medium">Session validity audit</span>
        <span className="text-muted-foreground">·</span>
        {allValid ? (
          <span>
            All {trades.length} trades fall within NSE regular hours (09:15–15:30 IST).
          </span>
        ) : (
          <span>
            {offSession.length} of {trades.length} trades have an entry/exit OUTSIDE 09:15–15:30 IST — flagged below.
          </span>
        )}
      </div>
      <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Idx</th>
            {showAttribution && <th className="px-2 py-1.5 font-medium">Strategy</th>}
            {showAttribution && <th className="px-2 py-1.5 font-medium">Src</th>}
            <th className="px-2 py-1.5 font-medium">Setup</th>
            <th className="px-2 py-1.5 font-medium">Dir</th>
            <th className="px-2 py-1.5 font-medium">Strike</th>
            <th className="px-2 py-1.5 font-medium">Entry</th>
            <th className="px-2 py-1.5 font-medium">Exit</th>
            <th className="px-2 py-1.5 text-right font-medium">Opt In</th>
            <th className="px-2 py-1.5 text-right font-medium">Opt Out</th>
            <th className="px-2 py-1.5 text-right font-medium">Qty</th>
            <th className="px-2 py-1.5 text-right font-medium">P&L</th>
            <th className="px-2 py-1.5 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-border/60 hover:bg-muted/30">
              <td className="px-2 py-1.5">{t.indexSymbol}</td>
              {showAttribution && (
                <td className="px-2 py-1.5">
                  <span title={t.strategyCategory ?? undefined}>{t.strategyName ?? "—"}</span>
                </td>
              )}
              {showAttribution && (
                <td className="px-2 py-1.5">
                  <span
                    className={`rounded px-1 text-[9px] ${
                      t.signalSource === "ENGINE"
                        ? "bg-sky-500/15 text-sky-300"
                        : t.signalSource === "STRATEGY"
                          ? "bg-violet-500/15 text-violet-300"
                          : "text-muted-foreground"
                    }`}
                  >
                    {t.signalSource ?? "—"}
                  </span>
                </td>
              )}
              <td className="px-2 py-1.5">
                <span title={t.setupName ?? undefined}>{t.setupKey ?? "—"}</span>
                {t.modeled && (
                  <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300" title="Delta-proxy fill — modeled, not a real option price">
                    modeled
                  </span>
                )}
              </td>
              <td className={`px-2 py-1.5 ${isBullishDirection(t.direction) ? "text-emerald-400" : "text-rose-400"}`}>
                {t.optionType ?? (isBullishDirection(t.direction) ? "CE" : "PE")}
              </td>
              <td className="px-2 py-1.5 tabular-nums">{t.strike ?? "—"}</td>
              <td className={`px-2 py-1.5 whitespace-nowrap ${isSessionValidIso(t.entryAt) ? "" : "text-rose-400"}`}>
                {shortDateTime(t.entryAt)}
                {!isSessionValidIso(t.entryAt) && (
                  <span title="Entry falls outside NSE regular hours (09:15–15:30 IST)"> ⚠</span>
                )}
              </td>
              <td className={`px-2 py-1.5 whitespace-nowrap ${isSessionValidIso(t.exitAt) ? "" : "text-rose-400"}`}>
                {shortDateTime(t.exitAt)}
                {!isSessionValidIso(t.exitAt) && (
                  <span title="Exit falls outside NSE regular hours (09:15–15:30 IST)"> ⚠</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums" title={t.optionEntry == null ? "No real premium captured" : undefined}>
                {t.optionEntry == null ? "—" : num(t.optionEntry)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums" title={t.optionExit == null ? "No captured option exit" : undefined}>
                {t.optionExit == null ? "—" : num(t.optionExit)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{t.qty ?? "—"}</td>
              <td
                className={`px-2 py-1.5 text-right tabular-nums ${
                  t.pnl == null ? "text-muted-foreground" : t.pnl > 0 ? "text-emerald-400" : t.pnl < 0 ? "text-rose-400" : ""
                }`}
                title={t.pnl == null ? "Excluded from P&L — no captured outcome (not fabricated)" : undefined}
              >
                {t.pnl == null ? "n/a" : money(t.pnl)}
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{t.exitReason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function BlockedTable({ rows, showAttribution }: { rows: BacktestBlockedSetup[]; showAttribution: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        No blocked-setup reasoning captured in this window.
      </div>
    );
  }
  return (
    <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Idx</th>
            {showAttribution && <th className="px-2 py-1.5 font-medium">Strategy</th>}
            <th className="px-2 py-1.5 font-medium">Setup</th>
            <th className="px-2 py-1.5 font-medium">Decision</th>
            <th className="px-2 py-1.5 font-medium">Reason</th>
            {showAttribution && <th className="px-2 py-1.5 font-medium">Cat</th>}
            <th className="px-2 py-1.5 font-medium">Regime</th>
            <th className="px-2 py-1.5 text-right font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
              <td className="px-2 py-1.5">{r.indexSymbol}</td>
              {showAttribution && <td className="px-2 py-1.5">{r.strategyName ?? "—"}</td>}
              <td className="px-2 py-1.5">{r.setupKey ?? "—"}</td>
              <td className="px-2 py-1.5">{r.decision ?? "—"}</td>
              <td className="px-2 py-1.5 text-muted-foreground" title={r.blockedRule ?? r.failedCondition ?? undefined}>
                {r.reasonCode ?? r.failedCondition ?? "—"}
              </td>
              {showAttribution && (
                <td className="px-2 py-1.5">
                  {r.category ? (
                    <span
                      className={`rounded px-1 text-[9px] ${
                        r.category === "RISK"
                          ? "bg-rose-500/15 text-rose-300"
                          : r.category === "DATA"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.category}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              <td className="px-2 py-1.5">{r.regime ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── over-filtered empty-state callout ─────────────

function categoryWord(category: string): string {
  if (category === "DATA") return "filter (indicator data unavailable at entry)";
  if (category === "RISK") return "risk cap";
  return "confirmation filter";
}

function UnderFilteredCallout({
  blocker,
  totalTrades,
  totalBlocked,
  onRelax,
  pending,
}: {
  blocker: DominantBlocker;
  totalTrades: number;
  totalBlocked: number;
  onRelax: (b: DominantBlocker) => void;
  pending: boolean;
}) {
  const share = Math.round(blocker.sharePct);
  const relaxLabel =
    blocker.relaxKind === "DISABLE_FILTER"
      ? `Turn off ${blocker.label} & re-run`
      : blocker.relaxKind === "LOWER_RR"
        ? "Set Min R:R to 0 & re-run"
        : blocker.relaxKind === "RAISE_TRADE_CAP"
          ? "Raise daily trade cap & re-run"
          : null;
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <Filter className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-200">
              {totalTrades === 0
                ? "No trades qualified — this run looks over-filtered"
                : "Very few trades — this run looks over-filtered"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <strong className="text-foreground">{share}%</strong> of blocked setups (
              {blocker.topCount.toLocaleString("en-IN")} of{" "}
              {totalBlocked.toLocaleString("en-IN")}) were stopped by the{" "}
              <strong className="text-foreground">{blocker.label}</strong>{" "}
              {categoryWord(blocker.category)}. Relax it to see whether the strategies are genuinely
              idle or just over-filtered.
            </p>
          </div>
        </div>
        {relaxLabel ? (
          <Button size="sm" onClick={() => onRelax(blocker)} disabled={pending} className="gap-1.5">
            {pending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {relaxLabel}
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            The dominant blocker ({blocker.label}) is not a one-click-relaxable confirmation filter —
            review the blocked table below for the full reasoning.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── page ─────────────

export default function BacktestLab() {
  const [backtestMode, setBacktestMode] = useState<BacktestRunRequestBacktestMode>("OFFICIAL_ENGINE");
  const [officialSubMode, setOfficialSubMode] = useState<BacktestRunRequestMode>("REAL_REPLAY");
  const [instrument, setInstrument] = useState<BacktestRunRequestInstrument>("ALL");
  const [capital, setCapital] = useState(1_000_000);
  const [riskPct, setRiskPct] = useState(1);
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set());
  const [strategyParams, setStrategyParams] = useState<Record<string, Record<string, number>>>({});
  const [filters, setFilters] = useState<Required<BacktestFilterConfig>>(DEFAULT_FILTERS);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(3);
  const [includeCharges, setIncludeCharges] = useState(true);
  const [includeSlippage, setIncludeSlippage] = useState(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // Honest "this run was reused, not freshly computed" notice (run idempotency).
  const [cachedNotice, setCachedNotice] = useState(false);

  const isStrategyMode =
    backtestMode === "STRATEGY_RESEARCH" || backtestMode === "COMPARE_OFFICIAL_VS_STRATEGIES";

  const runsQ = useListBacktestRuns();
  const coverageQ = useGetBacktestSnapshotCoverage();
  const strategiesQ = useGetBacktestStrategies();
  const createMut = useCreateBacktestRun();
  const deleteMut = useDeleteBacktestRun();

  const runQ = useGetBacktestRun(activeRunId ?? "", {
    query: {
      enabled: Boolean(activeRunId),
      queryKey: getGetBacktestRunQueryKey(activeRunId ?? ""),
    },
  });
  const tradesQ = useGetBacktestRunTrades(activeRunId ?? "", {
    query: {
      enabled: Boolean(activeRunId),
      queryKey: getGetBacktestRunTradesQueryKey(activeRunId ?? ""),
    },
  });
  const blockedQ = useGetBacktestRunBlocked(activeRunId ?? "", {
    query: {
      enabled: Boolean(activeRunId),
      queryKey: getGetBacktestRunBlockedQueryKey(activeRunId ?? ""),
    },
  });

  const run = runQ.data;
  const summary = run?.summary ?? null;
  const dq = run?.dataQuality ?? null;
  const comparison = run?.strategyComparison ?? null;
  const trades = tradesQ.data?.items ?? [];
  const blocked = blockedQ.data?.items ?? [];
  const strategies = strategiesQ.data?.items ?? [];

  // The active run's own mode drives whether attribution columns are meaningful.
  const runIsStrategy =
    run?.backtestMode === "STRATEGY_RESEARCH" ||
    run?.backtestMode === "COMPARE_OFFICIAL_VS_STRATEGIES";

  // Empty-state reasoning: roll the blocked table up to the single dominant rule
  // so a zero/near-zero strategy run can tell the owner exactly what to relax.
  const totalBlocked = useMemo(
    () => blocked.reduce((acc, b) => acc + (b.count ?? 0), 0),
    [blocked],
  );
  const dominantBlocker = useMemo(() => computeDominantBlocker(blocked), [blocked]);
  const showOverFiltered =
    runIsStrategy &&
    run?.status === "COMPLETE" &&
    summary != null &&
    dominantBlocker != null &&
    isLikelyOverFiltered(summary.totalTrades, totalBlocked);

  function toggleStrategy(id: string) {
    setSelectedStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canRun =
    !createMut.isPending && (!isStrategyMode || selectedStrategies.size > 0);

  function triggerRun(overrides?: {
    backtestMode?: BacktestRunRequestBacktestMode;
    instrument?: BacktestRunRequestInstrument;
    filters?: Required<BacktestFilterConfig>;
    maxTradesPerDay?: number;
    strategies?: string[];
  }) {
    const effBacktestMode = overrides?.backtestMode ?? backtestMode;
    const effInstrument = overrides?.instrument ?? instrument;
    const effFilters = overrides?.filters ?? filters;
    const effMaxTradesPerDay = overrides?.maxTradesPerDay ?? maxTradesPerDay;
    const effStrategies = overrides?.strategies ?? Array.from(selectedStrategies);
    const strategyMode =
      effBacktestMode === "STRATEGY_RESEARCH" ||
      effBacktestMode === "COMPARE_OFFICIAL_VS_STRATEGIES";
    createMut.mutate(
      {
        data: {
          // OFFICIAL_ENGINE uses the sub-mode; strategy runs replay the directional
          // spot layer, so we pass DIRECTIONAL as the engine mode.
          mode: effBacktestMode === "OFFICIAL_ENGINE" ? officialSubMode : "DIRECTIONAL",
          instrument: effInstrument,
          timeframe: "15m",
          startingCapital: capital,
          riskPerTradePct: riskPct,
          backtestMode: effBacktestMode,
          ...(strategyMode
            ? {
                strategies: effStrategies,
                filters: effFilters,
                maxTradesPerDay: effMaxTradesPerDay,
                includeCharges,
                includeSlippage,
                ...(() => {
                  // Only send overrides for selected strategies that actually carry params.
                  const sp: Record<string, Record<string, number>> = {};
                  for (const id of effStrategies) {
                    const ov = strategyParams[id];
                    if (ov && Object.keys(ov).length > 0) sp[id] = ov;
                  }
                  return Object.keys(sp).length > 0 ? { strategyParams: sp } : {};
                })(),
              }
            : {}),
        },
      },
      {
        onSuccess: (r) => {
          setActiveRunId(r.id);
          setCachedNotice(Boolean(r.cached));
          void runsQ.refetch();
        },
      },
    );
  }

  function runBacktest() {
    triggerRun();
  }

  // One-click "relax the dominant blocker and re-run". Reuses the active run's
  // strategy set / mode (so a stale form selection can't silently change what we
  // re-test) and relaxes exactly the rule that blocked the most setups.
  function relaxAndRerun(blocker: DominantBlocker) {
    const runStrategies = run?.selectedStrategies ?? [];
    const effStrategies =
      selectedStrategies.size > 0 ? Array.from(selectedStrategies) : runStrategies;
    const runMode = (run?.backtestMode ?? backtestMode) as BacktestRunRequestBacktestMode;
    const runInstrument = (run?.instrument ?? instrument) as BacktestRunRequestInstrument;

    // Base the relaxation on the active run's OWN persisted filters/cap so re-runs
    // reproduce the original run exactly minus the one relaxed rule, even when the
    // form state has drifted (e.g. while viewing an older run). Fall back to the
    // current form state only for legacy runs that never persisted these.
    const baseFilters: Required<BacktestFilterConfig> = run?.filters
      ? { ...DEFAULT_FILTERS, ...run.filters }
      : filters;
    const baseMaxTradesPerDay =
      typeof run?.maxTradesPerDay === "number" ? run.maxTradesPerDay : maxTradesPerDay;

    const nextFilters = relaxFilters(baseFilters, blocker);
    setFilters(nextFilters);

    let nextMaxTradesPerDay = baseMaxTradesPerDay;
    if (blocker.relaxKind === "RAISE_TRADE_CAP") {
      nextMaxTradesPerDay = Math.min(
        20,
        Math.max(baseMaxTradesPerDay + 1, baseMaxTradesPerDay * 2),
      );
    }
    setMaxTradesPerDay(nextMaxTradesPerDay);
    // Keep the form in sync with what we actually re-run.
    setBacktestMode(runMode);
    setInstrument(runInstrument);
    if (selectedStrategies.size === 0 && runStrategies.length > 0) {
      setSelectedStrategies(new Set(runStrategies));
    }

    triggerRun({
      backtestMode: runMode,
      instrument: runInstrument,
      filters: nextFilters,
      maxTradesPerDay: nextMaxTradesPerDay,
      strategies: effStrategies,
    });
  }

  function exportCsv() {
    if (trades.length === 0) return;
    const blob = new Blob([buildTradesCsv(trades)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${run?.backtestMode ?? backtestMode}-${run?.instrument ?? instrument}-${run?.id?.slice(0, 8) ?? "run"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const runs = runsQ.data?.items ?? [];
  const coverage = coverageQ.data;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-5 w-5 text-sky-300" />
        <h1 className="text-lg font-semibold">Backtest Lab</h1>
        <span className="text-xs text-muted-foreground">
          F&amp;O research · official engine · strategy registry · compare
        </span>
      </div>

      {/* honesty banner */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Backtests use <strong>real captured data only</strong>. No synthetic option chains. Real
          Replay never fabricates an outcome — signals with no captured option exit are excluded from
          P&amp;L. Directional &amp; strategy P&amp;L use a clearly-labeled delta proxy on real spot
          moves; option/spread/volume confirmation filters are auto-disabled (no historical data).
          This is research, not advice, and not a guarantee of future results.
        </p>
      </div>

      {/* controls */}
      <Card>
        <CardContent className="space-y-4 p-4">
          {/* 3-way backtest mode */}
          <div className="flex flex-wrap gap-2">
            {BACKTEST_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setBacktestMode(m.key)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  backtestMode === m.key
                    ? "border-sky-400 bg-sky-500/10"
                    : "border-border hover:border-sky-400/40"
                }`}
              >
                <div className="font-semibold">{m.label}</div>
                <div className="mt-0.5 max-w-[300px] text-[10px] text-muted-foreground">{m.blurb}</div>
              </button>
            ))}
          </div>

          {/* official sub-mode */}
          {backtestMode === "OFFICIAL_ENGINE" && (
            <div className="flex flex-wrap gap-2">
              {OFFICIAL_SUBMODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setOfficialSubMode(m.key)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                    officialSubMode === m.key
                      ? "border-violet-400 bg-violet-500/10"
                      : "border-border hover:border-violet-400/40"
                  }`}
                >
                  <div className="font-semibold">{m.label}</div>
                  <div className="mt-0.5 max-w-[280px] text-[10px] text-muted-foreground">{m.blurb}</div>
                </button>
              ))}
            </div>
          )}

          {/* strategy picker + filters */}
          {isStrategyMode && (
            <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Strategies {selectedStrategies.size > 0 && `(${selectedStrategies.size} selected)`}
              </div>
              <StrategyPicker
                strategies={strategies}
                selected={selectedStrategies}
                onToggle={toggleStrategy}
                loading={strategiesQ.isLoading}
                error={strategiesQ.isError}
              />
              <FilterToggles filters={filters} onChange={setFilters} />
              <AdvancedParamsPanel
                strategies={strategies}
                selected={selectedStrategies}
                overrides={strategyParams}
                onChange={setStrategyParams}
              />
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs">
                  <span className="mb-1 block text-muted-foreground">Max trades / day</span>
                  <input
                    type="number"
                    value={maxTradesPerDay}
                    min={1}
                    max={20}
                    step={1}
                    onChange={(e) => setMaxTradesPerDay(Math.max(1, Number(e.target.value)))}
                    className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={includeCharges}
                    onChange={(e) => setIncludeCharges(e.target.checked)}
                  />
                  <span className="text-muted-foreground" title="Subtract modeled round-trip brokerage/taxes (estimate)">
                    Include charges (modeled)
                  </span>
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={includeSlippage}
                    onChange={(e) => setIncludeSlippage(e.target.checked)}
                  />
                  <span className="text-muted-foreground" title="Subtract modeled slippage (estimate)">
                    Include slippage (modeled)
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* shared run controls */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Instrument</span>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value as BacktestRunRequestInstrument)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                {INSTRUMENTS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Starting capital (₹)</span>
              <input
                type="number"
                value={capital}
                min={100000}
                step={100000}
                onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))}
                className="w-36 rounded-md border border-border bg-background px-2 py-1.5 text-xs tabular-nums"
              />
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Risk / trade (%)</span>
              <input
                type="number"
                value={riskPct}
                min={0.1}
                max={10}
                step={0.1}
                onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value)))}
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs tabular-nums"
                title="Used for position sizing on modeled per-unit option risk"
              />
            </label>

            <Button onClick={runBacktest} disabled={!canRun} className="gap-1.5">
              {createMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {createMut.isPending ? "Running…" : "Run backtest"}
            </Button>
          </div>

          {isStrategyMode && selectedStrategies.size === 0 && (
            <div className="text-[11px] text-muted-foreground">
              Select at least one strategy to run.
            </div>
          )}

          {createMut.isError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
              Backtest failed: {(createMut.error as Error)?.message ?? "unknown error"}
            </div>
          )}

          {cachedNotice && !createMut.isPending && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-xs text-sky-300">
              These inputs match an earlier run, so the existing result was reused (no
              duplicate created). Change any input — or refresh the candle data — to force a
              fresh run.
            </div>
          )}
        </CardContent>
      </Card>

      {/* recent runs */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {runs.slice(0, 12).map((r) => {
            const summary = summarizeRunFilters(r.filters, r.maxTradesPerDay);
            return (
              <button
                key={r.id}
                onClick={() => setActiveRunId(r.id)}
                className={`group flex flex-col items-start gap-0.5 rounded-2xl border px-3 py-1.5 text-[11px] ${
                  activeRunId === r.id ? "border-sky-400 bg-sky-500/10" : "border-border hover:border-sky-400/40"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{r.mode === "REAL_REPLAY" ? "Real" : "Dir"}</span>
                  <span>{r.instrument}</span>
                  <span className={toneFor(r.totalPnl) === "pos" ? "text-emerald-400" : toneFor(r.totalPnl) === "neg" ? "text-rose-400" : "text-muted-foreground"}>
                    {money(r.totalPnl)}
                  </span>
                  <span className="text-muted-foreground">{shortDate(r.createdAt)}</span>
                  <Trash2
                    className="h-3 w-3 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMut.mutate(
                        { id: r.id },
                        {
                          onSuccess: () => {
                            if (activeRunId === r.id) setActiveRunId(null);
                            void runsQ.refetch();
                          },
                        },
                      );
                    }}
                  />
                </span>
                <span
                  className="max-w-[16rem] truncate text-[10px] text-muted-foreground"
                  title={summary.full}
                >
                  {summary.short}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* results */}
      {activeRunId == null ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Configure a mode and run a backtest to see results.
            {coverage && (
              <div className="mt-3 text-xs">
                Mode D option-chain capture:{" "}
                {coverage.count > 0 ? (
                  <span className="text-foreground">
                    {coverage.count.toLocaleString("en-IN")} snapshots ({shortDate(coverage.earliest)} →{" "}
                    {shortDate(coverage.latest)})
                  </span>
                ) : (
                  <span>none captured yet — accrues as the prod ingestor runs.</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : runQ.isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">Loading run…</CardContent>
        </Card>
      ) : run?.status === "FAILED" ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-rose-300">
            Run failed: {run.error ?? "unknown error"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* over-filtered empty-state: surface the dominant blocker + 1-click relax */}
          {showOverFiltered && dominantBlocker && summary && (
            <UnderFilteredCallout
              blocker={dominantBlocker}
              totalTrades={summary.totalTrades}
              totalBlocked={totalBlocked}
              onRelax={relaxAndRerun}
              pending={createMut.isPending}
            />
          )}

          {/* comparison / ranking dashboard (strategy + compare modes) */}
          {comparison && <ComparisonDashboard comparison={comparison} />}

          {/* read-only "filters used" summary for this saved run */}
          <RunFiltersUsed filters={run?.filters} maxTradesPerDay={run?.maxTradesPerDay} />

          {/* summary stats */}
          {summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <Stat label="Decided trades" value={String(summary.totalTrades)} hint="Trades with a captured / modeled outcome" />
              <Stat label="Win rate" value={pct(summary.winRate)} />
              <Stat label="Net P&L" value={money(summary.totalPnl)} tone={toneFor(summary.totalPnl)} />
              <Stat label="Profit factor" value={num(summary.profitFactor)} tone={toneFor((summary.profitFactor ?? 1) - 1)} />
              <Stat label="Expectancy" value={money(summary.expectancy)} tone={toneFor(summary.expectancy)} />
              <Stat label="Max DD" value={money(summary.maxDrawdown)} tone="neg" />
              <Stat label="Return" value={pct(summary.returnPct)} tone={toneFor(summary.returnPct)} />
            </div>
          )}

          {/* charts */}
          {summary && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Equity curve</CardTitle>
                </CardHeader>
                <CardContent>
                  <EquityCurve summary={summary} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">P&amp;L distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <PnlDistribution trades={trades} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* data quality */}
          {dq && <DataQualityPanel dq={dq} />}

          {/* trades */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">
                Trades{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({trades.length}; {trades.filter((t) => t.pnl != null).length} decided)
                </span>
              </CardTitle>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={trades.length === 0} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              {tradesQ.isLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">Loading trades…</div>
              ) : (
                <TradesTable trades={trades} showAttribution={runIsStrategy} />
              )}
            </CardContent>
          </Card>

          {/* blocked setups */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Blocked / rejected setups{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({runIsStrategy ? "filter / risk / data reasoning" : "engine reasoning"})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {blockedQ.isLoading ? (
                <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
              ) : (
                <BlockedTable rows={blocked} showAttribution={runIsStrategy} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
