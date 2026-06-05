/**
 * Backtest Lab — F&O engine backtesting (owner OR subscriber, tab-gated).
 *
 * Two honest modes:
 *   - REAL_REPLAY: 100% real. Replays the engine's actually-captured signal
 *     history + outcomes + reasoning. No fabrication; signals that expired or
 *     went stale with no captured option exit are shown but EXCLUDED from P&L.
 *   - DIRECTIONAL: replays the reconstructable directional layer on real 15-min
 *     index SPOT candles; option P&L via a clearly-LABELED delta proxy. Every
 *     modeled field is flagged; entry/exit option premiums are left blank.
 *
 * Hard rules honoured in the UI: no fake/synthetic option data, explicit
 * "unavailable" / "modeled" labelling, honest empty + loading states, never a
 * fabricated number where the source is missing.
 */
import { useMemo, useState } from "react";
import {
  useListBacktestRuns,
  useCreateBacktestRun,
  useGetBacktestRun,
  useGetBacktestRunTrades,
  useGetBacktestRunBlocked,
  useGetBacktestSnapshotCoverage,
  useDeleteBacktestRun,
  getGetBacktestRunQueryKey,
  getGetBacktestRunTradesQueryKey,
  getGetBacktestRunBlockedQueryKey,
} from "@workspace/api-client-react";
import type {
  BacktestRunRequestMode,
  BacktestRunRequestInstrument,
  BacktestSummary,
  BacktestTrade,
  BacktestDataQuality,
  BacktestBlockedSetup,
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
} from "lucide-react";

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
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(ms));
  } catch {
    return iso;
  }
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

const MODES: { key: BacktestRunRequestMode; label: string; blurb: string }[] = [
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

// ───────────── CSV export (client-side, honest — blanks stay blank) ─────────────

function buildTradesCsv(trades: BacktestTrade[]): string {
  const cols = [
    "indexSymbol",
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

function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  if (trades.length === 0) {
    return <div className="py-8 text-center text-xs text-muted-foreground">No trades in this run.</div>;
  }
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Idx</th>
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
              <td className="px-2 py-1.5">
                <span title={t.setupName ?? undefined}>{t.setupKey ?? "—"}</span>
                {t.modeled && (
                  <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300" title="DIRECTIONAL delta-proxy fill — modeled, not a real option price">
                    modeled
                  </span>
                )}
              </td>
              <td className={`px-2 py-1.5 ${t.direction === "BULLISH" ? "text-emerald-400" : "text-rose-400"}`}>
                {t.optionType ?? (t.direction === "BULLISH" ? "CE" : "PE")}
              </td>
              <td className="px-2 py-1.5 tabular-nums">{t.strike ?? "—"}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{shortDateTime(t.entryAt)}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{shortDateTime(t.exitAt)}</td>
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
  );
}

function BlockedTable({ rows }: { rows: BacktestBlockedSetup[] }) {
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
            <th className="px-2 py-1.5 font-medium">Setup</th>
            <th className="px-2 py-1.5 font-medium">Decision</th>
            <th className="px-2 py-1.5 font-medium">Reason</th>
            <th className="px-2 py-1.5 font-medium">Regime</th>
            <th className="px-2 py-1.5 text-right font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
              <td className="px-2 py-1.5">{r.indexSymbol}</td>
              <td className="px-2 py-1.5">{r.setupKey ?? "—"}</td>
              <td className="px-2 py-1.5">{r.decision ?? "—"}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{r.reasonCode ?? "—"}</td>
              <td className="px-2 py-1.5">{r.regime ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── page ─────────────

export default function BacktestLab() {
  const [mode, setMode] = useState<BacktestRunRequestMode>("REAL_REPLAY");
  const [instrument, setInstrument] = useState<BacktestRunRequestInstrument>("ALL");
  const [capital, setCapital] = useState(1_000_000);
  const [riskPct, setRiskPct] = useState(1);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const runsQ = useListBacktestRuns();
  const coverageQ = useGetBacktestSnapshotCoverage();
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
      enabled: Boolean(activeRunId) && mode === "REAL_REPLAY",
      queryKey: getGetBacktestRunBlockedQueryKey(activeRunId ?? ""),
    },
  });

  const run = runQ.data;
  const summary = run?.summary ?? null;
  const dq = run?.dataQuality ?? null;
  const trades = tradesQ.data?.items ?? [];
  const blocked = blockedQ.data?.items ?? [];

  function runBacktest() {
    createMut.mutate(
      {
        data: {
          mode,
          instrument,
          timeframe: "15m",
          startingCapital: capital,
          riskPerTradePct: riskPct,
        },
      },
      {
        onSuccess: (r) => {
          setActiveRunId(r.id);
          void runsQ.refetch();
        },
      },
    );
  }

  function exportCsv() {
    if (trades.length === 0) return;
    const blob = new Blob([buildTradesCsv(trades)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${run?.mode ?? mode}-${run?.instrument ?? instrument}-${run?.id?.slice(0, 8) ?? "run"}.csv`;
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
        <span className="text-xs text-muted-foreground">F&amp;O engine · real replay &amp; directional</span>
      </div>

      {/* honesty banner */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Backtests use <strong>real captured data only</strong>. Real Replay never fabricates an
          outcome — signals with no captured option exit are excluded from P&amp;L. Directional P&amp;L
          is a clearly-labeled delta proxy on real spot moves (option premiums are left blank). This
          is research, not advice, and not a guarantee of future results.
        </p>
      </div>

      {/* controls */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  mode === m.key
                    ? "border-sky-400 bg-sky-500/10"
                    : "border-border hover:border-sky-400/40"
                }`}
              >
                <div className="font-semibold">{m.label}</div>
                <div className="mt-0.5 max-w-[280px] text-[10px] text-muted-foreground">{m.blurb}</div>
              </button>
            ))}
          </div>

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
                title="Used for DIRECTIONAL position sizing on modeled per-unit option risk"
              />
            </label>

            <Button onClick={runBacktest} disabled={createMut.isPending} className="gap-1.5">
              {createMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {createMut.isPending ? "Running…" : "Run backtest"}
            </Button>
          </div>

          {createMut.isError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
              Backtest failed: {(createMut.error as Error)?.message ?? "unknown error"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* recent runs */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {runs.slice(0, 12).map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveRunId(r.id)}
              className={`group flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${
                activeRunId === r.id ? "border-sky-400 bg-sky-500/10" : "border-border hover:border-sky-400/40"
              }`}
            >
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
            </button>
          ))}
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
                <TradesTable trades={trades} />
              )}
            </CardContent>
          </Card>

          {/* blocked setups (REAL_REPLAY only) */}
          {mode === "REAL_REPLAY" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Blocked / rejected setups{" "}
                  <span className="text-xs font-normal text-muted-foreground">(engine reasoning)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {blockedQ.isLoading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
                ) : (
                  <BlockedTable rows={blocked} />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
