/**
 * Daily Analysis Module — owner-only
 *
 * Full Pre/Post Market Analysis page showing:
 *  – PREPOST bot status, scheduler, last send records
 *  – Pre-market analysis: all required sections with source/availability
 *  – Post-market analysis: all required sections with source/availability
 *  – Data coverage matrix (all 20+ sections)
 *  – Report history (last 30 DB records)
 *  – Manual send controls (owner-only)
 *
 * Safety: read-only for trading state. No paper-trade creation. No real orders.
 * Broker execution: DISABLED.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sun, Moon, RefreshCw, Bot, CheckCircle2, XCircle,
  AlertCircle, Clock, Database, Activity, Shield,
  BarChart2, TableProperties, History, Info,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DataCoverageEntry {
  status: string;
  source: string | null;
  note: string;
}

interface DailyReportRecord {
  istDate: string;
  sentAt: number;
  type: string;
  isManualTest: boolean;
  telegramStatus: string;
  telegramDestination: string;
  prepostConfigStatus: string;
}

interface ReportRunRow {
  reportType: string;
  istDate: string;
  status: string;
  workerId: string | null;
  startedAt: string;
  sentAt: string | null;
  telegramStatus: string | null;
  errorCode: string | null;
  createdAt: string;
}

interface DailyAnalysisStatus {
  prepostTelegram: { enabled: boolean; status: string };
  defaultTelegram: { enabled: boolean; status: string };
  schedule: {
    preMarket: { time: string; windowMinutes: number; description: string };
    postMarket: { time: string; windowMinutes: number; description: string };
  };
  lastPreMarket: DailyReportRecord | null;
  lastPostMarket: DailyReportRecord | null;
  recentHistory: ReportRunRow[];
  coverage: Record<string, DataCoverageEntry>;
  brokerExecution: string;
  workerDedup: { mechanism: string; description: string };
}

// ── Section metadata ───────────────────────────────────────────────────────────

const PRE_MARKET_SECTIONS: Array<{ key: string; label: string; detail: string; link?: string }> = [
  { key: "overnightGlobalCues", label: "Overnight Global Cues", detail: "US, Asia, Europe indices", link: undefined },
  { key: "giftNifty", label: "GIFT Nifty / SGX Nifty", detail: "Pre-open futures indicative", link: undefined },
  { key: "fiiDiiCash", label: "FII / DII Cash (prev session)", detail: "Institutional cash flows", link: "/flows" },
  { key: "fiiDiiFno", label: "FII / DII F&O (prev session)", detail: "Futures & options participant data", link: undefined },
  { key: "participantOi", label: "Participant-wise OI Change", detail: "NSE OI participant breakdown", link: "/flows" },
  { key: "indiaVix", label: "India VIX", detail: "Volatility index; ATM IV available via option chain", link: "/option-chain" },
  { key: "keyLevelsOhlc", label: "Key Levels — Nifty / BankNifty / Sensex OHLC", detail: "Previous day OHLC, support/resistance", link: "/premarket" },
  { key: "cprPivots", label: "CPR & Floor Pivots", detail: "Central Pivot Range and floor pivots", link: "/premarket" },
  { key: "optionChainAnalytics", label: "Option Chain (PCR, Max Pain, OI Walls)", detail: "Kite option chain snapshot analytics", link: "/option-chain" },
  { key: "expectedRange", label: "Expected Range (ATM Straddle / VIX / ATR)", detail: "Daily range estimation from option premiums", link: "/premarket" },
  { key: "newsEvents", label: "News & Events Calendar", detail: "Domestic / global events, results calendar", link: undefined },
  { key: "expiryRollover", label: "Expiry / Rollover Check", detail: "Weekly / monthly expiry check from Kite instruments", link: undefined },
  { key: "biasTradePlan", label: "Bias & Trade Plan", detail: "Overall session bias from available signals", link: undefined },
];

const POST_MARKET_SECTIONS: Array<{ key: string; label: string; detail: string; link?: string }> = [
  { key: "indexPerformance", label: "Index Performance", detail: "Nifty, BankNifty, Sensex close vs open", link: "/premarket" },
  { key: "marketBreadth", label: "Market Breadth (Adv / Dec)", detail: "NSE advance/decline, 52-week highs/lows", link: undefined },
  { key: "optionChainEod", label: "Option Chain EOD Change", detail: "OI shift, PCR change, max pain movement", link: "/option-chain" },
  { key: "levelValidation", label: "Level Validation (CPR / VWAP)", detail: "How key levels held intraday", link: undefined },
  { key: "sectorMoves", label: "Sector & Stock Moves", detail: "Top sector performers and notable movers", link: "/sectors" },
  { key: "newsRecap", label: "News Recap", detail: "Key news driving price action", link: undefined },
  { key: "globalStatusCheck", label: "Global Status Check", detail: "US futures, FII provisional data", link: undefined },
  { key: "tradeJournal", label: "Trade Journal (F&O Paper Trades)", detail: "Daily F&O paper trade P&L summary", link: "/paper-reports" },
  { key: "tomorrowSetup", label: "Tomorrow Setup", detail: "Preliminary bias and levels for next session", link: undefined },
];

// ── Status badge helpers ───────────────────────────────────────────────────────

function statusBadge(status: string) {
  if (status === "AVAILABLE" || status === "TRADE_GRADE") {
    return (
      <Badge variant="outline" className="text-[10px] font-mono border-green-500/40 text-green-400 bg-green-500/5">
        AVAILABLE
      </Badge>
    );
  }
  if (status === "INFO_ONLY") {
    return (
      <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-400 bg-amber-500/5">
        INFO-ONLY
      </Badge>
    );
  }
  if (status === "SOURCE_NOT_INTEGRATED") {
    return (
      <Badge variant="outline" className="text-[10px] font-mono border-red-500/30 text-red-400/80 bg-red-500/5">
        NOT INTEGRATED
      </Badge>
    );
  }
  if (status === "STALE") {
    return (
      <Badge variant="outline" className="text-[10px] font-mono border-orange-500/40 text-orange-400">
        STALE
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] font-mono border-border/50 text-muted-foreground">
      {status}
    </Badge>
  );
}

function sourceLabel(source: string | null) {
  if (!source) return <span className="text-muted-foreground/50 italic">—</span>;
  const map: Record<string, string> = {
    kite: "Kite (authoritative)",
    computed: "Computed from available data",
    db: "PostgreSQL (paper trades)",
    scanner: "NSE Scanner (info)",
    "nse-archive": "NSE Archive (info-only, delayed)",
    "yahoo-finance": "Yahoo Finance (info-only, delayed)",
  };
  return <span className="text-muted-foreground/80 font-mono text-[10px]">{map[source] ?? source}</span>;
}

function availabilityNote(entry: DataCoverageEntry) {
  if (entry.status === "SOURCE_NOT_INTEGRATED") {
    return <span className="text-red-400/70 text-[11px]">Unavailable — data source not integrated yet</span>;
  }
  if (entry.status === "INFO_ONLY") {
    return <span className="text-amber-400/80 text-[11px]">Info-only — not trade-grade; {entry.note}</span>;
  }
  return <span className="text-green-400/80 text-[11px]">{entry.note}</span>;
}

function telegramResultBadge(status: string | null) {
  if (!status) return null;
  if (status === "SENT") return <span className="text-green-400 text-[10px] font-mono">✅ SENT</span>;
  if (status.startsWith("PREPOST_TELEGRAM_DISABLED")) return <span className="text-amber-400 text-[10px] font-mono">⚠ BOT DISABLED</span>;
  if (status === "CONFIG_MISSING") return <span className="text-amber-400 text-[10px] font-mono">⚠ CONFIG MISSING</span>;
  if (status === "DEDUP_SKIPPED") return <span className="text-muted-foreground text-[10px] font-mono">DEDUP SKIPPED</span>;
  if (status === "SEND_FAILED") return <span className="text-red-400 text-[10px] font-mono">❌ SEND FAILED</span>;
  return <span className="text-muted-foreground text-[10px] font-mono">{status}</span>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionRow({
  item,
  coverage,
}: {
  item: { key: string; label: string; detail: string; link?: string };
  coverage: Record<string, DataCoverageEntry> | undefined;
}) {
  const entry = coverage?.[item.key];
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-foreground/90">{item.label}</span>
          {entry && statusBadge(entry.status)}
        </div>
        <div className="text-[11px] text-muted-foreground/70 mt-0.5">{item.detail}</div>
        {entry && (
          <div className="mt-1">{availabilityNote(entry)}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0 text-right">
        <div>{entry ? sourceLabel(entry.source) : <span className="text-muted-foreground/40 text-[10px]">—</span>}</div>
        {item.link && entry?.status === "AVAILABLE" && (
          <a
            href={item.link}
            className="text-[10px] font-mono text-amber-400/70 hover:text-amber-400 transition-colors"
          >
            View →
          </a>
        )}
      </div>
    </div>
  );
}

type ActiveTab = "pre-market" | "post-market" | "coverage" | "history";

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DailyAnalysisPage() {
  const { role } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("pre-market");
  const [sending, setSending] = useState<"pre" | "post" | null>(null);
  const [lastSendResult, setLastSendResult] = useState<{ type: string; result: string } | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<DailyAnalysisStatus>({
    queryKey: ["daily-analysis-full"],
    queryFn: () => fetch("/api/daily-analysis/status").then(r => r.json() as Promise<DailyAnalysisStatus>),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: role === "owner",
  });

  const { data: historyData, refetch: refetchHistory } = useQuery<{ history: ReportRunRow[]; count: number }>({
    queryKey: ["daily-analysis-history"],
    queryFn: () =>
      fetch("/api/daily-analysis/history?limit=30").then(r => r.json() as Promise<{ history: ReportRunRow[]; count: number }>),
    staleTime: 30_000,
    enabled: role === "owner" && activeTab === "history",
  });

  async function handleSend(type: "pre" | "post") {
    setSending(type);
    setLastSendResult(null);
    try {
      const path = type === "pre" ? "generate-pre-market" : "generate-post-market";
      const res = await fetch(`/api/daily-analysis/${path}`, { method: "POST" });
      const body = (await res.json()) as { result?: string; error?: string; message?: string };
      if (res.status === 429) {
        setLastSendResult({ type, result: `RATE_LIMITED — ${body.message ?? "retry later"}` });
      } else {
        setLastSendResult({ type, result: body.result ?? body.error ?? "UNKNOWN" });
        void refetch();
        void refetchHistory();
      }
    } catch {
      setLastSendResult({ type, result: "FETCH_ERROR" });
    } finally {
      setSending(null);
    }
  }

  if (role !== "owner") {
    return (
      <div className="w-full px-4 py-12 text-center">
        <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <div className="text-sm text-muted-foreground">This page is owner-only.</div>
      </div>
    );
  }

  const botEnabled = data?.prepostTelegram.enabled;
  const botStatus = data?.prepostTelegram.status ?? "";

  const tabs: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
    { id: "pre-market", label: "Pre-Market", icon: <Sun className="w-3.5 h-3.5" /> },
    { id: "post-market", label: "Post-Market", icon: <Moon className="w-3.5 h-3.5" /> },
    { id: "coverage", label: "Coverage Matrix", icon: <TableProperties className="w-3.5 h-3.5" /> },
    { id: "history", label: "History", icon: <History className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="w-full px-4 py-6 space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">Daily Analysis Module</div>
            <div className="text-[10px] font-mono uppercase text-muted-foreground/70 mt-0.5">
              Pre / Post Market Reports — Owner Only
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] font-mono ${botEnabled ? "border-green-500/40 text-green-400" : "border-amber-500/40 text-amber-400"}`}
          >
            <Bot className="w-3 h-3 mr-1" />
            {isLoading ? "..." : botEnabled ? "PREPOST BOT CONFIGURED" : botStatus.replace("PREPOST_TELEGRAM_", "") || "BOT NOT CONFIGURED"}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono border-red-500/30 text-red-400/80">
            <Shield className="w-3 h-3 mr-1" />
            BROKER DISABLED
          </Badge>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* PREPOST Bot */}
        <Card className="border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Bot className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">PREPOST Bot</span>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : botEnabled ? (
              <div className="flex items-center gap-1 text-green-400 text-xs font-mono">
                <CheckCircle2 className="w-3.5 h-3.5" /> Configured
              </div>
            ) : (
              <div className="flex items-center gap-1 text-amber-400 text-xs font-mono">
                <AlertCircle className="w-3.5 h-3.5" /> {botStatus.replace("PREPOST_TELEGRAM_", "") || "Not configured"}
              </div>
            )}
            <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">
              Pre/post reports only
            </div>
          </CardContent>
        </Card>

        {/* Last Pre-Market */}
        <Card className="border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Last Pre-Market</span>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : data?.lastPreMarket ? (
              <>
                <div className="text-xs font-mono text-foreground/90">{data.lastPreMarket.istDate}</div>
                <div className="mt-0.5">{telegramResultBadge(data.lastPreMarket.telegramStatus)}</div>
                {data.lastPreMarket.isManualTest && (
                  <div className="text-[10px] text-muted-foreground/50 italic mt-0.5">[test]</div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground/60 font-mono">None since start</div>
            )}
            <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">
              {data?.schedule.preMarket.time ?? "08:50 IST"}
            </div>
          </CardContent>
        </Card>

        {/* Last Post-Market */}
        <Card className="border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Moon className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Last Post-Market</span>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : data?.lastPostMarket ? (
              <>
                <div className="text-xs font-mono text-foreground/90">{data.lastPostMarket.istDate}</div>
                <div className="mt-0.5">{telegramResultBadge(data.lastPostMarket.telegramStatus)}</div>
                {data.lastPostMarket.isManualTest && (
                  <div className="text-[10px] text-muted-foreground/50 italic mt-0.5">[test]</div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground/60 font-mono">None since start</div>
            )}
            <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">
              {data?.schedule.postMarket.time ?? "15:45 IST"}
            </div>
          </CardContent>
        </Card>

        {/* Scheduler / Dedup */}
        <Card className="border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Dedup</span>
            </div>
            <div className="flex items-center gap-1 text-green-400 text-[11px] font-mono">
              <CheckCircle2 className="w-3 h-3" /> DB-backed
            </div>
            <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">
              UNIQUE(report_type, ist_date)
            </div>
            <div className="text-[10px] font-mono text-muted-foreground/50 mt-0.5">
              Multi-worker safe
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manual controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => void handleSend("pre")}
          disabled={sending !== null || isFetching || !botEnabled}
          className="flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-mono text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          <Sun className="w-3.5 h-3.5" />
          {sending === "pre" ? "Sending..." : "Send Pre-Market [TEST]"}
        </button>
        <button
          type="button"
          onClick={() => void handleSend("post")}
          disabled={sending !== null || isFetching || !botEnabled}
          className="flex items-center gap-1.5 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-mono text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
        >
          <Moon className="w-3.5 h-3.5" />
          {sending === "post" ? "Sending..." : "Send Post-Market [TEST]"}
        </button>
        <button
          type="button"
          onClick={() => { void refetch(); void refetchHistory(); }}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded border border-border/40 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
        {!botEnabled && !isLoading && (
          <span className="text-[11px] font-mono text-amber-400/80 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Set PREPOST_TELEGRAM_BOT_TOKEN + PREPOST_TELEGRAM_CHAT_ID to enable sends
          </span>
        )}
        {lastSendResult && (
          <span
            className={`text-[11px] font-mono px-2 py-1 rounded border ${
              lastSendResult.result === "SENT"
                ? "border-green-500/30 text-green-400 bg-green-500/5"
                : "border-amber-500/30 text-amber-400 bg-amber-500/5"
            }`}
          >
            {lastSendResult.type === "pre" ? "Pre" : "Post"}: {lastSendResult.result}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-b-2 transition-colors -mb-px ${
              activeTab === t.id
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-muted-foreground hover:text-foreground/80"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Pre-Market */}
      {activeTab === "pre-market" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground/70 text-[11px] font-mono">
            <Activity className="w-3.5 h-3.5" />
            <span>Pre-market analysis — {PRE_MARKET_SECTIONS.length} sections · scheduled 08:50 IST weekdays</span>
          </div>
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-mono font-semibold text-amber-400 flex items-center gap-2">
                <Sun className="w-4 h-4" /> Pre-Market Analysis Sections
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {PRE_MARKET_SECTIONS.map(item => (
                <SectionRow key={item.key} item={item} coverage={data?.coverage} />
              ))}
              {isLoading && (
                <div className="text-xs text-muted-foreground font-mono py-2">Loading coverage data...</div>
              )}
            </CardContent>
          </Card>
          <div className="rounded border border-border/30 bg-card/30 px-4 py-3 text-[11px] font-mono text-muted-foreground/70 space-y-1">
            <div className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> Broker execution: DISABLED</div>
            <div className="flex items-center gap-1.5"><Info className="w-3 h-3" /> Source: Kite session + in-process state. Not a trading recommendation.</div>
            <div className="flex items-center gap-1.5"><Info className="w-3 h-3" /> INFO-ONLY sections are informational only — not used for trade decisions.</div>
          </div>
        </div>
      )}

      {/* Tab: Post-Market */}
      {activeTab === "post-market" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground/70 text-[11px] font-mono">
            <Activity className="w-3.5 h-3.5" />
            <span>Post-market analysis — {POST_MARKET_SECTIONS.length} sections · scheduled 15:45 IST weekdays</span>
          </div>
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-mono font-semibold text-blue-400 flex items-center gap-2">
                <Moon className="w-4 h-4" /> Post-Market Analysis Sections
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {POST_MARKET_SECTIONS.map(item => (
                <SectionRow key={item.key} item={item} coverage={data?.coverage} />
              ))}
              {isLoading && (
                <div className="text-xs text-muted-foreground font-mono py-2">Loading coverage data...</div>
              )}
            </CardContent>
          </Card>
          <div className="rounded border border-border/30 bg-card/30 px-4 py-3 text-[11px] font-mono text-muted-foreground/70 space-y-1">
            <div className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> Broker execution: DISABLED</div>
            <div className="flex items-center gap-1.5"><Info className="w-3 h-3" /> Source: DB paper trade records + in-process state.</div>
          </div>
        </div>
      )}

      {/* Tab: Coverage Matrix */}
      {activeTab === "coverage" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground/70 text-[11px] font-mono">
            <TableProperties className="w-3.5 h-3.5" />
            <span>Full data coverage matrix — all {Object.keys(data?.coverage ?? {}).length} sections</span>
          </div>
          {isLoading ? (
            <div className="text-xs text-muted-foreground font-mono">Loading...</div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="border-b border-border/40 bg-card/50">
                        <th className="text-left px-4 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Section</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Status</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Source</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data?.coverage ?? {}).map(([key, entry]) => (
                        <tr key={key} className="border-b border-border/20 hover:bg-card/40 transition-colors">
                          <td className="px-4 py-2 text-foreground/80 font-medium">{key}</td>
                          <td className="px-3 py-2">{statusBadge(entry.status)}</td>
                          <td className="px-3 py-2">{sourceLabel(entry.source)}</td>
                          <td className="px-3 py-2 text-muted-foreground/70 max-w-xs">{entry.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-3 gap-3 text-center text-[11px] font-mono">
            {["AVAILABLE", "INFO_ONLY", "SOURCE_NOT_INTEGRATED"].map(s => {
              const count = Object.values(data?.coverage ?? {}).filter(e => e.status === s).length;
              return (
                <div key={s} className="rounded border border-border/30 bg-card/30 px-3 py-2">
                  <div className="text-base font-bold text-foreground/90">{count}</div>
                  <div>{statusBadge(s)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: History */}
      {activeTab === "history" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground/70 text-[11px] font-mono">
            <History className="w-3.5 h-3.5" />
            <span>DB report run history — {historyData?.count ?? 0} records</span>
          </div>
          {!historyData ? (
            <div className="text-xs text-muted-foreground font-mono">Loading history...</div>
          ) : historyData.history.length === 0 ? (
            <div className="text-xs text-muted-foreground font-mono py-4 text-center">
              No report history yet — daily_report_runs table is empty.
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="border-b border-border/40 bg-card/50">
                        <th className="text-left px-4 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Date</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Type</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Status</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Telegram</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Worker</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground uppercase text-[10px] tracking-wider">Sent At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.history.map((row, i) => (
                        <tr key={i} className="border-b border-border/20 hover:bg-card/40 transition-colors">
                          <td className="px-4 py-2 text-foreground/80">{row.istDate}</td>
                          <td className="px-3 py-2">
                            <span className={row.reportType === "pre-market" ? "text-amber-400" : "text-blue-400"}>
                              {row.reportType}
                            </span>
                          </td>
                          <td className="px-3 py-2">{telegramResultBadge(row.status) ?? row.status}</td>
                          <td className="px-3 py-2">{telegramResultBadge(row.telegramStatus)}</td>
                          <td className="px-3 py-2 text-muted-foreground/60 text-[10px]">{row.workerId ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground/70">
                            {row.sentAt
                              ? new Date(row.sentAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="text-[10px] font-mono text-muted-foreground/50 px-1">
            DB table: daily_report_runs · UNIQUE(report_type, ist_date) · Multi-worker dedup
          </div>
        </div>
      )}

      {/* Footer disclaimer */}
      <div className="text-[10px] font-mono text-muted-foreground/40 border-t border-border/20 pt-3 space-y-0.5">
        <div>Broker execution: DISABLED — no real orders placed · No paper-trade creation · No signal changes · No threshold changes</div>
        <div>PREPOST bot (PREPOST_TELEGRAM_BOT_TOKEN) → daily reports only · Default bot (TELEGRAM_BOT_TOKEN) → F&O/swing/urgent alerts only</div>
      </div>
    </div>
  );
}
